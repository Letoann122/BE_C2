const { check } = require("express-validator");

module.exports = [
  check("email").notEmpty().withMessage("Bạn chưa nhập email.")
    .isEmail().withMessage("Email không hợp lệ."),
  check("password").notEmpty().withMessage("Bạn chưa nhập mật khẩu."),
];
