const { User } = require("./../models");
const bcrypt = require("bcrypt");

module.exports = {
  async changePassword(req, res) {
    try {
      const { current_password, new_password, confirm_password } = req.body;
      if (!current_password || !new_password || !confirm_password) {
        return res.status(400).json({
          status: false,
          message: "Vui lòng nhập đầy đủ các trường bắt buộc!",
        });
      }
      if (new_password !== confirm_password) {
        return res.status(400).json({
          status: false,
          message: "Mật khẩu xác nhận không khớp!",
        });
      }
      const userId = req.user.userId;
      const user = await User.findByPk(userId);
      if (!user) {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy người dùng!",
        });
      }
      const isMatch = await bcrypt.compare(current_password, user.password);
      if (!isMatch) {
        return res.status(401).json({
          status: false,
          message: "Mật khẩu hiện tại không chính xác!",
        });
      }
      const hashedPassword = await bcrypt.hash(new_password, 10);
      user.password = hashedPassword;
      await user.save();
      return res.json({
        status: true,
        message: "Đổi mật khẩu thành công!",
      });
    } catch (error) {
      console.error("❌ Change password error:", error);
      return res.status(500).json({
        status: false,
        message: "Lỗi khi đổi mật khẩu!",
        error: error.message,
      });
    }
  },
};
