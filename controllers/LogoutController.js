module.exports = {
  async logout(req, res) {
    try {
      return res.json({
        status: true,
        message: "Đăng xuất thành công!",
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Lỗi khi đăng xuất!",
        error: error.message,
      });
    }
  },
};
