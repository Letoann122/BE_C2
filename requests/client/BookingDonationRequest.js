const { DonationSite } = require("../../models");

const ALLOWED_VOLUMES = [250, 350, 450];
const ALLOWED_SLOTS = ["7:00 - 11:00", "13:00 - 17:00"];

module.exports = async (req, res, next) => {
  const {
    donation_site_id,
    scheduled_at,
    time_slot,
    volume,
    notes,
    appointment_slot_id,
  } = req.body || {};

  const errors = {};

  if (!donation_site_id || Number.isNaN(Number(donation_site_id))) {
    errors.donation_site_id = ["Địa điểm hiến máu không hợp lệ!"];
  } else {
    const site = await DonationSite.findByPk(Number(donation_site_id));
    if (!site) errors.donation_site_id = ["Địa điểm hiến máu không tồn tại!"];
    else if (!site.is_active) errors.donation_site_id = ["Địa điểm hiến máu đang tạm ngưng hoạt động!"];
  }

  let scheduledDate = null;
  if (!scheduled_at || Number.isNaN(Date.parse(scheduled_at))) {
    errors.scheduled_at = ["Thời gian đặt lịch không hợp lệ!"];
  } else {
    scheduledDate = new Date(scheduled_at);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const apptDay = new Date(
      scheduledDate.getFullYear(),
      scheduledDate.getMonth(),
      scheduledDate.getDate()
    );
    if (apptDay < today) {
      errors.scheduled_at = ["Ngày hiến không được nhỏ hơn ngày hiện tại!"];
    }
  }

  if (!time_slot || !ALLOWED_SLOTS.includes(String(time_slot).trim())) {
    errors.time_slot = ["Khung giờ không hợp lệ!"];
  } else if (scheduledDate) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const apptDay = new Date(
      scheduledDate.getFullYear(),
      scheduledDate.getMonth(),
      scheduledDate.getDate()
    );
    if (apptDay.getTime() === today.getTime()) {
      if (time_slot === "7:00 - 11:00" && now.getHours() >= 11) {
        errors.time_slot = [
          "Ca sáng hôm nay đã kết thúc, vui lòng chọn ca chiều hoặc ngày khác!",
        ];
      }
    }
  }

  let preferred_volume_ml = null;
  if (!volume) {
    errors.volume = ["Vui lòng chọn dung tích máu hiến!"];
  } else {
    const parsed = Number(String(volume).replace(/\D/g, ""));
    if (!ALLOWED_VOLUMES.includes(parsed)) {
      errors.volume = ["Dung tích không hợp lệ (250/350/450 ml)!"];
    } else {
      preferred_volume_ml = parsed;
    }
  }

  let slotId = null;
  if (appointment_slot_id) {
    if (Number.isNaN(Number(appointment_slot_id))) {
      errors.appointment_slot_id = ["Khung giờ không hợp lệ!"];
    } else {
      slotId = Number(appointment_slot_id);
    }
  }

  if (Object.keys(errors).length > 0) {
    const firstError = Object.values(errors)[0][0];
    return res.status(422).json({
      status: false,
      message: firstError,
      errors,
    });
  }

  req.validated = {
    donor_id: req.user?.userId || req.user?.id,
    donation_site_id: Number(donation_site_id),
    appointment_slot_id: slotId,
    time_slot: String(time_slot).trim(),
    scheduled_at: scheduledDate,
    preferred_volume_ml,
    notes: notes?.trim() || null,
  };

  next();
};
