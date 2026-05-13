"use strict";

const { Op } = require("sequelize");
const {
  sequelize,
  Campaign,
  DonationSite,
  Appointment,
  AppointmentSlot,
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
} = require("../../services/slotCapacityService");

const { emitAppointmentUpdated } = require("../../socket");

const todayStr = () => new Date().toISOString().slice(0, 10);

const computeCampaignStatus = (start_date, end_date) => {
  const t = todayStr();
  const s = String(start_date).slice(0, 10);
  const e = String(end_date).slice(0, 10);

  if (t < s) return "upcoming";
  if (t > e) return "ended";
  return "running";
};

const buildLocationDisplay = (raw) => {
  if (raw.locate_type === "donation_site") {
    const ds = raw.donation_site;
    if (ds) return [ds.name, ds.address].filter(Boolean).join(" – ");
  }

  return raw.location || "";
};

const normalizePreferredVolume = (v) => {
  if (v == null || v === "") return null;

  const n = Number(String(v).replace(/[^\d]/g, ""));

  if ([250, 350, 450].includes(n)) {
    return n;
  }

  return null;
};



module.exports = {
  async publicCampaigns(req, res) {
    try {
      const { status = "active" } = req.query;
      const t = todayStr();

      const where = {
        approval_status: "approved",
      };

      if (status === "active") {
        where.end_date = { [Op.gte]: t };
      } else if (status === "upcoming") {
        where.start_date = { [Op.gt]: t };
      } else if (status === "running") {
        where.start_date = { [Op.lte]: t };
        where.end_date = { [Op.gte]: t };
      } else if (status === "ended") {
        where.end_date = { [Op.lt]: t };
      }

      const campaigns = await Campaign.findAll({
        where,
        include: [
          {
            model: DonationSite,
            as: "donation_site",
            required: false,
          },
        ],
        order: [["start_date", "ASC"]],
      });

      const data = campaigns.map((c) => {
        const raw = c.toJSON();

        return {
          id: raw.id,
          title: raw.title,
          content: raw.content,
          start_date: raw.start_date,
          end_date: raw.end_date,
          is_emerge: raw.is_emerge,
          is_emergency: raw.is_emergency,
          locate_type: raw.locate_type,
          donation_site_id: raw.donation_site_id,
          location: raw.location,
          status: computeCampaignStatus(raw.start_date, raw.end_date),
          location_display: buildLocationDisplay(raw),
        };
      });

      return res.json({
        status: true,
        data,
      });
    } catch (err) {
      console.error("CampaignController.publicCampaigns error:", err);

      return res.status(500).json({
        status: false,
        message: err.message,
      });
    }
  },

  async publicCampaignDetail(req, res) {
    try {
      const { id } = req.params;

      const campaign = await Campaign.findOne({
        where: {
          id,
          approval_status: "approved",
        },
        include: [
          {
            model: DonationSite,
            as: "donation_site",
            required: false,
          },
        ],
      });

      if (!campaign) {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy chiến dịch",
        });
      }

      const raw = campaign.toJSON();

      return res.json({
        status: true,
        data: {
          ...raw,
          status: computeCampaignStatus(raw.start_date, raw.end_date),
          location_display: buildLocationDisplay(raw),
        },
      });
    } catch (err) {
      console.error("CampaignController.publicCampaignDetail error:", err);

      return res.status(500).json({
        status: false,
        message: err.message,
      });
    }
  },

  async donorCreateAppointment(req, res) {
    const t = await sequelize.transaction();

    try {
      const donor_id = req.user?.userId || req.user?.id;

      const {
        campaign_id,
        appointment_slot_id,
        slot_id,
        preferred_volume_ml,
        notes,
      } = req.body;

      const selectedSlotId = appointment_slot_id || slot_id;

      if (!donor_id) {
        await t.rollback();

        return res.status(401).json({
          status: false,
          message: "Vui lòng đăng nhập!",
        });
      }

      if (!campaign_id) {
        await t.rollback();

        return res.json({
          status: false,
          message: "Thiếu campaign_id!",
        });
      }

      if (!selectedSlotId) {
        await t.rollback();

        return res.json({
          status: false,
          message: "Vui lòng chọn khung giờ hiến máu!",
        });
      }

      const campaign = await Campaign.findOne({
        where: {
          id: campaign_id,
          approval_status: "approved",
        },
        transaction: t,
      });

      if (!campaign) {
        await t.rollback();

        return res.json({
          status: false,
          message: "Chiến dịch không hợp lệ!",
        });
      }

      const camp = campaign.toJSON();
      const campaignStatus = computeCampaignStatus(camp.start_date, camp.end_date);

      if (campaignStatus === "ended") {
        await t.rollback();

        return res.json({
          status: false,
          message: "Chiến dịch đã kết thúc!",
        });
      }

      const slot = await AppointmentSlot.findOne({
        where: {
          id: selectedSlotId,
          campaign_id: camp.id,
          type: "campaign",
        },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!slot) {
        await t.rollback();

        return res.json({
          status: false,
          message: "Khung giờ không thuộc chiến dịch này!",
        });
      }

      const slotDate = String(slot.slot_date).slice(0, 10);
      const campaignStart = String(camp.start_date).slice(0, 10);
      const campaignEnd = String(camp.end_date).slice(0, 10);

      if (slotDate < campaignStart || slotDate > campaignEnd) {
        await t.rollback();

        return res.json({
          status: false,
          message: `Ngày hiến phải nằm trong ${campaignStart} - ${campaignEnd}`,
        });
      }

      const scheduledDate = new Date(`${slotDate}T${slot.start_time}`);

      if (scheduledDate < new Date()) {
        await t.rollback();

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
        transaction: t,
      });

      if (lastDonation) {
        const lastDate = new Date(lastDonation.scheduled_at);
        const nextAllowedDate = new Date(lastDate);

        nextAllowedDate.setMonth(nextAllowedDate.getMonth() + 3);

        if (scheduledDate < nextAllowedDate) {
          const dateStr = nextAllowedDate.toLocaleDateString("vi-VN");

          await t.rollback();

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
        transaction: t,
      });

      if (existed) {
        await t.rollback();

        return res.json({
          status: false,
          message: "Bạn đã có lịch đăng ký hoặc đã hiến máu trong ngày này!",
        });
      }

      let donation_site_id = null;

      if (camp.locate_type === "donation_site") {
        donation_site_id = camp.donation_site_id || slot.donation_site_id || null;

        if (!donation_site_id) {
          await t.rollback();

          return res.json({
            status: false,
            message: "Chiến dịch thiếu donation_site_id!",
          });
        }
      } else {
        donation_site_id = slot.donation_site_id || null;
      }

      const extraLoc =
        camp.locate_type === "custom" && camp.location
          ? `[Địa điểm chiến dịch] ${camp.location}`
          : null;

      const notesFinal = [notes?.trim(), extraLoc].filter(Boolean).join("\n");

      const appointment_code = generateAppointmentCode("CD");
      const created = await createAppointmentWithSlotCapacity({
        slotId: selectedSlotId,
        appointmentPayload: {
          appointment_code,
          donor_id,
          donation_site_id,
          campaign_id: camp.id,
          preferred_volume_ml: normalizePreferredVolume(preferred_volume_ml),
          notes: notesFinal || null,
          status: APPOINTMENT_STATUS.REQUESTED,
        },
        transaction: t,
      });

      await t.commit();

      emitAppointmentUpdated(created.id, {
        status: created.status,
        appointment: created,
      });

      return res.json({
        status: true,
        message: "Đăng ký chiến dịch thành công! Vui lòng chờ xét duyệt.",
        data: created,
      });
    } catch (err) {
      await t.rollback();

      console.error("CampaignController.donorCreateAppointment error:", err);

      return res.status(500).json({
        status: false,
        message: err.message,
      });
    }
  },

  async adminListCampaignRegistrations(req, res) {
    try {
      const { status } = req.query;

      const where = {
        campaign_id: {
          [Op.ne]: null,
        },
      };

      if (status) {
        where.status = status;
      }

      const rows = await Appointment.findAll({
        where,
        include: [
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
        data: rows,
      });
    } catch (err) {
      console.error("adminListCampaignRegistrations error:", err);

      return res.status(500).json({
        status: false,
        message: err.message,
      });
    }
  },

  async adminApproveCampaignRegistration(req, res) {
    try {
      const admin_id = req.user?.userId || req.user?.id;
      const { id } = req.params;

      const appt = await Appointment.findOne({
        where: {
          id,
          campaign_id: {
            [Op.ne]: null,
          },
        },
      });

      if (!appt) {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy đăng ký!",
        });
      }

      if (appt.status !== APPOINTMENT_STATUS.REQUESTED) {
        return res.status(422).json({
          status: false,
          message: "Chỉ duyệt khi lịch đang ở trạng thái chờ duyệt!",
        });
      }

      await appt.update({
        status: APPOINTMENT_STATUS.APPROVED,
        approved_by_admin_id: admin_id,
        approved_at: new Date(),
        rejected_reason: null,
        updated_at: new Date(),
      });

      emitAppointmentUpdated(appt.id, {
        status: APPOINTMENT_STATUS.APPROVED,
        appointment_id: appt.id,
      });

      return res.json({
        status: true,
        message: "Duyệt đăng ký chiến dịch thành công!",
      });
    } catch (err) {
      console.error("adminApproveCampaignRegistration error:", err);

      return res.status(500).json({
        status: false,
        message: err.message,
      });
    }
  },

  async adminRejectCampaignRegistration(req, res) {
    const t = await sequelize.transaction();

    try {
      const admin_id = req.user?.userId || req.user?.id;
      const { id } = req.params;
      const { rejected_reason } = req.body;

      if (!rejected_reason || !String(rejected_reason).trim()) {
        await t.rollback();

        return res.status(422).json({
          status: false,
          message: "Vui lòng nhập lý do từ chối!",
        });
      }

      const appt = await Appointment.findOne({
        where: {
          id,
          campaign_id: {
            [Op.ne]: null,
          },
        },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!appt) {
        await t.rollback();

        return res.status(404).json({
          status: false,
          message: "Không tìm thấy đăng ký!",
        });
      }

      if (appt.status !== APPOINTMENT_STATUS.REQUESTED) {
        await t.rollback();

        return res.status(422).json({
          status: false,
          message: "Chỉ từ chối khi lịch đang ở trạng thái chờ duyệt!",
        });
      }

      const slotId = getSlotIdFromAppointment(appt);

      await appt.update(
        {
          status: APPOINTMENT_STATUS.REJECTED,
          rejected_reason: String(rejected_reason).trim(),
          approved_by_admin_id: admin_id,
          approved_at: new Date(),
          updated_at: new Date(),
        },
        {
          transaction: t,
        }
      );

      await t.commit();

      if (slotId) {
        await refreshSlotCounters(slotId);
      }

      emitAppointmentUpdated(appt.id, {
        status: APPOINTMENT_STATUS.REJECTED,
        appointment_id: appt.id,
      });

      return res.json({
        status: true,
        message: "Đã từ chối đăng ký chiến dịch!",
      });
    } catch (err) {
      await t.rollback();

      console.error("adminRejectCampaignRegistration error:", err);

      return res.status(500).json({
        status: false,
        message: err.message,
      });
    }
  },
};