"use strict";

const { sequelize } = require("../../models");

module.exports = {
  async index(req, res) {
    try {
      const userId = req.user?.userId || req.user?.id;
      const role = req.user?.role;

      if (!userId) {
        return res.status(401).json({ status: false, message: "Unauthorized" });
      }

      if (role && role !== "donor") {
        return res.status(403).json({ status: false, message: "Forbidden" });
      }

      const page = Math.max(parseInt(req.query.page || "1", 10), 1);
      const limitRaw = parseInt(req.query.limit || "10", 10);
      const limit = Math.min(Math.max(limitRaw, 1), 100);
      const offset = (page - 1) * limit;

      const locationExpr = `
        CASE
          WHEN c.id IS NOT NULL AND (c.locate_type IS NULL OR c.locate_type <> 'donation_site')
            THEN COALESCE(c.location, '')
          ELSE CONCAT_WS(' - ',
                COALESCE(ds_camp.name, ds_appt.name, ''),
                COALESCE(ds_camp.address, ds_appt.address, '')
          )
        END
      `;

      // ---- OVERVIEW + LAST DONATION ----
      const statsSql = `
        SELECT
          COUNT(*) AS total_count,
          COALESCE(SUM(d.volume_ml), 0) AS total_volume_ml,
          MAX(d.collected_at) AS last_donation_at
        FROM donations d
        JOIN appointments a ON a.id = d.appointment_id
        WHERE d.donor_user_id = :userId
      `;

      const [statsRows] = await sequelize.query(statsSql, {
        replacements: { userId },
      });

      const statsRow = statsRows?.[0] || {
        total_count: 0,
        total_volume_ml: 0,
        last_donation_at: null,
      };

      const totalCount = parseInt(statsRow.total_count || 0, 10);
      const totalVolume = parseInt(statsRow.total_volume_ml || 0, 10);
      const lastDonationAt = statsRow.last_donation_at || null;

      // ---- ELIGIBILITY ----
      let nextEligibleDate = null;
      let remainingDays = 0;
      let progressPercent = 0;

      if (lastDonationAt) {
        const last = new Date(lastDonationAt);
        const next = new Date(last);
        next.setDate(next.getDate() + 90);
        nextEligibleDate = next;

        const now = new Date();

        const msPerDay = 24 * 60 * 60 * 1000;
        const diffMs = next.setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0);
        remainingDays = Math.max(Math.ceil(diffMs / msPerDay), 0);

        const elapsedDays = 90 - remainingDays;
        progressPercent = Math.min(Math.max(Math.round((elapsedDays / 90) * 100), 0), 100);
      }

      // ---- TOTAL RECORDS ----
      const countSql = `
        SELECT COUNT(*) AS total_records
        FROM donations d
        JOIN appointments a ON a.id = d.appointment_id
        LEFT JOIN campaigns c ON c.id = a.campaign_id
        LEFT JOIN donation_sites ds_appt ON ds_appt.id = a.donation_site_id
        LEFT JOIN donation_sites ds_camp ON ds_camp.id = c.donation_site_id
        WHERE d.donor_user_id = :userId
      `;

      const [countRows] = await sequelize.query(countSql, {
        replacements: { userId },
      });

      const totalRecords = parseInt(countRows?.[0]?.total_records || 0, 10);
      const totalPages = Math.max(Math.ceil(totalRecords / limit), 1);

      // ---- LIST ----
      const listSql = `
        SELECT
          d.id,
          d.collected_at,
          d.volume_ml,
          d.notes,
          d.screened_ok,
          a.appointment_code,
          a.campaign_id,
          (CASE WHEN c.id IS NULL THEN 0 ELSE 1 END) AS is_campaign,
          c.title AS campaign_title,
          (${locationExpr}) AS location_display,
          COALESCE(ds_camp.name, ds_appt.name) AS donation_site_name,
          COALESCE(ds_camp.address, ds_appt.address) AS donation_site_address
        FROM donations d
        JOIN appointments a ON a.id = d.appointment_id
        LEFT JOIN campaigns c ON c.id = a.campaign_id
        LEFT JOIN donation_sites ds_appt ON ds_appt.id = a.donation_site_id
        LEFT JOIN donation_sites ds_camp ON ds_camp.id = c.donation_site_id
        WHERE d.donor_user_id = :userId
        ORDER BY d.collected_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;

      const [rows] = await sequelize.query(listSql, {
        replacements: { userId },
      });

      return res.json({
        status: true,
        message: "OK",
        overview: {
          total_count: totalCount,
          total_volume_ml: totalVolume,
        },
        eligibility: {
          next_eligible_date: nextEligibleDate || null,
          remaining_days: remainingDays,
          progress_percent: progressPercent,
        },
        meta: {
          page,
          limit,
          total_records: totalRecords,
          total_pages: totalPages,
        },
        data: rows || [],
      });
    } catch (err) {
      console.error("DonationHistoryController.index error:", err);
      return res.status(500).json({
        status: false,
        message: "Lỗi server!",
        error: err.message,
      });
    }
  },
};