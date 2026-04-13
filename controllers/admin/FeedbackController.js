const { Feedback, User } = require("../../models");
  

module.exports = {
  async getAllFeedback(req, res) {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const offset = (page - 1) * limit;

      const { status } = req.query;

      const whereCondition = {};
      if (status) {
        whereCondition.status = status;
      }

      const { count, rows } = await Feedback.findAndCountAll({
        where: whereCondition,
        limit,
        offset,
        order: [["created_at", "DESC"]],
        include: [
          {
            model: User,
            as: "user",
            attributes: ["id", "full_name", "email"],
          },
        ],
      });

      res.status(200).json({
        status: true,
        message: "Tải danh sách phản hồi thành công!",
        totalItems: count,
        totalPages: Math.ceil(count / limit),
        currentPage: page,
        data: rows,
      });
    } catch (error) {
      console.error(" Lỗi getAllFeedback (Admin):", error);
      res.status(500).json({
        status: false,
        message: "Lỗi server khi tải danh sách phản hồi!",
      });
    }
  },

  async markAsRead(req, res) {
    try {
      const { id } = req.params;

      const [affectedRows] = await Feedback.update(
        { status: "read" },
        { where: { id } }
      );

      if (affectedRows === 0) {
        return res
          .status(404)
          .json({ status: false, message: "Không tìm thấy phản hồi." });
      }

      res
        .status(200)
        .json({ status: true, message: "Đã đánh dấu phản hồi là đã đọc!" });
    } catch (error) {
      res
        .status(500)
        .json({ status: false, message: "Lỗi server!", error: error.message });
    }
  },

  async deleteFeedback(req, res) {
    try {
      const { id } = req.params;

      const affectedRows = await Feedback.destroy({
        where: { id },
      });

      if (affectedRows === 0) {
        return res
          .status(404)
          .json({ status: false, message: "Không tìm thấy phản hồi để xóa." });
      }

      res
        .status(200)
        .json({ status: true, message: "Xóa phản hồi thành công!" });
    } catch (error) {
      console.error(" Lỗi deleteFeedback (Admin):", error);
      res.status(500).json({
        status: false,
        message: "Lỗi server khi xóa phản hồi!",
      });
    }
  },
};
