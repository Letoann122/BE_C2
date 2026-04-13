"use strict";

const { Op } = require("sequelize");
const { News } = require("../../models");

const pad = (n) => (n < 10 ? `0${n}` : `${n}`);
const getLastDay = (y, m) => new Date(y, m, 0).getDate();

module.exports = {
  // ============================================================================
  // GET /doctor/news
  // List bài của doctor + filter
  // ============================================================================
  async getMyNews(req, res) {
    try {
      const doctorId = req.user?.id;

      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const offset = (page - 1) * limit;

      const { status, keyword, time, start_from, start_to } = req.query;
      const where = { created_by: doctorId };

      if (status) where.status = status;
      if (keyword) where.title = { [Op.like]: `%${keyword}%` };

      // filter time... (giữ nguyên logic cũ)
      if (time === "this_month") {
        const now = new Date();
        const y = now.getFullYear();
        const m = now.getMonth() + 1;
        const from = `${y}-${pad(m)}-01`;
        const to = `${y}-${pad(m)}-${pad(getLastDay(y, m))}`;
        where.published_date = { [Op.between]: [from, to] };
      } else if (time === "last_month") {
        const now = new Date();
        let y = now.getFullYear();
        let m = now.getMonth();
        if (m === 0) {
          m = 12;
          y -= 1;
        }
        const from = `${y}-${pad(m)}-01`;
        const to = `${y}-${pad(m)}-${pad(getLastDay(y, m))}`;
        where.published_date = { [Op.between]: [from, to] };
      } else if (time === "this_year") {
        const y = new Date().getFullYear();
        where.published_date = { [Op.between]: [`${y}-01-01`, `${y}-12-31`] };
      } else if (time === "custom") {
        if (start_from && start_to) {
          where.published_date = { [Op.between]: [start_from, start_to] };
        }
      }

      const { rows, count } = await News.findAndCountAll({
        where,
        order: [["updated_at", "DESC"]],
        limit,
        offset,
      });

      return res.json({
        status: true,
        data: {
          items: rows,
          page,
          totalPages: Math.ceil(count / limit) || 1,
          total: count,
        },
      });
    } catch (err) {
      console.error("DoctorNews.getMyNews error:", err);
      return res.status(500).json({
        status: false,
        message: "Không thể tải danh sách bài báo!",
        error: err.message,
      });
    }
  },

  // ============================================================================
  // POST /doctor/news
  // Create news (Luôn là pending)
  // ============================================================================
  async create(req, res) {
    try {
      const doctorId = req.user?.id;
      const { title, content, image_url, published_date } = req.body;

      if (!title || !content) {
        return res.json({ status: false, message: "Vui lòng nhập tiêu đề và nội dung!" });
      }

      const news = await News.create({
        title,
        content,
        image_url: image_url || null,
        published_date: published_date || undefined,
        created_by: doctorId,
        status: "pending", // <--- Luôn pending, không có draft
      });

      return res.json({
        status: true,
        message: "Gửi duyệt thành công!",
        data: news,
      });
    } catch (err) {
      console.error("DoctorNews.create error:", err);
      return res.status(500).json({
        status: false,
        message: "Không thể tạo bài báo!",
        error: err.message,
      });
    }
  },

  // ============================================================================
  // PUT /doctor/news/:id
  // Update (Chỉ cho phép khi status = 'rejected')
  // ============================================================================
  async update(req, res) {
    try {
      const doctorId = req.user?.id;
      const { id } = req.params;

      const news = await News.findOne({ where: { id, created_by: doctorId } });
      if (!news) return res.json({ status: false, message: "Không tìm thấy bài báo!" });

      // Chỉ cho phép sửa khi bị từ chối
      if (news.status !== "rejected") {
        return res.json({
          status: false,
          message: "Bài viết đang chờ duyệt hoặc đã duyệt. Không thể chỉnh sửa!",
        });
      }

      const { title, content, image_url, published_date } = req.body;

      await news.update({
        title: title ?? news.title,
        content: content ?? news.content,
        image_url: image_url === "" ? null : image_url ?? news.image_url,
        published_date: published_date ?? news.published_date,
        status: "pending", // <--- Sửa xong thì quay lại pending để admin duyệt lại
        
        // Reset thông tin duyệt cũ
        reviewed_by: null,
        reviewed_at: null,
        review_note: null,
      });

      return res.json({
        status: true,
        message: "Đã cập nhật và gửi duyệt lại!",
        data: news,
      });
    } catch (err) {
      console.error("DoctorNews.update error:", err);
      return res.status(500).json({
        status: false,
        message: "Không thể cập nhật bài báo!",
        error: err.message,
      });
    }
  },

  // Đã xoá hàm submit() vì không còn dùng draft nữa
};