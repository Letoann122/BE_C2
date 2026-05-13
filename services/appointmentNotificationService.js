"use strict";

const { Notification } = require("../models");
const { emitAppointmentUpdated } = require("../socket");

const statusMessageMap = {
  REQUESTED: "Lịch hẹn của bạn đang chờ duyệt.",
  APPROVED: "Lịch hẹn hiến máu của bạn đã được duyệt.",
  BOOKED: "Lịch hẹn hiến máu của bạn đã được đặt.",
  CHECKED_IN: "Bạn đã check-in thành công.",
  SCREENING: "Bác sĩ đã bắt đầu khám sàng lọc.",
  FAILED_SCREENING: "Bạn chưa đủ điều kiện hiến máu trong lần này.",
  DONATING: "Bạn đang trong quá trình hiến máu.",
  COMPLETED: "Cảm ơn bạn đã hoàn tất hiến máu.",
  NO_SHOW: "Lịch hẹn của bạn được ghi nhận là vắng mặt.",
  CANCELLED: "Lịch hẹn hiến máu của bạn đã bị hủy.",
  REJECTED: "Lịch hẹn hiến máu của bạn đã bị từ chối.",
};

async function notifyAppointmentStatusChanged(appointment, extra = {}) {
  if (!appointment) return;

  const status = appointment.status;
  const message =
    extra.message ||
    statusMessageMap[status] ||
    "Trạng thái lịch hẹn của bạn đã được cập nhật.";

  try {
    if (Notification && appointment.donor_id) {
      await Notification.create({
        user_id: appointment.donor_id,
        type: "appointment",
        title: "Cập nhật lịch hẹn hiến máu",
        message,
        appointment_id: appointment.id,
        is_read: 0,
        created_at: new Date(),
        updated_at: new Date(),
      });
    }
  } catch (error) {
    console.error("Create appointment notification error:", error);
  }

  emitAppointmentUpdated(appointment.id, {
    appointment_id: appointment.id,
    status,
    event: extra.event || "APPOINTMENT_STATUS_CHANGED",
    message,
  });
}

module.exports = {
  notifyAppointmentStatusChanged,
};