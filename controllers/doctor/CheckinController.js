"use strict";

const { Op } = require("sequelize");
const {
  Appointment,
  Doctor,
  User,
  DonationSite,
  AppointmentSlot,
} = require("../../models");
const { emitAppointmentUpdated } = require("../../socket");
const {
  APPOINTMENT_STATUS,
  QR_ALLOWED_STATUSES,
} = require("../../constants/appointmentStatus");
const UserNotificationService = require("../../services/UserNotificationService");
const {
  refreshSlotCountersByAppointment,
  emitSlotAfterCommit,
} = require("../../services/slotCapacityService");

const VN_TIMEZONE_OFFSET_HOURS = 7;

function parseQrPayload(raw) {
  if (!raw) return {};

  if (typeof raw === "object") return raw;

  const text = String(raw).trim();

  try {
    const json = JSON.parse(text);
    if (json && typeof json === "object") {
      return json;
    }
  } catch (_) {}

  try {
    const url = new URL(text);
    return {
      appointment_id: url.searchParams.get("appointment_id"),
      appointment_code:
        url.searchParams.get("appointment_code") ||
        url.searchParams.get("code") ||
        url.searchParams.get("qr_code"),
    };
  } catch (_) {}

  return {
    appointment_code: text,
  };
}

const ACTIVE_BEFORE_CHECKIN_STATUSES = ["APPROVED", "BOOKED"];

function pad2(value) {
  return String(value).padStart(2, "0");
}

function getVietnamParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const map = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      map[part.type] = part.value;
    }
  }

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    dateString: `${map.year}-${map.month}-${map.day}`,
    timeString: `${map.hour}:${map.minute}:${map.second}`,
  };
}

function getDatePartInVietnam(dateValue) {
  if (!dateValue) return null;

  if (typeof dateValue === "string") {
    return dateValue.slice(0, 10);
  }

  const parts = getVietnamParts(new Date(dateValue));
  return parts.dateString;
}

function buildVietnamDateTime(dateValue, timeValue) {
  if (!dateValue || !timeValue) return null;

  const datePart = getDatePartInVietnam(dateValue);
  const timePart = String(timeValue).slice(0, 8);

  if (!datePart || !timePart) return null;

  const [year, month, day] = datePart.split("-").map(Number);
  const [hour = 0, minute = 0, second = 0] = timePart.split(":").map(Number);

  if (!year || !month || !day) return null;

  return new Date(
    Date.UTC(
      year,
      month - 1,
      day,
      hour - VN_TIMEZONE_OFFSET_HOURS,
      minute,
      second,
      0
    )
  );
}

function buildVietnamDateOnly(dateValue, endOfDay = false) {
  const datePart = getDatePartInVietnam(dateValue);

  if (!datePart) return null;

  const [year, month, day] = datePart.split("-").map(Number);

  if (!year || !month || !day) return null;

  const hour = endOfDay ? 23 : 0;
  const minute = endOfDay ? 59 : 0;
  const second = endOfDay ? 59 : 0;
  const millisecond = endOfDay ? 999 : 0;

  return new Date(
    Date.UTC(
      year,
      month - 1,
      day,
      hour - VN_TIMEZONE_OFFSET_HOURS,
      minute,
      second,
      millisecond
    )
  );
}

function formatVietnamDateTime(value) {
  if (!value) return "";

  return new Date(value).toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatVietnamTime(value) {
  if (!value) return "";

  return new Date(value).toLocaleTimeString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isSameVietnamDate(dateA, dateB) {
  if (!dateA || !dateB) return false;

  const a = getVietnamParts(new Date(dateA));
  const b = getVietnamParts(new Date(dateB));

  return (
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day
  );
}

async function validateCheckinTime(appointment) {
  const now = new Date();
  const slotId = appointment.appointment_slot_id || appointment.slot_id;

  if (slotId) {
    const slot = await AppointmentSlot.findByPk(slotId);

    if (slot && slot.slot_date && slot.start_time && slot.end_time) {
      const startTime = buildVietnamDateTime(slot.slot_date, slot.start_time);
      const endTime = buildVietnamDateTime(slot.slot_date, slot.end_time);

      if (!startTime || !endTime) {
        return {
          valid: false,
          message: "Không xác định được khung giờ check-in!",
        };
      }

      const startOfSlotDay = buildVietnamDateOnly(slot.slot_date, false);
      const endOfSlotDay = buildVietnamDateOnly(slot.slot_date, true);

      if (startOfSlotDay && now < startOfSlotDay) {
        return {
          valid: false,
          message: `Chưa đến ngày check-in! Lịch hẹn vào ngày ${formatVietnamDateTime(
            startTime
          )}`,
        };
      }

      if (endOfSlotDay && now > endOfSlotDay) {
        return {
          valid: false,
          message: "Lịch hẹn không phải ngày hôm nay, không thể check-in!",
        };
      }

      if (now < startTime) {
        return {
          valid: false,
          message: `Chưa đến giờ check-in! Khung giờ bắt đầu lúc ${formatVietnamTime(
            startTime
          )}`,
        };
      }

      if (now > endTime) {
        return {
          valid: false,
          message: `Đã quá giờ check-in! Khung giờ kết thúc lúc ${formatVietnamTime(
            endTime
          )}`,
        };
      }

      return { valid: true };
    }
  }

  if (appointment.scheduled_at) {
    const nowVietnam = new Date();
    const scheduledAt = new Date(appointment.scheduled_at);

    const sameDay = isSameVietnamDate(nowVietnam, scheduledAt);

    if (!sameDay) {
      return {
        valid: false,
        message: "Chỉ được check-in đúng ngày trong lịch hẹn!",
      };
    }
  }

  return { valid: true };
}

function getNoShowCutoff(scheduledAt) {
  const scheduledDate = new Date(scheduledAt);
  const vnParts = getVietnamParts(scheduledDate);

  const cutoffHour = vnParts.hour < 12 ? 11 : 17;
  const cutoffMinute = 30;

  return new Date(
    Date.UTC(
      vnParts.year,
      vnParts.month - 1,
      vnParts.day,
      cutoffHour - VN_TIMEZONE_OFFSET_HOURS,
      cutoffMinute,
      0,
      0
    )
  );
}

async function markNoShowAppointments() {
  const now = new Date();

  const appointments = await Appointment.findAll({
    where: {
      status: {
        [Op.in]: ACTIVE_BEFORE_CHECKIN_STATUSES,
      },
      checked_in_at: null,
      scheduled_at: {
        [Op.lte]: now,
      },
    },
  });

  let updatedCount = 0;
  const affectedSlotIds = new Set();

  for (const appointment of appointments) {
    const cutoff = getNoShowCutoff(appointment.scheduled_at);

    if (now >= cutoff) {
      appointment.status = "NO_SHOW";
      appointment.no_show_at = now;

      await appointment.save();

      const slotId = appointment.appointment_slot_id || appointment.slot_id;
      if (slotId) affectedSlotIds.add(slotId);

      emitAppointmentUpdated(appointment.id, {
        status: appointment.status,
        event: "NO_SHOW",
        message: "Lịch hẹn đã được ghi nhận là vắng mặt.",
      });

      updatedCount++;
    }
  }

  for (const appointment of appointments) {
    if (appointment.status === "NO_SHOW") {
      await refreshSlotCountersByAppointment(appointment);
    }
  }

  for (const slotId of affectedSlotIds) {
    await emitSlotAfterCommit(slotId);
  }

  return updatedCount;
}

module.exports = {
  async checkin(req, res) {
    try {
      const payload = parseQrPayload(
        req.body.qr_code || req.body.qr_payload || req.body
      );

      const appointment_id = payload.appointment_id || req.body.appointment_id;

      const appointment_code =
        payload.appointment_code ||
        payload.qr_code ||
        req.body.appointment_code ||
        req.body.qr_code;

      if (!appointment_id && !appointment_code) {
        return res.status(400).json({
          status: false,
          message: "Thiếu dữ liệu QR!",
        });
      }

      const doctorUserId = req.user?.userId || req.user?.id;

      const doctor = await Doctor.findOne({
        where: {
          user_id: doctorUserId,
        },
      });

      if (!doctor) {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy thông tin bác sĩ!",
        });
      }

      const where = {};

      if (appointment_id) {
        where.id = appointment_id;
      }

      if (appointment_code) {
        where.appointment_code = appointment_code;
      }

      const appointment = await Appointment.findOne({
        where,
        include: [
          {
            model: User,
            as: "donor",
            attributes: ["id", "full_name", "email", "phone", "blood_group"],
          },
          {
            model: DonationSite,
            as: "donation_site",
            attributes: ["id", "name", "address"],
          },
        ],
      });

      if (!appointment) {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy lịch hẹn từ mã QR!",
        });
      }

      if (appointment.status === APPOINTMENT_STATUS.CHECKED_IN) {
        return res.json({
          status: true,
          message: "Lịch hẹn này đã được check-in trước đó!",
          data: {
            appointment_id: appointment.id,
            appointment_code: appointment.appointment_code,
            scheduled_at: appointment.scheduled_at,
            status: appointment.status,
            checked_in_at: appointment.checked_in_at,
            checked_in_by_doctor_id: appointment.checked_in_by_doctor_id,
            donor: appointment.donor,
            donation_site: appointment.donation_site,
          },
        });
      }

      if (!QR_ALLOWED_STATUSES.includes(appointment.status)) {
        return res.status(400).json({
          status: false,
          message: `Lịch hẹn đang ở trạng thái ${appointment.status}, không thể check-in!`,
        });
      }

      const timeValidation = await validateCheckinTime(appointment);

      if (!timeValidation.valid) {
        return res.status(400).json({
          status: false,
          message: timeValidation.message,
        });
      }

      appointment.status = APPOINTMENT_STATUS.CHECKED_IN;
      appointment.checked_in_at = new Date();
      appointment.checked_in_by_doctor_id = doctor.id;

      await appointment.save();

      try {
        await UserNotificationService.create({
          user_id: appointment.donor_id,
          type: "appointment",
          title: "Check-in thành công",
          message: "Bạn đã check-in thành công cho lịch hiến máu.",
          priority: "normal",
          action_url: "/my-appointments",
          meta_json: {
            appointment_id: appointment.id,
          },
        });
      } catch (notiError) {
        console.error("CREATE CHECKIN NOTIFICATION ERROR:", notiError);
      }

      emitAppointmentUpdated(appointment.id, {
        status: appointment.status,
        event: "CHECKED_IN",
        message: "Bạn đã check-in thành công.",
      });

      return res.json({
        status: true,
        message: "Check-in thành công!",
        data: {
          appointment_id: appointment.id,
          appointment_code: appointment.appointment_code,
          scheduled_at: appointment.scheduled_at,
          status: appointment.status,
          checked_in_at: appointment.checked_in_at,
          checked_in_by_doctor_id: appointment.checked_in_by_doctor_id,
          donor: appointment.donor,
          donation_site: appointment.donation_site,
        },
      });
    } catch (error) {
      console.error("CHECKIN ERROR:", error);

      return res.status(500).json({
        status: false,
        message: "Lỗi server khi check-in!",
        error: error.message,
      });
    }
  },

  async todayCheckedIn(req, res) {
    try {
      const { time_slot, status } = req.query;

      const nowVN = getVietnamParts(new Date());

      const startOfDay = new Date(
        Date.UTC(
          nowVN.year,
          nowVN.month - 1,
          nowVN.day,
          0 - VN_TIMEZONE_OFFSET_HOURS,
          0,
          0,
          0
        )
      );

      const endOfDay = new Date(
        Date.UTC(
          nowVN.year,
          nowVN.month - 1,
          nowVN.day,
          23 - VN_TIMEZONE_OFFSET_HOURS,
          59,
          59,
          999
        )
      );

      const where = {
        checked_in_at: {
          [Op.between]: [startOfDay, endOfDay],
        },
      };

      if (status) {
        where.status = status;
      } else {
        where.status = {
          [Op.in]: [
            APPOINTMENT_STATUS.CHECKED_IN,
            APPOINTMENT_STATUS.SCREENING,
            APPOINTMENT_STATUS.DONATING,
            APPOINTMENT_STATUS.COMPLETED,
          ],
        };
      }

      if (time_slot === "morning") {
        where.scheduled_at = {
          [Op.between]: [
            new Date(
              Date.UTC(
                nowVN.year,
                nowVN.month - 1,
                nowVN.day,
                7 - VN_TIMEZONE_OFFSET_HOURS,
                0,
                0,
                0
              )
            ),
            new Date(
              Date.UTC(
                nowVN.year,
                nowVN.month - 1,
                nowVN.day,
                11 - VN_TIMEZONE_OFFSET_HOURS,
                59,
                59,
                999
              )
            ),
          ],
        };
      }

      if (time_slot === "afternoon") {
        where.scheduled_at = {
          [Op.between]: [
            new Date(
              Date.UTC(
                nowVN.year,
                nowVN.month - 1,
                nowVN.day,
                13 - VN_TIMEZONE_OFFSET_HOURS,
                0,
                0,
                0
              )
            ),
            new Date(
              Date.UTC(
                nowVN.year,
                nowVN.month - 1,
                nowVN.day,
                17 - VN_TIMEZONE_OFFSET_HOURS,
                59,
                59,
                999
              )
            ),
          ],
        };
      }

      const appointments = await Appointment.findAll({
        where,
        include: [
          {
            model: User,
            as: "donor",
            attributes: ["id", "full_name", "email", "phone", "blood_group"],
          },
          {
            model: DonationSite,
            as: "donation_site",
            attributes: ["id", "name", "address"],
          },
        ],
        order: [["checked_in_at", "DESC"]],
      });

      const data = appointments.map((item) => {
        const scheduledAt = item.scheduled_at
          ? new Date(item.scheduled_at)
          : null;

        const vn = scheduledAt ? getVietnamParts(scheduledAt) : null;
        const hour = vn ? vn.hour : null;

        return {
          appointment_id: item.id,
          appointment_code: item.appointment_code,
          scheduled_at: item.scheduled_at,
          checked_in_at: item.checked_in_at,
          status: item.status,
          preferred_volume_ml: item.preferred_volume_ml,
          donor: item.donor,
          donation_site: item.donation_site,
          time_slot:
            hour === null ? "" : hour < 12 ? "morning" : "afternoon",
          time_slot_label:
            hour === null
              ? "Không xác định"
              : hour < 12
              ? "Ca sáng"
              : "Ca chiều",
        };
      });

      return res.json({
        status: true,
        message: "Lấy danh sách check-in hôm nay thành công!",
        data,
      });
    } catch (error) {
      console.error("TODAY CHECKED IN ERROR:", error);

      return res.status(500).json({
        status: false,
        message: "Lỗi server khi lấy danh sách check-in hôm nay!",
        error: error.message,
      });
    }
  },

  async markNoShow(req, res) {
    try {
      const updatedCount = await markNoShowAppointments();

      return res.json({
        status: true,
        message: "Cập nhật vắng mặt thành công!",
        data: {
          updated_count: updatedCount,
        },
      });
    } catch (error) {
      console.error("MARK NO SHOW ERROR:", error);

      return res.status(500).json({
        status: false,
        message: "Lỗi server khi cập nhật vắng mặt!",
        error: error.message,
      });
    }
  },

  markNoShowAppointments,
};