"use strict";

const {
  BloodInventory,
  BloodType,
  InventoryTransaction,
  User,
  Doctor,
  Donation,
  sequelize,
} = require("../../models");
const { Op } = require("sequelize");

const INVENTORY_STATUS = {
  TESTING: "testing",
  AVAILABLE: "available",
  DISCARDED: "discarded",
  EXPIRED: "expired",
};

function normalizeDate(d) {
  const dt = new Date(d);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function isExpired(expiryDate) {
  if (!expiryDate) return false;

  const today = normalizeDate(new Date());
  const expiry = normalizeDate(expiryDate);

  return expiry < today;
}

function statusLabel(status) {
  const map = {
    testing: "Đang kiểm định",
    available: "Có thể sử dụng",
    discarded: "Đã loại bỏ",
    expired: "Hết hạn",
  };

  return map[status] || status;
}

async function createInventoryTx(
  { inventoryId, userId, txType, units, reason, refDonationId = null },
  options = {}
) {
  const { transaction = null } = options;

  return InventoryTransaction.create(
    {
      inventory_id: inventoryId,
      user_id: userId || null,
      tx_type: txType,
      units,
      reason,
      ref_donation_id: refDonationId,
      occurred_at: new Date(),
    },
    { transaction }
  );
}

async function getDoctor(req, transaction = null) {
  const doctorUserId = req.user?.userId || req.user?.id;

  if (!doctorUserId) return null;

  return Doctor.findOne({
    where: {
      user_id: doctorUserId,
    },
    transaction,
  });
}

module.exports = {
  // GET ALL
  async getAll(req, res) {
    try {
      const list = await BloodInventory.findAll({
        include: [
          { model: BloodType, as: "blood_type", attributes: ["abo", "rh"] },
        ],
        order: [["id", "DESC"]],
      });

      return res.json({ status: true, data: list });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Lỗi lấy danh sách kho máu",
        error: error.message,
      });
    }
  },

  // GET ONE
  // GET ONE
async getOne(req, res) {
  try {
    const { id } = req.params;

    const [rows] = await sequelize.query(
      `
        SELECT
          bi.*,
          CONCAT(bt.abo, bt.rh) AS blood_group,
          h.name AS hospital_name,
          COALESCE(tested_user.full_name, tested_user.email) AS tested_by_name,
          COALESCE(donor_user.full_name, donor_user.email) AS donor_name
        FROM blood_inventory bi
        LEFT JOIN blood_types bt
          ON bt.id = bi.blood_type_id
        LEFT JOIN hospitals h
          ON h.id = bi.hospital_id
        LEFT JOIN doctors tested_doctor
          ON tested_doctor.id = bi.tested_by_doctor_id
        LEFT JOIN users tested_user
          ON tested_user.id = tested_doctor.user_id
        LEFT JOIN donations d
          ON d.id = bi.donation_id
        LEFT JOIN users donor_user
          ON donor_user.id = d.donor_user_id
        WHERE bi.id = :id
        LIMIT 1
      `,
      {
        replacements: { id },
      }
    );

    const batch = rows?.[0];

    if (!batch) {
      return res.json({
        status: false,
        message: "Không tìm thấy lô máu",
      });
    }

    const transactions = await InventoryTransaction.findAll({
      where: {
        inventory_id: id,
      },
      include: [
        {
          model: User,
          attributes: ["id", "full_name", "email", "role"],
          required: false,
        },
      ],
      order: [["occurred_at", "DESC"]],
    });

    const mappedTransactions = transactions.map((tx) => ({
      id: tx.id,
      inventory_id: tx.inventory_id,
      tx_type: tx.tx_type,
      units: tx.units,
      reason: tx.reason,
      ref_donation_id: tx.ref_donation_id,
      occurred_at: tx.occurred_at,
      user: tx.User
        ? {
            id: tx.User.id,
            full_name: tx.User.full_name,
            email: tx.User.email,
            role: tx.User.role,
          }
        : null,
      by: tx.User
        ? {
            id: tx.User.id,
            full_name: tx.User.full_name,
            email: tx.User.email,
            role: tx.User.role,
          }
        : null,
    }));

    return res.json({
      status: true,
      message: "Lấy chi tiết lô máu thành công",
      data: {
        batch: {
          ...batch,
          blood_type: batch.blood_group,
          tested_by: batch.tested_by_name
            ? {
                full_name: batch.tested_by_name,
              }
            : null,
          hospital: batch.hospital_name
            ? {
                name: batch.hospital_name,
              }
            : null,
        },
        transactions: mappedTransactions,
      },
    });
  } catch (error) {
    console.error("getOne blood inventory error:", error);

    return res.status(500).json({
      status: false,
      message: "Lỗi lấy chi tiết lô máu",
      error: error.message,
    });
  }
},

  // CREATE MANUAL INVENTORY
  async create(req, res) {
    const t = await sequelize.transaction();

    try {
      const { blood_type_id, units, donation_date, expiry_date, quality_note } =
        req.body;
      const authUser = req.user;

      if (!blood_type_id || !units || !donation_date || !expiry_date) {
        await t.rollback();
        return res.json({
          status: false,
          message:
            "Vui lòng nhập đầy đủ nhóm máu, ngày nhập, hạn sử dụng và số lượng",
        });
      }

      if (Number(units) <= 0) {
        await t.rollback();
        return res.json({
          status: false,
          message: "Số lượng túi máu phải lớn hơn 0",
        });
      }

      const today = normalizeDate(new Date());
      const donation = normalizeDate(donation_date);
      const expiry = normalizeDate(expiry_date);

      if (donation < today) {
        await t.rollback();
        return res.json({
          status: false,
          message: "Ngày nhập không được nhỏ hơn ngày hiện tại",
        });
      }

      if (expiry < today) {
        await t.rollback();
        return res.json({
          status: false,
          message: "Hạn sử dụng không được nhỏ hơn ngày hiện tại",
        });
      }

      if (expiry < donation) {
        await t.rollback();
        return res.json({
          status: false,
          message: "Hạn sử dụng không được nhỏ hơn ngày nhập",
        });
      }

      const newBatch = await BloodInventory.create(
        {
          hospital_id: null,
          blood_type_id,
          units,
          donation_date,
          expiry_date,
          status: INVENTORY_STATUS.AVAILABLE,
          quality_note: quality_note || "Nhập kho thủ công, mặc định có thể sử dụng",
        },
        { transaction: t }
      );

      let label = "";
      const type = await BloodType.findByPk(blood_type_id, { transaction: t });
      if (type) label = `${type.abo}${type.rh}`;

      await createInventoryTx(
        {
          inventoryId: newBatch.id,
          userId: authUser?.userId,
          txType: "IN",
          units,
          reason: `Nhập ${units} túi máu ${label || ""} có thể sử dụng (id=${newBatch.id})`,
        },
        { transaction: t }
      );

      await t.commit();

      return res.json({
        status: true,
        message: "Thêm lô máu thành công",
        data: newBatch,
      });
    } catch (error) {
      await t.rollback();

      return res.status(500).json({
        status: false,
        message: "Lỗi thêm lô máu",
        error: error.message,
      });
    }
  },

  // UPDATE INVENTORY BASIC INFO
  async update(req, res) {
    const t = await sequelize.transaction();

    try {
      const { id } = req.params;
      const { blood_type_id, units, donation_date, expiry_date, quality_note } =
        req.body;
      const authUser = req.user;

      const batch = await BloodInventory.findByPk(id, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!batch) {
        await t.rollback();
        return res.json({ status: false, message: "Không tìm thấy lô máu" });
      }

      if (!blood_type_id || !units || !donation_date || !expiry_date) {
        await t.rollback();
        return res.json({
          status: false,
          message:
            "Vui lòng nhập đầy đủ nhóm máu, ngày nhập, hạn sử dụng và số lượng",
        });
      }

      if (Number(units) <= 0) {
        await t.rollback();
        return res.json({
          status: false,
          message: "Số lượng túi máu phải lớn hơn 0",
        });
      }

      const today = normalizeDate(new Date());
      const donation = normalizeDate(donation_date);
      const expiry = normalizeDate(expiry_date);

      if (donation < today) {
        await t.rollback();
        return res.json({
          status: false,
          message: "Ngày nhập không được nhỏ hơn ngày hiện tại",
        });
      }

      if (expiry < today) {
        await t.rollback();
        return res.json({
          status: false,
          message: "Hạn sử dụng không được nhỏ hơn ngày hiện tại",
        });
      }

      if (expiry < donation) {
        await t.rollback();
        return res.json({
          status: false,
          message: "Hạn sử dụng không được nhỏ hơn ngày nhập",
        });
      }

      const oldUnits = Number(batch.units || 0);
      const newStatus = isExpired(expiry_date)
        ? INVENTORY_STATUS.EXPIRED
        : batch.status;

      await batch.update(
        {
          blood_type_id,
          units,
          donation_date,
          expiry_date,
          status: newStatus,
          quality_note:
            quality_note !== undefined ? quality_note : batch.quality_note,
        },
        { transaction: t }
      );

      let label = "";
      const type = await BloodType.findByPk(blood_type_id, { transaction: t });
      if (type) label = `${type.abo}${type.rh}`;

      const diffUnits = Math.abs(Number(units) - oldUnits);

      if (diffUnits > 0) {
        await createInventoryTx(
          {
            inventoryId: batch.id,
            userId: authUser?.userId,
            txType: "ADJUST",
            units: diffUnits,
            reason: `Điều chỉnh lô máu ${label || ""} (id=${batch.id}) từ ${oldUnits} → ${units} túi`,
          },
          { transaction: t }
        );
      }

      await t.commit();

      return res.json({
        status: true,
        message: "Cập nhật lô máu thành công",
        data: batch,
      });
    } catch (error) {
      await t.rollback();

      return res.status(500).json({
        status: false,
        message: "Lỗi cập nhật lô máu",
        error: error.message,
      });
    }
  },

  // DELETE
  async delete(req, res) {
    const t = await sequelize.transaction();

    try {
      const { id } = req.params;
      const authUser = req.user;

      const batch = await BloodInventory.findByPk(id, {
        include: [
          { model: BloodType, as: "blood_type", attributes: ["abo", "rh"] },
        ],
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!batch) {
        await t.rollback();
        return res.json({ status: false, message: "Không tìm thấy lô máu" });
      }

      const label = batch.blood_type
        ? `${batch.blood_type.abo}${batch.blood_type.rh}`
        : "";
      const units = Number(batch.units || 0);

      await createInventoryTx(
        {
          inventoryId: batch.id,
          userId: authUser?.userId,
          txType: "OUT",
          units,
          reason: `Xóa lô máu ${label || ""} (id=${id}), xuất khỏi kho ${units} túi`,
        },
        { transaction: t }
      );

      await batch.destroy({ transaction: t });

      await t.commit();

      return res.json({ status: true, message: "Xóa lô máu thành công" });
    } catch (error) {
      await t.rollback();

      return res.status(500).json({
        status: false,
        message: "Lỗi xóa lô máu",
        error: error.message,
      });
    }
  },

  // FILTER
  async filter(req, res) {
    try {
      const { bloodType, status } = req.body;

      const whereClause = {};

      if (status && status !== "all") {
        whereClause.status = status;
      }

      const includeClause = [
        {
          model: BloodType,
          as: "blood_type",
          attributes: ["abo", "rh"],
          required: true,
        },
      ];

      if (bloodType && bloodType !== "all") {
        const bt = String(bloodType).trim().replace(/ /g, "+");
        const abo = bt.replace(/[+\-\s]/g, "");
        const rh = bt.includes("-") ? "-" : "+";

        includeClause[0].where = {
          [Op.and]: [{ abo }, { rh }],
        };
      }

      const result = await BloodInventory.findAll({
        where: whereClause,
        include: includeClause,
        order: [["id", "DESC"]],
      });

      return res.json({ status: true, data: result });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Lỗi lọc dữ liệu",
        error: error.message,
      });
    }
  },

  // BLOOD TESTING LIST
  async testingList(req, res) {
    try {
      const list = await BloodInventory.findAll({
        where: {
          status: INVENTORY_STATUS.TESTING,
        },
        include: [
          {
            model: BloodType,
            as: "blood_type",
            attributes: ["abo", "rh"],
          },
        ],
        order: [["id", "DESC"]],
      });

      return res.json({
        status: true,
        message: "Lấy danh sách túi máu chờ kiểm định thành công",
        data: list,
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Lỗi lấy danh sách túi máu chờ kiểm định",
        error: error.message,
      });
    }
  },

  // APPROVE BLOOD BAG
  async approveTesting(req, res) {
    const t = await sequelize.transaction();

    try {
      const { inventory_id, quality_note } = req.body;
      const authUser = req.user;

      if (!inventory_id) {
        await t.rollback();
        return res.status(400).json({
          status: false,
          message: "Thiếu inventory_id",
        });
      }

      const doctor = await getDoctor(req, t);

      const batch = await BloodInventory.findByPk(inventory_id, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!batch) {
        await t.rollback();
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy túi máu",
        });
      }

      if (batch.status !== INVENTORY_STATUS.TESTING) {
        await t.rollback();
        return res.status(400).json({
          status: false,
          message: `Chỉ có thể duyệt túi máu đang kiểm định. Hiện tại: ${statusLabel(batch.status)}`,
        });
      }

      await batch.update(
        {
          status: INVENTORY_STATUS.AVAILABLE,
          quality_note: quality_note || "Túi máu đạt kiểm định",
          tested_at: new Date(),
          tested_by_doctor_id: doctor?.id || null,
        },
        { transaction: t }
      );

      await createInventoryTx(
        {
          inventoryId: batch.id,
          userId: authUser?.userId || authUser?.id,
          txType: "ADJUST",
          units: Number(batch.units || 1),
          reason: `Túi máu id=${batch.id} đạt kiểm định, chuyển sang có thể sử dụng`,
          refDonationId: batch.donation_id || null,
        },
        { transaction: t }
      );

      await t.commit();

      return res.json({
        status: true,
        message: "Túi máu đã đạt kiểm định và có thể sử dụng",
        data: batch,
      });
    } catch (error) {
      await t.rollback();

      return res.status(500).json({
        status: false,
        message: "Lỗi duyệt túi máu",
        error: error.message,
      });
    }
  },

  // REJECT BLOOD BAG
  async rejectTesting(req, res) {
    const t = await sequelize.transaction();

    try {
      const { inventory_id, quality_note } = req.body;
      const authUser = req.user;

      if (!inventory_id) {
        await t.rollback();
        return res.status(400).json({
          status: false,
          message: "Thiếu inventory_id",
        });
      }

      if (!quality_note) {
        await t.rollback();
        return res.status(400).json({
          status: false,
          message: "Vui lòng nhập lý do loại bỏ túi máu",
        });
      }

      const doctor = await getDoctor(req, t);

      const batch = await BloodInventory.findByPk(inventory_id, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!batch) {
        await t.rollback();
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy túi máu",
        });
      }

      if (batch.status !== INVENTORY_STATUS.TESTING) {
        await t.rollback();
        return res.status(400).json({
          status: false,
          message: `Chỉ có thể loại bỏ túi máu đang kiểm định. Hiện tại: ${statusLabel(batch.status)}`,
        });
      }

      await batch.update(
        {
          status: INVENTORY_STATUS.DISCARDED,
          quality_note,
          tested_at: new Date(),
          tested_by_doctor_id: doctor?.id || null,
        },
        { transaction: t }
      );

      await createInventoryTx(
        {
          inventoryId: batch.id,
          userId: authUser?.userId || authUser?.id,
          txType: "ADJUST",
          units: Number(batch.units || 1),
          reason: `Túi máu id=${batch.id} không đạt kiểm định: ${quality_note}`,
          refDonationId: batch.donation_id || null,
        },
        { transaction: t }
      );

      await t.commit();

      return res.json({
        status: true,
        message: "Túi máu đã được loại bỏ sau kiểm định",
        data: batch,
      });
    } catch (error) {
      await t.rollback();

      return res.status(500).json({
        status: false,
        message: "Lỗi loại bỏ túi máu",
        error: error.message,
      });
    }
  },

  // LOGS BY BATCH
  async logsByBatch(req, res) {
    try {
      const { batch_id } = req.params;

      const logs = await InventoryTransaction.findAll({
        where: { inventory_id: batch_id },
        include: [{ model: User, attributes: ["full_name", "role"] }],
        order: [["occurred_at", "DESC"]],
      });

      const mapped = logs.map((log) => {
        let icon = "bi bi-info-circle";
        let title = "Hoạt động";

        switch (log.tx_type) {
          case "IN":
            icon = "bi bi-box-arrow-in-down";
            title = "Nhập kho";
            break;
          case "OUT":
            icon = "bi bi-arrow-up-circle";
            title = "Xuất kho";
            break;
          case "ADJUST":
            icon = "bi bi-pencil-square";
            title = "Điều chỉnh";
            break;
          case "EXPIRE":
            icon = "bi bi-exclamation-triangle";
            title = "Hết hạn";
            break;
        }

        return {
          icon,
          title,
          description: log.reason || "",
          actor: log.User ? log.User.full_name : "Hệ thống",
          time: log.occurred_at,
        };
      });

      return res.json({
        status: true,
        message: "Lấy nhật ký lô máu thành công",
        data: mapped,
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Lỗi lấy nhật ký lô máu",
        error: error.message,
      });
    }
  },

  // LOGS ALL
  async logsAll(req, res) {
    try {
      const logs = await InventoryTransaction.findAll({
        include: [{ model: User, attributes: ["full_name", "role"] }],
        order: [["occurred_at", "DESC"]],
      });

      const mapped = logs.map((log) => {
        const mapAction = {
          IN: "import",
          OUT: "export",
          ADJUST: "update",
          EXPIRE: "expire",
        };

        const mapIcon = {
          IN: "bi bi-box-arrow-in-down",
          OUT: "bi bi-arrow-up-circle",
          ADJUST: "bi bi-pencil-square",
          EXPIRE: "bi bi-exclamation-triangle",
        };

        return {
          id: log.id,
          action: mapAction[log.tx_type] || "update",
          icon: mapIcon[log.tx_type] || "bi bi-info-circle",
          batch_id: log.inventory_id,
          actor_name: log.User ? log.User.full_name : "Hệ thống",
          actor_role: log.User ? log.User.role : "system",
          actor_avatar: null,
          time: log.occurred_at,
          notes: log.reason || "",
        };
      });

      return res.json({
        status: true,
        message: "Lấy nhật ký kho máu thành công",
        data: mapped,
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Lỗi lấy nhật ký kho máu",
        error: error.message,
      });
    }
  },

  // EXPORT
  async export(req, res) {
  const t = await sequelize.transaction();

  try {
    const { blood_type_id, units, reason, inventory_id } = req.body;
    const authUser = req.user;

    if (!units || Number(units) <= 0) {
      await t.rollback();
      return res.json({
        status: false,
        message: "Số lượng xuất phải lớn hơn 0",
      });
    }

    // EXPORT BY SPECIFIC INVENTORY
    if (inventory_id) {
      const batch = await BloodInventory.findByPk(inventory_id, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!batch) {
        await t.rollback();
        return res.json({
          status: false,
          message: "Không tìm thấy lô máu cần xuất",
        });
      }

      if (isExpired(batch.expiry_date)) {
        await batch.update(
          {
            status: INVENTORY_STATUS.EXPIRED,
            quality_note: "Tự động cập nhật hết hạn do quá ngày sử dụng",
          },
          { transaction: t }
        );

        await createInventoryTx(
          {
            inventoryId: batch.id,
            userId: authUser?.userId || authUser?.id,
            txType: "EXPIRE",
            units: Number(batch.units || 0),
            reason: "Tự động cập nhật hết hạn trước khi xuất kho",
            refDonationId: batch.donation_id || null,
          },
          { transaction: t }
        );

        await t.commit();

        return res.json({
          status: false,
          message: "Túi máu đã hết hạn, không thể xuất kho",
        });
      }

      if (batch.status === INVENTORY_STATUS.TESTING) {
        await t.rollback();
        return res.json({
          status: false,
          message: "Túi máu đang kiểm định, chưa thể xuất kho",
        });
      }

      if (batch.status === INVENTORY_STATUS.DISCARDED) {
        await t.rollback();
        return res.json({
          status: false,
          message: "Túi máu đã bị loại bỏ, không thể xuất kho sử dụng",
        });
      }

      if (batch.status === INVENTORY_STATUS.EXPIRED) {
        await t.rollback();
        return res.json({
          status: false,
          message: "Túi máu đã hết hạn, không thể xuất kho",
        });
      }

      const currentUnits = Number(batch.units || 0);
      const take = Number(units);

      if (currentUnits <= 0 || take > currentUnits) {
        await t.rollback();
        return res.json({
          status: false,
          message: "Không đủ số lượng túi trong lô này để xuất",
        });
      }

      const newUnits = currentUnits - take;

      await batch.update({ units: newUnits }, { transaction: t });

      await createInventoryTx(
        {
          inventoryId: batch.id,
          userId: authUser?.userId || authUser?.id,
          txType: "OUT",
          units: take,
          reason:
            reason ||
            `Xuất ${take} túi từ lô id=${batch.id} để sử dụng`,
        },
        { transaction: t }
      );

      await t.commit();

      return res.json({
        status: true,
        message: "Xuất túi máu từ lô thành công",
      });
    }

    // EXPORT BY BLOOD TYPE
    if (!blood_type_id) {
      await t.rollback();
      return res.json({
        status: false,
        message: "Thiếu thông tin nhóm máu hoặc lô máu để xuất",
      });
    }

    const today = normalizeDate(new Date());

    const batches = await BloodInventory.findAll({
      where: {
        blood_type_id,
        status: INVENTORY_STATUS.AVAILABLE,
        units: { [Op.gt]: 0 },
        expiry_date: { [Op.gte]: today },
      },
      order: [
        ["expiry_date", "ASC"],
        ["id", "ASC"],
      ],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!batches.length) {
      await t.rollback();
      return res.json({
        status: false,
        message: "Không còn túi máu khả dụng phù hợp để xuất",
      });
    }

    let remaining = Number(units);

    for (const batch of batches) {
      if (remaining <= 0) break;

      if (isExpired(batch.expiry_date)) {
        await batch.update(
          {
            status: INVENTORY_STATUS.EXPIRED,
            quality_note: "Tự động cập nhật hết hạn do quá ngày sử dụng",
          },
          { transaction: t }
        );

        await createInventoryTx(
          {
            inventoryId: batch.id,
            userId: authUser?.userId || authUser?.id,
            txType: "EXPIRE",
            units: Number(batch.units || 0),
            reason: "Tự động cập nhật hết hạn trong quá trình xuất kho",
            refDonationId: batch.donation_id || null,
          },
          { transaction: t }
        );

        continue;
      }

      const take = Math.min(Number(batch.units), remaining);
      const newUnits = Number(batch.units) - take;

      await batch.update({ units: newUnits }, { transaction: t });

      await createInventoryTx(
        {
          inventoryId: batch.id,
          userId: authUser?.userId || authUser?.id,
          txType: "OUT",
          units: take,
          reason:
            reason ||
            `Xuất ${take} túi khả dụng từ lô id=${batch.id} (blood_type_id=${blood_type_id})`,
        },
        { transaction: t }
      );

      remaining -= take;
    }

    if (remaining > 0) {
      await t.rollback();
      return res.json({
        status: false,
        message: "Không đủ số lượng túi máu khả dụng để xuất",
      });
    }

    await t.commit();

    return res.json({ status: true, message: "Xuất túi máu thành công" });
  } catch (error) {
    await t.rollback();

    return res.status(500).json({
      status: false,
      message: "Lỗi xuất túi máu",
      error: error.message,
    });
  }
},
};