const { User } = require("../../models");

module.exports = {
  me(req, res) {
    const userId = req.user.userId;
    if (!userId) {
      return res.status(401).json({
        status: false,
        message: "Bạn chưa đăng nhập",
        errors: { auth: ["Unauthorized"] },
      });
    }

    User.findOne({
      where: { id: userId },
      attributes: ["id", "full_name", "blood_group", "email"],
    })
      .then((u) => {
        if (!u) {
          return res.status(404).json({
            status: false,
            message: "Không tìm thấy người dùng",
            errors: { profile: ["User not found"] },
          });
        }
        return res.json({
          status: true,
          data: { full_name: u.full_name || "", blood_group: u.blood_group || "" },
        });
      })
      .catch((err) =>
        res.status(500).json({
          status: false,
          message: "Lỗi tải thông tin người dùng",
          errors: { general: [err.message] },
        })
      );
  },
};
