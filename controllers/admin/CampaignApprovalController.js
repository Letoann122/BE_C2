"use strict";

const { Op } = require("sequelize");
const { Campaign, User, DonationSite } = require("../../models");

// format dd/MM/yyyy
const fmt = (d) => {
  if (!d) return "";
  const dt = new Date(d);
  const day = String(dt.getUTCDate()).padStart(2, "0");
  const month = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const year = dt.getUTCFullYear();
  return `${day}/${month}/${year}`;
};

module.exports = {
  // ===========================================
  // GET /admin/campaigns/pending
  // ===========================================
  async listPending(req, res) {
    try {
      const { q = "", type = "" } = req.query;

      const where = { approval_status: "pending" };

      if (type === "0") where.is_emergency = 0;
      if (type === "1") where.is_emergency = 1;

      const keyword = q.trim();
      if (keyword) {
        where[Op.or] = [
          { title: { [Op.like]: `%${keyword}%` } },
          { content: { [Op.like]: `%${keyword}%` } },
          { location: { [Op.like]: `%${keyword}%` } },
        ];
      }

      const campaigns = await Campaign.findAll({
        where,
        include: [
          { model: User, as: "creator", attributes: ["id", "full_name"] },
          { model: DonationSite, as: "donation_site" },
        ],
        order: [["created_at", "DESC"]],
      });

      // Gắn thêm trường format ngày
      campaigns.forEach((c) => {
        c.setDataValue("start_date_fmt", fmt(c.start_date));
        c.setDataValue("end_date_fmt", fmt(c.end_date));
      });

      return res.json({ status: true, data: campaigns });
    } catch (err) {
      console.error("listPending error:", err);
      return res.status(500).json({ status: false, message: err.message });
    }
  },

  // ===========================================
  // GET /admin/campaigns  (QUẢN LÝ)
  // ===========================================
  async listAll(req, res) {
    try {
      const { q = "", status = "", approval_status = "" } = req.query;
      const where = {};

      if (q.trim()) {
        where[Op.or] = [
          { title: { [Op.like]: `%${q}%` } },
          { content: { [Op.like]: `%${q}%` } },
          { location: { [Op.like]: `%${q}%` } },
        ];
      }

      if (approval_status) where.approval_status = approval_status;
      if (status) where.status = status;

      const campaigns = await Campaign.findAll({
        where,
        include: [
          { model: User, as: "creator", attributes: ["id", "full_name"] },
          { model: DonationSite, as: "donation_site" },
        ],
        order: [["created_at", "DESC"]],
      });

      // Gắn format ngày giống PENDING
      campaigns.forEach((c) => {
        c.setDataValue("start_date_fmt", fmt(c.start_date));
        c.setDataValue("end_date_fmt", fmt(c.end_date));
      });

      return res.json({ status: true, data: campaigns });
    } catch (err) {
      console.error("listAll error:", err);
      return res.status(500).json({ status: false, message: err.message });
    }
  },

  // ===========================================
  // APPROVE
  // ===========================================
  async approve(req, res) {
    try {
      const { id } = req.params;

      const campaign = await Campaign.findByPk(id);
      if (!campaign) return res.json({ status: false, message: "Không tìm thấy chiến dịch" });

      if (campaign.approval_status === "approved")
        return res.json({ status: true, message: "Đã duyệt trước đó", data: campaign });

      await campaign.update({
        approval_status: "approved",
        reviewed_by_admin_id: req.user.userId,
        reviewed_at: new Date(),
        rejected_reason: null,
      });

      return res.json({ status: true, message: "Duyệt thành công", data: campaign });
    } catch (err) {
      console.error("approve error:", err);
      return res.status(500).json({ status: false, message: err.message });
    }
  },

  // ===========================================
  // REJECT
  // ===========================================
  async reject(req, res) {
    try {
      const { id } = req.params;
      const reason = (req.body.reason || "").trim();

      if (!reason) return res.json({ status: false, message: "Vui lòng nhập lý do" });

      const campaign = await Campaign.findByPk(id);
      if (!campaign) return res.json({ status: false, message: "Không tìm thấy chiến dịch" });

      await campaign.update({
        approval_status: "rejected",
        reviewed_by_admin_id: req.user.userId,
        reviewed_at: new Date(),
        rejected_reason: reason,
      });

      return res.json({ status: true, message: "Từ chối thành công", data: campaign });
    } catch (err) {
      console.error("reject error:", err);
      return res.status(500).json({ status: false, message: err.message });
    }
  },
};
