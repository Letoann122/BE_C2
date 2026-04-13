const { User } = require("../../models");

module.exports = {
  async checkToken(req, res) {
    try {
      const { userId, role } = req.user;
      if (role !== "doctor")
        return res.json({ status: false, message: "Không có quyền truy cập!" });

      const doctor = await User.findOne({ where: { id: userId, role: "doctor" } });
      if (!doctor)
        return res.json({ status: false, message: "Không tìm thấy thông tin bác sĩ!" });

      return res.json({
        status: true,
        ho_ten: doctor.full_name,
        email: doctor.email,
        tinh_trang: doctor.tinh_trang,
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ status: false, message: "Lỗi xác thực token!" });
    }
  },
};
