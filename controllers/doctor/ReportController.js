// controllers/doctor/DoctorReportController.js
"use strict";

const { Op, QueryTypes } = require("sequelize");
const { Doctor, Campaign, sequelize } = require("../../models");

// ===== helpers =====
const pad2 = (n) => String(n).padStart(2, "0");

const toYMD = (d) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);

const addDays = (date, days) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

const addMonths = (date, months) => {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
};

const subMonths = (date, months) => {
  const d = new Date(date);
  d.setMonth(d.getMonth() - months);
  return d;
};

// MySQL datetime string
const toDT = (d) =>
  `${toYMD(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;

// FE gửi: 7d | 1m | 3m | 1y (đôi khi 30d). Support hết.
function parseRange(range, fromStr, toStr) {
  const now = new Date();

  if (range === "custom") {
    const from = fromStr ? new Date(`${fromStr}T00:00:00`) : subMonths(now, 1);
    const to = toStr ? new Date(`${toStr}T23:59:59`) : now;
    return { start: from, end: to };
  }

  switch (String(range || "7d")) {
    case "1m":
    case "30d":
      return { start: addDays(now, -29), end: now };
    case "3m":
      return { start: subMonths(now, 3), end: now };
    case "1y":
      return { start: subMonths(now, 12), end: now };
    case "7d":
    default:
      return { start: addDays(now, -6), end: now };
  }
}

// ✅ rule đổi đơn vị thống kê (đúng cái bạn muốn)
function granularityFromRange(range) {
  const r = String(range || "7d");
  if (r === "1y") return "month";
  if (r === "3m") return "week";
  return "day";
}

// Monday-start week (front-fill buckets)
function startOfWeekMonday(d) {
  const x = startOfDay(d);
  const day = x.getDay(); // 0 Sun ... 6 Sat
  const delta = (day + 6) % 7; // Mon=0, Tue=1,... Sun=6
  return addDays(x, -delta);
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0);
}

// fill missing buckets (để FE chart không bị giật)
function buildBuckets(start, end, granularity) {
  const labels = [];
  let cur;

  if (granularity === "month") cur = startOfMonth(start);
  else if (granularity === "week") cur = startOfWeekMonday(start);
  else cur = startOfDay(start);

  const endDay = endOfDay(end);

  while (cur <= endDay) {
    labels.push(toYMD(cur)); // always YYYY-MM-DD (period_start)
    if (granularity === "month") cur = addMonths(cur, 1);
    else if (granularity === "week") cur = addDays(cur, 7);
    else cur = addDays(cur, 1);
  }

  return labels;
}

async function resolveDoctorContext(req) {
  const userId = req.user?.userId || req.user?.id;
  const doctorIdFromToken = req.user?.doctorId;

  let doctor = null;
  if (doctorIdFromToken) doctor = await Doctor.findByPk(doctorIdFromToken);
  if (!doctor && userId) doctor = await Doctor.findOne({ where: { user_id: userId } });

  const hospitalId = doctor?.hospital_id || req.user?.hospital_id || null;
  return { userId, doctorId: doctor?.id || null, hospitalId };
}

// ✅ build trend tổng (theo range: day/week/month)
async function buildCampaignTrends({ ids, startDT, endDT, granularity }) {
  // groupExpr phải trả về "YYYY-MM-DD" (period_start)
  const groupExprAp =
    granularity === "month"
      ? `DATE_FORMAT(a.scheduled_at, '%Y-%m-01')`
      : granularity === "week"
        ? `DATE_SUB(DATE(a.scheduled_at), INTERVAL WEEKDAY(a.scheduled_at) DAY)`
        : `DATE(a.scheduled_at)`;

  const groupExprVol =
    granularity === "month"
      ? `DATE_FORMAT(COALESCE(d.confirmed_at, d.collected_at), '%Y-%m-01')`
      : granularity === "week"
        ? `DATE_SUB(DATE(COALESCE(d.confirmed_at, d.collected_at)), INTERVAL WEEKDAY(COALESCE(d.confirmed_at, d.collected_at)) DAY)`
        : `DATE(COALESCE(d.confirmed_at, d.collected_at))`;

  // 1) appointment trend
  const apTrendRows = await sequelize.query(
    `
    SELECT
      ${groupExprAp} AS period_start,
      SUM(CASE WHEN a.status = 'REQUESTED' THEN 1 ELSE 0 END) AS requested,
      SUM(CASE WHEN a.status = 'APPROVED' THEN 1 ELSE 0 END) AS approved,
      SUM(CASE WHEN a.status = 'REJECTED' THEN 1 ELSE 0 END) AS rejected,
      SUM(CASE WHEN a.status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN a.status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled
    FROM appointments a
    INNER JOIN campaigns c ON c.id = a.campaign_id
    WHERE a.campaign_id IN (:ids)
      AND a.scheduled_at BETWEEN
          GREATEST(CONCAT(c.start_date,' 00:00:00'), :startDT)
          AND
          LEAST(CONCAT(c.end_date,' 23:59:59'), :endDT)
    GROUP BY period_start
    ORDER BY period_start ASC
    `,
    { replacements: { ids, startDT, endDT }, type: QueryTypes.SELECT }
  );

  const apTrendMap = new Map(
    (apTrendRows || []).map((r) => [
      String(r.period_start).slice(0, 10),
      {
        requested: Number(r.requested || 0),
        approved: Number(r.approved || 0),
        rejected: Number(r.rejected || 0),
        completed: Number(r.completed || 0),
        cancelled: Number(r.cancelled || 0),
      },
    ])
  );

  // 2) volume trend
  const volTrendRows = await sequelize.query(
    `
    SELECT
      ${groupExprVol} AS period_start,
      SUM(d.volume_ml) AS volume_ml
    FROM donations d
    INNER JOIN appointments a ON a.id = d.appointment_id
    INNER JOIN campaigns c ON c.id = a.campaign_id
    WHERE a.campaign_id IN (:ids)
      AND a.status = 'COMPLETED'
      AND COALESCE(d.confirmed_at, d.collected_at) IS NOT NULL
      AND COALESCE(d.confirmed_at, d.collected_at) BETWEEN
          GREATEST(CONCAT(c.start_date,' 00:00:00'), :startDT)
          AND
          LEAST(CONCAT(c.end_date,' 23:59:59'), :endDT)
    GROUP BY period_start
    ORDER BY period_start ASC
    `,
    { replacements: { ids, startDT, endDT }, type: QueryTypes.SELECT }
  );

  const volTrendMap = new Map(
    (volTrendRows || []).map((r) => [String(r.period_start).slice(0, 10), Number(r.volume_ml || 0)])
  );

  return { apTrendMap, volTrendMap };
}

module.exports = {
  // GET /doctor/reports/campaign-performance?range=7d|1m|3m|1y|custom&from=YYYY-MM-DD&to=YYYY-MM-DD
  async campaignPerformance(req, res) {
    try {
      const range = String(req.query.range || "7d");
      const granularity = granularityFromRange(range);

      const { start: rawStart, end: rawEnd } = parseRange(range, req.query.from, req.query.to);

      const reportStart = startOfDay(rawStart);
      const reportEnd = endOfDay(rawEnd);

      const { hospitalId } = await resolveDoctorContext(req);

      // nếu có hospitalId thì vẫn cho match hospital_id NULL
      const hospitalScope = hospitalId
        ? { [Op.or]: [{ hospital_id: hospitalId }, { hospital_id: null }] }
        : {};

      // campaigns APPROVED giao với window report
      const campaignWhere = {
        approval_status: "approved",
        start_date: { [Op.lte]: toYMD(reportEnd) },
        end_date: { [Op.gte]: toYMD(reportStart) },
        ...hospitalScope,
      };

      const campaigns = await Campaign.findAll({
        where: campaignWhere,
        attributes: [
          "id",
          "title",
          "start_date",
          "end_date",
          "locate_type",
          "donation_site_id",
          "location",
          "hospital_id",
          "approval_status",
          "is_emergency",
        ],
        order: [["start_date", "DESC"]],
        limit: 50,
      });

      if (!campaigns.length) {
        return res.json({
          status: true,
          data: {
            range,
            granularity,
            from: toYMD(reportStart),
            to: toYMD(reportEnd),
            campaigns: [],
            trend: {
              granularity,
              labels: buildBuckets(reportStart, reportEnd, granularity),
              volume_ml: [],
              requested: [],
              approved: [],
              rejected: [],
              completed: [],
              cancelled: [],
            },
          },
        });
      }

      const ids = campaigns.map((c) => Number(c.id)).filter(Boolean);
      const startDT = toDT(reportStart);
      const endDT = toDT(reportEnd);

      // ===== 1) Aggregate appointments by status (group by campaign_id)
      const apRows = await sequelize.query(
        `
        SELECT 
          a.campaign_id AS campaign_id,
          SUM(CASE WHEN a.status = 'REQUESTED' THEN 1 ELSE 0 END) AS requested,
          SUM(CASE WHEN a.status = 'APPROVED' THEN 1 ELSE 0 END) AS approved,
          SUM(CASE WHEN a.status = 'REJECTED' THEN 1 ELSE 0 END) AS rejected,
          SUM(CASE WHEN a.status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed,
          SUM(CASE WHEN a.status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled
        FROM appointments a
        INNER JOIN campaigns c ON c.id = a.campaign_id
        WHERE a.campaign_id IN (:ids)
          AND a.scheduled_at BETWEEN
              GREATEST(CONCAT(c.start_date,' 00:00:00'), :startDT)
              AND
              LEAST(CONCAT(c.end_date,' 23:59:59'), :endDT)
        GROUP BY a.campaign_id
        `,
        { replacements: { ids, startDT, endDT }, type: QueryTypes.SELECT }
      );

      const apMap = new Map(
        (apRows || []).map((r) => [
          Number(r.campaign_id),
          {
            requested: Number(r.requested || 0),
            approved: Number(r.approved || 0),
            rejected: Number(r.rejected || 0),
            completed: Number(r.completed || 0),
            cancelled: Number(r.cancelled || 0),
          },
        ])
      );

      // ===== 2) Sum volume_ml by campaign
      const volRows = await sequelize.query(
        `
        SELECT
          a.campaign_id AS campaign_id,
          SUM(d.volume_ml) AS volume_ml
        FROM donations d
        INNER JOIN appointments a ON a.id = d.appointment_id
        INNER JOIN campaigns c ON c.id = a.campaign_id
        WHERE a.campaign_id IN (:ids)
          AND a.status = 'COMPLETED'
          AND COALESCE(d.confirmed_at, d.collected_at) IS NOT NULL
          AND COALESCE(d.confirmed_at, d.collected_at) BETWEEN
              GREATEST(CONCAT(c.start_date,' 00:00:00'), :startDT)
              AND
              LEAST(CONCAT(c.end_date,' 23:59:59'), :endDT)
        GROUP BY a.campaign_id
        `,
        { replacements: { ids, startDT, endDT }, type: QueryTypes.SELECT }
      );

      const volMap = new Map(
        (volRows || []).map((r) => [Number(r.campaign_id), Number(r.volume_ml || 0)])
      );

      // ===== 3) Trend tổng theo range (day/week/month) =====
      const labels = buildBuckets(reportStart, reportEnd, granularity);
      const { apTrendMap, volTrendMap } = await buildCampaignTrends({
        ids,
        startDT,
        endDT,
        granularity,
      });

      const trend = {
        granularity,
        labels,
        volume_ml: labels.map((k) => volTrendMap.get(k) || 0),
        requested: labels.map((k) => (apTrendMap.get(k)?.requested || 0)),
        approved: labels.map((k) => (apTrendMap.get(k)?.approved || 0)),
        rejected: labels.map((k) => (apTrendMap.get(k)?.rejected || 0)),
        completed: labels.map((k) => (apTrendMap.get(k)?.completed || 0)),
        cancelled: labels.map((k) => (apTrendMap.get(k)?.cancelled || 0)),
      };

      // ===== merge -> FE payload =====
      const results = campaigns.map((c) => {
        const cid = Number(c.id);
        const a = apMap.get(cid) || {
          requested: 0,
          approved: 0,
          rejected: 0,
          completed: 0,
          cancelled: 0,
        };
        const volume_ml = volMap.get(cid) || 0;

        // COMPLETED / (APPROVED + COMPLETED)
        const denom = Number(a.approved) + Number(a.completed);
        const completion_rate = denom > 0 ? Math.round((Number(a.completed) / denom) * 100) : 0;

        return {
          id: c.id,
          title: c.title,
          start_date: c.start_date,
          end_date: c.end_date,
          locate_type: c.locate_type,
          donation_site_id: c.donation_site_id,
          location: c.location,
          requested: a.requested,
          approved: a.approved,
          rejected: a.rejected,
          completed: a.completed,
          cancelled: a.cancelled,
          volume_ml,
          completion_rate,
        };
      });

      return res.json({
        status: true,
        data: {
          range,
          granularity,
          from: toYMD(reportStart),
          to: toYMD(reportEnd),
          campaigns: results,
          trend, // ✅ thêm để bạn vẽ chart theo tuần/tháng nếu cần
        },
      });
    } catch (err) {
      console.error("[DoctorReportController.campaignPerformance] error:", err);
      return res.status(500).json({
        status: false,
        message: err.message || "Server error",
      });
    }
  },
};
