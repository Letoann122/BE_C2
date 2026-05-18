"use strict";

const { SlotTemplate, DonationSite } = require("../models");
const { generateFixedPointSlots } = require("../services/slotGenerateService");

module.exports = {
  async index(req, res) {
    try {
      const rows = await SlotTemplate.findAll({
        include: [
          {
            model: DonationSite,
            as: "donation_site",
            required: false,
          },
        ],
        order: [
          ["donation_site_id", "ASC"],
          ["start_time", "ASC"],
        ],
      });

      return res.json({
        status: true,
        data: rows,
      });
    } catch (error) {
      console.error("SlotTemplateController.index error:", error);

      return res.status(500).json({
        status: false,
        message: "Không tải được template slot!",
      });
    }
  },

  async update(req, res) {
    try {
      const { id } = req.params;
      const { default_capacity, is_active } = req.body;

      const template = await SlotTemplate.findByPk(id);

      if (!template) {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy template!",
        });
      }

      const payload = {
        updated_at: new Date(),
      };

      if (default_capacity !== undefined) {
        const capacity = Number(default_capacity);

        if (!Number.isInteger(capacity) || capacity <= 0) {
          return res.json({
            status: false,
            message: "Sức chứa mặc định phải lớn hơn 0!",
          });
        }

        payload.default_capacity = capacity;
      }

      if (is_active !== undefined) {
        payload.is_active = !!is_active;
      }

      await template.update(payload);

      return res.json({
        status: true,
        message: "Cập nhật template slot thành công!",
        data: template,
      });
    } catch (error) {
      console.error("SlotTemplateController.update error:", error);

      return res.status(500).json({
        status: false,
        message: "Không cập nhật được template!",
      });
    }
  },

  async generate(req, res) {
    try {
      const days = Number(req.body.days || req.query.days || 30);

      const result = await generateFixedPointSlots(days);

      return res.json({
        status: true,
        message: `Đã tự động tạo ${result.createdCount} slot.`,
        data: result,
      });
    } catch (error) {
      console.error("SlotTemplateController.generate error:", error);

      return res.status(500).json({
        status: false,
        message: "Không tự động tạo slot được!",
      });
    }
  },
};