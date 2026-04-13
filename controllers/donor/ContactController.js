const transporter = require("../../config/mailer");
const dotenv = require("dotenv");
dotenv.config();

module.exports = {
  async sendContact(req, res) {
    try {
      const { name, email, message } = req.body;

      if (!name || !email || !message) {
        return res
          .status(400)
          .json({ status: false, message: "Thiếu họ tên, email hoặc nội dung!" });
      }

      await transporter.sendMail({
        from: `"Smart Blood Donation" <${process.env.MAIL_USER}>`,
        to: process.env.ADMIN_EMAIL,
        subject: "Liên hệ mới từ website Smart Blood Donation",
        html: `
          <h3>Liên hệ mới từ website</h3>
          <p><b>Họ tên:</b> ${name}</p>
          <p><b>Email:</b> ${email}</p>
          <p><b>Nội dung:</b></p>
          <p>${message}</p>
          <hr/>
          <p>Được gửi từ form Liên hệ trên website.</p>
        `,
      });

      return res.json({
        status: true,
        message: "Đã gửi liên hệ, cảm ơn bạn đã đồng hành cùng chương trình!",
      });
    } catch (err) {
      console.error("❌ Contact error:", err);
      return res
        .status(500)
        .json({ status: false, message: "Có lỗi khi gửi liên hệ, vui lòng thử lại sau!" });
    }
  },
};
