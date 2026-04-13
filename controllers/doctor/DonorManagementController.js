"use strict";

const { Donor, User, BloodType, Donation, Sequelize } = require("../../models");
const bcrypt = require("bcrypt");

module.exports = {

  async list(req, res) {
    try {
      const donors = await Donor.findAll({
        include: [
          {
            model: User,
            attributes: ["id", "full_name", "phone", "email", "address"],
          },
          {
            model: BloodType,
            attributes: ["abo", "rh"],
          },
        ],
        order: [["id", "ASC"]],
      });
      const donorIds = donors.map((d) => d.user_id);
      const donationStats = await Donation.findAll({
        where: { donor_user_id: donorIds },
        attributes: [
          "donor_user_id",
          [Sequelize.fn("MAX", Sequelize.col("collected_at")), "lastDonation"],
          [Sequelize.fn("COUNT", Sequelize.col("id")), "totalDonation"],
        ],
        group: ["donor_user_id"],
      });

      const statMap = {};
      donationStats.forEach((r) => {
        statMap[r.donor_user_id] = {
          lastDonation: r.getDataValue("lastDonation"),
          totalDonation: r.getDataValue("totalDonation"),
        };
      });

      const data = donors.map((d) => {
        const stat = statMap[d.user_id] || null;

        return {
          id: d.user_id,
          name: d.full_name,
          address: d.address,
          phone: d.phone,
          email: d.email,
          bloodType: d.BloodType
            ? `${d.BloodType.abo}${d.BloodType.rh}`
            : "Không rõ",
          lastDonation: stat?.lastDonation
            ? stat.lastDonation.toISOString().slice(0, 10)
            : "Chưa hiến",
          totalDonation: stat?.totalDonation || 0,
          status: d.tinh_trang === 1 ? "Hoạt động" : "Tạm ngừng",
        };
      });
      return res.json({ status: true, data });
    } catch (err) {
      console.error("❌ Lỗi list donors:", err);
      return res.status(500).json({ status: false, error: err.message });
    }
  },
  async create(req, res) {
  try {
    const {
      full_name,
      email,
      phone,
      birthday,
      gender,
      address,
      blood_type_id
    } = req.body;
    if (!full_name || !email || !phone || !birthday || !gender || !address || !blood_type_id) {
      return res.status(400).json({
        status: false,
        message: "Vui lòng nhập đầy đủ thông tin!"
      });
    }
    const existed = await User.findOne({ where: { email } });
    if (existed) {
      return res.status(400).json({
        status: false,
        message: "Email đã tồn tại!"
      });
    }
    const hash = await bcrypt.hash("123456", 10);
    const user = await User.create({
      full_name,
      email,
      phone,
      birthday,
      gender,
      address,
      role: "donor",
      password: hash,
      tinh_trang: 1,
    });
    await Donor.update(
      { blood_type_id },
      { where: { user_id: user.id } }
    );
    const bt = await BloodType.findByPk(blood_type_id);
    if (bt) {
      await User.update(
        { blood_group: `${bt.abo}${bt.rh}` },
        { where: { id: user.id } }
      );
    }
    return res.json({
      status: true,
      message: "Tạo donor thành công!",
      data: { user_id: user.id }
    });
  } catch (error) {
    console.error("❌ Lỗi tạo donor:", error);
    return res.status(500).json({
      status: false,
      message: "Lỗi server!",
      error: error.message
    });
  }
}
};
