const { DonationSite } = require("../../models");

module.exports = {
  getAll(req, res) {
    DonationSite.findAll({
      where: { is_active: 1 },
      order: [["name", "ASC"]],
    })
      .then((rows) => res.json({ status: true, data: rows }))
      .catch((err) => {
        return res.status(500).json({
          status: false,
          message: "Không thể tải danh sách điểm hiến máu",
          errors: { general: [err.message] },
        });
      });
  },
};
