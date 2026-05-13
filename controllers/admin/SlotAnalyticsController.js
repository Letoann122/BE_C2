"use strict";

const { Op } = require("sequelize");
const {
  AppointmentSlot,
  DonationSite,
  Campaign,
  Appointment,
  sequelize,
} = require("../../models");

const { buildSlotPayload } = require("../../services/slotCapacityService");

const toDateInput = (date) => {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const addDays = (date, days) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

const slotTimeKey = (slot) => {
  const start = String(slot.start_time || "").slice(0, 5);
  return start < "12:00" ? "morning" : "afternoon";
};

const slotTimeLabel = (slot) => {
  return `${String(slot.start_time).slice(0, 5)} - ${String(
    slot.end_time
  ).slice(0, 5)}`;
};

module.exports = {
  async overview(req, res) {
    try {
      const today = new Date();

      const fromDate = req.query.from_date || toDateInput(today);
      const toDate = req.query.to_date || toDateInput(addDays(today, 7));

      const where = {
        slot_date: {
          [Op.between]: [fromDate, toDate],
        },
      };

      if (req.query.type) where.type = req.query.type;
      if (req.query.donation_site_id) {
        where.donation_site_id = req.query.donation_site_id;
      }
      if (req.query.campaign_id) {
        where.campaign_id = req.query.campaign_id;
      }

      const slots = await AppointmentSlot.findAll({
        where,
        include: [
          {
            model: DonationSite,
            as: "donation_site",
            required: false,
          },
          {
            model: Campaign,
            as: "campaign",
            required: false,
          },
        ],
        order: [
          ["slot_date", "ASC"],
          ["start_time", "ASC"],
        ],
      });

      const data = slots.map(buildSlotPayload);

      const totalCapacity = data.reduce(
        (sum, item) => sum + Number(item.slot_capacity || 0),
        0
      );

      const currentCount = data.reduce(
        (sum, item) => sum + Number(item.current_count || 0),
        0
      );

      const availableCount = Math.max(totalCapacity - currentCount, 0);

      const overallPercent =
        totalCapacity > 0
          ? Math.round((currentCount / totalCapacity) * 100)
          : 0;

      const fullSlots = data.filter(
        (item) =>
          Number(item.slot_capacity || 0) > 0 &&
          Number(item.current_count || 0) >= Number(item.slot_capacity || 0)
      );

      const nearlyFullSlots = data.filter((item) => {
        const capacity = Number(item.slot_capacity || 0);
        const current = Number(item.current_count || 0);
        if (capacity <= 0) return false;

        const percent = Math.round((current / capacity) * 100);

        return percent >= 80 && percent < 100;
      });

      const byDateMap = {};
      const heatmapMap = {};

      const peakTime = {
        morning: {
          label: "Ca sáng",
          time_range: "07:00 - 11:00",
          current_count: 0,
          slot_capacity: 0,
          available_count: 0,
          percent: 0,
        },
        afternoon: {
          label: "Ca chiều",
          time_range: "13:00 - 17:00",
          current_count: 0,
          slot_capacity: 0,
          available_count: 0,
          percent: 0,
        },
      };

      data.forEach((slot) => {
        const date = String(slot.slot_date).slice(0, 10);
        const key = slotTimeKey(slot);

        if (!byDateMap[date]) {
          byDateMap[date] = {
            date,
            current_count: 0,
            slot_capacity: 0,
            available_count: 0,
            percent: 0,
            morning_count: 0,
            afternoon_count: 0,
          };
        }

        if (!heatmapMap[date]) {
          heatmapMap[date] = {
            date,
            morning: {
              current_count: 0,
              slot_capacity: 0,
              available_count: 0,
              percent: 0,
            },
            afternoon: {
              current_count: 0,
              slot_capacity: 0,
              available_count: 0,
              percent: 0,
            },
            total: {
              current_count: 0,
              slot_capacity: 0,
              available_count: 0,
              percent: 0,
            },
          };
        }

        byDateMap[date].current_count += Number(slot.current_count || 0);
        byDateMap[date].slot_capacity += Number(slot.slot_capacity || 0);
        byDateMap[date].available_count += Number(slot.available_count || 0);

        if (key === "morning") {
          byDateMap[date].morning_count += Number(slot.current_count || 0);
        } else {
          byDateMap[date].afternoon_count += Number(slot.current_count || 0);
        }

        heatmapMap[date][key].current_count += Number(slot.current_count || 0);
        heatmapMap[date][key].slot_capacity += Number(slot.slot_capacity || 0);
        heatmapMap[date][key].available_count += Number(
          slot.available_count || 0
        );

        heatmapMap[date].total.current_count += Number(slot.current_count || 0);
        heatmapMap[date].total.slot_capacity += Number(slot.slot_capacity || 0);
        heatmapMap[date].total.available_count += Number(
          slot.available_count || 0
        );

        peakTime[key].current_count += Number(slot.current_count || 0);
        peakTime[key].slot_capacity += Number(slot.slot_capacity || 0);
        peakTime[key].available_count += Number(slot.available_count || 0);
      });

      const byDate = Object.values(byDateMap).map((item) => ({
        ...item,
        percent:
          item.slot_capacity > 0
            ? Math.round((item.current_count / item.slot_capacity) * 100)
            : 0,
      }));

      const heatmap = Object.values(heatmapMap).map((row) => {
        ["morning", "afternoon", "total"].forEach((key) => {
          const item = row[key];

          item.percent =
            item.slot_capacity > 0
              ? Math.round((item.current_count / item.slot_capacity) * 100)
              : 0;
        });

        return row;
      });

      Object.keys(peakTime).forEach((key) => {
        const item = peakTime[key];

        item.percent =
          item.slot_capacity > 0
            ? Math.round((item.current_count / item.slot_capacity) * 100)
            : 0;
      });

      const topSites = await AppointmentSlot.findAll({
        where,
        attributes: [
          "donation_site_id",
          [
            sequelize.fn("SUM", sequelize.col("current_count")),
            "current_count",
          ],
          [
            sequelize.fn("SUM", sequelize.col("slot_capacity")),
            "slot_capacity",
          ],
        ],
        include: [
          {
            model: DonationSite,
            as: "donation_site",
            attributes: ["id", "name"],
            required: false,
          },
        ],
        group: ["donation_site_id", "donation_site.id"],
        order: [[sequelize.literal("current_count"), "DESC"]],
        limit: 10,
      });

      const top_sites = topSites.map((row) => {
        const raw = row.toJSON();
        const current = Number(raw.current_count || 0);
        const capacity = Number(raw.slot_capacity || 0);

        return {
          donation_site_id: raw.donation_site_id,
          name: raw.donation_site?.name || "Không rõ",
          current_count: current,
          slot_capacity: capacity,
          percent: capacity > 0 ? Math.round((current / capacity) * 100) : 0,
        };
      });

      const recentAppointments = await Appointment.findAll({
        attributes: [
          "status",
          [sequelize.fn("COUNT", sequelize.col("id")), "count"],
        ],
        where: {
          scheduled_at: {
            [Op.between]: [
              new Date(`${fromDate}T00:00:00`),
              new Date(`${toDate}T23:59:59`),
            ],
          },
        },
        group: ["status"],
      });

      const status_distribution = recentAppointments.map((item) => {
        const raw = item.toJSON();

        return {
          status: raw.status,
          count: Number(raw.count || 0),
        };
      });

      const alert_slots = data
        .filter((slot) => Number(slot.percent || 0) >= 80)
        .map((slot) => ({
          id: slot.id,
          type: slot.type,
          slot_date: slot.slot_date,
          time_range: slotTimeLabel(slot),
          current_count: slot.current_count,
          slot_capacity: slot.slot_capacity,
          available_count: slot.available_count,
          percent: slot.percent,
          donation_site_name: slot.donation_site?.name || null,
          campaign_title: slot.campaign?.title || null,
        }));

      return res.json({
        status: true,
        data: {
          overview: {
            total_slots: data.length,
            total_capacity: totalCapacity,
            current_count: currentCount,
            available_count: availableCount,
            percent: overallPercent,
            full_slots: fullSlots.length,
            nearly_full_slots: nearlyFullSlots.length,
          },
          peak_time: peakTime,
          by_date: byDate,
          heatmap,
          top_sites,
          status_distribution,
          alert_slots,
          slots: data,
        },
      });
    } catch (error) {
      console.error("SlotAnalyticsController.overview error:", error);

      return res.status(500).json({
        status: false,
        message: "Không tải được dữ liệu phân tích slot!",
      });
    }
  },
};