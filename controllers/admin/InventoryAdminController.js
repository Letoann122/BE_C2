const { BloodInventory, User } = require("../../models");
const { Op } = require("sequelize");

module.exports = {
  async getAllInventory(req, res) {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const offset = (page - 1) * limit;

      const { search, blood_type, status } = req.query;

      const whereCondition = {};

      if (status) {
        whereCondition.status = status;
      }

      if (blood_type) {
        whereCondition.blood_type = blood_type;
      }

      if (search) {
        whereCondition.blood_bag_id = { [Op.like]: `%${search}%` };
      }

      const { count, rows } = await BloodInventory.findAndCountAll({
        where: whereCondition,
        limit,
        offset,
        order: [["expiry_date", "ASC"]],
        include: [
          {
            model: User,
            as: "user",
            attributes: ["id", "full_name"],
          },
        ],
      });

      res.status(200).json({
        status: true,
        message: "Tải danh sách kho máu thành công!",
        totalItems: count,
        totalPages: Math.ceil(count / limit),
        currentPage: page,
        data: rows,
      });
    } catch (error) {
      console.error(" Lỗi getAllInventory (Admin):", error);
      res.status(500).json({
        status: false,
        message: "Lỗi server khi tải danh sách kho máu!",
      });
    }
  },
};
