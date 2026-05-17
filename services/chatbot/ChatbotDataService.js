"use strict";

const { Op, fn, col, literal } = require("sequelize");

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
  BloodInventory,
  Hospital,
} = require("../../models");

const { APPOINTMENT_STATUS } = require("../../constants/appointmentStatus");

const TZ = "Asia/Ho_Chi_Minh";

const formatDate = (value) => {
  if (!value) return "Không có";

  return new Date(value).toLocaleDateString("vi-VN", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

const formatDateTime = (value) => {
  if (!value) return "Không có";

  return new Date(value).toLocaleString("vi-VN", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

const formatTime = (value) => {
  if (!value) return "--:--";
  return String(value).slice(0, 5);
};

const addDays = (date, days) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

const todayDateOnly = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

const getBloodTypeText = (bloodType) => {
  if (!bloodType) return null;
  return `${bloodType.abo || ""}${bloodType.rh || ""}`.trim() || null;
};

const getAppointmentStatusText = (status) => {
  const map = {
    REQUESTED: "đang chờ duyệt",
    APPROVED: "đã được duyệt, có thể đến check-in theo lịch",
    BOOKED: "đã đặt chỗ",
    CHECKED_IN: "đã check-in",
    SCREENING: "đang sàng lọc",
    FAILED_SCREENING: "không đạt sàng lọc",
    DONATING: "đang hiến máu",
    COMPLETED: "đã hoàn tất",
    NO_SHOW: "vắng mặt",
    REJECTED: "bị từ chối",
    CANCELLED: "đã hủy",
  };

  return map[status] || status || "không rõ";
};

const requireLoginReply = (intent) => {
  const messages = {
    MY_PROFILE:
      "Bạn cần đăng nhập để mình có thể tra cứu thông tin cá nhân như nhóm máu, hồ sơ và số điện thoại.",
    MY_APPOINTMENTS:
      "Bạn cần đăng nhập để mình có thể tra cứu lịch hẹn hiến máu của bạn.",
    DONATION_HISTORY:
      "Bạn cần đăng nhập để mình có thể tra cứu lịch sử hiến máu của bạn.",
    DONATION_ELIGIBILITY:
      "Bạn cần đăng nhập để mình kiểm tra lần hiến máu gần nhất và tư vấn thời điểm có thể hiến máu lại.",
    MY_NOTIFICATIONS:
      "Bạn cần đăng nhập để mình có thể xem thông báo cá nhân của bạn.",
  };

  return messages[intent] || "Bạn cần đăng nhập để mình có thể tra cứu dữ liệu cá nhân.";
};

const getUserProfileData = async (userId) => {
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

  return { user, donor };
};

const answerMyProfile = async ({ userId }) => {
  if (!userId) return requireLoginReply("MY_PROFILE");

  const { user, donor } = await getUserProfileData(userId);

  if (!user) return "Mình chưa tìm thấy thông tin tài khoản của bạn.";

  const bloodType = user.blood_group || getBloodTypeText(donor?.BloodType) || "Chưa có";
  const donationCount = donor?.donation_count ?? 0;
  const totalBloodMl = donor?.total_blood_ml ?? 0;

  return `Thông tin hồ sơ của bạn:\n- Họ tên: ${user.full_name || "Chưa có"}\n- Email: ${user.email || "Chưa có"}\n- Số điện thoại: ${user.phone || "Chưa có"}\n- Nhóm máu: ${bloodType}\n- Giới tính: ${user.gender || donor?.gender || "Chưa có"}\n- Ngày sinh: ${formatDate(user.birthday || donor?.birthday)}\n- Địa chỉ: ${user.address || donor?.address || "Chưa có"}\n- Số lần hiến máu ghi nhận: ${donationCount}\n- Tổng lượng máu đã hiến: ${totalBloodMl}ml`;
};

const answerMyAppointments = async ({ userId }) => {
  if (!userId) return requireLoginReply("MY_APPOINTMENTS");

  const appointments = await Appointment.findAll({
    where: { donor_id: userId },
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

  if (!appointments.length) return "Bạn hiện chưa có lịch hẹn hiến máu nào gần đây.";

  const lines = appointments.map((a) => {
    const place = a.donation_site?.name || a.campaign?.title || "Chưa có địa điểm";
    const slotText = a.slot
      ? `, khung ${formatTime(a.slot.start_time)} - ${formatTime(a.slot.end_time)}`
      : "";

    return `- ${a.appointment_code || `#${a.id}`}: ${formatDateTime(a.scheduled_at)}${slotText}, ${place}, trạng thái: ${getAppointmentStatusText(a.status)}`;
  });

  return `Các lịch hẹn gần đây của bạn:\n${lines.join("\n")}`;
};

const answerDonationHistory = async ({ userId }) => {
  if (!userId) return requireLoginReply("DONATION_HISTORY");

  const donations = await Donation.findAll({
    where: { donor_user_id: userId },
    include: [
      {
        model: BloodType,
        as: "blood_type",
        required: false,
        attributes: ["id", "abo", "rh"],
      },
    ],
    order: [["collected_at", "DESC"]],
    limit: 10,
  });

  if (!donations.length) {
    return "Mình chưa thấy lịch sử hiến máu của bạn trong hệ thống.";
  }

  const totalVolume = donations.reduce((sum, d) => sum + Number(d.volume_ml || 0), 0);
  const successCount = donations.filter((d) => Number(d.screened_ok) === 1).length;

  const lines = donations.slice(0, 5).map((d, index) => {
    const blood = getBloodTypeText(d.blood_type) || "không rõ nhóm máu";
    const result = Number(d.screened_ok) === 1 ? "đạt sàng lọc" : "chưa đạt/chưa xác nhận";

    return `${index + 1}. ${formatDate(d.collected_at)} - ${d.volume_ml || 0}ml, ${blood}, ${result}`;
  });

  return `Lịch sử hiến máu của bạn:\n- Tổng số lần hiến được ghi nhận: ${donations.length}\n- Số lần đạt sàng lọc: ${successCount}\n- Tổng lượng máu trong 10 lần gần nhất: ${totalVolume}ml\n\nCác lần gần đây:\n${lines.join("\n")}`;
};

const answerDonationEligibility = async ({ userId }) => {
  if (!userId) return requireLoginReply("DONATION_ELIGIBILITY");

  const { user, donor } = await getUserProfileData(userId);

  const latestDonation = await Donation.findOne({
    where: {
      donor_user_id: userId,
      collected_at: { [Op.ne]: null },
    },
    order: [["collected_at", "DESC"]],
  });

  const lastDonationDate = latestDonation?.collected_at || donor?.last_donation_date;

  if (!lastDonationDate) {
    return "Mình chưa thấy ngày hiến máu gần nhất của bạn trong hệ thống. Bạn nên liên hệ điểm hiến máu hoặc bệnh viện để được tư vấn điều kiện hiến máu cụ thể.";
  }

  const lastDate = new Date(lastDonationDate);
  const today = todayDateOnly();

  const gender = user?.gender || donor?.gender || "";
  const waitingDays = String(gender).toLowerCase().includes("nữ") ? 112 : 84;
  const nextDate = addDays(lastDate, waitingDays);

  const passedDays = Math.floor((today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
  const remainingDays = Math.max(
    0,
    Math.ceil((nextDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  );

  if (today >= nextDate) {
    return `Chào bạn ${user?.full_name || ""},\n\nLần hiến máu gần nhất của bạn là ngày ${formatDate(lastDate)}. Theo mốc tham khảo ${waitingDays} ngày giữa các lần hiến máu, hiện bạn đã đủ thời gian tối thiểu để đăng ký hiến máu lại.\n\nLưu ý: đây chỉ là kiểm tra theo lịch sử hệ thống. Bạn vẫn cần được nhân viên y tế khám sàng lọc trực tiếp trước khi hiến máu.`;
  }

  return `Chào bạn ${user?.full_name || ""},\n\nLần hiến máu gần nhất của bạn là ngày ${formatDate(lastDate)}. Hiện tại mới qua khoảng ${Math.max(passedDays, 0)} ngày, nên bạn chưa nên hiến máu lại ngay.\n\nTheo mốc tham khảo ${waitingDays} ngày giữa các lần hiến máu, bạn có thể hiến lại dự kiến từ ngày ${formatDate(nextDate)}. Còn khoảng ${remainingDays} ngày nữa.\n\nLưu ý: đây chỉ là thông tin tham khảo từ hệ thống. Bạn vẫn cần được nhân viên y tế kiểm tra sức khỏe trực tiếp trước khi hiến máu.`;
};

const answerMyNotifications = async ({ userId }) => {
  if (!userId) return requireLoginReply("MY_NOTIFICATIONS");

  const notifications = await UserNotification.findAll({
    where: { user_id: userId },
    order: [["created_at", "DESC"]],
    limit: 5,
  });

  if (!notifications.length) return "Bạn hiện không có thông báo cá nhân gần đây.";

  const unreadCount = notifications.filter((n) => Number(n.is_read) === 0).length;
  const lines = notifications.map((n) => {
    const readText = Number(n.is_read) === 0 ? "chưa đọc" : "đã đọc";
    return `- ${n.title}: ${n.message || ""} (${readText}, ${formatDateTime(n.created_at)})`;
  });

  return `Bạn có ${unreadCount} thông báo chưa đọc trong 5 thông báo gần nhất:\n${lines.join("\n")}`;
};

const answerPublicCampaigns = async () => {
  const today = new Date().toISOString().slice(0, 10);

  const campaigns = await Campaign.findAll({
    where: {
      approval_status: "approved",
      end_date: { [Op.gte]: today },
    },
    include: [
      {
        model: DonationSite,
        as: "donation_site",
        required: false,
        attributes: ["id", "name", "address"],
      },
    ],
    order: [
      ["start_date", "ASC"],
      ["id", "DESC"],
    ],
    limit: 5,
  });

  if (!campaigns.length) return "Hiện chưa có chiến dịch hiến máu công khai nào đang hoặc sắp diễn ra.";

  const lines = campaigns.map((c) => {
    const location = c.donation_site?.name || c.location || "Chưa cập nhật địa điểm";
    return `- ${c.title}: ${formatDate(c.start_date)} - ${formatDate(c.end_date)}, ${location}, trạng thái: ${c.status}`;
  });

  return `Các chiến dịch hiến máu đang/sắp diễn ra:\n${lines.join("\n")}`;
};

const answerAvailableSlots = async ({ message }) => {
  const text = String(message || "");
  const dateMatch = text.match(/(\d{4}-\d{2}-\d{2})/);
  const requestedDate = dateMatch ? dateMatch[1] : new Date().toISOString().slice(0, 10);

  const slots = await AppointmentSlot.findAll({
    where: {
      slot_date: requestedDate,
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
        attributes: ["id", "title"],
      },
    ],
    order: [
      ["slot_date", "ASC"],
      ["start_time", "ASC"],
    ],
    limit: 12,
  });

  if (!slots.length) {
    return `Mình chưa tìm thấy khung giờ hiến máu nào cho ngày ${formatDate(requestedDate)}.`;
  }

  const lines = slots.map((s) => {
    const remain = Math.max(Number(s.slot_capacity || 0) - Number(s.current_count || 0), 0);
    const place = s.donation_site?.name || s.campaign?.title || s.location_custom || "Chưa có địa điểm";
    const status = remain > 0 ? `còn ${remain}/${s.slot_capacity} chỗ` : "đã đầy";

    return `- ${formatTime(s.start_time)} - ${formatTime(s.end_time)} tại ${place}: ${status}`;
  });

  return `Các khung giờ ngày ${formatDate(requestedDate)}:\n${lines.join("\n")}\n\nBạn có thể hỏi cụ thể theo ngày bằng định dạng YYYY-MM-DD, ví dụ: còn slot ngày 2026-05-20 không?`;
};

const answerDonationSites = async () => {
  const sites = await DonationSite.findAll({
    where: { is_active: 1 },
    include: [
      {
        model: Hospital,
        required: false,
        attributes: ["id", "name", "hotline"],
      },
    ],
    order: [["id", "DESC"]],
    limit: 8,
  });

  if (!sites.length) return "Hiện chưa có điểm hiến máu đang hoạt động trong hệ thống.";

  const lines = sites.map((s) => {
    const hospital = s.Hospital?.name ? ` - ${s.Hospital.name}` : "";
    const hotline = s.Hospital?.hotline ? `, hotline: ${s.Hospital.hotline}` : "";
    return `- ${s.name}${hospital}: ${s.address || "Chưa có địa chỉ"}${hotline}`;
  });

  return `Các điểm hiến máu đang hoạt động:\n${lines.join("\n")}`;
};

const answerInventorySummary = async ({ role }) => {
  if (!["doctor", "hospital", "admin"].includes(role)) {
    return "Thông tin kho máu chỉ dành cho bác sĩ/bệnh viện hoặc quản trị viên.";
  }

  const rows = await BloodInventory.findAll({
    attributes: [
      "blood_type_id",
      "status",
      [fn("SUM", col("units")), "total_units"],
    ],
    include: [
      {
        model: BloodType,
        as: "blood_type",
        required: false,
        attributes: ["id", "abo", "rh"],
      },
    ],
    group: ["blood_type_id", "status", "blood_type.id", "blood_type.abo", "blood_type.rh"],
    order: [[literal("total_units"), "DESC"]],
    limit: 20,
  });

  if (!rows.length) return "Hiện chưa có dữ liệu kho máu.";

  const lines = rows.map((r) => {
    const blood = getBloodTypeText(r.blood_type) || `ID ${r.blood_type_id}`;
    return `- ${blood}: ${r.get("total_units") || 0} đơn vị, trạng thái ${r.status}`;
  });

  return `Tóm tắt kho máu theo nhóm máu và trạng thái:\n${lines.join("\n")}`;
};

const answerDoctorTodaySummary = async ({ role }) => {
  if (!["doctor", "hospital", "admin"].includes(role)) {
    return "Tóm tắt lịch hẹn hôm nay chỉ dành cho bác sĩ/bệnh viện hoặc quản trị viên.";
  }

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const statuses = [
    APPOINTMENT_STATUS.REQUESTED,
    APPOINTMENT_STATUS.APPROVED,
    APPOINTMENT_STATUS.CHECKED_IN,
    APPOINTMENT_STATUS.SCREENING,
    APPOINTMENT_STATUS.DONATING,
    APPOINTMENT_STATUS.COMPLETED,
    APPOINTMENT_STATUS.NO_SHOW,
  ];

  const counts = await Promise.all(
    statuses.map(async (status) => ({
      status,
      count: await Appointment.count({
        where: {
          status,
          scheduled_at: { [Op.gte]: start, [Op.lt]: end },
        },
      }),
    }))
  );

  const total = counts.reduce((sum, item) => sum + item.count, 0);
  const lines = counts.map((item) => `- ${getAppointmentStatusText(item.status)}: ${item.count}`);

  return `Tóm tắt lịch hẹn hôm nay (${formatDate(start)}):\n- Tổng lịch: ${total}\n${lines.join("\n")}`;
};

const handleIntent = async ({ intent, message, userId, role }) => {
  switch (intent) {
    case "MY_PROFILE":
      return answerMyProfile({ userId });
    case "MY_APPOINTMENTS":
      return answerMyAppointments({ userId });
    case "DONATION_HISTORY":
      return answerDonationHistory({ userId });
    case "DONATION_ELIGIBILITY":
      return answerDonationEligibility({ userId });
    case "MY_NOTIFICATIONS":
      return answerMyNotifications({ userId });
    case "PUBLIC_CAMPAIGNS":
      return answerPublicCampaigns();
    case "AVAILABLE_SLOTS":
      return answerAvailableSlots({ message });
    case "DONATION_SITES":
      return answerDonationSites();
    case "INVENTORY_SUMMARY":
      return answerInventorySummary({ role });
    case "DOCTOR_TODAY_SUMMARY":
      return answerDoctorTodaySummary({ role });
    default:
      return null;
  }
};

module.exports = {
  handleIntent,
  formatDate,
  formatDateTime,
  getAppointmentStatusText,
};
