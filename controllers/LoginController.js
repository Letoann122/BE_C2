const { User } = require("./../models");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const dotenv = require("dotenv");
dotenv.config();

module.exports = {
  async login(req, res) {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({
          status: false,
          message: "Vui lòng nhập đầy đủ email và mật khẩu!",
        });
      }

      const user = await User.findOne({ where: { email } });
      if (!user)
        return res.status(400).json({
          status: false,
          message: "Email hoặc mật khẩu không đúng!",
        });

      // ❌ chưa kích hoạt
      if (user.tinh_trang === 0) {
        return res.status(403).json({
          status: false,
          message: "Tài khoản của bạn chưa được kích hoạt. Vui lòng kiểm tra email!",
        });
      }

      // ❌ bị khóa
      if (user.tinh_trang === 2) {
        return res.status(403).json({
          status: false,
          message: "Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên!",
        });
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch)
        return res.status(400).json({
          status: false,
          message: "Email hoặc mật khẩu không đúng!",
        });

      const payload = {
        userId: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
      };

      const token = jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: "7d",
      });

      return res.status(200).json({
        status: true,
        message: "Đăng nhập thành công!",
        data: {
          userId: user.id,
          full_name: user.full_name,
          email: user.email,
          role: user.role,
          token,
        },
      });
    } catch (error) {
      console.error("🔥 Lỗi login:", error);
      return res
        .status(500)
        .json({ status: false, message: "Đăng nhập thất bại!" });
    }
  },
};
