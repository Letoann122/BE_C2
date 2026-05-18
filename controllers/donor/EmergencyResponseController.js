"use strict";
const { Op } = require("sequelize");
const {
  sequelize,
  EmergencyRequest,
  EmergencyRequestResponse,
  DonationSite,
  Appointment,
} = require("../../models");

const { APPOINTMENT_STATUS } = require("../../constants/appointmentStatus");

const {
  emitEmergencyAlertUpdated,
  emitEmergencyRequestStatsUpdated,
} = require("../../socket");

const getDonorUserId = (req) => req.user?.userId || req.user?.id;

const generateEmergencyAppointmentCode = () => {
  const random = Math.floor(1000 + Math.random() * 9000);
  return `HM${Date.now()}${random}`;
};

const buildEmergencyScheduledAt = (neededBefore) => {
  const now = new Date();

  if (!neededBefore) return now;

  const before = new Date(neededBefore);

  if (Number.isNaN(before.getTime())) return now;

  return now <= before ? now : before;
};

const getEmergencyStats = async (emergencyRequestId, transaction = null) => {
  const total = await EmergencyRequestResponse.count({
    where: { emergency_request_id: emergencyRequestId },
    transaction,
  });

  const pending = await EmergencyRequestResponse.count({
    where: {
      emergency_request_id: emergencyRequestId,
      response_status: "pending",
    },
    transaction,
  });

  const accepted = await EmergencyRequestResponse.count({
    where: {
      emergency_request_id: emergencyRequestId,
      response_status: "accepted",
    },
    transaction,
  });

  const declined = await EmergencyRequestResponse.count({
    where: {
      emergency_request_id: emergencyRequestId,
      response_status: "declined",
    },
    transaction,
  });

  return {
    total,
    pending,
    accepted,
    declined,
  };
};

module.exports = {
  async pending(req, res) {
    try {
      const donorId = getDonorUserId(req);

      const rows = await EmergencyRequestResponse.findAll({
        where: {
          donor_id: donorId,
          response_status: "pending",
        },
        include: [
          {
            model: EmergencyRequest,
            required: true,
            where: {
              status: "open",
              needed_before: {
                [Op.gt]: new Date(),
              },
            },
            include: [
              {
                model: DonationSite,
                required: false,
              },
            ],
          }
        ],
        order: [["created_at", "DESC"]],
      });

      return res.json({
        status: true,
        message: "Lấy yêu cầu khẩn cấp đang chờ phản hồi thành công!",
        data: rows,
      });
    } catch (error) {
      console.error("EmergencyResponseController.pending error:", error);

      return res.status(500).json({
        status: false,
        message: "Không tải được yêu cầu khẩn cấp!",
        error: error.message,
      });
    }
  },

  async accept(req, res) {
    const t = await sequelize.transaction();

    try {
      const donorId = getDonorUserId(req);
      const { response_id } = req.body || {};

      if (!response_id) {
        await t.rollback();
        return res.status(400).json({
          status: false,
          message: "Thiếu response_id!",
        });
      }

      const response = await EmergencyRequestResponse.findOne({
        where: {
          id: response_id,
          donor_id: donorId,
        },
        include: [
          {
            model: EmergencyRequest,
            required: true,
          },
        ],
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!response) {
        await t.rollback();
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy yêu cầu khẩn cấp!",
        });
      }

      if (response.response_status !== "pending") {
        await t.rollback();
        return res.status(400).json({
          status: false,
          message: "Yêu cầu này đã được phản hồi trước đó!",
        });
      }

      const emergencyRequest = response.EmergencyRequest;

      if (!emergencyRequest || emergencyRequest.status !== "open") {
        await t.rollback();
        return res.status(400).json({
          status: false,
          message: "Yêu cầu khẩn cấp này không còn mở!",
        });
      }

      const appointment = await Appointment.create(
        {
          donor_id: donorId,
          donation_site_id: emergencyRequest.donation_site_id,
          campaign_id: null,
          emergency_request_id: emergencyRequest.id,
          appointment_slot_id: null,
          slot_id: null,
          appointment_code: generateEmergencyAppointmentCode(),
          scheduled_at: buildEmergencyScheduledAt(
            emergencyRequest.needed_before
          ),
          preferred_volume_ml: 350,
          status: APPOINTMENT_STATUS.APPROVED,
          notes: `Đăng ký hỗ trợ yêu cầu khẩn cấp #${emergencyRequest.id}`,
          approved_at: new Date(),
          created_at: new Date(),
          updated_at: new Date(),
        },
        { transaction: t }
      );

      response.response_status = "accepted";
      response.responded_at = new Date();
      response.appointment_id = appointment.id;
      response.updated_at = new Date();

      await response.save({ transaction: t });

      const stats = await getEmergencyStats(emergencyRequest.id, t);

      await t.commit();

      emitEmergencyAlertUpdated({
        event: "EMERGENCY_REQUEST_ACCEPTED",
        emergency_request_id: emergencyRequest.id,
        donor_id: donorId,
        response_id: response.id,
        appointment_id: appointment.id,
      });

      emitEmergencyRequestStatsUpdated(emergencyRequest.id, stats);

      return res.json({
        status: true,
        message: "Bạn đã đồng ý hỗ trợ. Lịch hẹn khẩn cấp đã được tạo!",
        data: {
          response,
          appointment,
          stats,
        },
      });
    } catch (error) {
      await t.rollback();

      console.error("EmergencyResponseController.accept error:", error);

      return res.status(500).json({
        status: false,
        message: "Không thể xác nhận hỗ trợ!",
        error: error.message,
      });
    }
  },

  async decline(req, res) {
    const t = await sequelize.transaction();

    try {
      const donorId = getDonorUserId(req);
      const { response_id, reason } = req.body || {};

      if (!response_id) {
        await t.rollback();
        return res.status(400).json({
          status: false,
          message: "Thiếu response_id!",
        });
      }

      const response = await EmergencyRequestResponse.findOne({
        where: {
          id: response_id,
          donor_id: donorId,
        },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!response) {
        await t.rollback();
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy yêu cầu khẩn cấp!",
        });
      }

      if (response.response_status !== "pending") {
        await t.rollback();
        return res.status(400).json({
          status: false,
          message: "Yêu cầu này đã được phản hồi trước đó!",
        });
      }

      response.response_status = "declined";
      response.responded_at = new Date();
      response.reason_summary = reason
        ? `${response.reason_summary || ""} | Từ chối: ${reason}`
        : response.reason_summary;
      response.updated_at = new Date();

      await response.save({ transaction: t });

      const stats = await getEmergencyStats(response.emergency_request_id, t);

      await t.commit();

      emitEmergencyAlertUpdated({
        event: "EMERGENCY_REQUEST_DECLINED",
        emergency_request_id: response.emergency_request_id,
        donor_id: donorId,
        response_id: response.id,
      });

      emitEmergencyRequestStatsUpdated(response.emergency_request_id, stats);

      return res.json({
        status: true,
        message: "Bạn đã từ chối yêu cầu khẩn cấp!",
        data: {
          response,
          stats,
        },
      });
    } catch (error) {
      await t.rollback();

      console.error("EmergencyResponseController.decline error:", error);

      return res.status(500).json({
        status: false,
        message: "Không thể từ chối yêu cầu!",
        error: error.message,
      });
    }
  },
};