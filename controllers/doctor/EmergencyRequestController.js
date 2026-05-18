"use strict";

const {
  sequelize,
  EmergencyRequest,
  EmergencyRequestResponse,
  DonationSite,
  Doctor,
  BloodType,
} = require("../../models");

const {
  getEmergencyRecommendations,
} = require("../../services/aiRecommendationService");

const UserNotificationService = require("../../services/UserNotificationService");

const {
  emitEmergencyAlertUpdated,
  emitEmergencyRequestToDonor,
  emitEmergencyRequestPing,
} = require("../../socket");

const normalizeBloodGroup = (value) => {
  return String(value || "").trim().toUpperCase();
};

const addHours = (hours) => {
  const date = new Date();
  date.setHours(date.getHours() + Number(hours || 2));
  return date;
};

const getDoctorProfile = async (req) => {
  const userId = req.user?.userId || req.user?.id;

  if (!userId) return null;

  return Doctor.findOne({
    where: { user_id: userId },
  });
};

const findBloodTypeByGroup = async (bloodGroup) => {
  const group = normalizeBloodGroup(bloodGroup);

  if (!group) return null;

  const abo = group.slice(0, -1);
  const rh = group.slice(-1);

  return BloodType.findOne({
    where: { abo, rh },
  });
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
const filterEligibleRecommendations = (result) => {
  const recommendations = Array.isArray(result?.recommendations)
    ? result.recommendations
    : [];

  const eligibleRecommendations = recommendations.filter((donor) => {
    return donor.eligible === true;
  });

  return {
    ...result,
    recommendations: eligibleRecommendations,
    total_recommendations: eligibleRecommendations.length,
    excluded_ineligible_count:
      recommendations.length - eligibleRecommendations.length,
  };
};

module.exports = {
  async index(req, res) {
    try {
      const rows = await EmergencyRequest.findAll({
        include: [
          {
            model: DonationSite,
            required: false,
          },
        ],
        order: [["created_at", "DESC"]],
        limit: 50,
      });

      return res.json({
        status: true,
        message: "Lấy danh sách yêu cầu khẩn cấp thành công!",
        data: rows,
      });
    } catch (error) {
      console.error("EmergencyRequestController.index error:", error);

      return res.status(500).json({
        status: false,
        message: "Không tải được danh sách yêu cầu khẩn cấp!",
        error: error.message,
      });
    }
  },

  async store(req, res) {
    const t = await sequelize.transaction();

    try {
      const {
        donation_site_id,
        blood_group,
        required_volume_ml,
        urgency_level,
        needed_in_hours,
        needed_before,
        title,
        message,
      } = req.body;

      if (!donation_site_id) {
        await t.rollback();
        return res.status(400).json({
          status: false,
          message: "Vui lòng chọn điểm tiếp nhận máu!",
        });
      }

      if (!blood_group) {
        await t.rollback();
        return res.status(400).json({
          status: false,
          message: "Vui lòng chọn nhóm máu cần!",
        });
      }

      const doctor = await getDoctorProfile(req);

      if (!doctor) {
        await t.rollback();
        return res.status(403).json({
          status: false,
          message: "Không tìm thấy thông tin bác sĩ!",
        });
      }

      const site = await DonationSite.findByPk(donation_site_id, {
        transaction: t,
      });

      if (!site) {
        await t.rollback();
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy điểm tiếp nhận máu!",
        });
      }

      const bloodType = await findBloodTypeByGroup(blood_group);

      const request = await EmergencyRequest.create(
        {
          hospital_id: site.hospital_id || doctor.hospital_id || null,
          donation_site_id: site.id,
          created_by_doctor_id: doctor.id,
          blood_type_id: bloodType?.id || null,
          blood_group: normalizeBloodGroup(blood_group),
          required_volume_ml: Number(required_volume_ml || 500),
          fulfilled_volume_ml: 0,
          urgency_level: urgency_level || "critical",
          needed_before: needed_before || addHours(needed_in_hours || 2),
          title:
            title ||
            `Khẩn cấp cần máu ${normalizeBloodGroup(blood_group)}`,
          message:
            message ||
            `Điểm tiếp nhận ${site.name} đang cần máu ${normalizeBloodGroup(
              blood_group
            )} gấp.`,
          status: "open",
          created_at: new Date(),
          updated_at: new Date(),
        },
        { transaction: t }
      );

      await t.commit();

      emitEmergencyAlertUpdated({
        event: "EMERGENCY_REQUEST_CREATED",
        emergency_request_id: request.id,
        blood_group: request.blood_group,
        title: request.title,
        message: request.message,
      });

      return res.status(201).json({
        status: true,
        message: "Tạo yêu cầu khẩn cấp thành công!",
        data: request,
      });
    } catch (error) {
      await t.rollback();

      console.error("EmergencyRequestController.store error:", error);

      return res.status(500).json({
        status: false,
        message: "Không tạo được yêu cầu khẩn cấp!",
        error: error.message,
      });
    }
  },

  async show(req, res) {
    try {
      const { id } = req.params;

      const request = await EmergencyRequest.findByPk(id, {
        include: [
          {
            model: DonationSite,
            required: false,
          },
        ],
      });

      if (!request) {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy yêu cầu khẩn cấp!",
        });
      }

      const responses = await EmergencyRequestResponse.findAll({
        where: { emergency_request_id: id },
        order: [
          ["ai_score", "DESC"],
          ["created_at", "ASC"],
        ],
      });

      const stats = await getEmergencyStats(id);

      return res.json({
        status: true,
        message: "Lấy chi tiết yêu cầu khẩn cấp thành công!",
        data: {
          request,
          responses,
          stats,
        },
      });
    } catch (error) {
      console.error("EmergencyRequestController.show error:", error);

      return res.status(500).json({
        status: false,
        message: "Không tải được chi tiết yêu cầu khẩn cấp!",
        error: error.message,
      });
    }
  },

  async recommendations(req, res) {
    try {
      const { id } = req.params;
      const limit = Number(req.query.limit || 20);

      const result = await getEmergencyRecommendations({
        emergencyRequestId: id,
        limit,
      });

      const filteredResult = filterEligibleRecommendations(result);

      return res.json({
        status: true,
        message: "Lấy danh sách donor đủ điều kiện đề xuất thành công!",
        data: filteredResult,
      });
    } catch (error) {
      console.error("EmergencyRequestController.recommendations error:", error);

      return res.status(500).json({
        status: false,
        message: "Không lấy được danh sách donor đề xuất!",
        error: error.message,
      });
    }
  },

  async saveRecommendations(req, res) {
    const t = await sequelize.transaction();

    try {
      const { id } = req.params;
      const { limit } = req.body || {};

      const request = await EmergencyRequest.findByPk(id, {
        transaction: t,
      });

      if (!request) {
        await t.rollback();
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy yêu cầu khẩn cấp!",
        });
      }

      const result = await getEmergencyRecommendations({
        emergencyRequestId: id,
        limit: limit || 20,
      });

      const filteredResult = filterEligibleRecommendations(result);
      const eligibleRecommendations = filteredResult.recommendations;

      if (eligibleRecommendations.length === 0) {
        await t.rollback();

        return res.json({
          status: false,
          message: "Không có donor nào đủ điều kiện để lưu vào danh sách đề xuất!",
          data: {
            excluded_ineligible_count: filteredResult.excluded_ineligible_count,
          },
        });
      }

      const rows = [];

      for (const donor of eligibleRecommendations) {
        const [response, created] = await EmergencyRequestResponse.findOrCreate({
          where: {
            emergency_request_id: id,
            donor_id: donor.donor_id,
          },
          defaults: {
            emergency_request_id: id,
            donor_id: donor.donor_id,
            response_status: "pending",
            ai_score: donor.score,
            distance_km: donor.distance_km,
            reason_summary: donor.reason_summary,
            notified_at: null,
            responded_at: null,
            created_at: new Date(),
            updated_at: new Date(),
          },
          transaction: t,
        });

        if (!created && response.response_status === "pending") {
          await response.update(
            {
              ai_score: donor.score,
              distance_km: donor.distance_km,
              reason_summary: donor.reason_summary,
              updated_at: new Date(),
            },
            { transaction: t }
          );
        }

        rows.push(response);
      }

      const stats = await getEmergencyStats(id, t);

      await t.commit();

      return res.json({
        status: true,
        message: `Đã lưu ${rows.length} donor đủ điều kiện vào danh sách đề xuất!`,
        data: {
          rows,
          stats,
          excluded_ineligible_count: filteredResult.excluded_ineligible_count,
        },
      });
    } catch (error) {
      await t.rollback();

      console.error("EmergencyRequestController.saveRecommendations error:", error);

      return res.status(500).json({
        status: false,
        message: "Không lưu được danh sách donor đề xuất!",
        error: error.message,
      });
    }
  },

  async sendToRecommendedDonors(req, res) {
    const t = await sequelize.transaction();

    try {
      const { id } = req.params;

      const request = await EmergencyRequest.findByPk(id, {
        include: [
          {
            model: DonationSite,
            required: false,
          },
        ],
        transaction: t,
      });

      if (!request) {
        await t.rollback();
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy yêu cầu khẩn cấp!",
        });
      }

      if (request.status !== "open") {
        await t.rollback();
        return res.status(400).json({
          status: false,
          message: "Chỉ có thể gửi yêu cầu đang mở!",
        });
      }

      const now = new Date();

      if (request.needed_before && new Date(request.needed_before) < now) {
        await t.rollback();
        return res.status(400).json({
          status: false,
          message: "Yêu cầu khẩn cấp này đã hết hạn!",
        });
      }

      let responses = await EmergencyRequestResponse.findAll({
        where: {
          emergency_request_id: id,
          response_status: "pending",
        },
        order: [
          ["ai_score", "DESC"],
          ["created_at", "ASC"],
        ],
        transaction: t,
      });

      if (responses.length === 0) {
        await t.rollback();
        return res.status(400).json({
          status: false,
          message:
            "Chưa có danh sách donor đề xuất. Vui lòng bấm lưu danh sách đề xuất trước!",
        });
      }

      await EmergencyRequestResponse.update(
        {
          notified_at: now,
          updated_at: now,
        },
        {
          where: {
            emergency_request_id: id,
            response_status: "pending",
          },
          transaction: t,
        }
      );

      responses = await EmergencyRequestResponse.findAll({
        where: {
          emergency_request_id: id,
          response_status: "pending",
        },
        order: [
          ["ai_score", "DESC"],
          ["created_at", "ASC"],
        ],
        transaction: t,
      });

      const stats = await getEmergencyStats(id, t);

      await t.commit();

      const requestPayload = {
        emergency_request_id: request.id,
        blood_group: request.blood_group,
        required_volume_ml: request.required_volume_ml,
        fulfilled_volume_ml: request.fulfilled_volume_ml,
        urgency_level: request.urgency_level,
        needed_before: request.needed_before,
        title: request.title,
        message: request.message,
        status: request.status,
        donation_site: request.DonationSite || request.donation_site || null,
        donation_site_id: request.donation_site_id,
      };

      for (const response of responses) {
        emitEmergencyRequestToDonor(response.donor_id, {
          response_id: response.id,
          ai_score: response.ai_score,
          distance_km: response.distance_km,
          reason_summary: response.reason_summary,
          request: requestPayload,
        });

        await UserNotificationService.create({
          user_id: response.donor_id,
          type: "emergency",
          title: "Yêu cầu hiến máu khẩn cấp",
          message: `Bạn được đề xuất hỗ trợ yêu cầu hiến máu khẩn cấp nhóm máu ${request.blood_group}.`,
          priority: "urgent",
          action_url: "/notification",
          meta_json: {
            emergency_request_id: request.id,
            response_id: response.id,
          },
        });
      }

      emitEmergencyRequestPing({
        emergency_request_id: request.id,
        blood_group: request.blood_group,
        title: request.title,
        sent_at: new Date(),
      });

      emitEmergencyAlertUpdated({
        event: "EMERGENCY_REQUEST_SENT",
        emergency_request_id: request.id,
        total_sent: responses.length,
        blood_group: request.blood_group,
        title: request.title,
        message: request.message,
      });

      return res.json({
        status: true,
        message: `Đã gửi popup khẩn cấp tới ${responses.length} donor được đề xuất!`,
        data: {
          emergency_request_id: request.id,
          total_sent: responses.length,
          stats,
        },
      });
    } catch (error) {
      await t.rollback();

      console.error("EmergencyRequestController.sendToRecommendedDonors error:", error);

      return res.status(500).json({
        status: false,
        message: "Không gửi được popup khẩn cấp!",
        error: error.message,
      });
    }
  },

  async stats(req, res) {
    try {
      const { id } = req.params;

      const request = await EmergencyRequest.findByPk(id);

      if (!request) {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy yêu cầu khẩn cấp!",
        });
      }

      const stats = await getEmergencyStats(id);

      return res.json({
        status: true,
        message: "Lấy thống kê phản hồi khẩn cấp thành công!",
        data: {
          request,
          stats,
        },
      });
    } catch (error) {
      console.error("EmergencyRequestController.stats error:", error);

      return res.status(500).json({
        status: false,
        message: "Không tải được thống kê phản hồi!",
        error: error.message,
      });
    }
  },
};