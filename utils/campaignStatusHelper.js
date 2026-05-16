"use strict";

function getVNDateKey(date = new Date()) {
  const vnDate = new Date(
    date.toLocaleString("en-US", {
      timeZone: "Asia/Ho_Chi_Minh",
    })
  );

  const year = vnDate.getFullYear();
  const month = String(vnDate.getMonth() + 1).padStart(2, "0");
  const day = String(vnDate.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function toDateKey(value) {
  if (!value) return "";

  if (typeof value === "string") {
    return value.slice(0, 10);
  }

  const d = new Date(value);

  if (Number.isNaN(d.getTime())) return "";

  return d.toISOString().slice(0, 10);
}

function getDisplayCampaignStatus(campaign) {
  if (!campaign) return "upcoming";

  // nếu doctor/admin đã đóng tay
  if (campaign.status === "ended") {
    return "ended";
  }

  const today = getVNDateKey();

  const start = toDateKey(campaign.start_date);
  const end = toDateKey(campaign.end_date);

  if (!start || !end) {
    return campaign.status || "upcoming";
  }

  // quá hạn => HIỂN THỊ ended
  if (today > end) {
    return "ended";
  }

  // chưa tới
  if (today < start) {
    return "upcoming";
  }

  return "running";
}

module.exports = {
  getDisplayCampaignStatus,
};