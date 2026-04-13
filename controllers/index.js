// controllers/index.js

module.exports = {
  RegisterController: require("./RegisterController.js"),
  ActivateController: require("./ActivateController.js"),
  LoginController: require("./LoginController.js"),
  LogoutController: require("./LogoutController.js"),
  ForgotPasswordController: require("./ForgotPasswordController.js"),
  ResetPasswordController: require("./ResetPasswordController.js"),
  AdminDonnorController: require("./admin/AdminDonorController.js"),
};
