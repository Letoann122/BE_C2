const { User } = require("../../models");

module.exports = {
  async checkToken(req, res) {
    try {
      const { userId, role } = req.user;
      if (role !== "admin") {
        return res.json({ status: false, message: "Không có quyền truy cập!" });
      }

      const admin = await User.findByPk(userId);
      if (!admin) return res.json({ status: false, message: "Không tìm thấy admin!" });

      return res.json({
        status: true,
        ho_ten: admin.full_name,
        email: admin.email,
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ status: false, message: "Lỗi xác thực token!" });
    }
  },
};
