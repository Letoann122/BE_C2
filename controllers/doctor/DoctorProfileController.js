const { User } = require("../../models");

module.exports = {
  async getProfile(req, res) {
    try {
      const doctor = await User.findByPk(req.user.userId, {
        attributes: [
          "id",
          "full_name",
          "birthday",
          "gender",
          "phone",
          "email",
          "address",
          "role",
        ],
      });
      if (!doctor) {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy hồ sơ bác sĩ!",
        });
      }
      return res.json({
        status: true,
        data: doctor,
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Lỗi khi lấy thông tin hồ sơ bác sĩ!",
        error: error.message,
      });
    }
  },
  async updateProfile(req, res) {
    try {
      const { full_name, birthday, gender, phone, address } = req.body;
      const errors = {};
      if (!full_name || full_name.trim() === "") {
        errors.full_name = ["Họ và tên không được để trống."];
      }
      if (!birthday) {
        errors.birthday = ["Ngày sinh không được để trống."];
      }
      if (!phone || !/^[0-9]{9,11}$/.test(phone)) {
        errors.phone = ["Số điện thoại không hợp lệ (9–11 số)."];
      }
      if (!address || address.trim() === "") {
        errors.address = ["Địa chỉ không được để trống."];
      }
      if (Object.keys(errors).length > 0) {
        return res.status(422).json({
          message: "The given data was invalid.",
          errors,
        });
      }
      const doctor = await User.findByPk(req.user.userId);
      if (!doctor) {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy hồ sơ bác sĩ!",
        });
      }
      await doctor.update({
        full_name,
        birthday,
        gender,
        phone,
        address,
      });
      return res.json({
        status: true,
        message: "Cập nhật hồ sơ bác sĩ thành công!",
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Lỗi khi cập nhật hồ sơ bác sĩ!",
        error: error.message,
      });
    }
  },
};
