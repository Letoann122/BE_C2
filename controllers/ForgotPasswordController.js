// ForgotPasswordController.js
const { User } = require("./../models");
const { v4: uuidv4 } = require("uuid");
const transporter = require("./../config/mailer");
const dotenv = require("dotenv");
dotenv.config();

module.exports = {
  async forgotPassword(req, res) {
    try {
      const { email } = req.body;
      const user = await User.findOne({ where: { email } });

      if (!user)
        return res.status(404).json({ status: false, message: "Email không tồn tại!" });

      const resetToken = uuidv4();
      user.reset_token = resetToken;
      user.reset_expires = new Date(Date.now() + 3600000); // 1 giờ
      await user.save();

      const resetLink = `${process.env.FRONTEND_URL}/change-password?token=${resetToken}`;
      await transporter.sendMail({
        from: `"Smart Blood Donation" <${process.env.MAIL_USER}>`,
        to: email,
        subject: "Đặt lại mật khẩu",
        html: `<h3>Xin chào ${user.full_name}</h3><p>Bạn vừa yêu cầu đặt lại mật khẩu.</p><a href="${resetLink}">${resetLink}</a>`,
      });

      return res.json({ status: true, message: "Email đặt lại mật khẩu đã được gửi!" });
    } catch (err) {
      console.error("❌ Forgot password error:", err);
      return res.status(500).json({ status: false, message: "Có lỗi khi gửi mail quên mật khẩu!", error: err.message });
    }
  },
};
