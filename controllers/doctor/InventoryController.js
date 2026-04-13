// controllers/InventoryController.js
const { VInventoryCurrent } = require("../../models");

module.exports = {
  current(req, res) {
    const { hospital_id } = req.query;
    const where = {};
    if (hospital_id) where.hospital_id = hospital_id;

    VInventoryCurrent.findAll({
      where,
      order: [["hospital_id", "ASC"], ["blood_group", "ASC"]],
    })
      .then((rows) => res.json({ status: true, data: rows }))
      .catch((err) =>
        res.status(500).json({
          status: false,
          message: "Không thể tải tồn kho hiện tại",
          errors: { general: [err.message] },
        })
      );
  },
};
