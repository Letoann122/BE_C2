"use strict";

const { Op, fn, col } = require("sequelize");
const { Campaign, User, DonationSite, Appointment } = require("../../models");

module.exports = {
  // GET /admin/donation-sites
  async getDonationSites(req, res) {
    try {
      const sites = await DonationSite.findAll({
        order: [["id", "DESC"]],
      });
      return res.json({ status: true, data: sites });
    } catch (err) {
      console.error("CampaignsController.getDonationSites error:", err);
      return res.status(500).json({ status: false, message: err.message });
    }
  },

  // GET /admin/campaigns?q=&approval_status=&status=
  async getAllCampaigns(req, res) {
    try {
      const { q = "", approval_status = "", status = "" } = req.query;

      const where = {};

      if (approval_status) where.approval_status = approval_status; // pending/approved/rejected
      if (status) where.status = status; // upcoming/running/ended

      const keyword = String(q || "").trim();
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
          { model: User, as: "creator", attributes: ["id", "full_name", "email"] },
          { model: DonationSite, as: "donation_site" },
        ],
        order: [["created_at", "DESC"]],
      });

      if (!campaigns.length) return res.json({ status: true, data: [] });

      // registration_count
      const campaignIds = campaigns.map((c) => c.id);

      const counts = await Appointment.findAll({
        attributes: ["campaign_id", [fn("COUNT", col("id")), "registration_count"]],
        where: { campaign_id: { [Op.in]: campaignIds } },
        group: ["campaign_id"],
        raw: true,
      });

      const countMap = {};
      for (const row of counts) {
        countMap[row.campaign_id] = parseInt(row.registration_count, 10) || 0;
      }

      campaigns.forEach((c) => c.setDataValue("registration_count", countMap[c.id] || 0));

      return res.json({ status: true, data: campaigns });
    } catch (err) {
      console.error("CampaignsController.getAllCampaigns error:", err);
      return res.status(500).json({ status: false, message: err.message });
    }
  },

  // GET /admin/campaigns/:id
  async getCampaignDetail(req, res) {
    try {
      const { id } = req.params;

      const campaign = await Campaign.findOne({
        where: { id },
        include: [
          { model: User, as: "creator", attributes: ["id", "full_name", "email"] },
          { model: DonationSite, as: "donation_site" },
        ],
      });

      if (!campaign) {
        return res.status(404).json({ status: false, message: "Không tìm thấy chiến dịch" });
      }

      const registrationCount = await Appointment.count({ where: { campaign_id: id } });
      campaign.setDataValue("registration_count", registrationCount || 0);

      return res.json({ status: true, data: campaign });
    } catch (err) {
      console.error("CampaignsController.getCampaignDetail error:", err);
      return res.status(500).json({ status: false, message: err.message });
    }
  },

  // PUT /admin/campaigns/:id
  async updateCampaign(req, res) {
    try {
      const { id } = req.params;

      const campaign = await Campaign.findByPk(id);
      if (!campaign) {
        return res.json({ status: false, message: "Không tìm thấy chiến dịch" });
      }

      // (FE đã disable khi ended, nhưng vẫn chặn thêm cho chắc)
      if (campaign.status === "ended") {
        return res.json({ status: false, message: "Chiến dịch đã kết thúc, không thể sửa!" });
      }

      const data = req.body || {};

      // validate dates nếu có truyền
      if (data.start_date && data.end_date) {
        const start = new Date(data.start_date);
        const end = new Date(data.end_date);
        if (end < start) {
          return res.json({ status: false, message: "Ngày kết thúc phải >= ngày bắt đầu!" });
        }
      }

      const locateType = data.locate_type || campaign.locate_type || "custom";

      // build payload (không đụng approval_status ở đây)
      const payload = {
        title: data.title ?? campaign.title,
        content: data.content ?? campaign.content,
        start_date: data.start_date ?? campaign.start_date,
        end_date: data.end_date ?? campaign.end_date,
        is_emergency: data.is_emergency ?? campaign.is_emergency,
        locate_type: locateType,
        location: null,
        donation_site_id: null,
      };

      if (locateType === "custom") {
        const loc = String(data.location ?? "").trim();
        if (!loc) return res.json({ status: false, message: "Vui lòng nhập địa điểm!" });
        payload.location = loc;
        payload.donation_site_id = null;
      } else if (locateType === "donation_site") {
        const siteId = data.donation_site_id;
        if (!siteId) return res.json({ status: false, message: "Vui lòng chọn điểm hiến máu!" });
        payload.donation_site_id = siteId;
        payload.location = null;
      } else {
        return res.json({ status: false, message: "locate_type không hợp lệ!" });
      }

      await campaign.update(payload);
      await campaign.reload();

      return res.json({
        status: true,
        message: "Cập nhật chiến dịch thành công",
        data: campaign,
      });
    } catch (err) {
      console.error("CampaignsController.updateCampaign error:", err);
      return res.status(500).json({ status: false, message: err.message });
    }
  },

  // PATCH /admin/campaigns/:id/close
  async closeCampaign(req, res) {
    try {
      const { id } = req.params;

      const campaign = await Campaign.findByPk(id);
      if (!campaign) {
        return res.status(404).json({ status: false, message: "Không tìm thấy chiến dịch" });
      }

      if (campaign.status === "ended") {
        return res.json({ status: true, message: "Chiến dịch đã được đóng trước đó.", data: campaign });
      }

      await campaign.update({ status: "ended" });
      await campaign.reload();

      return res.json({ status: true, message: "Đã đóng chiến dịch thành công!", data: campaign });
    } catch (err) {
      console.error("CampaignsController.closeCampaign error:", err);
      return res.status(500).json({ status: false, message: err.message });
    }
  },
};
