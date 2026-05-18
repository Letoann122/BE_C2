"use strict";

const { sequelize } = require("../models");

const toNumber = (value, fallback = 0) => {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  const n = Number(value);

  return Number.isFinite(n) ? n : fallback;
};

const normalizeBloodGroup = (value) => {
  return String(value || "").trim().toUpperCase();
};

const getCompatibleBloodGroups = (requestedBloodGroup) => {
  const group = normalizeBloodGroup(requestedBloodGroup);

  const map = {
    "O-": ["O-"],
    "O+": ["O-", "O+"],
    "A-": ["O-", "A-"],
    "A+": ["O-", "O+", "A-", "A+"],
    "B-": ["O-", "B-"],
    "B+": ["O-", "O+", "B-", "B+"],
    "AB-": ["O-", "A-", "B-", "AB-"],
    "AB+": ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"],
  };

  return map[group] || [group];
};

const haversineKm = (lat1, lng1, lat2, lng2) => {
  const aLat1 = toNumber(lat1, null);
  const aLng1 = toNumber(lng1, null);
  const aLat2 = toNumber(lat2, null);
  const aLng2 = toNumber(lng2, null);

  if (aLat1 === null || aLng1 === null || aLat2 === null || aLng2 === null) {
    return null;
  }

  const R = 6371;
  const dLat = ((aLat2 - aLat1) * Math.PI) / 180;
  const dLng = ((aLng2 - aLng1) * Math.PI) / 180;

  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((aLat1 * Math.PI) / 180) *
      Math.cos((aLat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));

  return Math.round(R * c * 10) / 10;
};

const daysSince = (date) => {
  if (!date) return 9999;

  const oldDate = new Date(date);
  const now = new Date();

  const diffMs =
    new Date(now).setHours(0, 0, 0, 0) -
    new Date(oldDate).setHours(0, 0, 0, 0);

  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
};

const scoreDonor = ({ donor, request, site }) => {
  let score = 0;
  const reasons = [];

  const donorBlood = normalizeBloodGroup(donor.blood_group);
  const requestBlood = normalizeBloodGroup(request.blood_group);
  const compatibleGroups = getCompatibleBloodGroups(requestBlood);

  if (donorBlood && donorBlood === requestBlood) {
    score += 40;
    reasons.push("Nhóm máu trùng khớp yêu cầu");
  } else if (compatibleGroups.includes(donorBlood)) {
    score += 30;
    reasons.push("Nhóm máu tương thích");
  }

  const distanceKm = haversineKm(
    donor.last_known_lat,
    donor.last_known_lng,
    site.latitude,
    site.longitude
  );

  if (distanceKm !== null) {
    if (distanceKm <= 3) {
      score += 20;
      reasons.push(`Rất gần điểm hiến (${distanceKm}km)`);
    } else if (distanceKm <= 8) {
      score += 14;
      reasons.push(`Khoảng cách phù hợp (${distanceKm}km)`);
    } else if (distanceKm <= 15) {
      score += 8;
      reasons.push(`Có thể di chuyển (${distanceKm}km)`);
    } else {
      reasons.push(`Khoảng cách xa (${distanceKm}km)`);
    }
  } else {
    reasons.push("Chưa có vị trí gần nhất của donor");
  }

  const lastDonationDays = daysSince(donor.last_donation_date);

  if (lastDonationDays >= 90) {
    score += 15;
    reasons.push("Đã đủ điều kiện thời gian hiến lại");
  } else {
    reasons.push(`Chưa đủ 90 ngày từ lần hiến gần nhất (${lastDonationDays} ngày)`);
  }

  const donationCount = toNumber(donor.donation_count);
  const historyScore = Math.min(donationCount * 2, 10);

  if (historyScore > 0) {
    score += historyScore;
    reasons.push(`Có lịch sử hiến máu tốt (${donationCount} lần)`);
  }

  const emergencyCount = toNumber(donor.emergency_donation_count);
  const emergencyScore = Math.min(emergencyCount * 3, 10);

  if (emergencyScore > 0) {
    score += emergencyScore;
    reasons.push(`Từng hỗ trợ hiến máu khẩn cấp (${emergencyCount} lần)`);
  }

  if (donor.last_location_at) {
    const locationDays = daysSince(donor.last_location_at);

    if (locationDays <= 7) {
      score += 5;
      reasons.push("Vị trí donor được cập nhật gần đây");
    }
  }

  score = Math.min(Math.max(Math.round(score), 0), 100);

  return {
    score,
    distance_km: distanceKm,
    reasons,
    eligible: lastDonationDays >= 90,
    last_donation_days: lastDonationDays,
  };
};

const getEmergencyRecommendations = async ({ emergencyRequestId, limit = 20 }) => {
  const [requestRows] = await sequelize.query(
    `
      SELECT
        er.*,
        ds.name AS donation_site_name,
        ds.address AS donation_site_address,
        ds.lat AS site_latitude,
        ds.lon AS site_longitude
      FROM emergency_requests er
      LEFT JOIN donation_sites ds ON ds.id = er.donation_site_id
      WHERE er.id = :emergencyRequestId
      LIMIT 1
    `,
    {
      replacements: { emergencyRequestId },
    }
  );

  const request = requestRows?.[0];

  if (!request) {
    throw new Error("Không tìm thấy yêu cầu khẩn cấp!");
  }

  if (!request.donation_site_id) {
    throw new Error("Yêu cầu khẩn cấp chưa có điểm tiếp nhận!");
  }

  const site = {
    id: request.donation_site_id,
    name: request.donation_site_name,
    address: request.donation_site_address,
    latitude: request.site_latitude,
    longitude: request.site_longitude,
  };

  const compatibleGroups = getCompatibleBloodGroups(request.blood_group);

  const [donorRows] = await sequelize.query(
    `
      SELECT
        u.id AS donor_id,
        u.full_name,
        u.email,
        u.phone,
        COALESCE(u.blood_group, CONCAT(bt.abo, bt.rh)) AS blood_group,
        d.address,
        d.last_donation_date,
        COALESCE(d.donation_count, 0) AS donation_count,
        COALESCE(d.emergency_donation_count, 0) AS emergency_donation_count,
        d.last_known_lat,
        d.last_known_lng,
        d.last_location_at
      FROM users u
      JOIN donors d ON d.user_id = u.id
      LEFT JOIN blood_types bt ON bt.id = d.blood_type_id
      WHERE u.role = 'donor'
        AND COALESCE(u.blood_group, CONCAT(bt.abo, bt.rh)) IN (:compatibleGroups)
        AND NOT EXISTS (
          SELECT 1
          FROM emergency_request_responses err
          WHERE err.donor_id = u.id
            AND err.response_status = 'declined'
            AND err.responded_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        )
      ORDER BY COALESCE(d.donation_count, 0) DESC
      LIMIT 200
    `,
    {
      replacements: { compatibleGroups },
    }
  );

  const recommendations = donorRows
    .map((donor) => {
      const scored = scoreDonor({
        donor,
        request,
        site,
      });

      return {
        donor_id: donor.donor_id,
        full_name: donor.full_name,
        email: donor.email,
        phone: donor.phone,
        blood_group: donor.blood_group,
        address: donor.address,
        score: scored.score,
        distance_km: scored.distance_km,
        eligible: scored.eligible,
        last_donation_days: scored.last_donation_days,
        donation_count: Number(donor.donation_count || 0),
        emergency_donation_count: Number(donor.emergency_donation_count || 0),
        reasons: scored.reasons,
        reason_summary: scored.reasons.join(" | "),
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Number(limit || 20));

  return {
    request,
    site,
    recommendations,
  };
};

module.exports = {
  getCompatibleBloodGroups,
  haversineKm,
  scoreDonor,
  getEmergencyRecommendations,
};