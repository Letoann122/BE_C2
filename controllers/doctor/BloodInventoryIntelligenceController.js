"use strict";

const {
  BloodInventory,
  BloodType,
  InventoryTransaction,
  User,
  Doctor,
  Donation,
  Appointment,
  DonationSite,
  Campaign,
  EmergencyRequest,
  sequelize,
} = require("../../models");
const { Op } = require("sequelize");

const SAFE_THRESHOLDS = {
  CRITICAL: 3,
  LOW: 8,
  OVERSTOCK: 30,
  EXPIRING_DAYS: 7,
  FORECAST_DAYS: 7,
};

const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

function normalizeDate(d) {
  if (!d) return null;
  const s = typeof d === "string" ? d.slice(0, 10) : null;

  if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [year, month, day] = s.split("-").map(Number);
    const dt = new Date(year, month - 1, day);
    dt.setHours(0, 0, 0, 0);
    return dt;
  }

  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function formatDateDMY(d) {
  if (!d) return "";

  if (typeof d === "string") {
    const onlyDate = d.slice(0, 10);
    const parts = onlyDate.split("-");
    if (parts.length === 3) {
      const [year, month, day] = parts;
      return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
    }
  }

  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";

  const day = String(dt.getDate()).padStart(2, "0");
  const month = String(dt.getMonth() + 1).padStart(2, "0");
  const year = dt.getFullYear();
  return `${day}/${month}/${year}`;
}

function diffDays(date) {
  const today = normalizeDate(new Date());
  const target = normalizeDate(date);
  if (!today || !target) return null;
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function todayDateOnly() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function expiredWarningText(daysLeft) {
  if (daysLeft === null) return "Không rõ số ngày quá hạn";
  const overdueDays = Math.abs(Number(daysLeft || 0));
  if (overdueDays <= 0) return "Hết hạn hôm nay";
  return `Đã quá hạn ${overdueDays} ngày`;
}

function getBloodGroup(batch) {
  return `${batch?.blood_type?.abo || ""}${batch?.blood_type?.rh || ""}`;
}

function classifyInventory(availableUnits, expiringCount = 0, expiredUnits = 0) {
  if (Number(availableUnits || 0) <= SAFE_THRESHOLDS.CRITICAL) return "critical";
  if (Number(expiredUnits || 0) > 0) return "critical";
  if (Number(expiringCount || 0) > 0) return "expiring_risk";
  if (Number(availableUnits || 0) <= SAFE_THRESHOLDS.LOW) return "low";
  if (Number(availableUnits || 0) >= SAFE_THRESHOLDS.OVERSTOCK) return "overstock";
  return "normal";
}

function statusText(status) {
  return {
    critical: "Nguy cấp",
    low: "Thấp",
    normal: "Ổn định",
    overstock: "Dư thừa",
    expiring_risk: "Rủi ro hết hạn",
  }[status] || "Không xác định";
}

function batchExpiryStatus(batch) {
  const units = Number(batch?.units || 0);
  const days = diffDays(batch?.expiry_date);

  if (units <= 0) {
    return {
      key: "empty",
      label: "Đã xuất hết",
      days_left: days,
      priority: 99,
    };
  }

  if (days === null) {
    return {
      key: "unknown",
      label: "Không rõ hạn",
      days_left: null,
      priority: 98,
    };
  }

  if (days < 0) {
    return {
      key: "expired",
      label: "Đã hết hạn",
      days_left: days,
      priority: 1,
    };
  }

  if (days <= SAFE_THRESHOLDS.EXPIRING_DAYS) {
    return {
      key: "expiring_soon",
      label: `Sắp hết hạn (${days} ngày)`,
      days_left: days,
      priority: 2,
    };
  }

  return {
    key: "valid",
    label: "Còn hạn",
    days_left: days,
    priority: 3,
  };
}

function toPlainBatch(batch) {
  const json = batch?.toJSON ? batch.toJSON() : batch;
  const group = getBloodGroup(json);
  const expiry = batchExpiryStatus(json);

  return {
    ...json,
    blood_group: group,
    donation_date_fmt: formatDateDMY(json?.donation_date),
    expiry_date_fmt: formatDateDMY(json?.expiry_date),
    expiry_status: expiry.key,
    expiry_label: expiry.label,
    days_left: expiry.days_left,
    fefo_priority: expiry.priority,
  };
}

async function getInventoryRows() {
  return BloodInventory.findAll({
    include: [{ model: BloodType, as: "blood_type", attributes: ["id", "abo", "rh"] }],
    order: [
      ["expiry_date", "ASC"],
      ["id", "ASC"],
    ],
  });
}

function buildGroups(rows, usageMap = {}) {
  const groups = {};

  BLOOD_GROUPS.forEach((group) => {
    groups[group] = {
      blood_group: group,
      blood_type_id: null,
      available_units: 0,
      testing_units: 0,
      discarded_units: 0,
      expired_units: 0,
      total_units: 0,
      available_batches: 0,
      testing_batches: 0,
      expiring_batches: 0,
      expired_batches: 0,
      earliest_expiry: null,
      earliest_expiry_fmt: "",
      status: "critical",
      status_text: "Nguy cấp",
      avg_daily_usage_7d: 0,
      days_remaining: null,
      fefo_batch: null,
      recommendation: "",
      campaign_suggestion: "",
    };
  });

  rows.forEach((batch) => {
    const json = toPlainBatch(batch);
    const group = json.blood_group;
    if (!group || !groups[group]) return;

    const g = groups[group];
    g.blood_type_id = json.blood_type_id;

    const units = Number(json.units || 0);
    g.total_units += units;

    if (json.status === "available") {
      if (json.expiry_status === "expired") {
        g.expired_units += units;
        g.expired_batches += 1;
      } else {
        g.available_units += units;
        g.available_batches += 1;

        if (json.expiry_status === "expiring_soon") {
          g.expiring_batches += 1;
        }

        if (units > 0 && !g.fefo_batch) {
          g.fefo_batch = {
            id: json.id,
            code: `BL${String(json.id).padStart(6, "0")}`,
            units: json.units,
            expiry_date: json.expiry_date,
            expiry_date_fmt: json.expiry_date_fmt,
            days_left: json.days_left,
          };
        }

        const exp = normalizeDate(json.expiry_date);
        if (exp && (!g.earliest_expiry || exp < normalizeDate(g.earliest_expiry))) {
          g.earliest_expiry = json.expiry_date;
          g.earliest_expiry_fmt = json.expiry_date_fmt;
        }
      }
    }

    if (json.status === "testing") {
      g.testing_units += units;
      g.testing_batches += 1;
    }

    if (json.status === "discarded") {
      g.discarded_units += units;
    }

    if (json.status === "expired") {
      g.expired_units += units;
      g.expired_batches += 1;
    }
  });

  Object.values(groups).forEach((g) => {
    const avgUsage = Number(usageMap[g.blood_group] || 0);
    g.avg_daily_usage_7d = Number(avgUsage.toFixed(2));
    g.days_remaining = avgUsage > 0 ? Number((g.available_units / avgUsage).toFixed(1)) : null;
    g.status = classifyInventory(g.available_units, g.expiring_batches, g.expired_units);
    g.status_text = statusText(g.status);

    if (g.status === "critical") {
      g.recommendation = `Nhóm máu ${g.blood_group} đang ở mức nguy cấp. Nên tạo yêu cầu hiến máu khẩn cấp hoặc gửi thông báo đến donor phù hợp.`;
      g.campaign_suggestion = `Tạo chiến dịch khẩn cấp bổ sung nhóm máu ${g.blood_group}.`;
    } else if (g.status === "low") {
      g.recommendation = `Nhóm máu ${g.blood_group} đang thấp. Nên theo dõi và cân nhắc tạo chiến dịch bổ sung.`;
      g.campaign_suggestion = `Lên kế hoạch chiến dịch bổ sung nhóm máu ${g.blood_group}.`;
    } else if (g.status === "expiring_risk") {
      g.recommendation = `Có lô máu ${g.blood_group} sắp hết hạn. Ưu tiên sử dụng lô có hạn dùng gần nhất.`;
      g.campaign_suggestion = "Chưa cần tạo chiến dịch mới, ưu tiên điều phối lô gần hết hạn.";
    } else if (g.status === "overstock") {
      g.recommendation = `Nhóm máu ${g.blood_group} đang dư tương đối. Nên ưu tiên sử dụng lô gần hết hạn trước khi nhập thêm.`;
      g.campaign_suggestion = "Không nên tạo chiến dịch bổ sung cho nhóm này lúc này.";
    } else {
      g.recommendation = `Nhóm máu ${g.blood_group} đang ổn định.`;
      g.campaign_suggestion = "Chưa cần hành động khẩn cấp.";
    }
  });

  return Object.values(groups);
}

async function getUsageMap() {
  const since = new Date();
  since.setDate(since.getDate() - SAFE_THRESHOLDS.FORECAST_DAYS);

  const logs = await InventoryTransaction.findAll({
    where: {
      tx_type: "OUT",
      occurred_at: { [Op.gte]: since },
    },
    include: [
      {
        model: BloodInventory,
        include: [{ model: BloodType, as: "blood_type", attributes: ["abo", "rh"] }],
      },
    ],
  });

  const totalMap = {};

  logs.forEach((log) => {
    const group = `${log.BloodInventory?.blood_type?.abo || ""}${log.BloodInventory?.blood_type?.rh || ""}`;
    if (!group) return;
    totalMap[group] = Number(totalMap[group] || 0) + Number(log.units || 0);
  });

  const usageMap = {};
  Object.keys(totalMap).forEach((group) => {
    usageMap[group] = Number(totalMap[group] || 0) / SAFE_THRESHOLDS.FORECAST_DAYS;
  });

  return usageMap;
}

async function getDoctorProfile(req, transaction = null) {
  const userId = req.user?.userId || req.user?.id;
  if (!userId) return null;
  return Doctor.findOne({ where: { user_id: userId }, transaction });
}

async function findBloodTypeByGroup(group) {
  const text = String(group || "").trim().toUpperCase();
  if (!text) return null;
  const abo = text.slice(0, -1);
  const rh = text.slice(-1);
  return BloodType.findOne({ where: { abo, rh } });
}

function getOverviewStats(groups, rows) {
  const plainRows = rows.map(toPlainBatch);
  const pendingExpiredRows = plainRows.filter(
    (b) =>
      b.expiry_status === "expired" &&
      !["expired", "discarded"].includes(b.status) &&
      Number(b.units || 0) > 0
  );

  return {
    total_available_units: groups.reduce((sum, g) => sum + Number(g.available_units || 0), 0),
    total_testing_units: groups.reduce((sum, g) => sum + Number(g.testing_units || 0), 0),
    total_expiring_batches: groups.reduce((sum, g) => sum + Number(g.expiring_batches || 0), 0),
    total_expired_units: groups.reduce((sum, g) => sum + Number(g.expired_units || 0), 0),
    total_expired_batches: groups.reduce((sum, g) => sum + Number(g.expired_batches || 0), 0),
    pending_expired_batches: pendingExpiredRows.length,
    pending_expired_units: pendingExpiredRows.reduce((sum, b) => sum + Number(b.units || 0), 0),
    critical_groups: groups.filter((g) => g.status === "critical").length,
    low_groups: groups.filter((g) => g.status === "low").length,
    overstock_groups: groups.filter((g) => g.status === "overstock").length,
    total_batches: rows.length,
  };
}

module.exports = {
  async dashboard(req, res) {
    try {
      const rows = await getInventoryRows();
      const usageMap = await getUsageMap();
      const groups = buildGroups(rows, usageMap);
      const plainRows = rows.map(toPlainBatch);

      const expiringBatches = plainRows
        .filter((b) => b.status === "available" && b.expiry_status === "expiring_soon" && Number(b.units || 0) > 0)
        .sort((a, b) => Number(a.days_left || 999) - Number(b.days_left || 999))
        .slice(0, 10);

      const fefoSuggestions = plainRows
        .filter((b) => b.status === "available" && b.expiry_status !== "expired" && Number(b.units || 0) > 0)
        .sort((a, b) => {
          const da = Number(a.days_left ?? 9999);
          const db = Number(b.days_left ?? 9999);
          if (da !== db) return da - db;
          return Number(a.id) - Number(b.id);
        })
        .slice(0, 10)
        .map((b) => ({
          id: b.id,
          code: `BL${String(b.id).padStart(6, "0")}`,
          blood_group: b.blood_group,
          units: b.units,
          expiry_date: b.expiry_date,
          expiry_date_fmt: b.expiry_date_fmt,
          days_left: b.days_left,
          suggestion: `Ưu tiên dùng lô ${`BL${String(b.id).padStart(6, "0")}`} theo nguyên tắc hết hạn trước - dùng trước vì còn ${b.days_left} ngày hết hạn.`,
        }));

      return res.json({
        status: true,
        message: "Lấy dashboard kho máu thông minh thành công",
        data: {
          thresholds: SAFE_THRESHOLDS,
          overview: getOverviewStats(groups, rows),
          groups,
          expiring_batches: expiringBatches,
          fefo_suggestions: fefoSuggestions,
          quick_filters: [
            { key: "testing", label: "Đang chờ xét nghiệm" },
            { key: "expiring", label: "Sắp hết hạn" },
            { key: "expired", label: "Đã hết hạn" },
            { key: "critical", label: "Nhóm máu nguy cấp" },
            { key: "available", label: "Lô khả dụng" },
          ],
        },
      });
    } catch (error) {
      console.error("BloodInventoryIntelligence.dashboard error:", error);
      return res.status(500).json({
        status: false,
        message: "Không tải được dashboard kho máu thông minh",
        error: error.message,
      });
    }
  },

  async groupDetail(req, res) {
    try {
      const bloodGroup = String(req.params.blood_group || "").trim().toUpperCase();
      const rows = await getInventoryRows();
      const usageMap = await getUsageMap();
      const groups = buildGroups(rows, usageMap);
      const group = groups.find((g) => g.blood_group === bloodGroup);

      const batches = rows
        .map(toPlainBatch)
        .filter((b) => b.blood_group === bloodGroup)
        .sort((a, b) => {
          const da = Number(a.days_left ?? 9999);
          const db = Number(b.days_left ?? 9999);
          if (a.status === "available" && b.status !== "available") return -1;
          if (a.status !== "available" && b.status === "available") return 1;
          if (da !== db) return da - db;
          return Number(a.id) - Number(b.id);
        });

      if (!group) {
        return res.status(404).json({ status: false, message: "Không tìm thấy nhóm máu" });
      }

      return res.json({
        status: true,
        message: "Lấy chi tiết nhóm máu thành công",
        data: {
          group,
          batches,
          fefo_batch: batches.find((b) => b.status === "available" && b.expiry_status !== "expired" && Number(b.units || 0) > 0) || null,
          filters: {
            statuses: ["all", "available", "testing", "discarded", "expired"],
            expiry: ["all", "valid", "expiring_soon", "expired", "empty"],
          },
        },
      });
    } catch (error) {
      console.error("BloodInventoryIntelligence.groupDetail error:", error);
      return res.status(500).json({
        status: false,
        message: "Không tải được chi tiết nhóm máu",
        error: error.message,
      });
    }
  },

  async batchDetail(req, res) {
    try {
      const { id } = req.params;

      const batch = await BloodInventory.findByPk(id, {
        include: [
          { model: BloodType, as: "blood_type", attributes: ["id", "abo", "rh"] },
          {
            model: Donation,
            as: "donation",
            required: false,
            include: [
              { model: User, as: "donor", required: false, attributes: ["id", "full_name", "email", "phone", "blood_group"] },
              { model: BloodType, as: "blood_type", required: false, attributes: ["abo", "rh"] },
              {
                model: Appointment,
                required: false,
                include: [
                  { model: User, as: "donor", required: false, attributes: ["id", "full_name", "email", "phone", "blood_group"] },
                  { model: DonationSite, as: "donation_site", required: false, attributes: ["id", "name", "address"] },
                  { model: Campaign, as: "campaign", required: false, attributes: ["id", "title", "status", "approval_status"] },
                ],
              },
            ],
          },
          { model: Doctor, as: "tested_by_doctor", required: false, attributes: ["id", "full_name", "email", "phone"] },
        ],
      });

      if (!batch) {
        return res.status(404).json({ status: false, message: "Không tìm thấy lô máu" });
      }

      const logs = await InventoryTransaction.findAll({
        where: { inventory_id: id },
        include: [{ model: User, attributes: ["full_name", "role"] }],
        order: [["occurred_at", "ASC"]],
      });

      const plain = toPlainBatch(batch);
      const donation = plain.donation || null;
      const appointment = donation?.Appointment || donation?.appointment || null;
      const donor = donation?.donor || appointment?.donor || null;

      const timeline = [
        {
          type: "batch_created",
          title: "Tạo lô máu",
          description: `Lô ${`BL${String(plain.id).padStart(6, "0")}`} được tạo trong kho`,
          icon: "bi bi-box-seam",
          time: plain.created_at,
          actor: "Hệ thống",
        },
        ...logs.map((log) => ({
          type: log.tx_type,
          title: {
            IN: "Nhập kho",
            OUT: "Xuất kho",
            ADJUST: "Điều chỉnh",
            EXPIRE: "Hết hạn",
          }[log.tx_type] || "Hoạt động kho",
          description: log.reason || "",
          icon: {
            IN: "bi bi-box-arrow-in-down",
            OUT: "bi bi-box-arrow-up",
            ADJUST: "bi bi-pencil-square",
            EXPIRE: "bi bi-exclamation-triangle",
          }[log.tx_type] || "bi bi-info-circle",
          time: log.occurred_at,
          actor: log.User?.full_name || "Hệ thống",
        })),
      ].filter((item) => item.time);

      return res.json({
        status: true,
        message: "Lấy chi tiết lô máu thông minh thành công",
        data: {
          batch: plain,
          traceability: {
            donor: donor
              ? {
                  id: donor.id,
                  full_name: donor.full_name,
                  email: donor.email,
                  phone: donor.phone,
                  blood_group: donor.blood_group,
                }
              : null,
            appointment: appointment
              ? {
                  id: appointment.id,
                  appointment_code: appointment.appointment_code,
                  scheduled_at: appointment.scheduled_at,
                  scheduled_at_fmt: formatDateDMY(appointment.scheduled_at),
                  status: appointment.status,
                }
              : null,
            donation: donation
              ? {
                  id: donation.id,
                  volume_ml: donation.volume_ml,
                  collected_at: donation.collected_at,
                  collected_at_fmt: formatDateDMY(donation.collected_at),
                  screened_ok: donation.screened_ok,
                }
              : null,
            donation_site: appointment?.donation_site || null,
            campaign: appointment?.campaign || null,
            tested_by_doctor: plain.tested_by_doctor || null,
          },
          expiry: batchExpiryStatus(plain),
          fefo: {
            should_prioritize: plain.status === "available" && plain.expiry_status === "expiring_soon" && Number(plain.units || 0) > 0,
            suggestion:
              plain.status === "available" && Number(plain.units || 0) > 0
                ? `Lô này nên được ưu tiên theo hạn sử dụng ${plain.expiry_date_fmt}.`
                : "Lô này không nằm trong danh sách lô khả dụng cần ưu tiên theo hạn dùng.",
          },
          timeline,
        },
      });
    } catch (error) {
      console.error("BloodInventoryIntelligence.batchDetail error:", error);
      return res.status(500).json({
        status: false,
        message: "Không tải được chi tiết lô máu thông minh",
        error: error.message,
      });
    }
  },

  async listExpiredBatches(req, res) {
    try {
      const today = todayDateOnly();

      const batches = await BloodInventory.findAll({
        where: {
          expiry_date: { [Op.lt]: today },
          units: { [Op.gt]: 0 },
          status: { [Op.notIn]: ["expired", "discarded"] },
        },
        include: [{ model: BloodType, as: "blood_type", attributes: ["id", "abo", "rh"] }],
        order: [
          ["expiry_date", "ASC"],
          ["id", "ASC"],
        ],
      });

      const data = batches.map((batch) => {
        const plain = toPlainBatch(batch);
        return {
          id: plain.id,
          code: `BL${String(plain.id).padStart(6, "0")}`,
          blood_type_id: plain.blood_type_id,
          blood_group: plain.blood_group,
          units: Number(plain.units || 0),
          status: plain.status,
          donation_date: plain.donation_date,
          donation_date_fmt: plain.donation_date_fmt,
          expiry_date: plain.expiry_date,
          expiry_date_fmt: plain.expiry_date_fmt,
          days_left: plain.days_left,
          overdue_days: Math.abs(Number(plain.days_left || 0)),
          warning_text: expiredWarningText(plain.days_left),
        };
      });

      return res.json({
        status: true,
        message: "Lấy danh sách lô máu hết hạn thành công",
        data: {
          summary: {
            total_batches: data.length,
            total_units: data.reduce((sum, item) => sum + Number(item.units || 0), 0),
            affected_groups: [...new Set(data.map((item) => item.blood_group).filter(Boolean))],
          },
          batches: data,
        },
      });
    } catch (error) {
      console.error("BloodInventoryIntelligence.listExpiredBatches error:", error);
      return res.status(500).json({
        status: false,
        message: "Không tải được danh sách lô máu hết hạn",
        error: error.message,
      });
    }
  },

  async processExpiredBatches(req, res) {
    const t = await sequelize.transaction();

    try {
      const today = todayDateOnly();
      const userId = req.user?.userId || req.user?.id || null;
      const inventoryIds = Array.isArray(req.body?.inventory_ids)
        ? req.body.inventory_ids.filter(Boolean)
        : [];
      const reason =
        req.body?.reason ||
        "Xác nhận loại khỏi kho khả dụng do lô máu đã hết hạn.";

      const whereCondition = {
        expiry_date: { [Op.lt]: today },
        units: { [Op.gt]: 0 },
        status: { [Op.notIn]: ["expired", "discarded"] },
      };

      if (inventoryIds.length > 0) {
        whereCondition.id = { [Op.in]: inventoryIds };
      }

      const expiredBatches = await BloodInventory.findAll({
        where: whereCondition,
        lock: t.LOCK.UPDATE,
        transaction: t,
      });

      if (!expiredBatches.length) {
        await t.rollback();
        return res.json({
          status: false,
          message: "Không có lô máu hết hạn nào cần xử lý.",
        });
      }

      let totalUnits = 0;
      const processedIds = [];

      for (const batch of expiredBatches) {
        const units = Number(batch.units || 0);
        totalUnits += units;
        processedIds.push(batch.id);

        await batch.update(
          {
            status: "expired",
            quality_note: reason,
          },
          { transaction: t }
        );

        await InventoryTransaction.create(
          {
            inventory_id: batch.id,
            user_id: userId,
            tx_type: "EXPIRE",
            units,
            reason,
            ref_donation_id: batch.donation_id || null,
            occurred_at: new Date(),
          },
          { transaction: t }
        );
      }

      await t.commit();

      return res.json({
        status: true,
        message: `Đã xử lý ${expiredBatches.length} lô máu hết hạn, tổng cộng ${totalUnits} túi.`,
        data: {
          processed_ids: processedIds,
          total_batches: expiredBatches.length,
          total_units: totalUnits,
        },
      });
    } catch (error) {
      await t.rollback();
      console.error("BloodInventoryIntelligence.processExpiredBatches error:", error);
      return res.status(500).json({
        status: false,
        message: "Không xử lý được lô máu hết hạn",
        error: error.message,
      });
    }
  },

  async createEmergencyFromInventory(req, res) {
    const t = await sequelize.transaction();

    try {
      const { blood_group, donation_site_id, required_volume_ml, needed_in_hours } = req.body;

      if (!blood_group) {
        await t.rollback();
        return res.status(400).json({ status: false, message: "Thiếu nhóm máu cần cảnh báo" });
      }

      const doctor = await getDoctorProfile(req, t);
      if (!doctor) {
        await t.rollback();
        return res.status(403).json({ status: false, message: "Không tìm thấy thông tin bác sĩ" });
      }

      const bloodType = await findBloodTypeByGroup(blood_group);
      if (!bloodType) {
        await t.rollback();
        return res.status(404).json({ status: false, message: "Không tìm thấy nhóm máu" });
      }

      let site = null;
      if (donation_site_id) {
        site = await DonationSite.findByPk(donation_site_id, { transaction: t });
      }

      if (!site) {
        site = await DonationSite.findOne({
          where: {
            ...(doctor.hospital_id ? { hospital_id: doctor.hospital_id } : {}),
            is_active: 1,
          },
          transaction: t,
        });
      }

      if (!site) {
        await t.rollback();
        return res.status(400).json({
          status: false,
          message: "Chưa có điểm tiếp nhận máu hoạt động để tạo yêu cầu khẩn cấp",
        });
      }

      const neededBefore = new Date();
      neededBefore.setHours(neededBefore.getHours() + Number(needed_in_hours || 24));

      const request = await EmergencyRequest.create(
        {
          hospital_id: site.hospital_id || doctor.hospital_id || null,
          donation_site_id: site.id,
          created_by_doctor_id: doctor.id,
          blood_type_id: bloodType.id,
          blood_group: String(blood_group).trim().toUpperCase(),
          required_volume_ml: Number(required_volume_ml || 500),
          fulfilled_volume_ml: 0,
          urgency_level: "critical",
          needed_before: neededBefore,
          title: `Khẩn cấp cần máu ${String(blood_group).trim().toUpperCase()}`,
          message: `Kho máu ${String(blood_group).trim().toUpperCase()} đang ở mức nguy cấp. ${site.name} cần donor phù hợp hỗ trợ hiến máu.`,
          status: "open",
          created_at: new Date(),
          updated_at: new Date(),
        },
        { transaction: t }
      );

      await t.commit();

      return res.status(201).json({
        status: true,
        message: "Đã tạo yêu cầu hiến máu khẩn cấp từ cảnh báo kho máu",
        data: request,
      });
    } catch (error) {
      await t.rollback();
      console.error("BloodInventoryIntelligence.createEmergencyFromInventory error:", error);
      return res.status(500).json({
        status: false,
        message: "Không tạo được yêu cầu khẩn cấp từ kho máu",
        error: error.message,
      });
    }
  },
};
