"use strict";

const { Op } = require("sequelize");

const {
  sequelize,
  Campaign,
  DonationSite,
  Appointment,
  AppointmentSlot,
  User,
} = require("../../models");

const {
  getDisplayCampaignStatus,
} = require("../../utils/campaignStatusHelper");

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

const buildLocationDisplay = (raw) => {
  if (raw.locate_type === "donation_site") {
    const ds = raw.donation_site;

    if (ds) {
      return [ds.name, ds.address].filter(Boolean).join(" – ");
    }
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

const dateKey = (value) => {
  if (!value) return "";

  if (typeof value === "string") {
    return value.slice(0, 10);
  }

  const d = new Date(value);

  if (Number.isNaN(d.getTime())) return "";

  return d.toISOString().slice(0, 10);
};

const buildVNDateTime = (dateKeyValue, timeValue) => {
  if (!dateKeyValue || !timeValue) return null;

  const time = String(timeValue).slice(0, 8);

  return new Date(`${dateKeyValue}T${time}+07:00`);
};

module.exports = {
  async publicCampaigns(req, res) {
  try {
    const { status = "" } = req.query;

    const where = {
      approval_status: "approved",
      status: ["upcoming", "running"],
    };

    // Nếu FE truyền filter status thì vẫn chỉ cho phép upcoming/running
    if (status && ["upcoming", "running"].includes(status)) {
      where.status = status;
    }

    const campaigns = await Campaign.findAll({
      where,
      include: [
        {
          model: DonationSite,
          as: "donation_site",
          required: false,
        },
        {
          model: User,
          as: "creator",
          attributes: ["id", "full_name"],
          required: false,
        },
      ],
      order: [
        ["start_date", "DESC"],
        ["id", "DESC"],
      ],
    });

    return res.json({
      status: true,
      message: "Lấy danh sách chiến dịch thành công!",
      data: campaigns,
    });
  } catch (error) {
    console.error("publicCampaigns error:", error);

    return res.status(500).json({
      status: false,
      message: "Không tải được danh sách chiến dịch!",
      error: error.message,
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

          // QUAN TRỌNG: donor dùng status từ DB để sync admin/doctor
          status: getDisplayCampaignStatus(raw),

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

      // QUAN TRỌNG: không tự tính ngày nữa, dùng status DB để sync admin/doctor
      if (getDisplayCampaignStatus(campaign) === "ended") {
        await t.rollback();

        return res.json({
          status: false,
          message: "Chiến dịch đã kết thúc!",
        });
      }

      const slot = await AppointmentSlot.findOne({
        where: {
          id: selectedSlotId,
          campaign_id: campaign.id,
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

      const slotDate = dateKey(slot.slot_date);
      const campaignStart = dateKey(campaign.start_date);
      const campaignEnd = dateKey(campaign.end_date);

      if (slotDate < campaignStart || slotDate > campaignEnd) {
        await t.rollback();

        return res.json({
          status: false,
          message: `Ngày hiến phải nằm trong ${campaignStart} - ${campaignEnd}`,
        });
      }

      const scheduledDate = buildVNDateTime(slotDate, slot.start_time);
      const slotEndAt = buildVNDateTime(slotDate, slot.end_time);

      if (!scheduledDate || !slotEndAt) {
        await t.rollback();

        return res.json({
          status: false,
          message: "Thời gian slot không hợp lệ!",
        });
      }

      if (Date.now() > slotEndAt.getTime()) {
        await t.rollback();

        return res.json({
          status: false,
          message:
            "Khung giờ bạn chọn đã kết thúc. Vui lòng chọn thời gian khác!",
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

      const sameDay = new Date(`${slotDate}T00:00:00+07:00`);
      const nextDay = new Date(`${slotDate}T00:00:00+07:00`);
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

      if (campaign.locate_type === "donation_site") {
        donation_site_id =
          campaign.donation_site_id || slot.donation_site_id || null;

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
        campaign.locate_type === "custom" && campaign.location
          ? `[Địa điểm chiến dịch] ${campaign.location}`
          : null;

      const notesFinal = [notes?.trim(), extraLoc].filter(Boolean).join("\n");

      const appointment_code = generateAppointmentCode("CD");

      const created = await createAppointmentWithSlotCapacity({
        slotId: selectedSlotId,
        appointmentPayload: {
          appointment_code,
          donor_id,
          donation_site_id,
          campaign_id: campaign.id,
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