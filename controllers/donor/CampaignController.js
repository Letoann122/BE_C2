"use strict";

const { Op } = require("sequelize");
const { Campaign, DonationSite, Appointment } = require("../../models");

// ===== helpers =====
const todayStr = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD

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

const buildScheduledAtFromDateAndSlot = (dateStr, time_slot) => {
  const left = String(time_slot || "7:00").split("-")[0].trim(); // "7:00"
  const [hh, mm] = left.split(":");
  const [Y, M, D] = String(dateStr).split("-").map(Number);
  return new Date(Y, (M || 1) - 1, D || 1, Number(hh || 7), Number(mm || 0), 0);
};

const normalizePreferredVolume = (v) => {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[^\d]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

module.exports = {
  // GET /api/public/campaigns?status=active|upcoming|running|ended
  async publicCampaigns(req, res) {
    try {
      const { status = "active" } = req.query;
      const t = todayStr();

      const where = { approval_status: "approved" };

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
          locate_type: raw.locate_type,
          donation_site_id: raw.donation_site_id,
          location: raw.location,
          status: computeCampaignStatus(raw.start_date, raw.end_date),
          location_display: buildLocationDisplay(raw),
        };
      });

      return res.json({ status: true, data });
    } catch (err) {
      console.error("CampaignController.publicCampaigns error:", err);
      return res.status(500).json({ status: false, message: err.message });
    }
  },

  // GET /api/public/campaigns/:id
  async publicCampaignDetail(req, res) {
    try {
      const { id } = req.params;

      const campaign = await Campaign.findOne({
        where: { id, approval_status: "approved" },
        include: [
          {
            model: DonationSite,
            as: "donation_site",
            required: false,
          },
        ],
      });

      if (!campaign) {
        return res.status(404).json({ status: false, message: "Không tìm thấy chiến dịch" });
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
      return res.status(500).json({ status: false, message: err.message });
    }
  },

  // ===================== DONOR: REGISTER CAMPAIGN =====================
  // POST /api/donor/register-campaigns
  async donorCreateAppointment(req, res) {
    try {
      const donor_id = req.user?.userId || req.user?.id;
      const { campaign_id, date, time_slot, preferred_volume_ml, notes } = req.body;

      if (!campaign_id) {
        return res.json({ status: false, message: "Thiếu campaign_id!" });
      }
      if (!date || !time_slot) {
        return res.json({ status: false, message: "Thiếu ngày hoặc khung giờ!" });
      }

      const campaign = await Campaign.findOne({
        where: { id: campaign_id, approval_status: "approved" },
      });
      if (!campaign) {
        return res.json({ status: false, message: "Chiến dịch không hợp lệ!" });
      }

      const camp = campaign.toJSON();
      const st = computeCampaignStatus(camp.start_date, camp.end_date);
      if (st === "ended") {
        return res.json({ status: false, message: "Chiến dịch đã kết thúc!" });
      }

      // ngày phải nằm trong khoảng start_date - end_date
      const dStr = String(date);
      const sStr = String(camp.start_date).slice(0, 10);
      const eStr = String(camp.end_date).slice(0, 10);
      if (dStr < sStr || dStr > eStr) {
        return res.json({ status: false, message: `Ngày phải trong ${sStr} - ${eStr}` });
      }

      // build scheduled_at từ ngày + time_slot
      const scheduled_at = buildScheduledAtFromDateAndSlot(dStr, time_slot);
      const scheduledDate = new Date(scheduled_at);
      const now = new Date();

      // 1) Không cho đặt lịch ở khung giờ đã trôi qua
      if (scheduledDate < now) {
        return res.json({
          status: false,
          message: "Khung giờ bạn chọn đã trôi qua. Vui lòng chọn thời gian khác!",
        });
      }

      // 2) Kiểm tra lần hiến gần nhất (COMPLETED) để đảm bảo cách 3 tháng
      const lastDonation = await Appointment.findOne({
        where: {
          donor_id,
          status: "COMPLETED",
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

      // 3) Chặn trùng lịch trong cùng 1 ngày (bao gồm cả COMPLETED)
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
          scheduled_at: { [Op.gte]: sameDay, [Op.lt]: nextDay },
          status: {
            [Op.in]: ["REQUESTED", "APPROVED", "BOOKED", "COMPLETED"],
          },
        },
      });

      if (existed) {
        return res.json({
          status: false,
          message: "Bạn đã có lịch đăng ký hoặc đã hiến máu trong ngày này!",
        });
      }

      // 4) donation_site_id theo locate_type
      let donation_site_id = null;
      if (camp.locate_type === "donation_site") {
        donation_site_id = camp.donation_site_id || null;
        if (!donation_site_id) {
          return res.json({
            status: false,
            message: "Chiến dịch thiếu donation_site_id!",
          });
        }
      }

      // custom location -> nhét thêm vào notes để bác sĩ/admin đọc
      const extraLoc =
        camp.locate_type === "custom" && camp.location
          ? `[Địa điểm chiến dịch] ${camp.location}`
          : null;

      const notesFinal = [notes?.trim(), extraLoc].filter(Boolean).join("\n");

      const created = await Appointment.create({
        donor_id,
        donation_site_id, // custom => null
        campaign_id: camp.id,
        appointment_slot_id: null,
        scheduled_at,
        preferred_volume_ml: normalizePreferredVolume(preferred_volume_ml),
        notes: notesFinal || null,
        time_slot,
        status: "REQUESTED",
      });

      return res.json({
        status: true,
        message: "Đăng ký chiến dịch thành công! Vui lòng chờ xét duyệt.",
        data: created,
      });
    } catch (err) {
      console.error("CampaignController.donorCreateAppointment error:", err);
      return res.status(500).json({ status: false, message: err.message });
    }
  },

  // ===================== ADMIN: APPROVE/REJECT CAMPAIGN REGISTRATIONS =====================
  async adminListCampaignRegistrations(req, res) {
    try {
      const { status } = req.query;

      const where = { campaign_id: { [Op.ne]: null } };
      if (status) where.status = status;

      const rows = await Appointment.findAll({
        where,
        include: [{ model: Campaign, as: "campaign", required: false }],
        order: [["created_at", "DESC"]],
      });

      return res.json({ status: true, data: rows });
    } catch (err) {
      console.error("adminListCampaignRegistrations error:", err);
      return res.status(500).json({ status: false, message: err.message });
    }
  },

  async adminApproveCampaignRegistration(req, res) {
    try {
      const admin_id = req.user?.userId || req.user?.id;
      const { id } = req.params;

      const appt = await Appointment.findOne({ where: { id, campaign_id: { [Op.ne]: null } } });
      if (!appt) return res.status(404).json({ status: false, message: "Không tìm thấy đăng ký!" });
      if (appt.status !== "REQUESTED") {
        return res.status(422).json({ status: false, message: "Chỉ duyệt khi REQUESTED!" });
      }

      await appt.update({
        status: "APPROVED",
        approved_by_d: admin_id, // log nhanh
        approved_at: new Date(),
        rejected_reason: null,
      });

      return res.json({ status: true, message: "Duyệt đăng ký chiến dịch thành công!" });
    } catch (err) {
      console.error("adminApproveCampaignRegistration error:", err);
      return res.status(500).json({ status: false, message: err.message });
    }
  },

  async adminRejectCampaignRegistration(req, res) {
    try {
      const admin_id = req.user?.userId || req.user?.id;
      const { id } = req.params;
      const { rejected_reason } = req.body;

      if (!rejected_reason || !String(rejected_reason).trim()) {
        return res.status(422).json({ status: false, message: "Vui lòng nhập lý do từ chối!" });
      }

      const appt = await Appointment.findOne({ where: { id, campaign_id: { [Op.ne]: null } } });
      if (!appt) return res.status(404).json({ status: false, message: "Không tìm thấy đăng ký!" });
      if (appt.status !== "REQUESTED") {
        return res.status(422).json({ status: false, message: "Chỉ từ chối khi REQUESTED!" });
      }

      await appt.update({
        status: "REJECTED",
        rejected_reason: String(rejected_reason).trim(),
        approved_by_d: admin_id,
        approved_at: new Date(),
      });

      return res.json({ status: true, message: "Đã từ chối đăng ký chiến dịch!" });
    } catch (err) {
      console.error("adminRejectCampaignRegistration error:", err);
      return res.status(500).json({ status: false, message: err.message });
    }
  },
};
