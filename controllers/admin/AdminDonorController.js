"use strict";

const { User, Donation, sequelize } = require("../../models");
const { Op } = require("sequelize");

module.exports = {
  async getAllUsers(req, res) {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 15;
      const offset = (page - 1) * limit;

      const { search, role } = req.query;

      const whereCondition = {
        role: { [Op.ne]: "admin" },
      };

      if (role && ["donor", "doctor"].includes(role)) {
        whereCondition.role = role;
      }

      if (search) {
        whereCondition[Op.or] = [
          { full_name: { [Op.like]: `%${search}%` } },
          { email: { [Op.like]: `%${search}%` } }
        ];
      }

      const { count, rows } = await User.findAndCountAll({
        where: whereCondition,
        limit,
        offset,
        order: [["created_at", "DESC"]],

        attributes: {
          exclude: ["password", "hash_active", "reset_token", "reset_expires"],

          include: [
            [
              sequelize.literal(`(
                SELECT COUNT(*) 
                FROM donations d 
                WHERE d.donor_user_id = User.id
              )`),
              "donation_count"
            ],
            [
              sequelize.literal(`(
                SELECT d.collected_at
                FROM donations d 
                WHERE d.donor_user_id = User.id
                ORDER BY d.collected_at DESC
                LIMIT 1
              )`),
              "last_donation_date"
            ],
          ],
        },
      });

      const mapped = rows.map(u => {
        const obj = u.toJSON();

        obj.donation_count = parseInt(obj.donation_count) || 0;

        obj.last_donation_date = obj.last_donation_date
          ? new Date(obj.last_donation_date)
          : null;

        return obj;
      });

      return res.json({
        status: true,
        data: mapped,
        totalItems: count,
        totalPages: Math.ceil(count / limit),
        currentPage: page,
      });

    } catch (error) {
      console.error("🔥 getAllUsers error:", error);
      return res.status(500).json({
        status: false,
        message: "Lỗi server!",
      });
    }
  },
  async editUser(req, res) {
    try {
      const { id } = req.params;
      const user = await User.findByPk(id);
      if (!user) {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy người dùng!"
        });
      }

      const { full_name, email, phone, gender, birthday, address, blood_group, tinh_trang } = req.body;

      let genderMapped = null;
      if (gender === "male") genderMapped = "Nam";
      if (gender === "female") genderMapped = "Nữ";

      const statusMapped = [1, 2].includes(parseInt(tinh_trang)) ? tinh_trang : 1;

      const safeData = {
        full_name,
        email,
        phone,
        gender: genderMapped,
        address,
        tinh_trang: statusMapped,
      };

      if (user.role === "donor") {
        safeData.birthday = birthday || null;
        safeData.blood_group = blood_group || null;
      }

      await User.update(safeData, { where: { id } });

      return res.json({
        status: true,
        message: "Cập nhật người dùng thành công!"
      });

    } catch (error) {
      console.error("🔥 editUser error:", error);
      return res.status(500).json({
        status: false,
        message: "Lỗi server khi cập nhật!",
      });
    }
  },
};
