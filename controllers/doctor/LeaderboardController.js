"use strict";

const { sequelize } = require("../../models");

const normalizeLimit = (limit) => {
  const value = parseInt(limit || "50", 10);
  return Math.min(Math.max(value, 1), 100);
};

const buildDateCondition = (alias, query) => {
  const month = parseInt(query.month || "", 10);
  const year = parseInt(query.year || "", 10);

  const conditions = [];

  if (month >= 1 && month <= 12) {
    conditions.push(`MONTH(${alias}.collected_at) = ${month}`);
  }

  if (year >= 2000 && year <= 2100) {
    conditions.push(`YEAR(${alias}.collected_at) = ${year}`);
  }

  return conditions.length ? `AND ${conditions.join(" AND ")}` : "";
};

module.exports = {
  async index(req, res) {
    try {
      const limit = normalizeLimit(req.query.limit);
      const type = req.query.type || "all_time";
      const dateCondition = buildDateCondition("d", req.query);

      let orderBy = "donation_count DESC, total_blood_ml DESC";

      if (type === "volume") {
        orderBy = "total_blood_ml DESC, donation_count DESC";
      }

      if (type === "emergency") {
        orderBy = "emergency_donation_count DESC, total_blood_ml DESC";
      }

      const sql = `
        SELECT
          u.id AS donor_id,
          u.full_name,
          u.email,
          u.phone,
          u.blood_group,
          COUNT(d.id) AS donation_count,
          COALESCE(SUM(d.volume_ml), 0) AS total_blood_ml,
          SUM(CASE WHEN c.is_emergency = 1 THEN 1 ELSE 0 END) AS emergency_donation_count,
          COALESCE(dn.exp_points, 0) AS exp_points,
          COALESCE(dn.donor_rank, 'bronze') AS donor_rank
        FROM donations d
        JOIN users u ON u.id = d.donor_user_id
        LEFT JOIN appointments a ON a.id = d.appointment_id
        LEFT JOIN campaigns c ON c.id = a.campaign_id
        LEFT JOIN donors dn ON dn.user_id = u.id
        WHERE u.role = 'donor'
          ${dateCondition}
        GROUP BY
          u.id,
          u.full_name,
          u.email,
          u.phone,
          u.blood_group,
          dn.exp_points,
          dn.donor_rank
        HAVING donation_count > 0
        ORDER BY ${orderBy}
        LIMIT ${limit}
      `;

      const [rows] = await sequelize.query(sql);

      return res.json({
        status: true,
        message: "Lấy bảng xếp hạng donor thành công!",
        data: rows || [],
      });
    } catch (error) {
      console.error("LeaderboardController.index error:", error);

      return res.status(500).json({
        status: false,
        message: "Không tải được bảng xếp hạng!",
        error: error.message,
      });
    }
  },

  async campaign(req, res) {
    try {
      const limit = normalizeLimit(req.query.limit);
      const dateCondition = buildDateCondition("d", req.query);

      const sql = `
        SELECT
          u.id AS donor_id,
          u.full_name,
          u.email,
          u.phone,
          u.blood_group,
          COUNT(d.id) AS campaign_donation_count,
          COALESCE(SUM(d.volume_ml), 0) AS campaign_volume_ml,
          COALESCE(dn.donation_count, 0) AS donation_count,
          COALESCE(dn.total_blood_ml, 0) AS total_blood_ml,
          COALESCE(dn.emergency_donation_count, 0) AS emergency_donation_count,
          COALESCE(dn.exp_points, 0) AS exp_points,
          COALESCE(dn.donor_rank, 'bronze') AS donor_rank
        FROM donations d
        JOIN appointments a ON a.id = d.appointment_id
        JOIN campaigns c ON c.id = a.campaign_id
        JOIN users u ON u.id = d.donor_user_id
        LEFT JOIN donors dn ON dn.user_id = u.id
        WHERE u.role = 'donor'
          AND a.campaign_id IS NOT NULL
          ${dateCondition}
        GROUP BY
          u.id,
          u.full_name,
          u.email,
          u.phone,
          u.blood_group,
          dn.donation_count,
          dn.total_blood_ml,
          dn.emergency_donation_count,
          dn.exp_points,
          dn.donor_rank
        HAVING campaign_donation_count > 0
        ORDER BY campaign_donation_count DESC, campaign_volume_ml DESC
        LIMIT ${limit}
      `;

      const [rows] = await sequelize.query(sql);

      return res.json({
        status: true,
        message: "Lấy bảng xếp hạng donor tham gia chiến dịch thành công!",
        data: rows || [],
      });
    } catch (error) {
      console.error("LeaderboardController.campaign error:", error);

      return res.status(500).json({
        status: false,
        message: "Không tải được bảng xếp hạng chiến dịch!",
        error: error.message,
      });
    }
  },

  async emergency(req, res) {
    try {
      const limit = normalizeLimit(req.query.limit);
      const dateCondition = buildDateCondition("d", req.query);

      const sql = `
        SELECT
          u.id AS donor_id,
          u.full_name,
          u.email,
          u.phone,
          u.blood_group,
          COUNT(d.id) AS emergency_donation_count,
          COALESCE(SUM(d.volume_ml), 0) AS emergency_volume_ml,
          COALESCE(dn.donation_count, 0) AS donation_count,
          COALESCE(dn.total_blood_ml, 0) AS total_blood_ml,
          COALESCE(dn.exp_points, 0) AS exp_points,
          COALESCE(dn.donor_rank, 'bronze') AS donor_rank
        FROM donations d
        JOIN appointments a ON a.id = d.appointment_id
        JOIN campaigns c ON c.id = a.campaign_id
        JOIN users u ON u.id = d.donor_user_id
        LEFT JOIN donors dn ON dn.user_id = u.id
        WHERE u.role = 'donor'
          AND c.is_emergency = 1
          ${dateCondition}
        GROUP BY
          u.id,
          u.full_name,
          u.email,
          u.phone,
          u.blood_group,
          dn.donation_count,
          dn.total_blood_ml,
          dn.exp_points,
          dn.donor_rank
        HAVING emergency_donation_count > 0
        ORDER BY emergency_donation_count DESC, emergency_volume_ml DESC
        LIMIT ${limit}
      `;

      const [rows] = await sequelize.query(sql);

      return res.json({
        status: true,
        message: "Lấy bảng xếp hạng donor khẩn cấp thành công!",
        data: rows || [],
      });
    } catch (error) {
      console.error("LeaderboardController.emergency error:", error);

      return res.status(500).json({
        status: false,
        message: "Không tải được bảng xếp hạng khẩn cấp!",
        error: error.message,
      });
    }
  },
};