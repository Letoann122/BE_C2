"use strict";

const {
  BloodInventory,
  BloodType,
  InventoryTransaction,
  User,
  Hospital,
  sequelize,
} = require("../../models");
const { Op, fn, col } = require("sequelize");

function toDateOnlyString(d) {
  const x = new Date(d);
  const yyyy = x.getFullYear();
  const mm = String(x.getMonth() + 1).padStart(2, "0");
  const dd = String(x.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function buildBloodTypeLabel(bt) {
  if (!bt) return "-";
  const abo = bt.abo || "";
  const rh = bt.rh || "";
  return `${abo}${rh}`.trim() || "-";
}

module.exports = {
  async getDashboard(req, res) {
    try {
      const range = Math.max(1, parseInt(req.query.range) || 7);

      const now = new Date();
      const start = new Date(now);
      start.setDate(start.getDate() - (range - 1));
      start.setHours(0, 0, 0, 0);

      // expiring: trong 7 ngày tới
      const expStart = new Date(now);
      expStart.setHours(0, 0, 0, 0);

      const expEnd = new Date(now);
      expEnd.setDate(expEnd.getDate() + 7);
      expEnd.setHours(23, 59, 59, 999);

      const expStartStr = toDateOnlyString(expStart);
      const expEndStr = toDateOnlyString(expEnd);

      // =========================
      // 1) Cards
      // =========================
      const [totalUnits, expiringUnits] = await Promise.all([
        BloodInventory.sum("units"),
        BloodInventory.sum("units", {
          where: { expiry_date: { [Op.between]: [expStartStr, expEndStr] } },
        }),
      ]);

      const [inUnits, outUnits] = await Promise.all([
        InventoryTransaction.sum("units", {
          where: {
            tx_type: "IN",
            occurred_at: { [Op.gte]: start },
          },
        }),
        InventoryTransaction.sum("units", {
          where: {
            tx_type: "OUT",
            occurred_at: { [Op.gte]: start },
          },
        }),
      ]);

      // =========================
      // 2) Inventory summary by BloodType (3 cột)
      // =========================
      const inventoryAgg = await BloodInventory.findAll({
        attributes: [
          "blood_type_id",
          [fn("SUM", col("units")), "total_units"],
          [
            sequelize.literal(
              `SUM(CASE WHEN expiry_date BETWEEN '${expStartStr}' AND '${expEndStr}' THEN units ELSE 0 END)`
            ),
            "expiring_units",
          ],
        ],
        include: [
          {
            model: BloodType,
            as: "blood_type",
            attributes: ["abo", "rh"],
          },
        ],
        group: ["blood_type_id", "blood_type.id"],
        order: [[sequelize.literal("total_units"), "DESC"]],
      });

      const inventory = inventoryAgg.map((r) => ({
        blood_type: buildBloodTypeLabel(r.blood_type),
        total_units: Number(r.get("total_units") || 0),
        expiring_units: Number(r.get("expiring_units") || 0),
      }));

      // =========================
      // 3) Latest batches + người nhập + donor_username (thực ra là full_name/email)
      // =========================
      const latest = await BloodInventory.findAll({
        limit: 10,
        order: [["donation_date", "DESC"]],
        include: [
          {
            model: BloodType,
            as: "blood_type",
            attributes: ["abo", "rh"],
          },
          {
            model: Hospital,
            as: "hospital",
            attributes: ["id", "name"],
            required: false,
          },
        ],
      });

      // Người nhập: lấy transaction IN gần nhất theo inventory_id
      const batchIds = latest.map((x) => x.id);
      const importerMap = new Map();

      if (batchIds.length > 0) {
        const inTxs = await InventoryTransaction.findAll({
          where: {
            inventory_id: { [Op.in]: batchIds },
            tx_type: "IN",
          },
          include: [{ model: User, attributes: ["id", "full_name", "email", "role"] }],
          order: [["occurred_at", "DESC"]],
        });

        for (const tx of inTxs) {
          if (!importerMap.has(tx.inventory_id)) {
            importerMap.set(
              tx.inventory_id,
              tx.User ? { id: tx.User.id, full_name: tx.User.full_name } : null
            );
          }
        }
      }

      /**
       * donor_username:
       * DB của bạn KHÔNG có users.username -> dùng users.full_name (fallback email)
       * JOIN blood_inventory.donation_id -> donations.id -> donations.donor_user_id -> users.id
       */
      const donorUsernameMap = new Map();
      const donationIds = latest
        .map((b) => b.donation_id)
        .filter((x) => x !== null && x !== undefined);

      if (donationIds.length > 0) {
        const [rows] = await sequelize.query(
          `
            SELECT 
              d.id AS donation_id,
              COALESCE(u.full_name, u.email) AS donor_username
            FROM donations d
            LEFT JOIN users u ON u.id = d.donor_user_id
            WHERE d.id IN (:donationIds)
          `,
          { replacements: { donationIds } }
        );

        for (const r of rows || []) {
          donorUsernameMap.set(Number(r.donation_id), r.donor_username || null);
        }
      }

      const latest_batches = latest.map((b) => ({
        id: b.id,
        blood_type: buildBloodTypeLabel(b.blood_type),
        units: b.units,
        donation_date: b.donation_date,
        expiry_date: b.expiry_date,
        donation_id: b.donation_id ?? null,
        hospital_name: b.hospital?.name || null,
        imported_by: importerMap.get(b.id) || null,
        donor_username: b.donation_id
          ? donorUsernameMap.get(Number(b.donation_id)) || null
          : null,
      }));

      // =========================
      // 4) Transactions IN/OUT + bởi (bác sĩ nào làm)
      // =========================
      const txRows = await InventoryTransaction.findAll({
        limit: 80,
        where: { tx_type: { [Op.in]: ["IN", "OUT"] } },
        include: [
          { model: User, attributes: ["id", "full_name", "email", "role"] },
          {
            model: BloodInventory,
            attributes: ["id", "donation_date", "expiry_date", "blood_type_id"],
            include: [
              {
                model: BloodType,
                as: "blood_type",
                attributes: ["abo", "rh"],
              },
            ],
          },
        ],
        order: [["occurred_at", "DESC"]],
      });

      const transactions = txRows.map((tx) => ({
        id: tx.id,
        tx_type: tx.tx_type,
        units: tx.units,
        reason: tx.reason,
        occurred_at: tx.occurred_at,
        by: tx.User ? { id: tx.User.id, full_name: tx.User.full_name } : null,
        inventory_id: tx.inventory_id,
        blood_type: buildBloodTypeLabel(tx.BloodInventory?.blood_type),
        batch_donation_date: tx.BloodInventory?.donation_date || null,
        batch_expiry_date: tx.BloodInventory?.expiry_date || null,
      }));

      // =========================
      // 5) Chart series (IN/OUT) theo ngày
      // =========================
      const txAgg = await InventoryTransaction.findAll({
        attributes: [
          [fn("DATE", col("occurred_at")), "day"],
          "tx_type",
          [fn("SUM", col("units")), "sum_units"],
        ],
        where: {
          tx_type: { [Op.in]: ["IN", "OUT"] },
          occurred_at: { [Op.gte]: start },
        },
        group: [fn("DATE", col("occurred_at")), "tx_type"],
        order: [[sequelize.literal("day"), "ASC"]],
      });

      const labels = [];
      const dayKeyList = [];
      const tmp = new Date(start);

      for (let i = 0; i < range; i++) {
        const key = toDateOnlyString(tmp);
        dayKeyList.push(key);
        labels.push(tmp.toLocaleDateString("vi-VN"));
        tmp.setDate(tmp.getDate() + 1);
      }

      const in_series = new Array(range).fill(0);
      const out_series = new Array(range).fill(0);

      for (const r of txAgg) {
        const day = String(r.get("day"));
        const type = r.get("tx_type");
        const sum = Number(r.get("sum_units") || 0);

        const idx = dayKeyList.indexOf(day);
        if (idx >= 0) {
          if (type === "IN") in_series[idx] = sum;
          if (type === "OUT") out_series[idx] = sum;
        }
      }

      return res.status(200).json({
        status: true,
        message: "Tải dashboard kho máu thành công!",
        data: {
          cards: {
            total_units: Number(totalUnits || 0),
            in_units: Number(inUnits || 0),
            out_units: Number(outUnits || 0),
            expiring_units: Number(expiringUnits || 0),
          },
          inventory,
          latest_batches,
          transactions,
          chart: { labels, in_series, out_series },
        },
      });
    } catch (error) {
      console.error("❌ Lỗi getDashboard (Admin Blood Inventory):", error);
      return res.status(500).json({
        status: false,
        message: "Lỗi server khi tải dashboard kho máu!",
        error: error.message,
      });
    }
  },
};
