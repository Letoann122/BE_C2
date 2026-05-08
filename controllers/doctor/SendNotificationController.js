"use strict";

const { Op } = require("sequelize");
const { User, Donor, Notification } = require("../../models");
const { sendMail } = require("../../services/mailService");
const { emitEmergencyAlertUpdated } = require("../../socket");

module.exports = {
  async sendNotification(req, res) {
    try {
      const { title, recipient, emergency, content, expires_at } = req.body;
      const currentUserId = req.user?.id || req.user?.userId || null;

      if (!title || !content) {
        return res.status(400).json({
          status: false,
          message: "Tiêu đề và nội dung không được để trống.",
        });
      }

      if (emergency && !expires_at) {
        return res.status(400).json({
          status: false,
          message: "Vui lòng chọn thời gian hết hạn cho cảnh báo khẩn cấp.",
        });
      }

      if (emergency && new Date(expires_at) <= new Date()) {
        return res.status(400).json({
          status: false,
          message: "Thời gian hết hạn phải lớn hơn thời gian hiện tại.",
        });
      }

      const donors = await Donor.findAll({
        where: { tinh_trang: 1 },
        attributes: ["id", "user_id"],
      });

      if (donors.length === 0) {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy donor nào đang hoạt động.",
        });
      }

      const userIds = donors.map((d) => d.user_id);

      const users = await User.findAll({
        where: {
          id: userIds,
          role: "donor",
          ...(recipient !== "all" ? { blood_group: recipient } : {}),
        },
        attributes: ["id", "full_name", "email", "blood_group"],
      });

      const validUsers = users.filter((u) => u.email && u.email.trim() !== "");

      if (validUsers.length === 0) {
        return res.status(404).json({
          status: false,
          message: "Không có donor phù hợp để gửi thông báo.",
        });
      }

      const subject = (emergency ? "[KHẨN CẤP] " : "") + title;

      await Promise.all(
        validUsers.map((u) =>
          sendMail({
            to: u.email,
            subject,
            template: "support_notification",
            context: {
              ten: u.full_name,
              nhom_mau: u.blood_group,
              title,
              noi_dung: content,
              emergency: !!emergency,
              expires_at: emergency ? expires_at : null,
            },
          })
        )
      );

      const saved = await Notification.create({
        user_id: currentUserId,
        title,
        content,
        recipient,
        emergency: !!emergency,
        sent_count: validUsers.length,
        status: "sent",
        is_active: emergency ? 1 : 0,
        expires_at: emergency ? expires_at : null,
        closed_at: null,
        closed_by_user_id: null,
      });

      if (saved.emergency && saved.is_active) {
        emitEmergencyAlertUpdated({
          action: "created",
          alert: saved,
        });
      }

      return res.status(200).json({
        status: true,
        message: `Đã gửi đến ${validUsers.length} donor.`,
        sent_count: validUsers.length,
        notification: saved,
      });
    } catch (err) {
      console.error("❌ Lỗi gửi thông báo:", err);
      return res.status(500).json({
        status: false,
        message: "Lỗi hệ thống khi gửi thông báo.",
      });
    }
  },

  async listNotifications(req, res) {
    try {
      const list = await Notification.findAll({
        order: [["created_at", "DESC"]],
      });

      return res.json({
        status: true,
        data: list,
      });
    } catch (err) {
      console.error("❌ Lỗi lấy danh sách:", err);
      return res.status(500).json({
        status: false,
        message: "Không thể tải danh sách thông báo.",
      });
    }
  },

  async closeNotification(req, res) {
    try {
      const { id } = req.params;
      const currentUserId = req.user?.id || req.user?.userId || null;

      const notification = await Notification.findByPk(id);

      if (!notification) {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy thông báo.",
        });
      }

      if (!notification.emergency) {
        return res.status(400).json({
          status: false,
          message: "Chỉ cảnh báo khẩn cấp mới cần tắt.",
        });
      }

      if (!notification.is_active) {
        return res.json({
          status: true,
          message: "Cảnh báo này đã được tắt trước đó.",
          data: notification,
        });
      }

      notification.is_active = 0;
      notification.closed_at = new Date();
      notification.closed_by_user_id = currentUserId;

      await notification.save();

      emitEmergencyAlertUpdated({
        action: "closed",
        alert_id: notification.id,
      });

      return res.json({
        status: true,
        message: "Đã tắt cảnh báo khẩn cấp.",
        data: notification,
      });
    } catch (err) {
      console.error("❌ Lỗi tắt cảnh báo:", err);
      return res.status(500).json({
        status: false,
        message: "Lỗi hệ thống khi tắt cảnh báo.",
      });
    }
  },

  async activeEmergency(req, res) {
    try {
      const alert = await Notification.findOne({
        where: {
          emergency: 1,
          is_active: 1,
          status: "sent",
          expires_at: {
            [Op.gt]: new Date(),
          },
        },
        order: [["created_at", "DESC"]],
      });

      return res.json({
        status: true,
        data: alert,
      });
    } catch (err) {
      console.error("❌ Lỗi lấy cảnh báo khẩn cấp:", err);
      return res.status(500).json({
        status: false,
        message: "Không thể tải cảnh báo khẩn cấp.",
      });
    }
  },
};