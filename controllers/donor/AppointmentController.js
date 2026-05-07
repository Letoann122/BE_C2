"use strict";

const {
  Appointment,
  AppointmentSlot,
  DonationSite,
  Campaign,
  User,
} = require("../../models");

const { Op } = require("sequelize");
const emailQueue = require("../../services/emailQueue");

const {
  APPOINTMENT_STATUS,
  ACTIVE_APPOINTMENT_STATUSES,
} = require("../../constants/appointmentStatus");

const formatTime = (value) => {
  if (!value) return "";

  if (typeof value === "string") {
    return value.slice(0, 5);
  }

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";

  return d.toTimeString().slice(0, 5);
};

const inferTimeSlotFromScheduledAt = (scheduledAt) => {
  if (!scheduledAt) return "Chưa có khung giờ";

  const d = new Date(scheduledAt);
  if (Number.isNaN(d.getTime())) return "Chưa có khung giờ";

  const hour = d.getHours();

  if (hour < 12) return "07:00 - 11:00";
  return "13:00 - 17:00";
};

const buildTimeSlot = (appointment) => {
  if (appointment.time_slot) return appointment.time_slot;

  const slot = appointment.slot;

  if (slot?.start_time && slot?.end_time) {
    return `${formatTime(slot.start_time)} - ${formatTime(slot.end_time)}`;
  }

  return inferTimeSlotFromScheduledAt(appointment.scheduled_at);
};

module.exports = {
  async create(req, res) {
    try {
      const {
        donor_id,
        donation_site_id,
        appointment_slot_id,
        scheduled_at,
        preferred_volume_ml,
        notes,
        time_slot,
        campaign_id,
      } = req.validated;

      const scheduledDate = new Date(scheduled_at);
      const now = new Date();

      if (scheduledDate < now) {
        return res.json({
          status: false,
          message: "Khung giờ bạn chọn đã trôi qua. Vui lòng chọn thời gian khác!",
        });
      }

      const lastDonation = await Appointment.findOne({
        where: {
          donor_id,
          status: APPOINTMENT_STATUS.COMPLETED,
        },
        order: [["scheduled_at", "DESC"]],
      });

      if (lastDonation) {
        const lastDate = new Date(lastDonation.scheduled_at);
        const nextAllowedDate = new Date(lastDate);
        nextAllowedDate.setMonth(nextAllowedDate.getMonth() + 3);

        if (scheduledDate < nextAllowedDate) {
          const dateStr = nextAllowedDate.toLocaleDateString("vi-VN");
          return res.json({
            status: false,
            message: `Bạn cần nghỉ ngơi sau lần hiến trước. Bạn có thể hiến máu lại từ ngày ${dateStr}.`,
          });
        }
      }

      const sameDay = new Date(
        scheduledDate.getFullYear(),
        scheduledDate.getMonth(),
        scheduledDate.getDate()
      );
      const nextDay = new Date(sameDay);
      nextDay.setDate(nextDay.getDate() + 1);

      const existed = await Appointment.findOne({
        where: {
          donor_id,
          scheduled_at: {
            [Op.gte]: sameDay,
            [Op.lt]: nextDay,
          },
          status: {
            [Op.in]: [
              ...ACTIVE_APPOINTMENT_STATUSES,
              APPOINTMENT_STATUS.COMPLETED,
            ],
          },
        },
      });

      if (existed) {
        return res.json({
          status: false,
          message: "Bạn đã có lịch đăng ký hoặc đã hiến máu trong ngày này!",
        });
      }

      const prefix = campaign_id ? "CD" : "HM";

      const [next] = await Appointment.sequelize.query(`
        SELECT AUTO_INCREMENT AS nextId
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'appointments'
      `);

      const nextId = next[0]?.nextId || 1;
      const appointment_code = prefix + String(nextId).padStart(6, "0");

      const newAppt = await Appointment.create({
        appointment_code,
        donor_id,
        donation_site_id,
        appointment_slot_id,
        scheduled_at: scheduledDate,
        preferred_volume_ml,
        notes,
        time_slot,
        campaign_id: campaign_id || null,
        status: APPOINTMENT_STATUS.REQUESTED,
      });

      const sendAt = new Date(scheduledDate);
      sendAt.setDate(sendAt.getDate() - 1);

      if (req.user?.email) {
        await emailQueue.enqueue({
          email: req.user.email,
          subject: "Nhắc lịch hiến máu của bạn",
          template: "truoc_khi_hien_mau",
          payload: {
            ten: req.user.full_name,
            ngay_hien: scheduledDate.toISOString().slice(0, 10),
          },
          scheduled_at: sendAt,
        });
      }

      return res.status(200).json({
        status: true,
        message: "Đặt lịch hiến máu thành công! Vui lòng chờ bác sĩ duyệt.",
        data: newAppt,
      });
    } catch (error) {
      console.error("CREATE APPOINTMENT ERROR:", error);

      return res.status(500).json({
        status: false,
        message: "Lỗi máy chủ khi tạo lịch hẹn!",
      });
    }
  },

  async myList(req, res) {
    try {
      const donor_id = req.user?.userId || req.user?.id;

      const rows = await Appointment.findAll({
        where: { donor_id },

        include: [
          {
            model: User,
            as: "donor",
            attributes: ["id", "full_name", "email", "phone", "blood_group"],
          },
          {
            model: DonationSite,
            as: "donation_site",
            required: false,
          },
          {
            model: AppointmentSlot,
            as: "slot",
            required: false,
          },
          {
            model: Campaign,
            as: "campaign",
            required: false,
          },
        ],

        order: [["scheduled_at", "DESC"]],
      });

      const data = rows.map((appt) => {
        const plain = appt.toJSON();

        plain.time_slot = buildTimeSlot(plain);

        if (!plain.donation_site && plain.campaign && plain.campaign.location) {
          plain.donation_site = {
            id: null,
            name: plain.campaign.location,
            address: plain.campaign.location,
          };
        }

        return plain;
      });

      return res.json({
        status: true,
        data,
      });
    } catch (e) {
      console.error("MY APPOINTMENTS ERROR:", e);

      return res.status(500).json({
        status: false,
        message: "Không tải được danh sách lịch!",
        error: e.message,
      });
    }
  },

  async cancel(req, res) {
    try {
      const donor_id = req.user?.userId || req.user?.id;
      const { id } = req.params;

      const appt = await Appointment.findOne({
        where: {
          id,
          donor_id,
        },
      });

      if (!appt) {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy lịch!",
        });
      }

      if (
        ![
          APPOINTMENT_STATUS.REQUESTED,
          APPOINTMENT_STATUS.APPROVED,
          APPOINTMENT_STATUS.BOOKED,
        ].includes(appt.status)
      ) {
        return res.json({
          status: false,
          message: "Lịch không thể huỷ ở trạng thái hiện tại!",
        });
      }

      await appt.update({
        status: APPOINTMENT_STATUS.CANCELLED,
      });

      return res.json({
        status: true,
        message: "Đã huỷ lịch hiến máu!",
      });
    } catch (e) {
      console.error("CANCEL APPOINTMENT ERROR:", e);

      return res.status(500).json({
        status: false,
        message: "Lỗi khi huỷ lịch!",
      });
    }
  },
};