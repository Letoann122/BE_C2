"use strict";

const AIChatbotService = require("../../services/AIChatbotService");

const {
  User,
  Appointment,
  Donation,
  Notification,
  DonationSite,
  Campaign,
  AppointmentSlot,
  BloodInventory,
  BloodType,
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


const isInventoryQuestion = (message) => {
  const text = String(message || "").toLowerCase();

  return (
    text.includes("kho máu") ||
    text.includes("tồn kho") ||
    text.includes("máu còn") ||
    text.includes("nhóm máu nào thiếu") ||
    text.includes("lô máu") ||
    text.includes("sắp hết hạn")
  );
};

const answerInventoryDirectly = async () => {
  const rows = await BloodInventory.findAll({
    include: [
      {
        model: BloodType,
        as: "blood_type",
        attributes: ["abo", "rh"],
      },
    ],
  });

  const groups = {};
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  rows.forEach((row) => {
    const group = `${row.blood_type?.abo || ""}${row.blood_type?.rh || ""}`;
    if (!group) return;

    if (!groups[group]) {
      groups[group] = { available: 0, testing: 0, expiring: 0 };
    }

    const units = Number(row.units || 0);
    const exp = row.expiry_date ? new Date(row.expiry_date) : null;
    if (exp) exp.setHours(0, 0, 0, 0);

    if (row.status === "available") {
      groups[group].available += units;

      if (exp) {
        const days = Math.ceil((exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        if (days >= 0 && days <= 7) groups[group].expiring += 1;
      }
    }

    if (row.status === "testing") {
      groups[group].testing += units;
    }
  });

  const list = Object.keys(groups)
    .sort()
    .map((group) => {
      const item = groups[group];
      let level = "Ổn định";
      if (item.available <= 3) level = "Nguy cấp";
      else if (item.available <= 8) level = "Thấp";
      else if (item.expiring > 0) level = "Có lô sắp hết hạn";

      return `- ${group}: ${item.available} túi khả dụng, ${item.testing} túi đang kiểm định, ${item.expiring} lô sắp hết hạn. Tình trạng: ${level}`;
    })
    .join("\n");

  if (!list) return "Hiện chưa có dữ liệu kho máu trong hệ thống.";

  return `Tổng quan kho máu hiện tại:\n${list}`;
};

const isAppointmentQuestion = (message) => {
  const text = String(message || "").toLowerCase();

  return (
    text.includes("lịch hẹn") ||
    text.includes("lịch hiến") ||
    text.includes("cuộc hẹn") ||
    text.includes("appointment") ||
    text.includes("đặt lịch")
  );
};

const answerAppointmentsDirectly = (appointments) => {
  if (!appointments || appointments.length === 0) {
    return "Bạn hiện chưa có lịch hẹn hiến máu nào gần đây.";
  }

  const list = appointments
    .slice(0, 5)
    .map((a) => {
      const place =
        a.donation_site?.name ||
        a.campaign?.title ||
        "Chưa có địa điểm";

      return `- ${a.appointment_code || `#${a.id}`}: ${formatDateTime(
        a.scheduled_at
      )}, ${place}, trạng thái: ${a.status}`;
    })
    .join("\n");

  return `Các lịch hẹn gần đây của bạn:\n${list}`;
};

const buildGuestContext = () => {
  return {
    authContext: "Người dùng chưa đăng nhập.",
    userContext:
      "Không có dữ liệu cá nhân. Chỉ được trả lời thông tin chung về hiến máu, điều kiện hiến máu, quy trình và cách đặt lịch.",
  };
};

const buildDonorContext = async (userId) => {
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
        attributes: ["id", "title", "status"],
      },
      {
        model: AppointmentSlot,
        as: "slot",
        required: false,
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

  const notifications = await Notification.findAll({
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
          .map((n) => `- ${n.title}: ${n.message || n.content || ""}`)
          .join("\n")
      : "Không có thông báo gần đây.";

  return {
    authContext: `
Người dùng đã đăng nhập.
Role: ${user?.role || "donor"}.
User ID: ${userId}.
`,
    userContext: `
THÔNG TIN NGƯỜI DÙNG:
- Họ tên: ${user?.full_name || "Không có"}
- Email: ${user?.email || "Không có"}
- SĐT: ${user?.phone || "Không có"}
- Nhóm máu: ${user?.blood_group || "Không có"}
- Giới tính: ${user?.gender || "Không có"}
- Ngày sinh: ${user?.birthday || "Không có"}
- Địa chỉ: ${user?.address || "Không có"}
- Tiền sử bệnh: ${user?.medical_history || "Không có"}

LỊCH HẸN GẦN ĐÂY:
${appointmentsText}

LỊCH SỬ HIẾN MÁU:
${donationsText}

THÔNG BÁO GẦN ĐÂY:
${notificationsText}
`,
    appointments,
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

      if (isInventoryQuestion(message)) {
        if (!["doctor", "hospital", "admin"].includes(role)) {
          return res.json({
            status: true,
            reply: "Bạn cần đăng nhập bằng tài khoản bác sĩ/hospital/admin để tra cứu dữ liệu kho máu.",
            source: "database",
            intent: "INVENTORY_SUMMARY",
          });
        }

        const reply = await answerInventoryDirectly();

        return res.json({
          status: true,
          reply,
          source: "database",
          intent: "INVENTORY_SUMMARY",
        });
      }

      if (!userId && isAppointmentQuestion(message)) {
        return res.json({
          status: true,
          reply:
            "Bạn cần đăng nhập để mình có thể tra cứu lịch hẹn hiến máu của bạn.",
        });
      }

      let context = buildGuestContext();

      if (userId) {
        context = await buildDonorContext(userId);

        if (isAppointmentQuestion(message)) {
          return res.json({
            status: true,
            reply: answerAppointmentsDirectly(context.appointments),
          });
        }
      }

      const reply = await AIChatbotService.ask(
        message.trim(),
        context.authContext,
        context.userContext
      );

      return res.json({
        status: true,
        reply,
        source: "gemini",
        intent: "GENERAL_AI",
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