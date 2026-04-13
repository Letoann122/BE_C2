const { User } = require("../../models");

module.exports = {
  async checkToken(req, res) {
    try {
      const { userId, role } = req.user;
      if (role !== "donor")
        return res.json({ status: false, message: "Không có quyền truy cập!" });

      const donor = await User.findOne({ where: { id: userId, role: "donor" } });
      if (!donor)
        return res.json({ status: false, message: "Không tìm thấy thông tin người hiến máu!" });

      return res.json({
        status: true,
        ho_ten: donor.full_name,
        email: donor.email,
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ status: false, message: "Lỗi xác thực token!" });
    }
  },
};
