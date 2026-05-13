"use strict";

const { emitAppointmentUpdated } = require("../../socket");
const {
  Appointment,
  Donation,
  DonationSite,
  User,
  Doctor,
  BloodType,
  BloodInventory,
  InventoryTransaction,
  Campaign,
  AppointmentSlot,
  sequelize,
} = require("../../models");

const {
  buildSlotPayload,
  refreshSlotCountersByAppointment,
  emitSlotAfterCommit,
} = require("../../services/slotCapacityService");

function parseBloodGroup(group) {
  if (!group) return null;

  const value = String(group).trim().toUpperCase();

  if (!["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].includes(value)) {
    return null;
  }

  return {
    abo: value.slice(0, -1),
    rh: value.slice(-1),
    label: value,
  };
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function toDateOnly(date) {
  return new Date(date).toISOString().slice(0, 10);
}

async function getDoctor(req, transaction = null) {
  const doctorUserId = req.user?.userId || req.user?.id;

  if (!doctorUserId) return null;

  return Doctor.findOne({
    where: {
      user_id: doctorUserId,
    },
    transaction,
  });
}

function appendNote(oldNote, newNote) {
  if (!newNote) return oldNote || null;
  if (!oldNote) return newNote;
  return `${oldNote}\n${newNote}`;
}

function resolveAppointmentLocation(appointment) {
  let siteName = "";
  let address = "";

  const campaign = appointment.campaign || null;
  const directSite = appointment.donation_site || null;

  if (campaign) {
    if (campaign.locate_type === "donation_site") {
      siteName = campaign.donation_site?.name || directSite?.name || "";
      address = campaign.donation_site?.address || directSite?.address || "";
    } else {
      siteName = campaign.location || "";
      address = "";
    }
  } else {
    siteName = directSite?.name || "";
    address = directSite?.address || "";
  }

  return {
    site_name: siteName,
    address,
  };
}

module.exports = {
  async detail(req, res) {
    try {
      const { appointment_id } = req.query;

      if (!appointment_id) {
        return res.status(400).json({
          status: false,
          message: "Thiếu appointment_id!",
        });
      }

      const appointment = await Appointment.findOne({
        where: {
          id: appointment_id,
        },
        include: [
          {
            model: User,
            as: "donor",
            attributes: [
              "id",
              "full_name",
              "email",
              "phone",
              "blood_group",
              "birthday",
              "gender",
              "address",
              "medical_history",
            ],
          },
          {
            model: DonationSite,
            as: "donation_site",
            required: false,
            attributes: ["id", "name", "address"],
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
            attributes: [
              "id",
              "title",
              "locate_type",
              "location",
              "donation_site_id",
            ],
            include: [
              {
                model: DonationSite,
                as: "donation_site",
                required: false,
                attributes: ["id", "name", "address"],
              },
            ],
          },
        ],
      });

      if (!appointment) {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy lịch hẹn!",
        });
      }

      let donation = await Donation.findOne({
        where: {
          appointment_id,
        },
        raw: true,
      });

      if (donation && donation.confirmed_by_doctor_id) {
        const confirmedDoctor = await Doctor.findOne({
          where: {
            id: donation.confirmed_by_doctor_id,
          },
          attributes: ["id", "full_name", "email", "phone"],
          raw: true,
        });

        donation.confirmed_by_doctor = confirmedDoctor || null;
      }

      const location = resolveAppointmentLocation(appointment);
      const slotPayload = appointment.slot
        ? buildSlotPayload(appointment.slot)
        : null;

      return res.json({
        status: true,
        message: "Lấy chi tiết quy trình hiến máu thành công!",
        data: {
          appointment_id: appointment.id,
          appointment_code: appointment.appointment_code,
          scheduled_at: appointment.scheduled_at,
          preferred_volume_ml: appointment.preferred_volume_ml,
          status: appointment.status,
          notes: appointment.notes,
          checked_in_at: appointment.checked_in_at,
          screening_started_at: appointment.screening_started_at,
          donation_started_at: appointment.donation_started_at,
          completed_at: appointment.completed_at,

          appointment_slot_id: appointment.appointment_slot_id,
          slot_id: appointment.slot_id,
          slot: slotPayload,
          slot_info: slotPayload,

          site_name: location.site_name,
          address: location.address,
          campaign: appointment.campaign,

          donor: appointment.donor,
          donation_site: appointment.donation_site,
          donation,
        },
      });
    } catch (error) {
      console.error("DONATION PROCESS DETAIL ERROR:", error);

      return res.status(500).json({
        status: false,
        message: "Lỗi server khi lấy chi tiết quy trình hiến máu!",
        error: error.message,
      });
    }
  },

  async startScreening(req, res) {
    const t = await sequelize.transaction();

    try {
      const { appointment_id } = req.body;

      if (!appointment_id) {
        await t.rollback();
        return res.status(400).json({
          status: false,
          message: "Thiếu appointment_id!",
        });
      }

      const doctor = await getDoctor(req, t);

      if (!doctor) {
        await t.rollback();
        return res.status(403).json({
          status: false,
          message: "Tài khoản không phải bác sĩ!",
        });
      }

      const appointment = await Appointment.findOne({
        where: {
          id: appointment_id,
        },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!appointment) {
        await t.rollback();
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy lịch hẹn!",
        });
      }

      if (appointment.status !== "CHECKED_IN") {
        await t.rollback();
        return res.status(400).json({
          status: false,
          message: `Chỉ được bắt đầu sàng lọc khi trạng thái là CHECKED_IN. Hiện tại: ${appointment.status}`,
        });
      }

      appointment.status = "SCREENING";
      appointment.screening_started_at = new Date();

      await appointment.save({ transaction: t });
      await t.commit();

      emitAppointmentUpdated(appointment.id, {
        appointment_id: appointment.id,
        status: appointment.status,
        event: "START_SCREENING",
        message: "Bác sĩ đã bắt đầu khám sàng lọc.",
      });

      return res.json({
        status: true,
        message: "Đã bắt đầu sàng lọc!",
        data: {
          appointment_id: appointment.id,
          status: appointment.status,
          screening_started_at: appointment.screening_started_at,
        },
      });
    } catch (error) {
      await t.rollback();

      console.error("START SCREENING ERROR:", error);

      return res.status(500).json({
        status: false,
        message: "Lỗi server khi bắt đầu sàng lọc!",
        error: error.message,
      });
    }
  },

  async failScreening(req, res) {
    const t = await sequelize.transaction();

    try {
      const { appointment_id, reason, screening_note } = req.body;

      if (!appointment_id) {
        await t.rollback();
        return res.status(400).json({
          status: false,
          message: "Thiếu appointment_id!",
        });
      }

      const doctor = await getDoctor(req, t);

      if (!doctor) {
        await t.rollback();
        return res.status(403).json({
          status: false,
          message: "Tài khoản không phải bác sĩ!",
        });
      }

      const appointment = await Appointment.findOne({
        where: {
          id: appointment_id,
        },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!appointment) {
        await t.rollback();
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy lịch hẹn!",
        });
      }

      if (appointment.status !== "SCREENING") {
        await t.rollback();
        return res.status(400).json({
          status: false,
          message: `Chỉ được đánh rớt sàng lọc khi trạng thái là SCREENING. Hiện tại: ${appointment.status}`,
        });
      }

      const note = `[Sàng lọc không đạt] ${
        reason || screening_note || "Không có ghi chú"
      }`;

      appointment.status = "FAILED_SCREENING";
      appointment.notes = appendNote(appointment.notes, note);

      await appointment.save({ transaction: t });

      const slotId = appointment.appointment_slot_id || appointment.slot_id;

      await refreshSlotCountersByAppointment(appointment, t);

      await t.commit();

      await emitSlotAfterCommit(slotId);

      emitAppointmentUpdated(appointment.id, {
        appointment_id: appointment.id,
        status: appointment.status,
        event: "FAILED_SCREENING",
        message: "Bạn không đạt điều kiện hiến máu.",
      });

      return res.json({
        status: true,
        message: "Đã cập nhật không đạt sàng lọc!",
        data: {
          appointment_id: appointment.id,
          status: appointment.status,
          notes: appointment.notes,
        },
      });
    } catch (error) {
      await t.rollback();

      console.error("FAIL SCREENING ERROR:", error);

      return res.status(500).json({
        status: false,
        message: "Lỗi server khi cập nhật không đạt sàng lọc!",
        error: error.message,
      });
    }
  },

  async startDonation(req, res) {
    const t = await sequelize.transaction();

    try {
      const {
        appointment_id,
        blood_pressure,
        heart_rate,
        hemoglobin,
        weight,
        screening_note,
      } = req.body;

      if (!appointment_id) {
        await t.rollback();
        return res.status(400).json({
          status: false,
          message: "Thiếu appointment_id!",
        });
      }

      const doctor = await getDoctor(req, t);

      if (!doctor) {
        await t.rollback();
        return res.status(403).json({
          status: false,
          message: "Tài khoản không phải bác sĩ!",
        });
      }

      const appointment = await Appointment.findOne({
        where: {
          id: appointment_id,
        },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!appointment) {
        await t.rollback();
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy lịch hẹn!",
        });
      }

      if (appointment.status !== "SCREENING") {
        await t.rollback();
        return res.status(400).json({
          status: false,
          message: `Chỉ được bắt đầu hiến máu khi trạng thái là SCREENING. Hiện tại: ${appointment.status}`,
        });
      }

      const note = [
        "[Sàng lọc đạt]",
        blood_pressure ? `Huyết áp: ${blood_pressure}` : null,
        heart_rate ? `Nhịp tim: ${heart_rate}` : null,
        hemoglobin ? `Hemoglobin: ${hemoglobin}` : null,
        weight ? `Cân nặng: ${weight}` : null,
        screening_note ? `Ghi chú: ${screening_note}` : null,
      ]
        .filter(Boolean)
        .join(" | ");

      appointment.status = "DONATING";
      appointment.donation_started_at = new Date();
      appointment.notes = appendNote(appointment.notes, note);

      await appointment.save({ transaction: t });
      await t.commit();

      emitAppointmentUpdated(appointment.id, {
        appointment_id: appointment.id,
        status: appointment.status,
        event: "START_DONATION",
        message: "Bạn đã đủ điều kiện và bắt đầu hiến máu.",
      });

      return res.json({
        status: true,
        message: "Đã bắt đầu hiến máu!",
        data: {
          appointment_id: appointment.id,
          status: appointment.status,
          donation_started_at: appointment.donation_started_at,
          notes: appointment.notes,
        },
      });
    } catch (error) {
      await t.rollback();

      console.error("START DONATION ERROR:", error);

      return res.status(500).json({
        status: false,
        message: "Lỗi server khi bắt đầu hiến máu!",
        error: error.message,
      });
    }
  },

  async completeDonation(req, res) {
    const t = await sequelize.transaction();

    try {
      const { appointment_id, volume_ml, blood_group, notes } = req.body;

      if (!appointment_id) {
        await t.rollback();
        return res.status(400).json({
          status: false,
          message: "Thiếu appointment_id!",
        });
      }

      if (!volume_ml || Number(volume_ml) <= 0) {
        await t.rollback();
        return res.status(400).json({
          status: false,
          message: "Lượng máu không hợp lệ!",
        });
      }

      const doctor = await getDoctor(req, t);

      if (!doctor) {
        await t.rollback();
        return res.status(403).json({
          status: false,
          message: "Tài khoản không phải bác sĩ!",
        });
      }

      const appointment = await Appointment.findOne({
        where: {
          id: appointment_id,
        },
        include: [
          {
            model: User,
            as: "donor",
            attributes: ["id", "full_name", "email", "phone", "blood_group"],
          },
          {
            model: DonationSite,
            as: "donation_site",
            attributes: ["id", "name", "address", "hospital_id"],
          },
        ],
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!appointment) {
        await t.rollback();
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy lịch hẹn!",
        });
      }

      if (appointment.status !== "DONATING") {
        await t.rollback();
        return res.status(400).json({
          status: false,
          message: `Chỉ được hoàn tất khi trạng thái là DONATING. Hiện tại: ${appointment.status}`,
        });
      }

      const existedDonation = await Donation.findOne({
        where: {
          appointment_id,
        },
        transaction: t,
      });

      if (existedDonation) {
        await t.rollback();
        return res.status(400).json({
          status: false,
          message: "Lịch hẹn này đã có bản ghi hiến máu!",
        });
      }

      const finalBloodGroup = blood_group || appointment.donor?.blood_group;
      const parsedBloodGroup = parseBloodGroup(finalBloodGroup);

      if (!parsedBloodGroup) {
        await t.rollback();
        return res.status(400).json({
          status: false,
          message: "Nhóm máu không hợp lệ hoặc chưa có nhóm máu!",
        });
      }

      const [bloodType] = await BloodType.findOrCreate({
        where: {
          abo: parsedBloodGroup.abo,
          rh: parsedBloodGroup.rh,
        },
        defaults: {
          abo: parsedBloodGroup.abo,
          rh: parsedBloodGroup.rh,
        },
        transaction: t,
      });

      const now = new Date();
      const donationDate = toDateOnly(now);
      const expiryDate = toDateOnly(addDays(now, 35));
      const hospitalId = appointment.donation_site?.hospital_id || null;

      const donation = await Donation.create(
        {
          donor_user_id: appointment.donor_id,
          appointment_id: appointment.id,
          hospital_id: hospitalId,
          blood_type_id: bloodType.id,
          volume_ml: Number(volume_ml),
          collected_at: now,
          screened_ok: 1,
          confirmed_by_doctor_id: doctor.id,
          confirmed_at: now,
          notes: notes || null,
        },
        {
          transaction: t,
        }
      );

      const inventory = await BloodInventory.create(
        {
          donation_id: donation.id,
          hospital_id: hospitalId,
          blood_type_id: bloodType.id,
          units: 1,
          donation_date: donationDate,
          expiry_date: expiryDate,
          status: "testing",
          quality_note: "Túi máu đang chờ kiểm định sau hiến máu",
        },
        {
          transaction: t,
        }
      );

      await InventoryTransaction.create(
        {
          inventory_id: inventory.id,
          user_id: req.user?.userId || req.user?.id || null,
          tx_type: "IN",
          units: 1,
          reason: `Tạo túi máu chờ kiểm định từ appointment_id=${appointment.id}`,
          ref_donation_id: donation.id,
          occurred_at: now,
        },
        {
          transaction: t,
        }
      );

      appointment.status = "COMPLETED";
      appointment.completed_at = now;

      if (notes) {
        appointment.notes = appendNote(
          appointment.notes,
          `[Hoàn tất hiến máu] ${notes}`
        );
      }

      await appointment.save({ transaction: t });

      const slotId = appointment.appointment_slot_id || appointment.slot_id;

      await refreshSlotCountersByAppointment(appointment, t);

      await t.commit();

      await emitSlotAfterCommit(slotId);

      emitAppointmentUpdated(appointment.id, {
        appointment_id: appointment.id,
        status: appointment.status,
        event: "COMPLETE_DONATION",
        message:
          "Quá trình hiến máu đã hoàn tất. Túi máu đang chờ kiểm định.",
      });

      return res.status(201).json({
        status: true,
        message:
          "Hoàn tất hiến máu. Túi máu đã được chuyển sang trạng thái chờ kiểm định!",
        data: {
          appointment_id: appointment.id,
          appointment_code: appointment.appointment_code,
          status: appointment.status,
          donation_id: donation.id,
          inventory_id: inventory.id,
          inventory_status: inventory.status,
          volume_ml: Number(volume_ml),
          blood_group: parsedBloodGroup.label,
          completed_at: appointment.completed_at,
        },
      });
    } catch (error) {
      await t.rollback();

      console.error("COMPLETE DONATION PROCESS ERROR:", error);

      return res.status(500).json({
        status: false,
        message: "Lỗi server khi hoàn tất hiến máu!",
        error: error.message,
      });
    }
  },
};