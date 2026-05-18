"use strict";

const { Op } = require("sequelize");
const { UserNotification } = require("../../models");

const getUserId = (req) => req.user?.userId || req.user?.id;

module.exports = {
  async index(req, res) {
    try {
      const userId = getUserId(req);
      const { type, read, page = 1, limit = 20 } = req.query;

      const where = {
        user_id: userId,
      };

      if (type && type !== "all") {
        where.type = type;
      }

      if (read === "0" || read === "false") {
        where.is_read = 0;
      }

      if (read === "1" || read === "true") {
        where.is_read = 1;
      }

      const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
      const safePage = Math.max(Number(page) || 1, 1);

      const { rows, count } = await UserNotification.findAndCountAll({
        where,
        order: [["created_at", "DESC"]],
        limit: safeLimit,
        offset: (safePage - 1) * safeLimit,
      });

      const unread_count = await UserNotification.count({
        where: {
          user_id: userId,
          is_read: 0,
        },
      });

      return res.json({
        status: true,
        message: "Lấy danh sách thông báo thành công!",
        data: rows,
        meta: {
          total: count,
          page: safePage,
          limit: safeLimit,
          unread_count,
        },
      });
    } catch (error) {
      console.error("UserNotificationController.index error:", error);

      return res.status(500).json({
        status: false,
        message: "Không tải được thông báo!",
        error: error.message,
      });
    }
  },

  async markAsRead(req, res) {
    try {
      const userId = getUserId(req);
      const { id } = req.params;

      const notification = await UserNotification.findOne({
        where: {
          id,
          user_id: userId,
        },
      });

      if (!notification) {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy thông báo!",
        });
      }

      if (!notification.is_read) {
        await notification.update({
          is_read: 1,
          read_at: new Date(),
          updated_at: new Date(),
        });
      }

      return res.json({
        status: true,
        message: "Đã đánh dấu thông báo là đã đọc!",
        data: notification,
      });
    } catch (error) {
      console.error("UserNotificationController.markAsRead error:", error);

      return res.status(500).json({
        status: false,
        message: "Không thể cập nhật thông báo!",
        error: error.message,
      });
    }
  },

  async markAllAsRead(req, res) {
    try {
      const userId = getUserId(req);

      await UserNotification.update(
        {
          is_read: 1,
          read_at: new Date(),
          updated_at: new Date(),
        },
        {
          where: {
            user_id: userId,
            is_read: 0,
          },
        }
      );

      return res.json({
        status: true,
        message: "Đã đánh dấu tất cả thông báo là đã đọc!",
      });
    } catch (error) {
      console.error("UserNotificationController.markAllAsRead error:", error);

      return res.status(500).json({
        status: false,
        message: "Không thể cập nhật thông báo!",
        error: error.message,
      });
    }
  },

  async clearAll(req, res) {
    try {
      const userId = getUserId(req);

      await UserNotification.destroy({
        where: {
          user_id: userId,
        },
      });

      return res.json({
        status: true,
        message: "Đã xóa tất cả thông báo!",
      });
    } catch (error) {
      console.error("UserNotificationController.clearAll error:", error);

      return res.status(500).json({
        status: false,
        message: "Không thể xóa thông báo!",
        error: error.message,
      });
    }
  },

  async unreadCount(req, res) {
    try {
      const userId = getUserId(req);

      const unread_count = await UserNotification.count({
        where: {
          user_id: userId,
          is_read: 0,
        },
      });

      return res.json({
        status: true,
        data: {
          unread_count,
        },
      });
    } catch (error) {
      console.error("UserNotificationController.unreadCount error:", error);

      return res.status(500).json({
        status: false,
        message: "Không lấy được số thông báo chưa đọc!",
        error: error.message,
      });
    }
  },
};