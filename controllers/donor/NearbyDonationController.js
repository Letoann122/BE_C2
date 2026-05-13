"use strict";

const { Op } = require("sequelize");
const {
  DonationSite,
  Campaign,
  AppointmentSlot,
  Hospital,
} = require("../../models");

const toNumberOrNull = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const normalizeText = (value = "") =>
  String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const formatDateLocal = (date) => {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const startOfDay = (date = new Date()) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const addDays = (date, days) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

const haversineDistanceKm = (lat1, lon1, lat2, lon2) => {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((R * c).toFixed(1));
};

const emptySlotBreakdown = () => ({
  morning: {
    label: "Ca sáng",
    time_range: "07:00 - 11:00",
    current_count: 0,
    slot_capacity: 0,
    available_count: 0,
    percent: 0,
    is_full: false,
    slot_ids: [],
  },
  afternoon: {
    label: "Ca chiều",
    time_range: "13:00 - 17:00",
    current_count: 0,
    slot_capacity: 0,
    available_count: 0,
    percent: 0,
    is_full: false,
    slot_ids: [],
  },
});

const getSlotKey = (startTime) => {
  const value = String(startTime || "").slice(0, 5);
  if (value < "12:00") return "morning";
  return "afternoon";
};

const addSlotToBreakdown = (breakdown, slot) => {
  if (!slot) return breakdown;

  const plain = typeof slot.toJSON === "function" ? slot.toJSON() : slot;
  const key = getSlotKey(plain.start_time);

  const current = Number(plain.current_count || 0);
  const capacity = Number(plain.slot_capacity || 0);
  const available = Math.max(capacity - current, 0);

  breakdown[key].current_count += current;
  breakdown[key].slot_capacity += capacity;
  breakdown[key].available_count += available;
  breakdown[key].slot_ids.push(plain.id);

  breakdown[key].is_full =
    breakdown[key].slot_capacity > 0 &&
    breakdown[key].current_count >= breakdown[key].slot_capacity;

  breakdown[key].percent =
    breakdown[key].slot_capacity > 0
      ? Math.round(
          (breakdown[key].current_count / breakdown[key].slot_capacity) * 100
        )
      : 0;

  return breakdown;
};

const getSlotSummary = (breakdown) => {
  const morning = breakdown.morning;
  const afternoon = breakdown.afternoon;

  const available_slots =
    Number(morning.available_count || 0) + Number(afternoon.available_count || 0);

  const total_capacity =
    Number(morning.slot_capacity || 0) + Number(afternoon.slot_capacity || 0);

  const current_count =
    Number(morning.current_count || 0) + Number(afternoon.current_count || 0);

  const percent =
    total_capacity > 0 ? Math.round((current_count / total_capacity) * 100) : 0;

  return {
    available_slots,
    total_capacity,
    current_count,
    percent,
    is_full: total_capacity > 0 && current_count >= total_capacity,
  };
};

const getSiteStatusText = (availableSlots) => {
  if (availableSlots > 0) return "Đang tiếp nhận";
  return "Tạm hết chỗ";
};

const getCampaignStatusText = (targetDate, startDate, endDate) => {
  const t = formatDateLocal(targetDate);
  const s = String(startDate).slice(0, 10);
  const e = String(endDate).slice(0, 10);

  if (t >= s && t <= e) return "Đang hoạt động";
  if (t < s) return "Sắp diễn ra";
  return "Đã kết thúc";
};

const matchesKeyword = (keyword, ...fields) => {
  if (!keyword) return true;
  const normalizedKeyword = normalizeText(keyword);
  return fields.some((field) =>
    normalizeText(field || "").includes(normalizedKeyword)
  );
};

const getPriority = (item) => {
  if (
    item.status_text === "Đang tiếp nhận" ||
    item.status_text === "Đang hoạt động"
  )
    return 1;
  if (item.status_text === "Sắp diễn ra") return 2;
  return 3;
};

module.exports = {
  async index(req, res) {
    try {
      const { keyword = "", distance, date = "today", lat, lon } = req.query;

      const userLat = toNumberOrNull(lat);
      const userLon = toNumberOrNull(lon);
      const maxDistance = toNumberOrNull(distance);

      const today = startOfDay(new Date());
      const tomorrow = addDays(today, 1);
      const dayAfterTomorrow = addDays(today, 2);

      let targetStart = today;
      let targetEnd = tomorrow;
      let targetSlotDate = formatDateLocal(today);

      const campaignWhere = {
        approval_status: "approved",
        status: { [Op.in]: ["running", "upcoming"] },
      };

      if (date === "tomorrow") {
        targetStart = tomorrow;
        targetEnd = dayAfterTomorrow;
        targetSlotDate = formatDateLocal(tomorrow);

        campaignWhere.start_date = { [Op.lte]: targetSlotDate };
        campaignWhere.end_date = { [Op.gte]: targetSlotDate };
      } else if (date === "upcoming") {
        targetStart = tomorrow;
        targetEnd = null;
        targetSlotDate = null;

        campaignWhere.start_date = { [Op.gt]: formatDateLocal(today) };
      } else {
        targetSlotDate = formatDateLocal(today);

        campaignWhere.start_date = { [Op.lte]: targetSlotDate };
        campaignWhere.end_date = { [Op.gte]: targetSlotDate };
      }

      const fixedSlotWhere = {
        type: "fixed_point",
      };

      const campaignSlotWhere = {
        type: "campaign",
      };

      if (targetSlotDate) {
        fixedSlotWhere.slot_date = targetSlotDate;
        campaignSlotWhere.slot_date = targetSlotDate;
      } else {
        fixedSlotWhere.slot_date = { [Op.gte]: formatDateLocal(tomorrow) };
        campaignSlotWhere.slot_date = { [Op.gte]: formatDateLocal(tomorrow) };
      }

      const [sites, fixedSlots, campaignSlots, campaigns] = await Promise.all([
        DonationSite.findAll({
          where: { is_active: 1 },
          include: [{ model: Hospital, required: false }],
          order: [["name", "ASC"]],
        }),

        AppointmentSlot.findAll({
          where: fixedSlotWhere,
          order: [
            ["slot_date", "ASC"],
            ["start_time", "ASC"],
          ],
        }),

        AppointmentSlot.findAll({
          where: campaignSlotWhere,
          order: [
            ["slot_date", "ASC"],
            ["start_time", "ASC"],
          ],
        }),

        Campaign.findAll({
          where: campaignWhere,
          include: [
            {
              model: DonationSite,
              as: "donation_site",
              required: false,
              include: [{ model: Hospital, required: false }],
            },
          ],
          order: [["start_date", "ASC"]],
        }),
      ]);

      const siteSlotMap = fixedSlots.reduce((acc, slot) => {
        const plain = slot.toJSON();
        if (!acc[plain.donation_site_id]) {
          acc[plain.donation_site_id] = emptySlotBreakdown();
        }

        addSlotToBreakdown(acc[plain.donation_site_id], plain);
        return acc;
      }, {});

      const campaignSlotMap = campaignSlots.reduce((acc, slot) => {
        const plain = slot.toJSON();
        if (!plain.campaign_id) return acc;

        if (!acc[plain.campaign_id]) {
          acc[plain.campaign_id] = emptySlotBreakdown();
        }

        addSlotToBreakdown(acc[plain.campaign_id], plain);
        return acc;
      }, {});

      const siteItems = sites
        .map((site) => {
          const plain = site.toJSON();
          const latValue = toNumberOrNull(plain.lat);
          const lonValue = toNumberOrNull(plain.lon);

          const distanceKm =
            userLat != null &&
            userLon != null &&
            latValue != null &&
            lonValue != null
              ? haversineDistanceKm(userLat, userLon, latValue, lonValue)
              : null;

          const slots = siteSlotMap[plain.id] || emptySlotBreakdown();
          const summary = getSlotSummary(slots);

          const badges = [];

          if (summary.available_slots > 0) {
            badges.push(`${summary.available_slots} chỗ trống`);
          }

          if (slots.morning.slot_capacity > 0) {
            badges.push(
              `Sáng: ${slots.morning.available_count}/${slots.morning.slot_capacity}`
            );
          }

          if (slots.afternoon.slot_capacity > 0) {
            badges.push(
              `Chiều: ${slots.afternoon.available_count}/${slots.afternoon.slot_capacity}`
            );
          }

          if (plain.Hospital?.name) {
            badges.push(`BV: ${plain.Hospital.name}`);
          }

          return {
            id: plain.id,
            type: "site",
            name: plain.name,
            address: plain.address || "",
            lat: latValue,
            lon: lonValue,
            distance_km: distanceKm,
            status_text: getSiteStatusText(summary.available_slots),
            available_slots: summary.available_slots,
            total_capacity: summary.total_capacity,
            current_count: summary.current_count,
            percent: summary.percent,
            is_full: summary.is_full,
            slots,
            badges,
            hospital_name: plain.Hospital?.name || null,
            start_date: null,
            end_date: null,
          };
        })
        .filter((item) =>
          matchesKeyword(keyword, item.name, item.address, item.hospital_name)
        )
        .filter((item) => {
          if (maxDistance == null || item.distance_km == null) return true;
          return item.distance_km <= maxDistance;
        });

      const campaignItems = campaigns
        .map((campaign) => {
          const plain = campaign.toJSON();
          const site = plain.donation_site || null;

          const latValue = toNumberOrNull(site?.lat);
          const lonValue = toNumberOrNull(site?.lon);

          const distanceKm =
            userLat != null &&
            userLon != null &&
            latValue != null &&
            lonValue != null
              ? haversineDistanceKm(userLat, userLon, latValue, lonValue)
              : null;

          const address = plain.location || site?.address || site?.name || "";
          const statusText = getCampaignStatusText(
            targetStart,
            plain.start_date,
            plain.end_date
          );

          const slots = campaignSlotMap[plain.id] || emptySlotBreakdown();
          const summary = getSlotSummary(slots);

          const badges = [];

          if (plain.is_emergency) badges.push("Khẩn cấp");
          if (site?.name) badges.push(`Tại: ${site.name}`);

          if (summary.available_slots > 0) {
            badges.push(`${summary.available_slots} chỗ trống`);
          }

          if (slots.morning.slot_capacity > 0) {
            badges.push(
              `Sáng: ${slots.morning.available_count}/${slots.morning.slot_capacity}`
            );
          }

          if (slots.afternoon.slot_capacity > 0) {
            badges.push(
              `Chiều: ${slots.afternoon.available_count}/${slots.afternoon.slot_capacity}`
            );
          }

          return {
            id: plain.id,
            type: "campaign",
            name: plain.title,
            address,
            lat: latValue,
            lon: lonValue,
            distance_km: distanceKm,
            status_text:
              summary.available_slots > 0 || statusText === "Sắp diễn ra"
                ? statusText
                : "Tạm hết chỗ",
            available_slots: summary.available_slots,
            total_capacity: summary.total_capacity,
            current_count: summary.current_count,
            percent: summary.percent,
            is_full: summary.is_full,
            slots,
            badges,
            hospital_name: site?.Hospital?.name || null,
            start_date: plain.start_date,
            end_date: plain.end_date,
            is_emergency: Boolean(plain.is_emergency),
            donation_site_id: plain.donation_site_id || null,
          };
        })
        .filter((item) =>
          matchesKeyword(keyword, item.name, item.address, item.hospital_name)
        )
        .filter((item) => {
          if (maxDistance == null || item.distance_km == null) return true;
          return item.distance_km <= maxDistance;
        });

      const data = [...siteItems, ...campaignItems].sort((a, b) => {
        const priorityDiff = getPriority(a) - getPriority(b);
        if (priorityDiff !== 0) return priorityDiff;

        const distanceA =
          a.distance_km == null ? Number.MAX_SAFE_INTEGER : a.distance_km;
        const distanceB =
          b.distance_km == null ? Number.MAX_SAFE_INTEGER : b.distance_km;

        if (distanceA !== distanceB) return distanceA - distanceB;

        const dateA = a.start_date
          ? new Date(a.start_date).getTime()
          : Number.MAX_SAFE_INTEGER;
        const dateB = b.start_date
          ? new Date(b.start_date).getTime()
          : Number.MAX_SAFE_INTEGER;

        if (dateA !== dateB) return dateA - dateB;

        return String(a.name || "").localeCompare(String(b.name || ""), "vi");
      });

      return res.json({
        status: true,
        data,
      });
    } catch (err) {
      console.error("NearbyDonationController.index error:", err);

      return res.status(500).json({
        status: false,
        message: "Không thể tải danh sách điểm hiến máu gần bạn",
        errors: { general: [err.message] },
      });
    }
  },
};