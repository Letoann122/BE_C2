const { User, Donor } = require("./../models");

module.exports = {
  // Lấy thông tin hồ sơ người dùng
  async getProfile(req, res) {
    try {
      const user = await User.findByPk(req.user.userId, {
        attributes: [
          "id",
          "full_name",
          "birthday",
          "gender",
          "phone",
          "email",
          "address",
          "blood_group",
          "medical_history",
          "role",
        ],
      });

      if (!user) {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy người dùng!",
        });
      }

      return res.json({
        status: true,
        data: user,
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Lỗi khi lấy thông tin user!",
        error: error.message,
      });
    }
  },

  // Cập nhật hồ sơ người dùng
  async updateProfile(req, res) {
    try {
      const {
        full_name,
        birthday,
        gender,
        phone,
        address,
        // ❌ KHÔNG lấy blood_group từ body nữa
        medical_history,
      } = req.body;

      // ✅ Validate nhẹ để FE toast lỗi từng trường (422)
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

      // ❌ Không còn validate blood_group (đã khoá, user không sửa được)

      if (Object.keys(errors).length > 0) {
        return res.status(422).json({
          message: "The given data was invalid.",
          errors,
        });
      }

      // ✅ Update vào DB
      const user = await User.findByPk(req.user.userId);
      if (!user) {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy người dùng!",
        });
      }

      await user.update({
        full_name,
        birthday,
        gender,
        phone,
        address,
        // ❌ không đụng tới blood_group
        medical_history,
      });

      return res.json({
        status: true,
        message: "Cập nhật hồ sơ thành công!",
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Lỗi khi cập nhật hồ sơ!",
        error: error.message,
      });
    }
  },

  // Cập nhật vị trí GPS donor
async updateLocation(req, res) {
  try {
    const userId = req.user.userId;

    const { latitude, longitude } = req.body;

    if (
      latitude === undefined ||
      longitude === undefined
    ) {
      return res.status(400).json({
        status: false,
        message: "Thiếu tọa độ vị trí!",
      });
    }

    const lat = Number(latitude);
    const lng = Number(longitude);

    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng)
    ) {
      return res.status(400).json({
        status: false,
        message: "Tọa độ không hợp lệ!",
      });
    }

    await Donor.update(
      {
        last_known_lat: lat,
        last_known_lng: lng,
        last_location_at: new Date(),
      },
      {
        where: {
          user_id: userId,
        },
      }
    );

    return res.json({
      status: true,
      message: "Cập nhật vị trí thành công!",
    });
  } catch (error) {
    console.error(
      "ProfileController.updateLocation error:",
      error
    );

    return res.status(500).json({
      status: false,
      message: "Không thể cập nhật vị trí!",
      error: error.message,
    });
  }
},
};
