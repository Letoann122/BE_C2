"use strict";

const cron = require("node-cron");
const { EmailJob } = require("../models");
const { sendMail } = require("../services/mailService");
const CheckinController = require("../controllers/doctor/CheckinController");
const { Op } = require("sequelize");

async function processEmailJobs() {
  const now = new Date();

  const jobs = await EmailJob.findAll({
    where: {
      status: "pending",
      scheduled_at: { [Op.lte]: now },
    },
    limit: 20,
  });

  for (const job of jobs) {
    try {
      job.status = "processing";
      await job.save();

      // 🔥🔴 FIX QUAN TRỌNG: dùng context, KHÔNG dùng data
      await sendMail({
        to: job.email,
        subject: job.subject,
        template: job.template,   // ví dụ: "truoc_khi_hien_mau"
        context: job.payload,     // payload phải là object
      });

      job.status = "sent";
      job.sent_at = new Date();
      await job.save();

    } catch (err) {
      console.error("❌ Cron mail error:", err);

      job.status = "failed";
      job.fail_reason = err.message;
      await job.save();
    }
  }
}

// Chạy mỗi phút
cron.schedule("* * * * *", async () => {
  console.log("⏳ Cronjob: kiểm tra email_jobs...");

  await processEmailJobs();

  try {
    const updatedCount = await CheckinController.markNoShowAppointments();

    if (updatedCount > 0) {
      console.log(`🚫 Cronjob: đã cập nhật ${updatedCount} lịch hẹn sang NO_SHOW`);
    }
  } catch (err) {
    console.error("❌ Cron no-show error:", err);
  }
});
