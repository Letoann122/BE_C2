const jwt = require("jsonwebtoken");
const { User } = require("../models");   // 👈 thêm dòng này
require("dotenv").config();

module.exports = (roleRequired = null) => {
  return async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res
        .status(401)
        .json({ status: false, message: "Thiếu token xác thực!" });
    }

    const token = authHeader.split(" ")[1];
    if (!token) {
      return res
        .status(401)
        .json({ status: false, message: "Token không hợp lệ!" });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      req.user = {
        id: decoded.id || decoded.userId,
        userId: decoded.userId || decoded.id,
        email: decoded.email,
        full_name: decoded.full_name,
        role: decoded.role,
      };

      // Check quyền role (doctor / donor / admin...)
      if (roleRequired && req.user.role !== roleRequired) {
        return res.status(403).json({
          status: false,
          message: "Bạn không có quyền truy cập vào tài nguyên này!",
        });
      }

      // 🔍 Lấy user từ DB để kiểm tra tinh_trang
      const u = await User.findByPk(req.user.id);

      if (!u) {
        return res
          .status(401)
          .json({ status: false, message: "Tài khoản không tồn tại!" });
      }

      // ❌ nếu đã bị khóa
      if (u.tinh_trang === 2) {
        return res.status(403).json({
          status: false,
          message: "Tài khoản của bạn đã bị khóa!",
        });
      }

      next();
    } catch (error) {
      return res.status(403).json({
        status: false,
        message: "Token hết hạn hoặc không hợp lệ!",
        error: error.message,
      });
    }
  };
};
