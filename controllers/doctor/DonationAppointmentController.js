"use strict";

const { Op } = require("sequelize");
const {
  Appointment,
  AppointmentSlot,
  DonationSite,
  User,
  Doctor,
  Hospital,
  Campaign,
} = require("../../models");

const emailQueue = require("../../services/emailQueue");
const { APPOINTMENT_STATUS } = require("../../constants/appointmentStatus");

const formatDate = (d) => {
  if (!d) return "";
  const date = new Date(d);
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
};

const formatTime = (d) => (d ? d.toTimeString().slice(0, 5) : null);

const inferTimeRange = (date) => {
  if (!date) return "";
  return date.getHours() < 12 ? "7:00 - 11:00" : "13:00 - 17:00";
};

const pickAssoc = (SourceModel, targetName, foreignKey) => {
  const assocs = SourceModel?.associations || {};
  return Object.values(assocs).find(
    (a) =>
      a?.target?.name === targetName &&
      (!foreignKey || a.foreignKey === foreignKey)
  );
};

const donorAssoc = pickAssoc(Appointment, "User", "donor_id");
const siteAssoc = pickAssoc(Appointment, "DonationSite", "donation_site_id");
const slotAssoc = pickAssoc(Appointment, "AppointmentSlot", "appointment_slot_id");
const approvedDoctorAssoc = pickAssoc(
  Appointment,
  "Doctor",
  "approved_by_doctor_id"
);

const slotSiteAssoc = pickAssoc(AppointmentSlot, "DonationSite", "donation_site_id");
const hospitalAssoc = pickAssoc(DonationSite, "Hospital");
const campaignSiteAssoc = pickAssoc(Campaign, "DonationSite", "donation_site_id");

const getDonor = (appt) => (donorAssoc ? appt[donorAssoc.as] : appt.User);
const getSlot = (appt) => (slotAssoc ? appt[slotAssoc.as] : appt.AppointmentSlot);
const getDirectSite = (appt) =>
  siteAssoc ? appt[siteAssoc.as] : appt.donation_site;

const getSiteFromAppt = (appt) => {
  const slot = getSlot(appt);
  const directSite = getDirectSite(appt);

  return (
    (slotSiteAssoc && slot?.[slotSiteAssoc.as]) ||
    slot?.DonationSite ||
    directSite ||
    null
  );
};

const getHospitalFromSite = (site) =>
  (hospitalAssoc && site?.[hospitalAssoc.as]) || site?.Hospital || null;

const cleanNotes = (notes) => {
  if (!notes) return null;

  const lines = String(notes)
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

  const filtered = lines.filter(
    (l) => !/^\[\s*Địa điểm chiến dịch\s*\]/i.test(l)
  );

  const out = filtered.join("\n").trim();
  return out || null;
};

const buildMailDataFromAppointment = (appointment, extra = {}) => {
  const donor = getDonor(appointment);
  const slot = getSlot(appointment);
  const site = getSiteFromAppt(appointment);
  const hospital = getHospitalFromSite(site);

  const timeRange = slot?.start_time
    ? `${formatTime(slot.start_time)} - ${formatTime(slot.end_time)}`
    : inferTimeRange(appointment.scheduled_at);

  return {
    ho_ten: donor?.full_name || "",
    email: donor?.email || "",
    appointment_code: appointment.appointment_code,
    ngay_hien: appointment.scheduled_at ? formatDate(appointment.scheduled_at) : "",
    khung_gio: timeRange,
    dia_diem: extra.location_display || site?.name || "",
    benh_vien: extra.hospital_display || hospital?.name || "",
    the_tich: appointment.preferred_volume_ml || "",
    ghi_chu: cleanNotes(appointment.notes) || "",
    campaign_title: extra.campaign_title || "",
  };
};

const loadCampaignMap = async (campaignIds) => {
  const ids = [...new Set((campaignIds || []).filter(Boolean))];
  if (!ids.length) return {};

  const includeDonationSite = campaignSiteAssoc
    ? {
        association: campaignSiteAssoc,
        required: false,
        include: hospitalAssoc
          ? [{ association: hospitalAssoc, required: false }]
          : [Hospital],
      }
    : {
        model: DonationSite,
        as: "donation_site",
        required: false,
        include: [Hospital],
      };

  const camps = await Campaign.findAll({
    where: { id: { [Op.in]: ids } },
    include: [includeDonationSite],
  });

  const map = {};
  camps.forEach((c) => (map[c.id] = c));
  return map;
};

const getCampaignSite = (camp) =>
  (campaignSiteAssoc && camp?.[campaignSiteAssoc.as]) ||
  camp?.donation_site ||
  null;

module.exports = {
  async index(req, res) {
    try {
      const { appointment_code, date, from_date, to_date } = req.query;

      const where = { status: APPOINTMENT_STATUS.REQUESTED };

      if (appointment_code) where.appointment_code = appointment_code.trim();

      if (from_date || to_date) {
        const start = from_date
          ? new Date(`${from_date} 00:00:00`)
          : new Date("1970-01-01 00:00:00");

        const end = to_date
          ? new Date(`${to_date} 23:59:59`)
          : new Date("9999-12-31 23:59:59");

        where.scheduled_at = { [Op.between]: [start, end] };
      } else if (date) {
        const start = new Date(`${date} 00:00:00`);
        const end = new Date(`${date} 23:59:59`);
        where.scheduled_at = { [Op.between]: [start, end] };
      }

      const rows = await Appointment.findAll({
        where,
        include: [
          donorAssoc
            ? {
                association: donorAssoc,
                attributes: ["full_name", "phone", "email", "blood_group"],
              }
            : {
                model: User,
                attributes: ["full_name", "phone", "email", "blood_group"],
              },

          slotAssoc
            ? {
                association: slotAssoc,
                required: false,
                include: [
                  slotSiteAssoc
                    ? {
                        association: slotSiteAssoc,
                        required: false,
                        include: hospitalAssoc
                          ? [{ association: hospitalAssoc, required: false }]
                          : [Hospital],
                      }
                    : {
                        model: DonationSite,
                        required: false,
                        include: hospitalAssoc
                          ? [{ association: hospitalAssoc, required: false }]
                          : [Hospital],
                      },
                ],
              }
            : {
                model: AppointmentSlot,
                required: false,
                include: [
                  {
                    model: DonationSite,
                    required: false,
                    include: [Hospital],
                  },
                ],
              },

          siteAssoc
            ? {
                association: siteAssoc,
                required: false,
                include: hospitalAssoc
                  ? [{ association: hospitalAssoc, required: false }]
                  : [Hospital],
              }
            : {
                model: DonationSite,
                as: "donation_site",
                required: false,
                include: [Hospital],
              },

          approvedDoctorAssoc
            ? {
                association: approvedDoctorAssoc,
                attributes: ["full_name"],
                required: false,
              }
            : {
                model: Doctor,
                as: "approved_doctor",
                attributes: ["full_name"],
                required: false,
              },
        ],
        order: [["created_at", "DESC"]],
      });

      const campaignMap = await loadCampaignMap(rows.map((r) => r.campaign_id));

      const data = rows.map((row) => {
        const donor = getDonor(row);
        const slot = getSlot(row);

        const apptSite = getSiteFromAppt(row);
        const apptHospital = getHospitalFromSite(apptSite);
        const camp = row.campaign_id ? campaignMap[row.campaign_id] : null;

        let is_campaign = !!camp;
        let campaign_title = camp?.title || "";
        let campaign_locate_type = camp?.locate_type || null;
        let campaign_location = camp?.location || "";
        let location_display = "";
        let hospital_display = "";

        if (camp) {
          const campSite = getCampaignSite(camp);
          const campHospital = getHospitalFromSite(campSite);

          if (camp.locate_type === "donation_site") {
            const finalSite = campSite || apptSite;
            const finalHospital = campHospital || apptHospital;

            location_display = [finalSite?.name, finalSite?.address]
              .filter(Boolean)
              .join(" – ");

            hospital_display = finalHospital?.name || "";
          } else {
            location_display = campaign_location || "";
            hospital_display = "";
          }
        } else {
          location_display = apptSite?.name || "";
          hospital_display = apptHospital?.name || "";
        }

        const timeRange = slot?.start_time
          ? `${formatTime(slot.start_time)} - ${formatTime(slot.end_time)}`
          : inferTimeRange(row.scheduled_at);

        const doctorName = approvedDoctorAssoc
          ? row?.[approvedDoctorAssoc.as]?.full_name
          : row?.approved_doctor?.full_name;

        return {
          id: row.id,
          appointment_code: row.appointment_code,

          is_campaign,
          campaign_id: row.campaign_id || null,
          campaign_title,
          campaign_locate_type,
          campaign_location,

          status: row.status,

          donor_name: donor?.full_name || "",
          donor_phone: donor?.phone || "",
          donor_email: donor?.email || "",
          blood_group: donor?.blood_group || "",

          scheduled_date: formatDate(row.scheduled_at),
          time_range: timeRange,

          donation_site_name: apptSite?.name || "",
          hospital_name: apptHospital?.name || "",

          location_display,
          hospital_display,

          preferred_volume_ml: row.preferred_volume_ml,
          notes: cleanNotes(row.notes),
          doctor_name: doctorName || "Chưa duyệt",
        };
      });

      return res.json({
        status: true,
        message: "Lấy danh sách lịch đang CHỜ DUYỆT thành công",
        data,
      });
    } catch (error) {
      console.error("Lỗi lấy danh sách:", error);
      return res.status(500).json({
        status: false,
        message: "Lỗi server!",
        error: error.message,
      });
    }
  },

  async approve(req, res) {
    try {
      const { id } = req.body;

      if (!id) {
        return res.status(400).json({
          status: false,
          message: "Thiếu ID lịch hiến máu",
        });
      }

      const appointment = await Appointment.findByPk(id, {
        include: [
          donorAssoc
            ? { association: donorAssoc, attributes: ["full_name", "email"] }
            : { model: User, attributes: ["full_name", "email"] },

          slotAssoc
            ? {
                association: slotAssoc,
                required: false,
                include: [
                  slotSiteAssoc
                    ? {
                        association: slotSiteAssoc,
                        required: false,
                        include: hospitalAssoc
                          ? [{ association: hospitalAssoc, required: false }]
                          : [Hospital],
                      }
                    : {
                        model: DonationSite,
                        required: false,
                        include: [Hospital],
                      },
                ],
              }
            : {
                model: AppointmentSlot,
                required: false,
                include: [
                  {
                    model: DonationSite,
                    required: false,
                    include: [Hospital],
                  },
                ],
              },

          siteAssoc
            ? {
                association: siteAssoc,
                required: false,
                include: hospitalAssoc
                  ? [{ association: hospitalAssoc, required: false }]
                  : [Hospital],
              }
            : {
                model: DonationSite,
                as: "donation_site",
                required: false,
                include: [Hospital],
              },
        ],
      });

      if (!appointment) {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy lịch hiến máu",
        });
      }

      if (appointment.status !== APPOINTMENT_STATUS.REQUESTED) {
        return res.status(400).json({
          status: false,
          message: "Chỉ được duyệt lịch CHỜ DUYỆT",
        });
      }

      const doctorUserId = req.user?.userId;
      const doctor = await Doctor.findOne({ where: { user_id: doctorUserId } });

      if (!doctor) {
        return res.status(403).json({
          status: false,
          message: "Tài khoản bác sĩ không hợp lệ",
        });
      }

      appointment.status = APPOINTMENT_STATUS.APPROVED;
      appointment.approved_by_doctor_id = doctor.id;
      appointment.approved_at = new Date();
      appointment.rejected_reason = null;
      await appointment.save();

      const isCampaign = !!appointment.campaign_id;

      let extra = {};
      if (isCampaign) {
        const campMap = await loadCampaignMap([appointment.campaign_id]);
        const camp = campMap[appointment.campaign_id];

        if (camp) {
          const campSite = getCampaignSite(camp);
          const campHospital = getHospitalFromSite(campSite);

          extra.campaign_title = camp.title || "";

          if (camp.locate_type === "donation_site") {
            extra.location_display = [campSite?.name, campSite?.address]
              .filter(Boolean)
              .join(" – ");
            extra.hospital_display = campHospital?.name || "";
          } else {
            extra.location_display = camp.location || "";
            extra.hospital_display = "";
          }
        }
      }

      const mailData = buildMailDataFromAppointment(appointment, extra);

      await emailQueue.enqueue({
        email: mailData.email,
        subject: isCampaign
          ? "Bạn đã được duyệt tham gia chiến dịch hiến máu"
          : "Lịch hiến máu của bạn đã được duyệt",
        template: isCampaign ? "duyet_chien_dich" : "duyet_hien_mau",
        payload: {
          ho_ten: mailData.ho_ten,
          appointment_code: mailData.appointment_code,
          ngay_hien: mailData.ngay_hien,
          khung_gio: mailData.khung_gio,
          dia_diem: mailData.dia_diem,
          benh_vien: mailData.benh_vien,
          the_tich: mailData.the_tich,
          ghi_chu: mailData.ghi_chu,
          campaign_title: mailData.campaign_title,
          year: new Date().getFullYear(),
        },
        scheduled_at: new Date(),
      });

      return res.json({
        status: true,
        message: "Duyệt lịch hiến máu thành công",
      });
    } catch (error) {
      console.error("Lỗi duyệt:", error);
      return res.status(500).json({
        status: false,
        message: "Lỗi server!",
        error: error.message,
      });
    }
  },

  async reject(req, res) {
    try {
      const { id, rejected_reason } = req.body;

      if (!id) {
        return res.status(400).json({
          status: false,
          message: "Thiếu ID lịch hiến máu",
        });
      }

      if (!rejected_reason || !rejected_reason.trim()) {
        return res.status(400).json({
          status: false,
          message: "Vui lòng nhập lý do từ chối",
        });
      }

      const appointment = await Appointment.findByPk(id, {
        include: [
          donorAssoc
            ? { association: donorAssoc, attributes: ["full_name", "email"] }
            : { model: User, attributes: ["full_name", "email"] },

          slotAssoc
            ? {
                association: slotAssoc,
                required: false,
                include: [
                  slotSiteAssoc
                    ? {
                        association: slotSiteAssoc,
                        required: false,
                        include: hospitalAssoc
                          ? [{ association: hospitalAssoc, required: false }]
                          : [Hospital],
                      }
                    : {
                        model: DonationSite,
                        required: false,
                        include: [Hospital],
                      },
                ],
              }
            : {
                model: AppointmentSlot,
                required: false,
                include: [
                  {
                    model: DonationSite,
                    required: false,
                    include: [Hospital],
                  },
                ],
              },

          siteAssoc
            ? {
                association: siteAssoc,
                required: false,
                include: hospitalAssoc
                  ? [{ association: hospitalAssoc, required: false }]
                  : [Hospital],
              }
            : {
                model: DonationSite,
                as: "donation_site",
                required: false,
                include: [Hospital],
              },
        ],
      });

      if (!appointment) {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy lịch hiến máu",
        });
      }

      if (appointment.status !== APPOINTMENT_STATUS.REQUESTED) {
        return res.status(400).json({
          status: false,
          message: "Chỉ được từ chối lịch CHỜ DUYỆT",
        });
      }

      const doctorUserId = req.user?.userId;
      const doctor = await Doctor.findOne({ where: { user_id: doctorUserId } });

      if (!doctor) {
        return res.status(403).json({
          status: false,
          message: "Tài khoản bác sĩ không hợp lệ",
        });
      }

      appointment.status = APPOINTMENT_STATUS.REJECTED;
      appointment.approved_by_doctor_id = doctor.id;
      appointment.approved_at = new Date();
      appointment.rejected_reason = rejected_reason.trim();
      await appointment.save();

      const isCampaign = !!appointment.campaign_id;

      let extra = {};
      if (isCampaign) {
        const campMap = await loadCampaignMap([appointment.campaign_id]);
        const camp = campMap[appointment.campaign_id];

        if (camp) {
          const campSite = getCampaignSite(camp);
          const campHospital = getHospitalFromSite(campSite);

          extra.campaign_title = camp.title || "";

          if (camp.locate_type === "donation_site") {
            extra.location_display = [campSite?.name, campSite?.address]
              .filter(Boolean)
              .join(" – ");
            extra.hospital_display = campHospital?.name || "";
          } else {
            extra.location_display = camp.location || "";
            extra.hospital_display = "";
          }
        }
      }

      const mailData = buildMailDataFromAppointment(appointment, extra);
      mailData.rejected_reason = rejected_reason.trim();

      await emailQueue.enqueue({
        email: mailData.email,
        subject: isCampaign
          ? "Bạn không được duyệt tham gia chiến dịch hiến máu"
          : "Lịch hiến máu của bạn không được duyệt",
        template: isCampaign ? "tu_choi_chien_dich" : "tu_choi_hien_mau",
        payload: {
          ho_ten: mailData.ho_ten,
          appointment_code: mailData.appointment_code,
          ngay_hien: mailData.ngay_hien,
          khung_gio: mailData.khung_gio,
          dia_diem: mailData.dia_diem,
          benh_vien: mailData.benh_vien,
          rejected_reason: mailData.rejected_reason,
          ghi_chu: mailData.ghi_chu,
          campaign_title: mailData.campaign_title,
          year: new Date().getFullYear(),
        },
        scheduled_at: new Date(),
      });

      return res.json({
        status: true,
        message: "Từ chối lịch hiến máu thành công",
      });
    } catch (error) {
      console.error("Lỗi từ chối:", error);
      return res.status(500).json({
        status: false,
        message: "Lỗi server!",
        error: error.message,
      });
    }
  },
};