"use strict";

const {
  getDonorAchievementProfile,
  syncDonorAchievements,
} = require("../../services/achievementService");

module.exports = {
  async profile(req, res) {
    try {
      const donorUserId = req.user?.userId || req.user?.id;

      if (!donorUserId) {
        return res.status(401).json({
          status: false,
          message: "Unauthorized",
        });
      }

      const data = await getDonorAchievementProfile(donorUserId);

      return res.json({
        status: true,
        message: "Lấy achievement profile thành công!",
        data,
      });
    } catch (error) {
      console.error("AchievementController.profile error:", error);

      return res.status(500).json({
        status: false,
        message: "Không tải được achievement profile!",
        error: error.message,
      });
    }
  },

  async sync(req, res) {
    try {
      const donorUserId = req.user?.userId || req.user?.id;

      if (!donorUserId) {
        return res.status(401).json({
          status: false,
          message: "Unauthorized",
        });
      }

      const result = await syncDonorAchievements(donorUserId);

      return res.json({
        status: true,
        message: "Đồng bộ achievement thành công!",
        data: result,
      });
    } catch (error) {
      console.error("AchievementController.sync error:", error);

      return res.status(500).json({
        status: false,
        message: "Không đồng bộ được achievement!",
        error: error.message,
      });
    }
  },
};