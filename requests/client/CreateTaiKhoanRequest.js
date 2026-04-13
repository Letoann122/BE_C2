const { body } = require("express-validator");
const { User } = require("../../models");

const CreateTaiKhoanRequest = [
  body("email")
    .notEmpty().withMessage("Bạn chưa nhập email.")
    .isEmail().withMessage("Email không hợp lệ.")
    .normalizeEmail()
    .custom(async (value) => {
      const existing = await User.findOne({ where: { email: value } });
      if (existing) throw new Error("Email đã được sử dụng.");
      return true;
    }),

  body("password")
    .notEmpty().withMessage("Bạn chưa nhập mật khẩu.")
    .isLength({ min: 6 }).withMessage("Mật khẩu phải có ít nhất 6 ký tự.")
    .isLength({ max: 50 }).withMessage("Mật khẩu không được quá 50 ký tự."),

  body("password_confirmation")
    .notEmpty().withMessage("Bạn chưa nhập lại mật khẩu.")
    .custom((value, { req }) => {
      if (value !== req.body.password)
        throw new Error("Mật khẩu nhập lại không khớp.");
      return true;
    }),

  body("full_name")
    .notEmpty().withMessage("Bạn chưa nhập họ và tên.")
    .isLength({ max: 255 }).withMessage("Họ và tên không được quá 255 ký tự."),

  body("phone")
    .notEmpty().withMessage("Bạn chưa nhập số điện thoại.")
    .isNumeric().withMessage("Số điện thoại chỉ được chứa số.")
    .isLength({ min: 10, max: 10 }).withMessage("Số điện thoại phải có 10 chữ số.")
    .custom(async (value) => {
      const existingPhone = await User.findOne({ where: { phone: value } });
      if (existingPhone) throw new Error("Số điện thoại đã được đăng ký.");
      return true;
    }),

  body("birthday")
    .notEmpty().withMessage("Bạn chưa nhập ngày sinh.")
    .isISO8601().withMessage("Ngày sinh không hợp lệ.")
    .custom((value) => {
      const d = new Date(value);
      const now = new Date();
      if (d > now) throw new Error("Ngày sinh không được lớn hơn ngày hiện tại.");
      const age = now.getFullYear() - d.getFullYear();
      if (age < 18) throw new Error("Phải từ 18 tuổi trở lên.");
      return true;
    }),

  body("gender")
    .notEmpty().withMessage("Bạn chưa chọn giới tính.")
    .isIn(["Nam", "Nữ"]).withMessage("Giới tính chỉ được chọn Nam hoặc Nữ."),

  body("address")
    .notEmpty().withMessage("Bạn chưa nhập địa chỉ.")
    .isLength({ max: 255 }).withMessage("Địa chỉ không được quá 255 ký tự."),

  body("role")
    .notEmpty().withMessage("Bạn chưa chọn vai trò.")
    .isIn(["donor", "doctor"]).withMessage("Vai trò không hợp lệ."),

  body("blood_group")
    .if(body("role").equals("donor"))
    .notEmpty().withMessage("Vui lòng chọn nhóm máu.")
    .isIn(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"])
    .withMessage("Nhóm máu không hợp lệ."),

  body("medical_history")
    .if(body("role").equals("donor"))
    .optional({ checkFalsy: true })
    .isLength({ max: 1000 }).withMessage("Tiền sử bệnh lý không được vượt quá 1000 ký tự.")
    .matches(/^[^<>{}]*$/).withMessage("Tiền sử bệnh lý không được chứa ký tự đặc biệt."),
];

module.exports = CreateTaiKhoanRequest;
