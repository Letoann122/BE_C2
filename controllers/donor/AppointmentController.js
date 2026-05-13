"use strict";

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

      const existedActive = await Appointment.findOne({
        where: {
          donor_id,
          status: ACTIVE_APPOINTMENT_STATUSES,
        },
        transaction: t,
      });

      if (existedActive) {
        await t.rollback();
        return res.json({
          status: false,
          message:
            "Bạn đang có lịch hiến máu đang hoạt động. Vui lòng hoàn tất hoặc huỷ lịch trước khi đặt lịch mới!",
        });
      }

      const appointment_code = generateAppointmentCode("HM");

      const newAppt = await createAppointmentWithSlotCapacity({
        slotId: selectedSlotId,
        appointmentPayload: {
          appointment_code,
          donor_id,
          donation_site_id: donation_site_id || null,
          campaign_id: campaign_id || null,
          preferred_volume_ml: normalizePreferredVolume(
            preferred_volume_ml || volume
          ),
          notes: notes || note || null,
          status: APPOINTMENT_STATUS.REQUESTED,
        },
        transaction: t,
      });

      const slotId = getSlotIdFromAppointment(newAppt);

      await t.commit();

      await emitSlotAfterCommit(slotId);

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
        { transaction: t }
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