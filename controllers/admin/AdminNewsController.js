"use strict";

const { Op } = require("sequelize");
const { News, User } = require("../../models");

// Runtime Association
if (!News.associations.creator) {
  News.belongsTo(User, { foreignKey: "created_by", as: "creator" });
}
if (!News.associations.reviewer) {
  News.belongsTo(User, { foreignKey: "reviewed_by", as: "reviewer" });
}

module.exports = {
  // ... (Giữ nguyên getPendingNews, getAllNews, approveNews) ...
  async getPendingNews(req, res) {
    try {
      const { q } = req.query;
      const where = { status: "pending" };
      if (q) where.title = { [Op.like]: `%${q}%` };
      const rows = await News.findAll({
        where,
        order: [["created_at", "ASC"]],
        include: [{ model: User, as: "creator", attributes: ["id", "full_name", "email"] }],
      });
      return res.json({ status: true, data: rows });
    } catch (err) { return res.status(500).json({ status: false, message: "Lỗi hệ thống!" }); }
  },

  async getAllNews(req, res) {
    try {
      const { q, status, page, limit } = req.query;
      const pageNum = parseInt(page) || 1;
      const pageSize = parseInt(limit) || 10;
      const offset = (pageNum - 1) * pageSize;
      const where = {};
      if (status) where.status = status;
      if (q) where.title = { [Op.like]: `%${q}%` };

      const { rows, count } = await News.findAndCountAll({
        where,
        order: [["updated_at", "DESC"]],
        limit: pageSize,
        offset: offset,
        include: [{ model: User, as: "creator", attributes: ["id", "full_name", "email"] }],
      });
      return res.json({ status: true, data: { items: rows, total: count, page: pageNum, totalPages: Math.ceil(count / pageSize) } });
    } catch (err) { return res.status(500).json({ status: false, message: "Lỗi hệ thống!" }); }
  },

  async approveNews(req, res) {
    try {
      const adminId = req.user?.id;
      const { id } = req.params;
      const news = await News.findByPk(id);
      if (!news) return res.json({ status: false, message: "Không tìm thấy bài viết!" });
      await news.update({ status: "approved", reviewed_by: adminId, reviewed_at: new Date(), review_note: null });
      return res.json({ status: true, message: "Duyệt thành công!" });
    } catch (err) { return res.status(500).json({ status: false, message: "Lỗi duyệt bài!" }); }
  },

  async rejectNews(req, res) {
    try {
      const adminId = req.user?.id;
      const { id } = req.params;
      const { review_note } = req.body;
      if (!review_note?.trim()) return res.json({ status: false, message: "Nhập lý do từ chối!" });
      const news = await News.findByPk(id);
      if (!news) return res.json({ status: false, message: "Không tìm thấy bài viết!" });
      await news.update({ status: "rejected", reviewed_by: adminId, reviewed_at: new Date(), review_note: review_note.trim() });
      return res.json({ status: true, message: "Đã từ chối bài viết!" });
    } catch (err) { return res.status(500).json({ status: false, message: "Lỗi từ chối!" }); }
  },

  // ============================================================================
  // DELETE /admin/news/:id
  // Xóa hẳn bài viết khỏi Database
  // ============================================================================
  async deleteNews(req, res) {
    try {
      const { id } = req.params;
      const news = await News.findByPk(id);
      
      if (!news) {
        return res.json({ status: false, message: "Bài viết không tồn tại!" });
      }

      await news.destroy(); // Xóa vĩnh viễn

      return res.json({
        status: true,
        message: "Đã xóa bài viết thành công!",
      });
    } catch (err) {
      console.error("AdminNews.deleteNews error:", err);
      return res.status(500).json({
        status: false,
        message: "Không thể xóa bài viết!",
        error: err.message,
      });
    }
  },
};