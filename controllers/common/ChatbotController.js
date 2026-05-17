"use strict";

const AIChatbotService = require("../../services/AIChatbotService");
const { detectIntent } = require("../../services/chatbot/ChatbotIntentService");
const ChatbotDataService = require("../../services/chatbot/ChatbotDataService");

const {
  User,
  Donor,
  BloodType,
  Appointment,
  Donation,
  UserNotification,
  DonationSite,
  Campaign,
  AppointmentSlot,
} = require("../../models");

const formatDateTime = (value) => {
  if (!value) return "Không có thời gian";

  return new Date(value).toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

const getBloodTypeText = (bloodType) => {
  if (!bloodType) return null;
  return `${bloodType.abo || ""}${bloodType.rh || ""}`.trim() || null;
};

const buildGuestContext = () => {
  return {
    authContext: "Người dùng chưa đăng nhập.",
    userContext:
      "Không có dữ liệu cá nhân. Chỉ được trả lời thông tin chung về hiến máu, điều kiện hiến máu, quy trình và cách đặt lịch. Nếu hỏi dữ liệu cá nhân thì yêu cầu đăng nhập.",
  };
};

const buildUserContext = async (userId) => {
  const user = await User.findByPk(userId, {
    attributes: [
      "id",
      "full_name",
      "email",
      "phone",
      "blood_group",
      "gender",
      "birthday",
      "address",
      "medical_history",
      "role",
    ],
  });

  const donor = await Donor.findOne({
    where: { user_id: userId },
    include: [
      {
        model: BloodType,
        required: false,
        attributes: ["id", "abo", "rh"],
      },
    ],
  });

  const appointments = await Appointment.findAll({
    where: {
      donor_id: userId,
    },
    include: [
      {
        model: DonationSite,
        as: "donation_site",
        required: false,
        attributes: ["id", "name", "address"],
      },
      {
        model: Campaign,
        as: "campaign",
        required: false,
        attributes: ["id", "title", "status", "start_date", "end_date"],
      },
      {
        model: AppointmentSlot,
        as: "slot",
        required: false,
        attributes: ["id", "slot_date", "start_time", "end_time", "slot_capacity", "current_count"],
      },
    ],
    order: [["scheduled_at", "DESC"]],
    limit: 5,
  });

  const donations = await Donation.findAll({
    where: {
      donor_user_id: userId,
    },
    order: [["collected_at", "DESC"]],
    limit: 5,
  });

  const notifications = await UserNotification.findAll({
    where: {
      user_id: userId,
    },
    order: [["created_at", "DESC"]],
    limit: 5,
  });

  const appointmentsText =
    appointments.length > 0
      ? appointments
          .map((a) => {
            const site =
              a.donation_site?.name ||
              a.campaign?.title ||
              "Không có địa điểm";

            return `- Mã ${a.appointment_code || a.id}: trạng thái ${
              a.status
            }, thời gian ${formatDateTime(
              a.scheduled_at
            )}, địa điểm/chiến dịch: ${site}`;
          })
          .join("\n")
      : "Không có lịch hẹn gần đây.";

  const donationsText =
    donations.length > 0
      ? donations
          .map(
            (d) =>
              `- ${d.volume_ml}ml, ngày ${formatDateTime(
                d.collected_at
              )}, screened_ok: ${d.screened_ok}`
          )
          .join("\n")
      : "Chưa có lịch sử hiến máu.";

  const notificationsText =
    notifications.length > 0
      ? notifications
          .map((n) => `- ${n.title}: ${n.message || ""}`)
          .join("\n")
      : "Không có thông báo gần đây.";

  const bloodType = user?.blood_group || getBloodTypeText(donor?.BloodType) || "Không có";

  return {
    authContext: `
Người dùng đã đăng nhập.
Role: ${user?.role || "donor"}.
User ID: ${userId}.
`,
    userContext: `
NGÀY HIỆN TẠI:
${new Date().toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}

THÔNG TIN NGƯỜI DÙNG:
- Họ tên: ${user?.full_name || "Không có"}
- Email: ${user?.email || "Không có"}
- SĐT: ${user?.phone || "Không có"}
- Nhóm máu: ${bloodType}
- Giới tính: ${user?.gender || donor?.gender || "Không có"}
- Ngày sinh: ${user?.birthday || donor?.birthday || "Không có"}
- Địa chỉ: ${user?.address || donor?.address || "Không có"}
- Tiền sử bệnh: ${user?.medical_history || donor?.medical_history || "Không có"}
- Số lần hiến máu ghi nhận: ${donor?.donation_count ?? 0}
- Tổng lượng máu đã hiến: ${donor?.total_blood_ml ?? 0}ml

LỊCH HẸN GẦN ĐÂY:
${appointmentsText}

LỊCH SỬ HIẾN MÁU:
${donationsText}

THÔNG BÁO GẦN ĐÂY:
${notificationsText}
`,
  };
};

module.exports = {
  async ask(req, res) {
    try {
      const { message } = req.body;

      if (!message || !message.trim()) {
        return res.json({
          status: false,
          message: "Vui lòng nhập nội dung cần hỏi.",
        });
      }

      const userId = req.user?.userId || req.user?.id;
      const role = req.user?.role;
      const cleanMessage = message.trim();
      const intent = detectIntent(cleanMessage);

      const dbReply = await ChatbotDataService.handleIntent({
        intent,
        message: cleanMessage,
        userId,
        role,
      });

      if (dbReply) {
        return res.json({
          status: true,
          reply: dbReply,
          source: "database",
          intent,
        });
      }

      const context = userId ? await buildUserContext(userId) : buildGuestContext();

      const reply = await AIChatbotService.ask(
        cleanMessage,
        context.authContext,
        context.userContext
      );

      return res.json({
        status: true,
        reply,
        source: "gemini",
        intent,
      });
    } catch (err) {
      console.error("CHATBOT CONTROLLER ERROR:", err);

      return res.status(500).json({
        status: false,
        message: "Không thể xử lý chatbot.",
        error: err.message,
      });
    }
  },
};
