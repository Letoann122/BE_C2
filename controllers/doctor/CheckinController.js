"use strict";

const { Appointment } = require("../../models");

const {
  APPOINTMENT_STATUS,
} = require("../../constants/appointmentStatus");

module.exports = {
  async checkin(req, res) {
    try {
      const {
        appointment_id,
        appointment_code,
      } = req.body;

      if (!appointment_id || !appointment_code) {
        return res.status(400).json({
          status: false,
          message: "Thiếu dữ liệu QR!",
        });
      }

      const appointment = await Appointment.findOne({
        where: {
          id: appointment_id,
          appointment_code,
        },
      });

      if (!appointment) {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy lịch hẹn!",
        });
      }

      if (
        ![
          APPOINTMENT_STATUS.APPROVED,
          APPOINTMENT_STATUS.BOOKED,
        ].includes(appointment.status)
      ) {
        return res.status(400).json({
          status: false,
          message:
            "Lịch hẹn không ở trạng thái có thể check-in!",
        });
      }

      appointment.status = APPOINTMENT_STATUS.CHECKED_IN;
      appointment.checked_in_at = new Date();

      await appointment.save();

      return res.json({
        status: true,
        message: "Check-in thành công!",
        data: {
          appointment_id: appointment.id,
          appointment_code: appointment.appointment_code,
          status: appointment.status,
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
};