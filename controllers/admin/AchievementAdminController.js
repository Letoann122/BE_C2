"use strict";

const { Achievement } = require("../../models");

const VALID_TYPES = [
  "donation_count",
  "donation_volume",
  "campaign",
  "emergency",
  "streak",
  "special",
];

module.exports = {
  async index(req, res) {
    try {
      const rows = await Achievement.findAll({
        order: [
          ["sort_order", "ASC"],
          ["id", "ASC"],
        ],
      });

      return res.json({
        status: true,
        message: "Lấy danh sách huy hiệu thành công!",
        data: rows,
      });
    } catch (error) {
      console.error("AchievementAdminController.index error:", error);

      return res.status(500).json({
        status: false,
        message: "Không tải được danh sách huy hiệu!",
        error: error.message,
      });
    }
  },

  async store(req, res) {
    try {
      const {
        code,
        name,
        description,
        icon,
        badge_color,
        achievement_type,
        requirement_value,
        exp_reward,
        sort_order,
      } = req.body;

      if (!code || !name) {
        return res.status(400).json({
          status: false,
          message: "Vui lòng nhập mã và tên huy hiệu!",
        });
      }

      if (!VALID_TYPES.includes(achievement_type)) {
        return res.status(400).json({
          status: false,
          message: "Loại huy hiệu không hợp lệ!",
        });
      }

      const existed = await Achievement.findOne({ where: { code } });

      if (existed) {
        return res.status(400).json({
          status: false,
          message: "Mã huy hiệu đã tồn tại!",
        });
      }

      const achievement = await Achievement.create({
        code: String(code).trim().toUpperCase(),
        name,
        description: description || null,
        icon: icon || "bi-award-fill",
        badge_color: badge_color || "danger",
        achievement_type,
        requirement_value: Number(requirement_value || 0),
        exp_reward: Number(exp_reward || 0),
        sort_order: Number(sort_order || 0),
        is_active: 1,
      });

      return res.status(201).json({
        status: true,
        message: "Tạo huy hiệu thành công!",
        data: achievement,
      });
    } catch (error) {
      console.error("AchievementAdminController.store error:", error);

      return res.status(500).json({
        status: false,
        message: "Không tạo được huy hiệu!",
        error: error.message,
      });
    }
  },

  async update(req, res) {
    try {
      const { id } = req.params;

      const achievement = await Achievement.findByPk(id);

      if (!achievement) {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy huy hiệu!",
        });
      }

      const {
        name,
        description,
        icon,
        badge_color,
        achievement_type,
        requirement_value,
        exp_reward,
        sort_order,
        is_active,
      } = req.body;

      if (achievement_type && !VALID_TYPES.includes(achievement_type)) {
        return res.status(400).json({
          status: false,
          message: "Loại huy hiệu không hợp lệ!",
        });
      }

      await achievement.update({
        name: name ?? achievement.name,
        description: description ?? achievement.description,
        icon: icon ?? achievement.icon,
        badge_color: badge_color ?? achievement.badge_color,
        achievement_type: achievement_type ?? achievement.achievement_type,
        requirement_value:
          requirement_value !== undefined
            ? Number(requirement_value)
            : achievement.requirement_value,
        exp_reward:
          exp_reward !== undefined
            ? Number(exp_reward)
            : achievement.exp_reward,
        sort_order:
          sort_order !== undefined
            ? Number(sort_order)
            : achievement.sort_order,
        is_active:
          is_active !== undefined
            ? Number(is_active)
            : achievement.is_active,
      });

      return res.json({
        status: true,
        message: "Cập nhật huy hiệu thành công!",
        data: achievement,
      });
    } catch (error) {
      console.error("AchievementAdminController.update error:", error);

      return res.status(500).json({
        status: false,
        message: "Không cập nhật được huy hiệu!",
        error: error.message,
      });
    }
  },

  async toggle(req, res) {
    try {
      const { id } = req.params;

      const achievement = await Achievement.findByPk(id);

      if (!achievement) {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy huy hiệu!",
        });
      }

      achievement.is_active = Number(achievement.is_active) === 1 ? 0 : 1;
      await achievement.save();

      return res.json({
        status: true,
        message:
          Number(achievement.is_active) === 1
            ? "Đã bật huy hiệu!"
            : "Đã tắt huy hiệu!",
        data: achievement,
      });
    } catch (error) {
      console.error("AchievementAdminController.toggle error:", error);

      return res.status(500).json({
        status: false,
        message: "Không đổi được trạng thái huy hiệu!",
        error: error.message,
      });
    }
  },

  async destroy(req, res) {
    try {
      const { id } = req.params;

      const achievement = await Achievement.findByPk(id);

      if (!achievement) {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy huy hiệu!",
        });
      }

      await achievement.destroy();

      return res.json({
        status: true,
        message: "Đã xoá huy hiệu!",
      });
    } catch (error) {
      console.error("AchievementAdminController.destroy error:", error);

      return res.status(500).json({
        status: false,
        message: "Không xoá được huy hiệu!",
        error: error.message,
      });
    }
  },
};