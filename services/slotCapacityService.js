"use strict";

const { Op } = require("sequelize");
const { AppointmentSlot, Appointment } = require("../models");
const {
  APPOINTMENT_STATUS,
  ACTIVE_APPOINTMENT_STATUSES,
} = require("../constants/appointmentStatus");
const { emitSlotUpdated } = require("../socket");

const VALID_SLOT_RANGES = [
  { start_time: "07:00:00", end_time: "11:00:00" },
  { start_time: "13:00:00", end_time: "17:00:00" },
];

const normalizeTime = (time) => {
  if (!time) return null;

  const value = String(time).trim();

  if (value.length === 5) return `${value}:00`;
  if (value.length === 8) return value;

  return value;
};

const isValidSlotTime = (start_time, end_time) => {
  const start = normalizeTime(start_time);
  const end = normalizeTime(end_time);

  return VALID_SLOT_RANGES.some(
    (slot) => slot.start_time === start && slot.end_time === end
  );
};

const buildScheduledAt = (slot_date, start_time) => {
  const date = String(slot_date).slice(0, 10);
  const time = normalizeTime(start_time);

  return new Date(`${date}T${time}`);
};

const getSlotIdFromAppointment = (appointment) => {
  return appointment?.appointment_slot_id || appointment?.slot_id || null;
};

const isSlotExpired = (slot) => {
  if (!slot?.slot_date || !slot?.end_time) return false;

  const date = String(slot.slot_date).slice(0, 10);
  const endTime = normalizeTime(slot.end_time);

  return new Date(`${date}T${endTime}`) < new Date();
};

const canBookSlot = (slot) => {
  if (!slot) {
    return {
      status: false,
      message: "Khung giờ không tồn tại!",
    };
  }

  if (isSlotExpired(slot)) {
    return {
      status: false,
      message: "Khung giờ này đã quá thời gian đặt lịch!",
    };
  }

  if (Number(slot.current_count) >= Number(slot.slot_capacity)) {
    return {
      status: false,
      message: "Khung giờ này đã đủ số lượng người đăng ký!",
    };
  }

  return {
    status: true,
    message: "Slot khả dụng",
  };
};

const buildSlotPayload = (slot) => {
  if (!slot) return null;

  const raw = typeof slot.toJSON === "function" ? slot.toJSON() : slot;

  const slotCapacity = Number(raw.slot_capacity || 0);
  const currentCount = Number(raw.current_count || 0);
  const totalRegistered = Number(raw.total_registered || 0);

  const percent =
    slotCapacity > 0 ? Math.round((currentCount / slotCapacity) * 100) : 0;

  const expired = isSlotExpired(raw);

  return {
    ...raw,
    available_count: Math.max(slotCapacity - currentCount, 0),
    percent,
    is_full: currentCount >= slotCapacity,
    is_expired: expired,
    can_book: !expired && currentCount < slotCapacity,
    total_registered: totalRegistered,
  };
};

const serializeSlot = buildSlotPayload;

const refreshSlotCounters = async (slotId, transaction = null) => {
  if (!slotId) return null;

  const whereSlot = {
    [Op.or]: [{ appointment_slot_id: slotId }, { slot_id: slotId }],
  };

  const currentCount = await Appointment.count({
    where: {
      ...whereSlot,
      status: {
        [Op.in]: ACTIVE_APPOINTMENT_STATUSES,
      },
    },
    transaction,
  });

  const totalRegistered = await Appointment.count({
    where: whereSlot,
    transaction,
  });

  await AppointmentSlot.update(
    {
      current_count: currentCount,
      total_registered: totalRegistered,
      updated_at: new Date(),
    },
    {
      where: { id: slotId },
      transaction,
    }
  );

  const slot = await AppointmentSlot.findByPk(slotId, { transaction });
  const payload = buildSlotPayload(slot);

  if (!transaction) {
    emitSlotUpdated(slotId, payload);
  }

  return payload;
};

const refreshSlotCountersByAppointment = async (
  appointment,
  transaction = null
) => {
  const slotId = getSlotIdFromAppointment(appointment);

  if (!slotId) return null;

  return await refreshSlotCounters(slotId, transaction);
};

const createAppointmentWithSlotCapacity = async ({
  slotId,
  appointmentPayload,
  transaction,
}) => {
  if (!slotId) {
    throw new Error("Vui lòng chọn khung giờ hiến máu!");
  }

  const slot = await AppointmentSlot.findOne({
    where: { id: slotId },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });

  if (!slot) {
    throw new Error("Khung giờ không tồn tại!");
  }

  if (!isValidSlotTime(slot.start_time, slot.end_time)) {
    throw new Error(
      "Khung giờ không hợp lệ. Chỉ hỗ trợ 07:00-11:00 hoặc 13:00-17:00!"
    );
  }

  const slotCheck = canBookSlot(slot);

  if (!slotCheck.status) {
    throw new Error(slotCheck.message);
  }

  const scheduledAt = buildScheduledAt(slot.slot_date, slot.start_time);

  const appointment = await Appointment.create(
    {
      ...appointmentPayload,
      donation_site_id:
        appointmentPayload.donation_site_id || slot.donation_site_id || null,
      campaign_id: appointmentPayload.campaign_id || slot.campaign_id || null,
      appointment_slot_id: slot.id,
      slot_id: slot.id,
      scheduled_at: scheduledAt,
      status: appointmentPayload.status || APPOINTMENT_STATUS.REQUESTED,
    },
    { transaction }
  );

  await slot.update(
    {
      current_count: Number(slot.current_count) + 1,
      total_registered: Number(slot.total_registered || 0) + 1,
      updated_at: new Date(),
    },
    { transaction }
  );

  return appointment;
};

const emitSlotAfterCommit = async (slotId) => {
  if (!slotId) return;

  const slot = await AppointmentSlot.findByPk(slotId);
  emitSlotUpdated(slotId, buildSlotPayload(slot));
};

const recalculateSlotCount = refreshSlotCounters;

module.exports = {
  VALID_SLOT_RANGES,
  normalizeTime,
  isValidSlotTime,
  buildScheduledAt,
  buildSlotPayload,
  serializeSlot,
  getSlotIdFromAppointment,
  refreshSlotCounters,
  refreshSlotCountersByAppointment,
  recalculateSlotCount,
  createAppointmentWithSlotCapacity,
  emitSlotAfterCommit,
  isSlotExpired,
  canBookSlot,
};