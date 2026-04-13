// ActivateController.js
const { User } = require("./../models");
const dotenv = require("dotenv");
dotenv.config();

module.exports = {
  async activate(req, res) {
    try {
      const { token } = req.params;
      const user = await User.findOne({ where: { hash_active: token } });
      if (!user)
        return res.status(400).json({ status: false, message: "Token kích hoạt không hợp lệ" });

      user.tinh_trang = 1;
      user.hash_active = null;
      await user.save();

      return res.redirect(`${process.env.FRONTEND_URL}/login`);
    } catch (error) {
      return res.status(500).json({ status: false, message: "Kích hoạt thất bại", error: error.message });
    }
  },
};
