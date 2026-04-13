// ResetPasswordController.js
const { User } = require("./../models");
const bcrypt = require("bcrypt");

module.exports = {
  async resetPassword(req, res) {
    try {
      const { token, password, password_confirmation } = req.body;
      if (password !== password_confirmation)
        return res.status(400).json({ status: false, message: "Mật khẩu xác nhận không khớp!" });

      const user = await User.findOne({ where: { reset_token: token } });
      if (!user)
        return res.status(400).json({ status: false, message: "Token không hợp lệ!" });

      if (user.reset_expires < new Date())
        return res.status(400).json({ status: false, message: "Token đã hết hạn!" });

      user.password = await bcrypt.hash(password, 10);
      user.reset_token = null;
      user.reset_expires = null;
      await user.save();

      return res.json({ status: true, message: "Đổi mật khẩu thành công!" });
    } catch (err) {
      console.error("❌ Reset password error:", err);
      return res.status(500).json({ status: false, message: "Đổi mật khẩu thất bại!", error: err.message });
    }
  },
};
