"use strict";

const { Campaign, User, DonationSite, Appointment } = require("../../models");
const { Op, fn, col, where } = require("sequelize");

const {
  getDisplayCampaignStatus,
} = require("../../utils/campaignStatusHelper");

// Helper
const pad = (n) => (n < 10 ? `0${n}` : `${n}`);
const getLastDay = (y, m) => new Date(y, m, 0).getDate();

const attachDisplayStatus = (campaign) => {
  if (!campaign) return campaign;

  campaign.setDataValue(
    "status",
    getDisplayCampaignStatus(campaign)
  );

  return campaign;
};

const normalizeText = (value) => {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
};

const formatDateVN = (value) => {
  if (!value) return "-";

  return new Date(value).toLocaleDateString("vi-VN");
};

const normalizeDateOnly = (value) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

const validateCampaignDate = ({ start_date, end_date }) => {
  if (!start_date || !end_date) {
    return {
      valid: false,
      message: "Vui lòng nhập ngày bắt đầu và ngày kết thúc chiến dịch!",
    };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const start = normalizeDateOnly(start_date);
  const end = normalizeDateOnly(end_date);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return {
      valid: false,
      message: "Ngày bắt đầu hoặc ngày kết thúc không hợp lệ!",
    };
  }

  if (start < today) {
    return {
      valid: false,
      message: "Ngày bắt đầu không được nhỏ hơn hôm nay!",
    };
  }

  if (end < start) {
    return {
      valid: false,
      message: "Ngày kết thúc phải lớn hơn hoặc bằng ngày bắt đầu!",
    };
  }

  if (end < today) {
    return {
      valid: false,
      message: "Ngày kết thúc không được nhỏ hơn hôm nay!",
    };
  }

  return {
    valid: true,
  };
};

const validateCampaignLocationDateConflict = async ({
  start_date,
  end_date,
  locate_type,
  donation_site_id,
  location,
  excludeCampaignId = null,
}) => {
  const whereClause = {
    // Có giao nhau ngày:
    // campaign.start_date <= new.end_date
    // campaign.end_date >= new.start_date
    start_date: {
      [Op.lte]: end_date,
    },
    end_date: {
      [Op.gte]: start_date,
    },

    // Không tính chiến dịch đã bị từ chối hoặc đã đóng
    approval_status: {
      [Op.ne]: "rejected",
    },
    status: {
      [Op.ne]: "ended",
    },
  };

  if (excludeCampaignId) {
    whereClause.id = {
      [Op.ne]: excludeCampaignId,
    };
  }

  if (locate_type === "donation_site") {
    if (!donation_site_id) {
      return {
        valid: false,
        message: "Vui lòng chọn điểm hiến máu cho chiến dịch!",
      };
    }

    whereClause.locate_type = "donation_site";
    whereClause.donation_site_id = donation_site_id;
  } else if (locate_type === "custom") {
    const normalizedLocation = normalizeText(location);

    if (!normalizedLocation) {
      return {
        valid: false,
        message: "Vui lòng nhập địa điểm tổ chức chiến dịch!",
      };
    }

    whereClause.locate_type = "custom";
    whereClause[Op.and] = [
      where(
        fn("LOWER", fn("TRIM", col("location"))),
        normalizedLocation
      ),
    ];
  } else {
    return {
      valid: false,
      message: "Loại địa điểm chiến dịch không hợp lệ!",
    };
  }

  const existedCampaign = await Campaign.findOne({
    where: whereClause,
    include: [
      {
        model: DonationSite,
        as: "donation_site",
        required: false,
      },
    ],
    attributes: [
      "id",
      "title",
      "start_date",
      "end_date",
      "location",
      "locate_type",
      "donation_site_id",
      "approval_status",
      "status",
    ],
  });

  if (existedCampaign) {
    const place =
      existedCampaign.locate_type === "donation_site"
        ? existedCampaign.donation_site?.name || "điểm hiến máu này"
        : existedCampaign.location || "địa điểm này";

    return {
      valid: false,
      message: `${place} đã có chiến dịch "${existedCampaign.title}" trong khoảng ${formatDateVN(
        existedCampaign.start_date
      )} - ${formatDateVN(
        existedCampaign.end_date
      )}. Vui lòng chọn ngày khác hoặc địa điểm khác.`,
      conflict: existedCampaign,
    };
  }

  return {
    valid: true,
  };
};

module.exports = {
  // ============================================================================
  // 1. GET CAMPAIGN LIST
  // ============================================================================
  async getAllCampaigns(req, res) {
    try {
      let { type, time, status, start_from, start_to, approval_status } =
        req.query;

      const where = {};

      if (type === "0") where.is_emergency = 0;
      if (type === "1") where.is_emergency = 1;

      // status filter vẫn lọc theo DB status, giữ logic cũ
      if (status) where.status = status;

      if (approval_status) where.approval_status = approval_status;

      if (start_from && start_to) {
        where.start_date = {
          [Op.between]: [start_from, start_to],
        };
      }

      const today = new Date();
      const year = today.getFullYear();
      const month = today.getMonth() + 1;

      if (time === "this_month") {
        const last = getLastDay(year, month);

        where.start_date = {
          [Op.between]: [
            `${year}-${pad(month)}-01`,
            `${year}-${pad(month)}-${pad(last)}`,
          ],
        };
      }

      if (time === "last_month") {
        const m = month - 1 === 0 ? 12 : month - 1;
        const y = m === 12 ? year - 1 : year;
        const last = getLastDay(y, m);

        where.start_date = {
          [Op.between]: [
            `${y}-${pad(m)}-01`,
            `${y}-${pad(m)}-${pad(last)}`,
          ],
        };
      }

      if (time === "this_year") {
        where.start_date = {
          [Op.between]: [`${year}-01-01`, `${year}-12-31`],
        };
      }

      const campaigns = await Campaign.findAll({
        where,
        include: [
          {
            model: User,
            as: "creator",
            attributes: ["full_name"],
          },
          {
            model: User,
            as: "reviewer",
            attributes: ["full_name"],
          },
          {
            model: DonationSite,
            as: "donation_site",
          },
        ],
        order: [["created_at", "DESC"]],
      });

      if (!campaigns.length) {
        return res.json({
          status: true,
          data: [],
        });
      }

      const campaignIds = campaigns.map((c) => c.id);

      const counts = await Appointment.findAll({
        attributes: [
          "campaign_id",
          [fn("COUNT", col("id")), "registration_count"],
        ],
        where: {
          campaign_id: {
            [Op.in]: campaignIds,
          },
        },
        group: ["campaign_id"],
        raw: true,
      });

      const countMap = {};

      counts.forEach((row) => {
        countMap[row.campaign_id] =
          parseInt(row.registration_count, 10) || 0;
      });

      campaigns.forEach((c) => {
        c.setDataValue(
          "registration_count",
          countMap[c.id] || 0
        );

        attachDisplayStatus(c);
      });

      return res.json({
        status: true,
        data: campaigns,
      });
    } catch (err) {
      console.error("getAllCampaigns error:", err);

      return res.status(500).json({
        status: false,
        errors: {
          server: [err.message],
        },
      });
    }
  },

  // ============================================================================
  // 2. GET DETAIL
  // ============================================================================
  async getCampaignDetail(req, res) {
    try {
      const id = req.params.id;

      const campaign = await Campaign.findOne({
        where: {
          id,
        },
        include: [
          {
            model: User,
            as: "creator",
            attributes: ["full_name"],
          },
          {
            model: User,
            as: "reviewer",
            attributes: ["full_name"],
          },
          {
            model: DonationSite,
            as: "donation_site",
          },
        ],
      });

      if (!campaign) {
        return res.json({
          status: false,
          message: "Không tìm thấy chiến dịch",
        });
      }

      attachDisplayStatus(campaign);

      return res.json({
        status: true,
        data: campaign,
      });
    } catch (err) {
      console.error("getCampaignDetail error:", err);

      return res.status(500).json({
        status: false,
        message: err.message,
      });
    }
  },

  // ============================================================================
  // 3. CREATE
  // ============================================================================
  async createCampaign(req, res) {
    try {
      const {
        title,
        content,
        start_date,
        end_date,
        is_emergency,
        locate_type,
        location,
        donation_site_id,
      } = req.body;

      const dateCheck = validateCampaignDate({
        start_date,
        end_date,
      });

      if (!dateCheck.valid) {
        return res.json({
          status: false,
          message: dateCheck.message,
        });
      }

      const conflictCheck = await validateCampaignLocationDateConflict({
        start_date,
        end_date,
        locate_type,
        donation_site_id,
        location,
      });

      if (!conflictCheck.valid) {
        return res.json({
          status: false,
          message: conflictCheck.message,
          conflict: conflictCheck.conflict || null,
        });
      }

      const payload = {
        title,
        content,
        start_date,
        end_date,
        is_emergency,
        locate_type,
        created_by: req.user.userId,
        location: null,
        donation_site_id: null,
        approval_status: "pending",
        reviewed_by_admin_id: null,
        reviewed_at: null,
        rejected_reason: null,
      };

      if (locate_type === "custom") {
        payload.location = location;
      }

      if (locate_type === "donation_site") {
        payload.donation_site_id = donation_site_id;
      }

      const newCamp = await Campaign.create(payload);

      attachDisplayStatus(newCamp);

      return res.json({
        status: true,
        message: "Tạo chiến dịch thành công!",
        data: newCamp,
      });
    } catch (err) {
      console.error("createCampaign error:", err);

      return res.status(500).json({
        status: false,
        message: err.message,
      });
    }
  },

  // ============================================================================
  // 4. UPDATE
  // ============================================================================
  async updateCampaign(req, res) {
    try {
      const id = req.params.id;
      const data = req.body;

      const campaign = await Campaign.findByPk(id);

      if (!campaign) {
        return res.json({
          status: false,
          message: "Không tìm thấy chiến dịch",
        });
      }

      const now = new Date();
      const startDate = new Date(campaign.start_date);

      if (startDate <= now) {
        await campaign.update({
          content: data.content,
        });

        await campaign.reload();

        attachDisplayStatus(campaign);

        return res.json({
          status: true,
          canEdit: false,
          message: "Cập nhật mô tả thành công (chiến dịch đã bắt đầu)",
          data: campaign,
        });
      }

      const dateCheck = validateCampaignDate({
        start_date: data.start_date,
        end_date: data.end_date,
      });

      if (!dateCheck.valid) {
        return res.json({
          status: false,
          message: dateCheck.message,
        });
      }

      const conflictCheck = await validateCampaignLocationDateConflict({
        start_date: data.start_date,
        end_date: data.end_date,
        locate_type: data.locate_type,
        donation_site_id: data.donation_site_id,
        location: data.location,
        excludeCampaignId: id,
      });

      if (!conflictCheck.valid) {
        return res.json({
          status: false,
          message: conflictCheck.message,
          conflict: conflictCheck.conflict || null,
        });
      }

      const payload = {
        title: data.title,
        content: data.content,
        start_date: data.start_date,
        end_date: data.end_date,
        is_emergency: data.is_emergency,
        locate_type: data.locate_type,
        location: null,
        donation_site_id: null,
      };

      if (data.locate_type === "custom") {
        payload.location = data.location;
      }

      if (data.locate_type === "donation_site") {
        payload.donation_site_id = data.donation_site_id;
      }

      const importantChanged =
        (data.title ?? "") !== (campaign.title ?? "") ||
        (data.start_date ?? "") !== (campaign.start_date ?? "") ||
        (data.end_date ?? "") !== (campaign.end_date ?? "") ||
        String(data.is_emergency ?? "") !==
          String(campaign.is_emergency ?? "") ||
        (data.locate_type ?? "") !== (campaign.locate_type ?? "") ||
        String(data.donation_site_id ?? "") !==
          String(campaign.donation_site_id ?? "") ||
        (data.location ?? "") !== (campaign.location ?? "");

      if (
        campaign.approval_status === "rejected" ||
        (campaign.approval_status === "approved" && importantChanged)
      ) {
        payload.approval_status = "pending";
        payload.reviewed_by_admin_id = null;
        payload.reviewed_at = null;
        payload.rejected_reason = null;
      }

      await campaign.update(payload);
      await campaign.reload();

      attachDisplayStatus(campaign);

      return res.json({
        status: true,
        canEdit: true,
        message: "Cập nhật chiến dịch thành công",
        data: campaign,
      });
    } catch (err) {
      console.error("updateCampaign error:", err);

      return res.status(500).json({
        status: false,
        message: err.message,
      });
    }
  },

  // ============================================================================
  // 5. CLOSE CAMPAIGN
  // ============================================================================
  async closeCampaign(req, res) {
    try {
      const id = req.params.id;

      const campaign = await Campaign.findByPk(id);

      if (!campaign) {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy chiến dịch",
        });
      }

      if (campaign.status === "ended") {
        attachDisplayStatus(campaign);

        return res.json({
          status: true,
          message: "Chiến dịch đã được đóng trước đó.",
          data: campaign,
        });
      }

      await campaign.update({
        status: "ended",
      });

      await campaign.reload();

      attachDisplayStatus(campaign);

      return res.json({
        status: true,
        message: "Đã đóng chiến dịch thành công!",
        data: campaign,
      });
    } catch (err) {
      console.error("closeCampaign error:", err);

      return res.status(500).json({
        status: false,
        message: err.message,
      });
    }
  },

  // ============================================================================
  // 6. GET APPOINTMENTS
  // ============================================================================
  async getCampaignAppointments(req, res) {
    try {
      const id = req.params.id;

      const appointments = await Appointment.findAll({
        where: {
          campaign_id: id,
        },
        order: [["scheduled_at", "ASC"]],
      });

      if (!appointments.length) {
        return res.json({
          status: true,
          data: [],
        });
      }

      const donorIds = [
        ...new Set(appointments.map((a) => a.donor_id)),
      ];

      const donorList = await User.findAll({
        where: {
          id: donorIds,
        },
        attributes: ["id", "full_name", "phone", "blood_group"],
      });

      const mapUser = {};

      donorList.forEach((u) => {
        mapUser[u.id] = u;
      });

      const fmtDate = (d) => {
        if (!d) return "";

        const dt = new Date(d);
        const day = String(dt.getDate()).padStart(2, "0");
        const month = String(dt.getMonth() + 1).padStart(2, "0");
        const year = dt.getFullYear();

        return `${day}/${month}/${year}`;
      };

      const fmtTime = (d) => {
        if (!d) return "";

        const dt = new Date(d);
        const h = String(dt.getHours()).padStart(2, "0");
        const m = String(dt.getMinutes()).padStart(2, "0");

        return `${h}:${m}`;
      };

      const list = appointments.map((a) => {
        return {
          id: a.id,
          donorName: mapUser[a.donor_id]?.full_name || "Không rõ",
          donorPhone: mapUser[a.donor_id]?.phone || "Không rõ",
          bloodType: mapUser[a.donor_id]?.blood_group || "Không rõ",
          date: fmtDate(a.scheduled_at),
          time: fmtTime(a.scheduled_at),
          status: a.status,
          statusClass:
            a.status === "COMPLETED"
              ? "bg-success text-white"
              : a.status === "REQUESTED"
                ? "bg-warning text-dark"
                : "bg-danger text-white",
        };
      });

      return res.json({
        status: true,
        data: list,
      });
    } catch (err) {
      console.error("getCampaignAppointments error:", err);

      return res.status(500).json({
        status: false,
        message: err.message,
      });
    }
  },
};