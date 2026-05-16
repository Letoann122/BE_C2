"use strict";

const { Op } = require("sequelize");

const {
  sequelize,
  Appointment,
  AppointmentSlot,
  DonationSite,
  Campaign,
} = require("../../models");

const {
  generateAppointmentCode,
} = require("../../utils/generateAppointmentCode");

const {
  APPOINTMENT_STATUS,
  ACTIVE_APPOINTMENT_STATUSES,
} = require("../../constants/appointmentStatus");

const {
  createAppointmentWithSlotCapacity,
  refreshSlotCounters,
  getSlotIdFromAppointment,
  emitSlotAfterCommit,
} = require("../../services/slotCapacityService");

const emailQueue = require("../../services/emailQueue");
const { emitAppointmentUpdated } = require("../../socket");

function normalizePreferredVolume(value) {
  const volume = Number(String(value || "").replace(/[^\d]/g, ""));

  if ([250, 350, 450].includes(volume)) {
    return volume;
  }

  return null;
}

function getVNDateKey(date = new Date()) {
  const vnDate = new Date(
    date.toLocaleString("en-US", {
      timeZone: "Asia/Ho_Chi_Minh",
    })
  );

  const year = vnDate.getFullYear();
  const month = String(vnDate.getMonth() + 1).padStart(2, "0");
  const day = String(vnDate.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getSlotDateKey(slotDate) {
  if (!slotDate) return null;

  if (typeof slotDate === "string") {
    return slotDate.slice(0, 10);
  }

  const d = new Date(slotDate);

  if (Number.isNaN(d.getTime())) return null;

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function normalizeTimeValue(timeValue) {
  if (!timeValue) return null;

  if (typeof timeValue === "string") {
    const parts = timeValue.split(":");

    return {
      hour: Number(parts[0] || 0),
      minute: Number(parts[1] || 0),
      second: Number(parts[2] || 0),
    };
  }

  const d = new Date(timeValue);

  if (Number.isNaN(d.getTime())) return null;

  return {
    hour: d.getHours(),
    minute: d.getMinutes(),
    second: d.getSeconds(),
  };
}

function buildVNDateTime(dateKey, timeValue) {
  const time = normalizeTimeValue(timeValue);

  if (!dateKey || !time) return null;

  const hour = String(time.hour).padStart(2, "0");
  const minute = String(time.minute).padStart(2, "0");
  const second = String(time.second || 0).padStart(2, "0");

  return new Date(`${dateKey}T${hour}:${minute}:${second}+07:00`);
}

function buildVNDayRange(dateKey) {
  return {
    start: new Date(`${dateKey}T00:00:00+07:00`),
    end: new Date(`${dateKey}T23:59:59.999+07:00`),
  };
}

module.exports = {
  async create(req, res) {
    const t = await sequelize.transaction();

    try {
      const donor_id = req.user?.id || req.user?.userId;

      const {
        donation_site_id,
        campaign_id,
        appointment_slot_id,
        slot_id,
        preferred_volume_ml,
        volume,
        notes,
        note,
      } = req.body;

      const selectedSlotId = appointment_slot_id || slot_id;

      if (!donor_id) {
        await t.rollback();
        return res.status(401).json({
          status: false,
          message: "Vui lòng đăng nhập!",
        });
      }

      if (!selectedSlotId) {
        await t.rollback();
        return res.json({
          status: false,
          message: "Vui lòng chọn khung giờ hiến máu!",
        });
      }

      const slot = await AppointmentSlot.findOne({
        where: {
          id: selectedSlotId,
        },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!slot) {
        await t.rollback();
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy khung giờ hiến máu!",
        });
      }

      const slotDateKey = getSlotDateKey(slot.slot_date);
      const todayKey = getVNDateKey();

      if (!slotDateKey) {
        await t.rollback();
        return res.json({
          status: false,
          message: "Ngày của khung giờ không hợp lệ!",
        });
      }

      if (slotDateKey < todayKey) {
        await t.rollback();
        return res.json({
          status: false,
          message: "Không thể đặt lịch cho ngày đã qua!",
        });
      }

      const slotStartAt = buildVNDateTime(slotDateKey, slot.start_time);
      const slotEndAt = buildVNDateTime(slotDateKey, slot.end_time);

      if (!slotStartAt || !slotEndAt) {
        await t.rollback();
        return res.json({
          status: false,
          message: "Thời gian của khung giờ không hợp lệ!",
        });
      }

      if (Date.now() > slotEndAt.getTime()) {
        await t.rollback();
        return res.json({
          status: false,
          message:
            "Khung giờ hiến máu này đã kết thúc, vui lòng chọn khung giờ khác!",
        });
      }

      if (
        donation_site_id &&
        slot.donation_site_id &&
        String(donation_site_id) !== String(slot.donation_site_id)
      ) {
        await t.rollback();
        return res.json({
          status: false,
          message: "Khung giờ không thuộc địa điểm hiến máu đã chọn!",
        });
      }

      if (
        campaign_id &&
        slot.campaign_id &&
        String(campaign_id) !== String(slot.campaign_id)
      ) {
        await t.rollback();
        return res.json({
          status: false,
          message: "Khung giờ không thuộc chiến dịch đã chọn!",
        });
      }

      const lastCompletedDonation = await Appointment.findOne({
        where: {
          donor_id,
          status: APPOINTMENT_STATUS.COMPLETED,
        },
        order: [["scheduled_at", "DESC"]],
        transaction: t,
      });

      if (lastCompletedDonation) {
        const lastDate = new Date(lastCompletedDonation.scheduled_at);
        const nextAllowedDate = new Date(lastDate);

        nextAllowedDate.setMonth(nextAllowedDate.getMonth() + 3);

        if (slotStartAt < nextAllowedDate) {
          await t.rollback();

          return res.json({
            status: false,
            message: `Bạn cần nghỉ ngơi sau lần hiến trước. Bạn có thể hiến máu lại từ ngày ${nextAllowedDate.toLocaleDateString(
              "vi-VN"
            )}.`,
          });
        }
      }

      const { start, end } = buildVNDayRange(slotDateKey);

      const existedSameDay = await Appointment.findOne({
        where: {
          donor_id,
          status: {
            [Op.in]: [
              ...ACTIVE_APPOINTMENT_STATUSES,
              APPOINTMENT_STATUS.COMPLETED,
            ],
          },
          scheduled_at: {
            [Op.between]: [start, end],
          },
        },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (existedSameDay) {
        await t.rollback();
        return res.json({
          status: false,
          message:
            "Bạn đã có lịch hiến máu trong ngày này. Vui lòng chọn ngày khác hoặc huỷ lịch cũ trước!",
        });
      }

      const normalizedVolume = normalizePreferredVolume(
        preferred_volume_ml || volume
      );

      if (!normalizedVolume) {
        await t.rollback();
        return res.json({
          status: false,
          message: "Vui lòng chọn dung tích máu hiến hợp lệ!",
        });
      }

      const appointment_code = generateAppointmentCode("HM");

      const newAppt = await createAppointmentWithSlotCapacity({
        slotId: selectedSlotId,
        appointmentPayload: {
          appointment_code,
          donor_id,
          donation_site_id: donation_site_id || slot.donation_site_id || null,
          campaign_id: campaign_id || slot.campaign_id || null,
          preferred_volume_ml: normalizedVolume,
          notes: notes || note || null,
          status: APPOINTMENT_STATUS.REQUESTED,
        },
        transaction: t,
      });

      const finalSlotId = getSlotIdFromAppointment(newAppt);

      await t.commit();

      await emitSlotAfterCommit(finalSlotId);

      emitAppointmentUpdated(newAppt.id, {
        status: newAppt.status,
        appointment: newAppt,
      });

      try {
        const scheduledDate = new Date(newAppt.scheduled_at);
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
      } catch (emailError) {
        console.error("Queue reminder email error:", emailError);
      }

      return res.status(200).json({
        status: true,
        message: "Đặt lịch hiến máu thành công! Vui lòng chờ bác sĩ duyệt.",
        data: newAppt,
      });
    } catch (error) {
      await t.rollback();

      console.error("Donor AppointmentController.create error:", error);

      return res.json({
        status: false,
        message: error.message || "Không thể đặt lịch hiến máu!",
      });
    }
  },

  async myAppointments(req, res) {
    try {
      const donor_id = req.user?.id || req.user?.userId;

      if (!donor_id) {
        return res.status(401).json({
          status: false,
          message: "Vui lòng đăng nhập!",
        });
      }

      const appointments = await Appointment.findAll({
        where: {
          donor_id,
        },
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
          {
            model: AppointmentSlot,
            as: "slot",
            required: false,
          },
        ],
        order: [["created_at", "DESC"]],
      });

      return res.json({
        status: true,
        data: appointments,
      });
    } catch (error) {
      console.error("Donor AppointmentController.myAppointments error:", error);

      return res.status(500).json({
        status: false,
        message: "Không tải được danh sách lịch hẹn!",
      });
    }
  },

  async detail(req, res) {
    try {
      const donor_id = req.user?.id || req.user?.userId;
      const { id } = req.params;

      if (!donor_id) {
        return res.status(401).json({
          status: false,
          message: "Vui lòng đăng nhập!",
        });
      }

      const appointment = await Appointment.findOne({
        where: {
          id,
          donor_id,
        },
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
          {
            model: AppointmentSlot,
            as: "slot",
            required: false,
          },
        ],
      });

      if (!appointment) {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy lịch hẹn!",
        });
      }

      return res.json({
        status: true,
        data: appointment,
      });
    } catch (error) {
      console.error("Donor AppointmentController.detail error:", error);

      return res.status(500).json({
        status: false,
        message: "Không tải được chi tiết lịch hẹn!",
      });
    }
  },

  async cancel(req, res) {
    const t = await sequelize.transaction();

    try {
      const donor_id = req.user?.id || req.user?.userId;
      const { id } = req.params;

      if (!donor_id) {
        await t.rollback();
        return res.status(401).json({
          status: false,
          message: "Vui lòng đăng nhập!",
        });
      }

      const appt = await Appointment.findOne({
        where: {
          id,
          donor_id,
        },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!appt) {
        await t.rollback();
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy lịch hẹn!",
        });
      }

      const cancelableStatuses = [
        APPOINTMENT_STATUS.REQUESTED,
        APPOINTMENT_STATUS.APPROVED,
        APPOINTMENT_STATUS.BOOKED,
      ];

      if (!cancelableStatuses.includes(appt.status)) {
        await t.rollback();
        return res.json({
          status: false,
          message: "Lịch hẹn này không thể huỷ!",
        });
      }

      const slotId = getSlotIdFromAppointment(appt);

      await appt.update(
        {
          status: APPOINTMENT_STATUS.CANCELLED,
          updated_at: new Date(),
        },
        {
          transaction: t,
        }
      );

      await refreshSlotCounters(slotId, t);

      await t.commit();

      await emitSlotAfterCommit(slotId);

      emitAppointmentUpdated(appt.id, {
        status: APPOINTMENT_STATUS.CANCELLED,
        appointment_id: appt.id,
      });

      return res.json({
        status: true,
        message: "Huỷ lịch hẹn thành công!",
      });
    } catch (error) {
      await t.rollback();

      console.error("Donor AppointmentController.cancel error:", error);

      return res.status(500).json({
        status: false,
        message: "Không thể huỷ lịch hẹn!",
      });
    }
  },
};