"use strict";

const { Op } = require("sequelize");
const {
  Donor,
  User,
  BloodType,
  Donation,
  Appointment,
  DonationSite,
  Hospital,
  Campaign, // ✅ thêm Campaign (nếu bạn đã có model này)
} = require("../../models");

module.exports = {
  async detail(req, res) {
    try {
      const user_id = req.params.id;

      // 1️⃣ Lấy thông tin donor + user + blood type
      const donor = await Donor.findOne({
        where: { user_id },
        include: [
          {
            model: User,
            attributes: [
              "full_name",
              "birthday",
              "gender",
              "phone",
              "email",
              "address",
              "blood_group",
              "tinh_trang",
            ],
          },
          { model: BloodType, attributes: ["abo", "rh"] },
        ],
      });

      if (!donor) {
        return res.status(404).json({ status: false, message: "Donor không tồn tại" });
      }

      // 2️⃣ Lấy lịch sử hiến máu
      const history = await Donation.findAll({
        where: { donor_user_id: user_id },
        include: [
          {
            model: Appointment,
            include: [
              {
                model: DonationSite,
                as: "donation_site",
                include: [{ model: Hospital }],
              },
            ],
          },
        ],
        order: [["collected_at", "DESC"]],
      });

      // 3️⃣ Lần hiến máu gần nhất
      const lastDonation = history.length > 0 ? history[0] : null;

      // ✅ 4️⃣ Bổ sung: gom campaign_id để query 1 lần (tránh N+1)
      const campaignIds = Array.from(
        new Set(
          history
            .map((x) => x?.campaign_id || x?.Appointment?.campaign_id) // hỗ trợ cả donation.campaign_id / appointment.campaign_id
            .filter(Boolean)
        )
      );

      let campaignMap = new Map();
      if (campaignIds.length && Campaign) {
        const campaigns = await Campaign.findAll({
          where: { id: { [Op.in]: campaignIds } },
          attributes: ["id", "title", "location"], // dùng đúng field bạn nói: title + location
        });
        campaignMap = new Map(campaigns.map((c) => [c.id, c]));
      }

      // 5️⃣ Nhóm máu hiển thị
      const bloodType = donor.BloodType
        ? `${donor.BloodType.abo}${donor.BloodType.rh}`
        : donor.User.blood_group || "Không rõ";

      // Helper map record (✅ fix chiến dịch)
      const mapDonationRecord = (item) => {
        const appointment = item.Appointment || null;

        const site = appointment?.donation_site || null;
        const hospital = site?.Hospital || null;

        // ✅ detect campaign
        const cid = item?.campaign_id || appointment?.campaign_id || null;
        const campaign = cid ? campaignMap.get(cid) : null;

        // ✅ nếu không có donation_site/hospital => ưu tiên hiến theo chiến dịch
        const isCampaign = !site && !!(campaign || appointment?.location);

        const displaySite = isCampaign
          ? (campaign?.location || appointment?.location || "")
          : (site?.name || "");

        const displayHospital = isCampaign
          ? (campaign?.title || appointment?.campaign_name || "")
          : (hospital?.name || "");

        return {
          date: item.collected_at ? item.collected_at.toISOString().slice(0, 10) : null,
          volume: item.volume_ml || 0,
          site: displaySite,
          hospital: displayHospital,
          status: "Hoàn thành",
          // optional: type để FE muốn badge thì có
          type: isCampaign ? "campaign" : "normal",
        };
      };

      return res.json({
        status: true,
        data: {
          donor: {
            id: user_id,
            name: donor.User.full_name,
            birthday: donor.User.birthday,
            gender: donor.User.gender,
            phone: donor.User.phone,
            email: donor.User.email,
            address: donor.User.address,
            bloodType,
            status: donor.User.tinh_trang === 1 ? "Hoạt động" : "Tạm ngừng",
          },
          lastDonation: lastDonation ? mapDonationRecord(lastDonation) : null,
          history: history.map(mapDonationRecord),
        },
      });
    } catch (error) {
      console.error("❌ Lỗi lấy chi tiết donor:", error);
      return res.status(500).json({ status: false, error: error.message });
    }
  },
};
