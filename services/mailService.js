"use strict";

const transporter = require("../config/mailer");

module.exports = {
  async sendMail({ to, subject, template, context, data }) {
    try {
      // Lấy context ưu tiên: context (cronjob) hoặc data (gọi trực tiếp)
      let ctx = context || data || {};

      // ⚠️ Nếu là string JSON -> parse về object
      if (typeof ctx === "string") {
        try {
          ctx = JSON.parse(ctx);
        } catch (e) {
          console.warn("⚠️ Không parse được JSON context, dùng raw string:", ctx);
          // vẫn để nguyên string, nhưng ít nhất không crash vì 'in' nữa
        }
      }

      await transporter.sendMail({
        from: `"Smart Blood Donation" <${process.env.MAIL_USER}>`,
        to,
        subject,
        template,
        context: ctx,   // đảm bảo là object (hoặc string đã xử lý)
      });

      return true;
    } catch (err) {
      console.error("❌ Mail error:", err);
      return false;
    }
  },
};
