"use strict";

const { Appointment, User, BloodType, Campaign } = require("../../models");

module.exports = {
  async getByCampaign(req, res) {
    try {
      const { campaign_id } = req.query;

      if (!campaign_id) {
        return res.json({ status: false, message: "Thiếu campaign_id!" });
      }

      // ✅ Check campaign đã được duyệt chưa
      const camp = await Campaign.findByPk(campaign_id, {
        attributes: ["id", "approval_status"],
      });

      if (!camp) {
        return res.json({ status: false, message: "Chiến dịch không tồn tại!" });
      }

      if (camp.approval_status !== "approved") {
        return res.json({
          status: false,
          message: "Chiến dịch chưa được Admin duyệt nên không thể xem danh sách đăng ký.",
        });
      }

      const list = await Appointment.findAll({
        where: { campaign_id },
        include: [
          { model: User, as: "donor", attributes: ["full_name", "blood_group"] },
          { model: BloodType, as: "blood_type" },
        ],
        order: [["scheduled_at", "ASC"]],
      });

      return res.json({ status: true, data: list });
    } catch (err) {
      return res.status(500).json({ status: false, message: err.message });
    }
  },
};
