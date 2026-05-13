"use strict";

const { Op } = require("sequelize");
const {
  Appointment,
  User,
  Doctor,
  DonationSite,
  Campaign,
  AppointmentSlot,
  sequelize,
} = require("../../models");
const emailQueue = require("../../services/emailQueue");

const {
  recalculateSlotCount,
  emitSlotAfterCommit,
} = require("../../services/slotCapacityService");

const toVNDate = (d) => {
  if (!d) return null;
  const dt = new Date(d);
  const day = String(dt.getDate()).padStart(2, "0");
  const month = String(dt.getMonth() + 1).padStart(2, "0");
  const year = dt.getFullYear();
  return `${day}/${month}/${year}`;
};

const toTimeStr = (value) => {
  if (!value) return null;

  if (typeof value === "string") {
    return value.slice(0, 5);
  }

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;

  return d.toTimeString().slice(0, 5);
};

const serializeSlot = (slot) => {
  if (!slot) return null;

  const raw = typeof slot.toJSON === "function" ? slot.toJSON() : slot;

  const start = raw.start_time ? String(raw.start_time).slice(0, 5) : "";
  const end = raw.end_time ? String(raw.end_time).slice(0, 5) : "";

  const slotCapacity = Number(raw.slot_capacity || 0);
  const currentCount = Number(raw.current_count || 0);

  return {
    ...raw,
    time_slot_label: start && end ? `${start} - ${end}` : "-",
    available_count: Math.max(slotCapacity - currentCount, 0),
    percent:
      slotCapacity > 0 ? Math.round((currentCount / slotCapacity) * 100) : 0,
    is_full: currentCount >= slotCapacity,
  };
};

module.exports = {
  async index(req, res) {
    try {
      const rows = await Appointment.findAll({
        attributes: {
          include: [
            [
              sequelize.literal(`(
                SELECT volume_ml 
                FROM donations
                WHERE donations.appointment_id = Appointment.id
                LIMIT 1
              )`),
              "actual_volume_ml",
            ],
          ],
        },
        include: [
          {
            model: User,
            as: "donor",
            attributes: ["full_name", "phone", "email", "blood_group"],
          },
          {
            model: DonationSite,
            as: "donation_site",
            attributes: ["id", "name"],
          },
          {
            model: AppointmentSlot,
            as: "slot",
            required: false,
          },
          {
            model: Campaign,
            as: "campaign",
            attributes: ["id", "title"],
          },
          {
            model: Doctor,
            as: "approved_doctor",
            attributes: ["id"],
            include: [{ model: User, as: "User", attributes: ["full_name"] }],
          },
        ],
        order: [["scheduled_at", "DESC"]],
      });

      const data = rows.map((a) => {
        const x = a.toJSON();
        const slotInfo = x.slot ? serializeSlot(x.slot) : null;

        return {
          id: x.id,
          code: x.appointment_code,
          donor: {
            name: x.donor?.full_name || "—",
            phone: x.donor?.phone || "",
            email: x.donor?.email || "",
            blood: x.donor?.blood_group || "—",
          },
          siteId: x.donation_site?.id,
          site: x.donation_site?.name || "—",
          slot: slotInfo ? slotInfo.time_slot_label : toTimeStr(x.scheduled_at),
          slot_info: slotInfo,
          date: toVNDate(x.scheduled_at),
          status: x.status,
          doctorName: x.approved_doctor?.User?.full_name || "—",
          preferred_volume_ml: x.preferred_volume_ml,
          actual_volume_ml: x.actual_volume_ml,
          rejected_reason: x.rejected_reason,
          campaign_name: x.campaign?.title,
          notes: x.notes,
        };
      });

      const doctorRows = await Doctor.findAll({
        include: [{ model: User, as: "User", attributes: ["full_name"] }],
        attributes: ["id"],
        order: [[sequelize.col("User.full_name"), "ASC"]],
      });

      const doctors = doctorRows.map((d) => ({
        id: d.id,
        name: d.User?.full_name || "",
      }));

      const sites = await DonationSite.findAll({
        attributes: ["id", "name"],
        order: [["name", "ASC"]],
      });

      return res.json({
        status: true,
        data,
        doctors,
        sites,
      });
    } catch (e) {
      console.error("🔥 index error:", e);
      return res.status(500).json({
        status: false,
        message: "Server error",
      });
    }
  },

  async detail(req, res) {
    try {
      const rows = await Appointment.findAll({
        where: { id: req.params.id },
        include: [
          { model: User, as: "donor" },
          { model: DonationSite, as: "donation_site" },
          { model: AppointmentSlot, as: "slot", required: false },
          { model: Campaign, as: "campaign" },
          {
            model: Doctor,
            as: "approved_doctor",
            include: [{ model: User, as: "User" }],
          },
        ],
      });

      const x = rows[0]?.toJSON();

      if (!x) {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy lịch!",
        });
      }

      const slotInfo = x.slot ? serializeSlot(x.slot) : null;

      return res.json({
        status: true,
        data: {
          id: x.id,
          code: x.appointment_code,
          donor: {
            name: x.donor?.full_name,
            phone: x.donor?.phone,
            email: x.donor?.email,
            blood: x.donor?.blood_group,
          },
          site: x.donation_site?.name,
          slot: slotInfo ? slotInfo.time_slot_label : toTimeStr(x.scheduled_at),
          slot_info: slotInfo,
          date: toVNDate(x.scheduled_at),
          notes: x.notes,
          status: x.status,
          doctorName: x.approved_doctor?.User?.full_name,
          preferred_volume_ml: x.preferred_volume_ml,
          actual_volume_ml: x.actual_volume_ml,
          rejected_reason: x.rejected_reason,
          campaign_name: x.campaign?.title,
        },
      });
    } catch (e) {
      return res.status(500).json({ status: false, message: "Server error" });
    }
  },

  async bulkApprove(req, res) {
    const t = await sequelize.transaction();

    try {
      const { ids, note } = req.body;
      const adminId = req.user?.userId;

      const apps = await Appointment.findAll({
        where: { id: { [Op.in]: ids } },
        transaction: t,
      });

      const invalid = apps.filter((a) => a.status !== "REQUESTED");
      if (invalid.length > 0) {
        await t.rollback();
        return res.json({
          status: false,
          message: "Chỉ duyệt những lịch có trạng thái REQUESTED.",
        });
      }

      await Appointment.update(
        {
          status: "APPROVED",
          approved_by_admin_id: adminId,
          approved_at: new Date(),
          notes: note || null,
        },
        {
          where: { id: { [Op.in]: ids } },
          transaction: t,
        }
      );

      const appsMail = await Appointment.findAll({
        where: { id: { [Op.in]: ids } },
        include: [
          { model: User, as: "donor", attributes: ["email", "full_name"] },
        ],
        transaction: t,
      });

      for (const a of appsMail) {
        await emailQueue.enqueue({
          email: a.donor.email,
          subject: "Lịch hẹn hiến máu đã được duyệt",
          template: "duyet_hien_mau",
          payload: {
            donor_name: a.donor.full_name,
            appointment_code: a.appointment_code,
            note: note || "",
          },
        });
      }

      await t.commit();
      return res.json({ status: true, message: "Duyệt thành công!" });
    } catch (e) {
      await t.rollback();
      return res.status(500).json({ status: false, message: "Lỗi server!" });
    }
  },

  async bulkCancel(req, res) {
    const t = await sequelize.transaction();

    try {
      const { ids, note } = req.body;

      const apps = await Appointment.findAll({
        where: { id: { [Op.in]: ids } },
        transaction: t,
      });

      const invalid = apps.filter(
        (a) => !["REQUESTED", "APPROVED"].includes(a.status)
      );

      if (invalid.length > 0) {
        await t.rollback();
        return res.json({
          status: false,
          message:
            "Chỉ được huỷ những lịch có trạng thái REQUESTED hoặc APPROVED.",
        });
      }

      const affectedSlotIds = [
        ...new Set(
          apps.map((a) => a.appointment_slot_id || a.slot_id).filter(Boolean)
        ),
      ];

      await Appointment.update(
        {
          status: "CANCELLED",
          rejected_reason: note || null,
          notes: note || null,
        },
        {
          where: { id: { [Op.in]: ids } },
          transaction: t,
        }
      );

      for (const slotId of affectedSlotIds) {
        await recalculateSlotCount(slotId, t);
      }

      const appsMail = await Appointment.findAll({
        where: { id: { [Op.in]: ids } },
        include: [
          { model: User, as: "donor", attributes: ["email", "full_name"] },
        ],
        transaction: t,
      });

      for (const a of appsMail) {
        await emailQueue.enqueue({
          email: a.donor.email,
          subject: "Lịch hẹn hiến máu bị từ chối",
          template: "tu_choi_hien_mau",
          payload: {
            donor_name: a.donor.full_name,
            appointment_code: a.appointment_code,
            reason: note || "",
          },
        });
      }

      await t.commit();

      for (const slotId of affectedSlotIds) {
        await emitSlotAfterCommit(slotId);
      }

      return res.json({ status: true, message: "Huỷ thành công!" });
    } catch (e) {
      await t.rollback();
      return res.status(500).json({ status: false, message: "Lỗi server!" });
    }
  },

  async bulkNotify(req, res) {
    try {
      const { ids, note } = req.body;

      const apps = await Appointment.findAll({
        where: { id: { [Op.in]: ids } },
        include: [
          { model: User, as: "donor", attributes: ["email", "full_name"] },
        ],
      });

      for (const a of apps) {
        await emailQueue.enqueue({
          email: a.donor.email,
          subject: "Thông báo từ hệ thống hiến máu",
          template: "notification_admin",
          payload: {
            donor_name: a.donor.full_name,
            appointment_code: a.appointment_code,
            message: note,
          },
        });
      }

      return res.json({ status: true, message: "Đã gửi thông báo!" });
    } catch (e) {
      return res.status(500).json({ status: false, message: "Lỗi server!" });
    }
  },
};