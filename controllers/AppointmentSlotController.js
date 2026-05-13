"use strict";

const { Op } = require("sequelize");
const {
  sequelize,
  AppointmentSlot,
  Appointment,
  DonationSite,
  Campaign,
  User,
} = require("../models");
const {
  normalizeTime,
  isValidSlotTime,
  buildSlotPayload,
  refreshSlotCounters,
  isSlotExpired,
} = require("../services/slotCapacityService");
const {
  generateCampaignSlots,
} = require("../services/slotGenerateService");


module.exports = {
  async index(req, res) {
  try {
    const {
      type,
      campaign_id,
      donation_site_id,
      date,
      from_date,
      to_date,
    } = req.query;

    const where = {};

    if (type) where.type = type;
    if (campaign_id) where.campaign_id = campaign_id;
    if (donation_site_id) where.donation_site_id = donation_site_id;

    if (date) {
      where.slot_date = date;
    } else if (from_date || to_date) {
      where.slot_date = {};

      if (from_date) where.slot_date[Op.gte] = from_date;
      if (to_date) where.slot_date[Op.lte] = to_date;
    }

    const rows = await AppointmentSlot.findAll({
      where,
      include: [
        {
          model: DonationSite,
          as: "donation_site",
          required: false,
        },
        {
          model: Campaign,
          as: "campaign",
          required: false,
        },
      ],
      order: [
        ["slot_date", "ASC"],
        ["start_time", "ASC"],
      ],
    });

    const data = rows.map((slot) => {
      const payload = buildSlotPayload(slot);

      const date = String(payload.slot_date).slice(0, 10);
      const endTime = String(payload.end_time).slice(0, 8);

      const expired =
        new Date(`${date}T${endTime}`) < new Date();

      return {
        ...payload,
        is_expired: expired,
        can_book:
          !expired &&
          Number(payload.current_count || 0) <
            Number(payload.slot_capacity || 0),
      };
    });

    const isDonor =
      req.user?.role === "donor" ||
      String(req.originalUrl || "").includes("/donor/");

    const finalData = isDonor
      ? data.filter((slot) => !slot.is_expired)
      : data;

    return res.json({
      status: true,
      data: finalData,
    });
  } catch (error) {
    console.error("AppointmentSlotController.index error:", error);

    return res.status(500).json({
      status: false,
      message: "Không tải được danh sách slot!",
    });
  }
},

  async detail(req, res) {
    try {
      const { id } = req.params;

      const slot = await AppointmentSlot.findByPk(id, {
        include: [
          {
            model: DonationSite,
            as: "donation_site",
            required: false,
          },
          {
            model: Campaign,
            as: "campaign",
            required: false,
          },
        ],
      });

      if (!slot) {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy slot!",
        });
      }

      return res.json({
        status: true,
        data: buildSlotPayload(slot),
      });
    } catch (error) {
      console.error("AppointmentSlotController.detail error:", error);
      return res.status(500).json({
        status: false,
        message: "Không tải được chi tiết slot!",
      });
    }
  },

  async create(req, res) {
    const t = await sequelize.transaction();

    try {
      const {
        type = "fixed_point",
        campaign_id = null,
        donation_site_id = null,
        slot_date,
        start_time,
        end_time,
        slot_capacity = 10,
        location_custom = null,
      } = req.body;

      const start = normalizeTime(start_time);
      const end = normalizeTime(end_time);

      if (!slot_date || !start || !end) {
        await t.rollback();
        return res.json({
          status: false,
          message: "Vui lòng nhập ngày và khung giờ!",
        });
      }

      if (!isValidSlotTime(start, end)) {
        await t.rollback();
        return res.json({
          status: false,
          message: "Chỉ hỗ trợ 2 khung giờ: 07:00-11:00 hoặc 13:00-17:00!",
        });
      }

      if (!["fixed_point", "campaign"].includes(type)) {
        await t.rollback();
        return res.json({
          status: false,
          message: "Loại slot không hợp lệ!",
        });
      }

      if (type === "fixed_point" && !donation_site_id) {
        await t.rollback();
        return res.json({
          status: false,
          message: "Hiến máu cố định cần chọn điểm hiến!",
        });
      }

      if (type === "campaign" && !campaign_id) {
        await t.rollback();
        return res.json({
          status: false,
          message: "Slot chiến dịch cần campaign_id!",
        });
      }

      const capacity = Number(slot_capacity);

      if (!Number.isInteger(capacity) || capacity <= 0) {
        await t.rollback();
        return res.json({
          status: false,
          message: "Số lượng slot phải lớn hơn 0!",
        });
      }

      const existedWhere = {
        type,
        slot_date,
        start_time: start,
        end_time: end,
      };

      if (type === "fixed_point") {
        existedWhere.donation_site_id = donation_site_id;
      }

      if (type === "campaign") {
        existedWhere.campaign_id = campaign_id;
      }

      const existed = await AppointmentSlot.findOne({
        where: existedWhere,
        transaction: t,
      });

      if (existed) {
        await t.rollback();
        return res.json({
          status: false,
          message: "Khung giờ này đã tồn tại!",
        });
      }

      const slot = await AppointmentSlot.create(
        {
          type,
          campaign_id: campaign_id || null,
          donation_site_id: donation_site_id || null,
          slot_date,
          start_time: start,
          end_time: end,
          slot_capacity: capacity,
          current_count: 0,
          total_registered: 0,
          location_custom,
        },
        { transaction: t }
      );

      await t.commit();

      return res.json({
        status: true,
        message: "Tạo slot thành công!",
        data: buildSlotPayload(slot),
      });
    } catch (error) {
      await t.rollback();

      console.error("AppointmentSlotController.create error:", error);
      return res.status(500).json({
        status: false,
        message: "Lỗi khi tạo slot!",
      });
    }
  },

  async update(req, res) {
    const t = await sequelize.transaction();

    try {
      const { id } = req.params;
      const { slot_capacity, location_custom, start_time, end_time, slot_date } =
        req.body;

      const slot = await AppointmentSlot.findByPk(id, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!slot) {
        await t.rollback();
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy slot!",
        });
      }

      const payload = {};

      if (slot_date) payload.slot_date = slot_date;

      if (start_time || end_time) {
        const start = normalizeTime(start_time || slot.start_time);
        const end = normalizeTime(end_time || slot.end_time);

        if (!isValidSlotTime(start, end)) {
          await t.rollback();
          return res.json({
            status: false,
            message: "Chỉ hỗ trợ 2 khung giờ: 07:00-11:00 hoặc 13:00-17:00!",
          });
        }

        payload.start_time = start;
        payload.end_time = end;
      }

      if (slot_capacity !== undefined) {
        const capacity = Number(slot_capacity);

        if (!Number.isInteger(capacity) || capacity <= 0) {
          await t.rollback();
          return res.json({
            status: false,
            message: "Số lượng slot phải lớn hơn 0!",
          });
        }

        if (capacity < Number(slot.current_count)) {
          await t.rollback();
          return res.json({
            status: false,
            message: "Không thể giảm capacity nhỏ hơn số người đang đăng ký!",
          });
        }

        payload.slot_capacity = capacity;
      }

      if (location_custom !== undefined) {
        payload.location_custom = location_custom;
      }

      payload.updated_at = new Date();

      await slot.update(payload, { transaction: t });

      await t.commit();

      const data = await refreshSlotCounters(id);

      return res.json({
        status: true,
        message: "Cập nhật slot thành công!",
        data,
      });
    } catch (error) {
      await t.rollback();

      console.error("AppointmentSlotController.update error:", error);
      return res.status(500).json({
        status: false,
        message: "Lỗi khi cập nhật slot!",
      });
    }
  },

  async delete(req, res) {
    const t = await sequelize.transaction();

    try {
      const { id } = req.params;

      const slot = await AppointmentSlot.findByPk(id, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!slot) {
        await t.rollback();
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy slot!",
        });
      }

      if (Number(slot.current_count) > 0) {
        await t.rollback();
        return res.json({
          status: false,
          message: "Không thể xoá slot đang có người đăng ký!",
        });
      }

      await slot.destroy({ transaction: t });

      await t.commit();

      return res.json({
        status: true,
        message: "Xoá slot thành công!",
      });
    } catch (error) {
      await t.rollback();

      console.error("AppointmentSlotController.delete error:", error);
      return res.status(500).json({
        status: false,
        message: "Lỗi khi xoá slot!",
      });
    }
  },

  async appointments(req, res) {
    try {
      const { id } = req.params;

      const slot = await AppointmentSlot.findByPk(id);

      if (!slot) {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy slot!",
        });
      }

      const rows = await Appointment.findAll({
        where: {
          [Op.or]: [{ appointment_slot_id: id }, { slot_id: id }],
        },
        include: [
          {
            model: User,
            as: "donor",
            attributes: ["id", "full_name", "email", "phone"],
          },
          {
            model: DonationSite,
            as: "donation_site",
            required: false,
          },
          {
            model: Campaign,
            as: "campaign",
            required: false,
          },
        ],
        order: [["created_at", "DESC"]],
      });

      return res.json({
        status: true,
        slot: buildSlotPayload(slot),
        data: rows,
      });
    } catch (error) {
      console.error("AppointmentSlotController.appointments error:", error);
      return res.status(500).json({
        status: false,
        message: "Không tải được danh sách người trong slot!",
      });
    }
  },
  async dashboard(req, res) {
    try {
      const {
        from_date,
        to_date,
        donation_site_id,
        type,
        campaign_id,
      } = req.query;

      const today = new Date().toISOString().slice(0, 10);

      const where = {};

      if (type) where.type = type;
      if (campaign_id) where.campaign_id = campaign_id;
      if (donation_site_id) where.donation_site_id = donation_site_id;

      if (from_date || to_date) {
        where.slot_date = {};
        if (from_date) where.slot_date[Op.gte] = from_date;
        if (to_date) where.slot_date[Op.lte] = to_date;
      } else {
        where.slot_date = today;
      }

      const slots = await AppointmentSlot.findAll({
        where,
        include: [
          {
            model: DonationSite,
            as: "donation_site",
            required: false,
          },
          {
            model: Campaign,
            as: "campaign",
            required: false,
          },
        ],
        order: [
          ["slot_date", "ASC"],
          ["start_time", "ASC"],
        ],
      });

      const data = slots.map(buildSlotPayload);

      const totalCapacity = data.reduce(
        (sum, item) => sum + Number(item.slot_capacity || 0),
        0
      );

      const currentCount = data.reduce(
        (sum, item) => sum + Number(item.current_count || 0),
        0
      );

      const availableCount = Math.max(totalCapacity - currentCount, 0);

      const fullSlots = data.filter(
        (item) =>
          Number(item.slot_capacity || 0) > 0 &&
          Number(item.current_count || 0) >= Number(item.slot_capacity || 0)
      );

      const nearlyFullSlots = data.filter((item) => {
        const capacity = Number(item.slot_capacity || 0);
        const current = Number(item.current_count || 0);

        if (capacity <= 0) return false;

        const percent = Math.round((current / capacity) * 100);

        return percent >= 80 && percent < 100;
      });

      const overview = {
        total_slots: data.length,
        total_capacity: totalCapacity,
        current_count: currentCount,
        available_count: availableCount,
        percent:
          totalCapacity > 0
            ? Math.round((currentCount / totalCapacity) * 100)
            : 0,
        full_slots: fullSlots.length,
        nearly_full_slots: nearlyFullSlots.length,
      };

      const heatmapMap = {};

      data.forEach((slot) => {
        const date = String(slot.slot_date).slice(0, 10);
        const key =
          String(slot.start_time || "").slice(0, 5) < "12:00"
            ? "morning"
            : "afternoon";

        if (!heatmapMap[date]) {
          heatmapMap[date] = {
            date,
            morning: {
              current_count: 0,
              slot_capacity: 0,
              available_count: 0,
              percent: 0,
            },
            afternoon: {
              current_count: 0,
              slot_capacity: 0,
              available_count: 0,
              percent: 0,
            },
            total: {
              current_count: 0,
              slot_capacity: 0,
              available_count: 0,
              percent: 0,
            },
          };
        }

        heatmapMap[date][key].current_count += Number(slot.current_count || 0);
        heatmapMap[date][key].slot_capacity += Number(slot.slot_capacity || 0);
        heatmapMap[date][key].available_count += Number(
          slot.available_count || 0
        );

        heatmapMap[date].total.current_count += Number(slot.current_count || 0);
        heatmapMap[date].total.slot_capacity += Number(slot.slot_capacity || 0);
        heatmapMap[date].total.available_count += Number(
          slot.available_count || 0
        );
      });

      const heatmap = Object.values(heatmapMap).map((row) => {
        ["morning", "afternoon", "total"].forEach((key) => {
          const item = row[key];

          item.percent =
            item.slot_capacity > 0
              ? Math.round((item.current_count / item.slot_capacity) * 100)
              : 0;
        });

        return row;
      });

      const peakTime = {
        morning: {
          label: "Ca sáng",
          time_range: "07:00 - 11:00",
          current_count: 0,
          slot_capacity: 0,
          available_count: 0,
          percent: 0,
        },
        afternoon: {
          label: "Ca chiều",
          time_range: "13:00 - 17:00",
          current_count: 0,
          slot_capacity: 0,
          available_count: 0,
          percent: 0,
        },
      };

      data.forEach((slot) => {
        const key =
          String(slot.start_time || "").slice(0, 5) < "12:00"
            ? "morning"
            : "afternoon";

        peakTime[key].current_count += Number(slot.current_count || 0);
        peakTime[key].slot_capacity += Number(slot.slot_capacity || 0);
        peakTime[key].available_count += Number(slot.available_count || 0);
      });

      Object.keys(peakTime).forEach((key) => {
        const item = peakTime[key];

        item.percent =
          item.slot_capacity > 0
            ? Math.round((item.current_count / item.slot_capacity) * 100)
            : 0;
      });

      const alert_slots = data
        .filter((slot) => Number(slot.percent || 0) >= 80)
        .map((slot) => ({
          id: slot.id,
          type: slot.type,
          slot_date: slot.slot_date,
          time_range: `${String(slot.start_time).slice(0, 5)} - ${String(
            slot.end_time
          ).slice(0, 5)}`,
          current_count: slot.current_count,
          slot_capacity: slot.slot_capacity,
          available_count: slot.available_count,
          percent: slot.percent,
          donation_site_name: slot.donation_site?.name || null,
          campaign_title: slot.campaign?.title || null,
        }));

      return res.json({
        status: true,
        data: {
          overview,
          peak_time: peakTime,
          heatmap,
          alert_slots,
          slots: data,
        },
      });
    } catch (error) {
      console.error("AppointmentSlotController.dashboard error:", error);

      return res.status(500).json({
        status: false,
        message: "Không tải được dashboard slot!",
      });
    }
  },
  async generateCampaign(req, res) {
    try {
      const { campaign_id } = req.params;

      const {
        slot_capacity = 10,
        include_morning = true,
        include_afternoon = true,
      } = req.body;

      const result = await generateCampaignSlots({
        campaign_id,
        slot_capacity,
        include_morning,
        include_afternoon,
      });

      return res.json({
        status: true,
        message: `Đã tạo ${result.createdCount} slot chiến dịch. Bỏ qua ${result.skippedCount} slot đã tồn tại.`,
        data: result,
      });
    } catch (error) {
      console.error("AppointmentSlotController.generateCampaign error:", error);

      return res.status(500).json({
        status: false,
        message: error.message || "Không tạo được slot chiến dịch!",
      });
    }
  },
};
