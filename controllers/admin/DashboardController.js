// controllers/admin/DashboardController.js
const { Op, fn, col } = require("sequelize");
const {
  User,
  Hospital,
  News,
  Campaign,
  BloodInventory,
  Donation,
  AuditLog,
  BloodType,
} = require("../../models");

function getStartDate(filter) {
  const now = new Date();
  switch ((filter || "").toLowerCase()) {
    case "today":
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    case "week": {
      const d = new Date(now);
      d.setDate(now.getDate() - 6);
      d.setHours(0, 0, 0, 0);
      return d;
    }
    case "month":
      return new Date(now.getFullYear(), now.getMonth(), 1);
    case "year":
      return new Date(now.getFullYear(), 0, 1);
    default:
      return new Date(now.getFullYear(), now.getMonth(), 1);
  }
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function labelForChart(filter, isoDate) {
  const d = new Date(isoDate);
  const f = (filter || "").toLowerCase();

  if (f === "week" || f === "today") {
    const names = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
    return names[d.getDay()];
  }
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;
}

function toISODateOnly(d) {
  return new Date(d).toISOString().slice(0, 10);
}

module.exports = {
  async getDashboardStats(req, res) {
    try {
      const filter = req.query.filter || "week";
      const startDate = getStartDate(filter);
      const endDate = new Date();

      const [
        totalUsers,
        newUsersSinceStart,
        activeHospitals,
        pendingNewsCount,
        pendingCampaignCount,
        totalBloodUnits,
        bloodTypeRows,
        usersByDayRows,
        donationsByDayRows,
        pendingNewsRows,
        pendingCampaignRows,
        pendingDoctorRows,
        recentLogs,
      ] = await Promise.all([
        /**
         * ✅ Tổng user = 3 role (donor + doctor + admin)
         * chỉ tính những user có tinh_trang = 1 (active)
         */
        User.count({
          where: { tinh_trang: 1 },
        }),

        /**
         * ✅ User mới theo filter = 3 role, chỉ active
         */
        User.count({
          where: {
            tinh_trang: 1,
            created_at: { [Op.gte]: startDate },
          },
        }),

        // Hospitals active (fallback all)
        (async () => {
          try {
            return await Hospital.count({ where: { status: "active" } });
          } catch (e) {
            return await Hospital.count();
          }
        })(),

        // Pending counts
        News.count({ where: { status: "pending" } }),
        Campaign.count({ where: { status: "pending" } }),

        // Total blood units
        (async () => {
          const row = await BloodInventory.findOne({
            attributes: [[fn("COALESCE", fn("SUM", col("units")), 0), "total_units"]],
            raw: true,
          });
          return Number(row?.total_units || 0);
        })(),

        // Blood type aggregation
        (async () => {
          try {
            const rows = await BloodInventory.findAll({
              attributes: ["blood_type_id", [fn("SUM", col("units")), "units"]],
              group: ["blood_type_id"],
              raw: true,
            });

            const typeIds = rows.map((r) => r.blood_type_id).filter(Boolean);
            const types = typeIds.length
              ? await BloodType.findAll({
                  where: { id: typeIds },
                  attributes: ["id", "abo", "rh"],
                  raw: true,
                })
              : [];

            const typeMap = {};
            types.forEach((t) => {
              const label = `${t.abo || ""}${t.rh ? (t.abo ? " " + t.rh : t.rh) : ""}`.trim();
              typeMap[t.id] = label || `Type ${t.id}`;
            });

            return rows.map((r) => ({
              label: typeMap[r.blood_type_id] || `Type ${r.blood_type_id || "Unknown"}`,
              value: Number(r.units || 0),
            }));
          } catch (e) {
            return [];
          }
        })(),

        /**
         * ✅ Users per day: cũng chỉ count user active (tinh_trang = 1)
         */
        (async () => {
          const rows = await User.findAll({
            attributes: [
              [fn("DATE", col("created_at")), "date"],
              [fn("COUNT", col("id")), "count"],
            ],
            where: {
              created_at: { [Op.gte]: startDate },
              tinh_trang: 1,
            },
            group: [fn("DATE", col("created_at"))],
            order: [[fn("DATE", col("created_at")), "ASC"]],
            raw: true,
          });
          return rows;
        })(),

        // Donations per day
        (async () => {
          try {
            return await Donation.findAll({
              attributes: [
                [fn("DATE", col("collected_at")), "date"],
                [fn("COUNT", col("id")), "count"],
              ],
              where: {
                collected_at: { [Op.gte]: startDate },
                screened_ok: 1,
              },
              group: [fn("DATE", col("collected_at"))],
              order: [[fn("DATE", col("collected_at")), "ASC"]],
              raw: true,
            });
          } catch (e) {
            return await Donation.findAll({
              attributes: [
                [fn("DATE", col("created_at")), "date"],
                [fn("COUNT", col("id")), "count"],
              ],
              where: { created_at: { [Op.gte]: startDate } },
              group: [fn("DATE", col("created_at"))],
              order: [[fn("DATE", col("created_at")), "ASC"]],
              raw: true,
            });
          }
        })(),

        // Pending news list
        News.findAll({
          where: { status: "pending" },
          order: [["created_at", "DESC"]],
          limit: 10,
          include: [{ association: "creator", attributes: ["full_name"], required: false }],
        }),

        // Pending campaigns list
        Campaign.findAll({
          where: { status: "pending" },
          order: [["created_at", "DESC"]],
          limit: 10,
          raw: true,
        }),

        // Pending doctors list: tinh_trang = 0
        User.findAll({
          where: { role: "doctor", tinh_trang: 0 },
          attributes: ["id", "full_name", "email", "created_at"],
          order: [["created_at", "DESC"]],
          limit: 10,
          raw: true,
        }),

        // Recent logs
        AuditLog.findAll({
          order: [["created_at", "DESC"]],
          limit: 12,
          include: [{ model: User, attributes: ["full_name"], required: false }],
        }),
      ]);

      // Build day array
      const dayMs = 24 * 60 * 60 * 1000;
      const days = [];
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      for (let d = new Date(start); d <= endDate; d = new Date(d.getTime() + dayMs)) {
        days.push(toISODateOnly(d));
      }

      const usersMap = {};
      (usersByDayRows || []).forEach((r) => {
        const k = String(r.date).slice(0, 10);
        usersMap[k] = Number(r.count || 0);
      });

      const donationsMap = {};
      (donationsByDayRows || []).forEach((r) => {
        const k = String(r.date).slice(0, 10);
        donationsMap[k] = Number(r.count || 0);
      });

      const labels = days.map((iso) => labelForChart(filter, iso));
      const usersData = days.map((iso) => usersMap[iso] || 0);
      const donationsData = days.map((iso) => donationsMap[iso] || 0);

      const bloodLabels = (bloodTypeRows || []).map((x) => x.label);
      const bloodValues = (bloodTypeRows || []).map((x) => x.value);

      // Format pending lists
      const pendingNews = (pendingNewsRows || []).map((n) => ({
        id: n.id,
        title: n.title,
        author: (n.creator && n.creator.full_name) || n.created_by || "Unknown",
        date: n.created_at,
      }));

      const pendingCampaigns = (pendingCampaignRows || []).map((c) => ({
        id: c.id,
        title: c.title || c.name || "—",
        hospital: c.hospital_name || c.hospital || "—",
        date: c.created_at,
      }));

      const pendingDoctors = (pendingDoctorRows || []).map((u) => ({
        id: u.id,
        fullName: u.full_name || "—",
        email: u.email || "—",
        date: u.created_at,
      }));

      const systemLogs = (recentLogs || []).map((l) => ({
        action: l.action || l.message || "Hành động",
        user: (l.User && l.User.full_name) || l.user_name || "Hệ thống",
        role: l.user_role || "Unknown",
        time: l.created_at,
      }));

      const responsePayload = {
        stats: {
          totalUsers: Number(totalUsers || 0),
          newUsers: Number(newUsersSinceStart || 0),
          activeHospitals: Number(activeHospitals || 0),
          pendingRequests:
            Number(pendingNewsCount || 0) +
            Number(pendingCampaignCount || 0) +
            Number(pendingDoctors.length || 0),
          totalBloodUnits: Number(totalBloodUnits || 0),
        },

        growthChartData: {
          labels,
          datasets: [
            { label: "Người dùng mới", data: usersData },
            { label: "Lượt hiến máu", data: donationsData },
          ],
        },

        bloodTypeChartData: {
          labels: bloodLabels.length ? bloodLabels : ["O", "A", "B", "AB"],
          datasets: [
            {
              label: "Tỷ lệ nhóm máu",
              data: bloodValues.length ? bloodValues : [0, 0, 0, 0],
            },
          ],
        },

        pendingNews,
        pendingCampaigns,
        pendingDoctors,
        systemLogs,
      };

      return res.status(200).json({ status: true, data: responsePayload });
    } catch (error) {
      console.error("Dashboard error:", error);
      return res
        .status(500)
        .json({ status: false, message: "Lỗi server!", error: error.message });
    }
  },
};
