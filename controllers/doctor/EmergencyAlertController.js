"use strict";

const { Notification } = require("../../models");

module.exports = {
  async createEmergencyAlert(req, res) {
    try {
      const { title, content } = req.body;
      const currentUserId = req.user?.id || req.user?.userId;

      if (!title || !content) {
        return res.status(400).json({
          status: false,
          message: "Tiêu đề và nội dung là bắt buộc.",
        });
      }
      const alert = await Notification.create({
        user_id: currentUserId,
        title,
        content,
        recipient: "all",
        emergency: 1,
        sent_count: 0,
        status: "sent",
      });
      return res.status(200).json({
        status: true,
        message: "Tạo cảnh báo khẩn cấp thành công.",
        data: alert,
      });
    } catch (err) {
      console.error("❌ Lỗi tạo alert:", err);
      return res.status(500).json({
        status: false,
        message: "Lỗi hệ thống khi tạo alert.",
      });
    }
  },
  async getEmergencyAlert(req, res) {
    try {
      const alert = await Notification.findOne({
        where: { emergency: 1 },
        order: [["created_at", "DESC"]],
      });
      return res.status(200).json({
        status: true,
        data: alert || null,
      });
    } catch (err) {
      console.error("❌ Lỗi lấy alert:", err);
      return res.status(500).json({
        status: false,
        message: "Không thể tải thông báo khẩn cấp.",
      });
    }
  },
};
