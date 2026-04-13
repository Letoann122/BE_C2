// controllers/NewsController.js
const { Op } = require("sequelize");
const { News, User } = require("../models");

module.exports = {
  // ============================================================================
  // GET /news
  // Lấy danh sách tin (CHỈ hiển thị bài đã duyệt VÀ ngày đăng <= hiện tại)
  // ============================================================================
  async getAll(req, res) {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 8;
      const offset = (page - 1) * limit;

      const { start, end } = req.query;
      const today = new Date(); // Lấy thời gian hiện tại

      // ✅ MẶC ĐỊNH:
      // 1. Status phải là 'approved'
      // 2. Published_date phải <= hôm nay (không được hiện bài tương lai)
      const whereCondition = {
        status: "approved",
        published_date: {
          [Op.lte]: today, // Less than or equal to Today
        },
      };

      // Xử lý bộ lọc nếu có (kết hợp với điều kiện lte: today)
      if (start || end) {
        const dateFilters = [];
        
        // Luôn luôn phải nhỏ hơn hoặc bằng hôm nay
        dateFilters.push({ [Op.lte]: today });

        if (start) {
          dateFilters.push({ [Op.gte]: start });
        }
        
        if (end) {
          dateFilters.push({ [Op.lte]: end });
        }

        // Gán lại vào whereCondition bằng toán tử AND
        whereCondition.published_date = {
          [Op.and]: dateFilters,
        };
      }

      const { count, rows } = await News.findAndCountAll({
        where: whereCondition,
        limit,
        offset,
        order: [["published_date", "DESC"]], // Bài mới nhất lên đầu
        attributes: [
          "id",
          "title",
          "content",
          "image_url",
          "published_date",
          "created_at",
        ],
      });

      return res.json({
        status: true,
        total: count,
        totalPages: Math.ceil(count / limit),
        currentPage: page,
        data: rows,
      });
    } catch (err) {
      console.error("❌ NewsController.getAll error:", err);
      return res.status(500).json({
        status: false,
        message: "Không thể tải danh sách tin tức!",
        error: err.message,
      });
    }
  },

  // ============================================================================
  // GET /news/:id
  // Xem chi tiết (cũng phải chặn nếu truy cập bằng ID bài tương lai)
  // ============================================================================
  async getById(req, res) {
    try {
      const { id } = req.params;
      const today = new Date();

      const news = await News.findOne({
        where: {
          id: id,
          status: "approved",
          // ✅ QUAN TRỌNG: Chặn xem trước bài hẹn giờ bằng ID
          published_date: {
            [Op.lte]: today, 
          },
        },
        include: [
          {
            model: User,
            as: "creator",
            attributes: ["full_name"],
            required: false,
          },
        ],
      });

      if (!news) {
        return res.status(404).json({
          status: false,
          message: "Bài viết không tồn tại, chưa được duyệt hoặc chưa đến ngày hiển thị!",
        });
      }

      return res.json({ status: true, data: news });
    } catch (err) {
      console.error("❌ NewsController.getById error:", err);
      return res.status(500).json({
        status: false,
        message: "Không thể tải bài viết!",
        error: err.message,
      });
    }
  },
};