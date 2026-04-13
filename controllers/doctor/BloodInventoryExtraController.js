// controllers/doctor/BloodInventoryExtraController.js
"use strict";

const { BloodInventory, BloodType, BloodLog } = require("../../models");

module.exports = {
  // 1️⃣ Lấy thông tin chi tiết 1 lô máu
  async getOne(req, res) {
    try {
      const { id } = req.params;

      const batch = await BloodInventory.findOne({
        where: { id },
        include: [
          {
            model: BloodType,
            as: "blood_type",
            attributes: ["abo", "rh"],
          },
        ],
      });

      if (!batch) {
        return res.json({
          status: false,
          message: "Không tìm thấy lô máu!",
        });
      }

      return res.json({
        status: true,
        data: batch,
      });
    } catch (error) {
      console.error("❌ Lỗi getOne blood-inventory:", error);
      return res.status(500).json({
        status: false,
        message: "Lỗi tải chi tiết lô máu",
      });
    }
  },
  // 2️⃣ Lấy log của 1 lô máu
  async getLogsByBatch(req, res) {
    try {
      const { batch_id } = req.params;

      const logs = await BloodLog.findAll({
        where: { batch_id },
        order: [["created_at", "DESC"]],
      });

      return res.json({
        status: true,
        data: logs,
      });
    } catch (error) {
      console.error("❌ Lỗi getLogsByBatch:", error);
      return res.status(500).json({
        status: false,
        message: "Lỗi tải nhật ký lô máu",
      });
    }
  },
  // 3️⃣ Lấy toàn bộ nhật ký kho máu
  async getAllLogs(req, res) {
    try {
      const logs = await BloodLog.findAll({
        order: [["created_at", "DESC"]],
      });

      return res.json({
        status: true,
        data: logs,
      });
    } catch (error) {
      console.error("❌ Lỗi getAllLogs:", error);
      return res.status(500).json({
        status: false,
        message: "Lỗi tải toàn bộ nhật ký",
      });
    }
  },
};
