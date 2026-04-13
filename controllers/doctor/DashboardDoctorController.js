// controllers/doctor/DoctorDashboardController.js
"use strict";

const { Op, fn, col, literal } = require("sequelize");
const models = require("../../models");

const {
  Doctor,
  Donation,
  Appointment,
  Campaign,
  DonationSite,
  BloodInventory,
  BloodType,
  InventoryTransaction,
} = models;

// ---------- helpers ----------
const pad2 = (n) => String(n).padStart(2, "0");
const toYMD = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);

const addDays = (date, days) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

const subMonths = (date, months) => {
  const d = new Date(date);
  d.setMonth(d.getMonth() - months);
  return d;
};

function parseRange(range, fromStr, toStr) {
  const now = new Date();

  if (range === "custom") {
    const from = fromStr ? new Date(`${fromStr}T00:00:00`) : subMonths(now, 1);
    const to = toStr ? new Date(`${toStr}T23:59:59`) : now;
    return { start: from, end: to };
  }

  switch (range) {
    case "1m":
      return { start: subMonths(now, 1), end: now };
    case "3m":
      return { start: subMonths(now, 3), end: now };
    case "1y":
      return { start: subMonths(now, 12), end: now };
    case "7d":
    default:
      return { start: addDays(now, -6), end: now };
  }
}

function btName(bt) {
  if (!bt) return "";
  return `${bt.abo || ""}${bt.rh || ""}`.trim();
}

function levelByUnits(units, low = 30, critical = 10) {
  if (units <= critical) return "critical";
  if (units <= low) return "low";
  return "full";
}

function buildDayLabels(start, end) {
  const s = startOfDay(new Date(start));
  const e = startOfDay(new Date(end));
  const labels = [];
  for (let d = new Date(s); d <= e; d = addDays(d, 1)) labels.push(toYMD(d));
  return labels;
}

function mapSeriesByDay(labels, rows, valueKey = "value") {
  const map = new Map(rows.map((r) => [String(r.day), Number(r[valueKey] || 0)]));
  return labels.map((d) => map.get(d) || 0);
}

const sumByDay = (rows) => {
  const m = new Map();
  for (const x of rows) m.set(x.day, (m.get(x.day) || 0) + x.value);
  return Array.from(m.entries()).map(([day, value]) => ({ day, value }));
};

function ensureModelsOrThrow() {
  const required = { BloodInventory, BloodType, InventoryTransaction, Appointment, Donation, Campaign };
  const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    const err = new Error(`Missing models: ${missing.join(", ")}. Check models/index.js export`);
    err.statusCode = 500;
    throw err;
  }
}

async function resolveDoctorContext(req) {
  const userId = req.user?.userId || req.user?.id;
  const doctorIdFromToken = req.user?.doctorId;

  let doctor = null;

  if (doctorIdFromToken && Doctor) {
    doctor = await Doctor.findByPk(doctorIdFromToken);
  }

  if (!doctor && Doctor && userId) {
    doctor = await Doctor.findOne({ where: { user_id: userId } });
  }

  const hospitalId = doctor?.hospital_id || req.user?.hospital_id || null;
  return { userId, doctorId: doctor?.id || null, hospitalId };
}

// ✅ helper sum tx units
const sumTxUnits = async ({ where, include }) => {
  const row = await InventoryTransaction.findOne({
    attributes: [[fn("SUM", col("InventoryTransaction.units")), "sum_units"]],
    where,
    include,
    raw: true,
  });
  return Number(row?.sum_units || 0);
};

module.exports = {
  // GET /doctor/dashboard
  async index(req, res) {
    try {
      ensureModelsOrThrow();

      const inventory_range = String(req.query.inventory_range || "7d");
      const appointment_range = String(req.query.appointment_range || "7d");

      const { start: invStart, end: invEnd } = parseRange(
        inventory_range,
        req.query.inventory_from,
        req.query.inventory_to
      );

      const { start: apStart, end: apEnd } = parseRange(
        appointment_range,
        req.query.appointment_from,
        req.query.appointment_to
      );

      const { hospitalId } = await resolveDoctorContext(req);

      const today = new Date();
      const today0 = startOfDay(today);
      const today23 = endOfDay(today);

      // Hospital scope: bạn muốn tính cả hospital_id NULL để match data hiện tại
      const hospitalScope = hospitalId
        ? { [Op.or]: [{ hospital_id: hospitalId }, { hospital_id: null }] }
        : {};

      // =========================
      // A) TOTAL UNITS: theo yêu cầu -> CHỈ units>0, KHÔNG lọc expiry
      // =========================
      const invWhereAll = {
        units: { [Op.gt]: 0 },
        ...hospitalScope,
      };

      const totalUnits = await BloodInventory.sum("units", { where: invWhereAll });

      // =========================
      // B) Inventory by blood type (để giống trang quản lý kho máu): units>0 (không lọc expiry)
      // =========================
      const inventoryByTypeRaw = await BloodInventory.findAll({
        where: invWhereAll,
        attributes: ["blood_type_id", [fn("SUM", col("BloodInventory.units")), "units"]],
        include: [{ model: BloodType, as: "blood_type", attributes: ["id", "abo", "rh"] }],
        group: ["blood_type_id", "blood_type.id"],
        order: [[literal("units"), "ASC"]],
      });

      const inventoryByType = inventoryByTypeRaw.map((r) => {
        const units = Number(r.get("units") || 0);
        const bt = r.blood_type;
        return {
          blood_type: { id: bt?.id, abo: bt?.abo, rh: bt?.rh, type_name: btName(bt) },
          units,
          level: levelByUnits(units),
        };
      });

      // =========================
      // C) ALERTS lowGroups: nên tính theo usable (chưa hết hạn) để cảnh báo không bị ảo
      // =========================
      const invWhereUsable = {
        ...invWhereAll,
        expiry_date: { [Op.gte]: toYMD(today0) },
      };

      const inventoryUsableRaw = await BloodInventory.findAll({
        where: invWhereUsable,
        attributes: ["blood_type_id", [fn("SUM", col("BloodInventory.units")), "units"]],
        include: [{ model: BloodType, as: "blood_type", attributes: ["id", "abo", "rh"] }],
        group: ["blood_type_id", "blood_type.id"],
        raw: false,
      });

      const inventoryUsable = inventoryUsableRaw.map((r) => {
        const units = Number(r.get("units") || 0);
        const bt = r.blood_type;
        return {
          blood_type: { id: bt?.id, abo: bt?.abo, rh: bt?.rh, type_name: btName(bt) },
          units,
          level: levelByUnits(units),
        };
      });

      const lowGroups = inventoryUsable
        .filter((x) => x.level !== "full")
        .sort((a, b) => a.units - b.units)
        .slice(0, 3);

      // =========================
      // 2) Expiring soon (within 3 days) — units > 0
      // =========================
      const expiringTo = toYMD(addDays(today0, 3));
      const expiringUnits = await BloodInventory.sum("units", {
        where: {
          ...invWhereAll,
          expiry_date: { [Op.between]: [toYMD(today0), expiringTo] },
        },
      });

      // =========================
      // 3) Appointment include scope (lọc theo hospital qua donation_site)
      // =========================
      const apIncludeSite = DonationSite
        ? [
            {
              model: DonationSite,
              as: "donation_site",
              attributes: [],
              where: hospitalId ? { hospital_id: hospitalId } : {},
              required: !!hospitalId,
            },
          ]
        : [];

      const pendingAppointments = await Appointment.count({
        where: {
          status: "REQUESTED",
          scheduled_at: { [Op.between]: [startOfDay(apStart), endOfDay(apEnd)] },
        },
        include: apIncludeSite,
      });

      // =========================
      // 4) Collected today (Donation.collected_at TODAY)
      // =========================
      const collectedToday = await Donation.sum("volume_ml", {
        where: {
          collected_at: { [Op.between]: [today0, today23] },
          ...(hospitalId ? { hospital_id: hospitalId } : {}),
        },
      });

      const topCards = [
        { key: "total_units", title: "Tổng túi máu", icon: "🩸", value: Number(totalUnits || 0), delta_pct: null },
        { key: "pending_appointments", title: "Tổng lịch chờ duyệt", icon: "⏳", value: Number(pendingAppointments || 0), delta_pct: null },
        { key: "expiring_units", title: "Máu sắp hết hạn", icon: "⏰", value: Number(expiringUnits || 0), delta_pct: null },
        { key: "collected_today_ml", title: "Tổng máu thu hôm nay", icon: "📥", value: Number(collectedToday || 0), delta_pct: null },
      ];

      // =========================
      // 5) Inventory trend: daily IN/OUT (dựa trên InventoryTransaction)
      // =========================
      const invLabels = buildDayLabels(invStart, invEnd);

      const txIncludeInventory = [
        {
          model: BloodInventory,
          attributes: [],
          where: hospitalScope,        // OR hospital_id = hospitalId OR NULL
          required: !!hospitalId,
        },
      ];

      const txDailyRaw = await InventoryTransaction.findAll({
        attributes: [
          [fn("DATE", col("InventoryTransaction.occurred_at")), "day"],
          "tx_type",
          [fn("SUM", col("InventoryTransaction.units")), "units"],
        ],
        where: {
          tx_type: { [Op.in]: ["IN", "OUT", "EXPIRE", "ADJUST"] },
          occurred_at: { [Op.between]: [startOfDay(invStart), endOfDay(invEnd)] },
        },
        include: txIncludeInventory,
        group: [fn("DATE", col("InventoryTransaction.occurred_at")), col("InventoryTransaction.tx_type")],
        raw: true,
      });

      const inRows = [];
      const outRows = [];
      for (const r of txDailyRaw) {
        const day = String(r.day);
        const units = Number(r.units || 0);
        const t = String(r.tx_type);
        if (t === "IN" || t === "ADJUST") inRows.push({ day, value: units });
        if (t === "OUT" || t === "EXPIRE") outRows.push({ day, value: units });
      }

      const invTrend = {
        range: inventory_range,
        labels: invLabels,
        in_units: mapSeriesByDay(invLabels, sumByDay(inRows), "value"),
        out_units: mapSeriesByDay(invLabels, sumByDay(outRows), "value"),
      };

      // =========================
      // 6) Appointments summary + trend (5 status)
      // =========================
      const apLabels = buildDayLabels(apStart, apEnd);

      const apTodayCount = await Appointment.count({
        where: { scheduled_at: { [Op.between]: [today0, today23] } },
        include: apIncludeSite,
      });

      const apRequestedCount = await Appointment.count({
        where: { status: "REQUESTED", scheduled_at: { [Op.between]: [startOfDay(apStart), endOfDay(apEnd)] } },
        include: apIncludeSite,
      });
      const apApprovedCount = await Appointment.count({
        where: { status: "APPROVED", scheduled_at: { [Op.between]: [startOfDay(apStart), endOfDay(apEnd)] } },
        include: apIncludeSite,
      });
      const apRejectedCount = await Appointment.count({
        where: { status: "REJECTED", scheduled_at: { [Op.between]: [startOfDay(apStart), endOfDay(apEnd)] } },
        include: apIncludeSite,
      });
      const apCompletedCount = await Appointment.count({
        where: { status: "COMPLETED", scheduled_at: { [Op.between]: [startOfDay(apStart), endOfDay(apEnd)] } },
        include: apIncludeSite,
      });
      const apCancelledCount = await Appointment.count({
        where: { status: "CANCELLED", scheduled_at: { [Op.between]: [startOfDay(apStart), endOfDay(apEnd)] } },
        include: apIncludeSite,
      });

      const apDailyRaw = await Appointment.findAll({
        attributes: [
          [fn("DATE", col("Appointment.scheduled_at")), "day"],
          [fn("SUM", literal(`CASE WHEN Appointment.status = 'REQUESTED' THEN 1 ELSE 0 END`)), "requested"],
          [fn("SUM", literal(`CASE WHEN Appointment.status = 'APPROVED' THEN 1 ELSE 0 END`)), "approved"],
          [fn("SUM", literal(`CASE WHEN Appointment.status = 'REJECTED' THEN 1 ELSE 0 END`)), "rejected"],
          [fn("SUM", literal(`CASE WHEN Appointment.status = 'COMPLETED' THEN 1 ELSE 0 END`)), "completed"],
          [fn("SUM", literal(`CASE WHEN Appointment.status = 'CANCELLED' THEN 1 ELSE 0 END`)), "cancelled"],
        ],
        where: { scheduled_at: { [Op.between]: [startOfDay(apStart), endOfDay(apEnd)] } },
        include: apIncludeSite,
        group: [fn("DATE", col("Appointment.scheduled_at"))],
        raw: true,
      });

      const appointmentTrend = {
        range: appointment_range,
        labels: apLabels,
        requested: mapSeriesByDay(apLabels, apDailyRaw.map((x) => ({ day: x.day, value: Number(x.requested || 0) }))),
        approved: mapSeriesByDay(apLabels, apDailyRaw.map((x) => ({ day: x.day, value: Number(x.approved || 0) }))),
        rejected: mapSeriesByDay(apLabels, apDailyRaw.map((x) => ({ day: x.day, value: Number(x.rejected || 0) }))),
        completed: mapSeriesByDay(apLabels, apDailyRaw.map((x) => ({ day: x.day, value: Number(x.completed || 0) }))),
        cancelled: mapSeriesByDay(apLabels, apDailyRaw.map((x) => ({ day: x.day, value: Number(x.cancelled || 0) }))),
      };

      // =========================
      // 7) Campaigns upcoming
      // =========================
      const next30 = toYMD(addDays(today0, 30));

      const campaigns = await Campaign.findAll({
        where: {
          approval_status: "approved",
          start_date: { [Op.between]: [toYMD(today0), next30] },
          ...(hospitalId ? { hospital_id: hospitalId } : {}),
        },
        include: DonationSite
          ? [{ model: DonationSite, as: "donation_site", attributes: ["id", "name", "address"], required: false }]
          : [],
        order: [["start_date", "ASC"]],
        limit: 5,
      });

      const upcomingCampaigns = campaigns.map((c) => ({
        id: c.id,
        title: c.title,
        start_date: c.start_date,
        end_date: c.end_date,
        is_emergency: !!c.is_emergency,
        locate_type: c.locate_type,
        location: c.location,
        donation_site: c.donation_site
          ? { id: c.donation_site.id, name: c.donation_site.name, address: c.donation_site.address }
          : null,
        approval_status: c.approval_status,
      }));

      // =========================
      // 8) Notifications
      // =========================
      const notifications = [];

      if (lowGroups.length) {
        const first = lowGroups[0];
        notifications.push({
          type: "LOW_INVENTORY",
          severity: first.level === "critical" ? "danger" : "warning",
          message: `Thiếu máu ${first.blood_type.type_name || "?"}: còn ${first.units} túi (chưa hết hạn)`,
          meta: { blood_type_id: first.blood_type.id, units: first.units, level: first.level },
        });
      }

      if (Number(expiringUnits || 0) > 0) {
        notifications.push({
          type: "EXPIRING_SOON",
          severity: "warning",
          message: `Lô máu sắp hết hạn: ${Number(expiringUnits)} túi trong 3 ngày`,
          meta: { units: Number(expiringUnits), within_days: 3 },
        });
      }

      return res.json({
        status: true,
        data: {
          hospital_id: hospitalId,
          alerts: {
            lowGroups, // usable only
            expiring: { units: Number(expiringUnits || 0), within_days: 3 },
          },
          topCards,
          inventory: { byType: inventoryByType, trend: invTrend },
          appointments: {
            summary: {
              today: apTodayCount,
              requested: apRequestedCount,
              approved: apApprovedCount,
              rejected: apRejectedCount,
              completed: apCompletedCount,
              cancelled: apCancelledCount,
            },
            trend: appointmentTrend,
          },
          campaigns: { upcoming: upcomingCampaigns },
          notifications,
        },
      });
    } catch (err) {
      console.error("[DoctorDashboardController] error:", err);
      return res.status(err.statusCode || 500).json({
        status: false,
        message: err.message || "Server error",
      });
    }
  },
};
