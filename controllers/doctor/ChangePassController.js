const bcrypt = require("bcrypt");
const { User } = require("../../models");

module.exports = {
  // Đổi mật khẩu cho bác sĩ
  async changePassword(req, res) {
    try {
      const { current_password, new_password, confirm_password } = req.body;

      // ===== Validate cơ bản =====
      if (!current_password || !new_password || !confirm_password) {
        return res.status(400).json({
          status: false,
          message: "Vui lòng nhập đầy đủ thông tin!",
        });
      }

      if (new_password !== confirm_password) {
        return res.status(400).json({
          status: false,
          message: "Mật khẩu xác nhận không khớp!",
        });
      }

      // ===== Lấy user hiện tại theo token =====
      const user = await User.findByPk(req.user.userId);

      if (!user || user.role !== "doctor") {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy tài khoản bác sĩ!",
        });
      }

      // ===== So sánh mật khẩu cũ =====
      const isMatch = await bcrypt.compare(current_password, user.password);
      if (!isMatch) {
        return res.status(400).json({
          status: false,
          message: "Mật khẩu hiện tại không chính xác!",
        });
      }

      // ===== Mã hóa & cập nhật mật khẩu mới =====
      const hashedPassword = await bcrypt.hash(new_password, 10);
      await user.update({ password: hashedPassword });

      return res.json({
        status: true,
        message: "Đổi mật khẩu thành công!",
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Lỗi khi đổi mật khẩu!",
        error: error.message,
      });
    }
  },
};
