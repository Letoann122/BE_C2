"use strict";

const { Op } = require("sequelize");
const {
  sequelize,
  User,
  Donor,
  Achievement,
  DonorAchievement,
} = require("../models");

const getRankByDonationCount = (count) => {
  const total = Number(count || 0);

  if (total >= 25) return "diamond";
  if (total >= 10) return "gold";
  if (total >= 5) return "silver";
  return "bronze";
};

const getStatsByDonorUserId = async (donorUserId, transaction = null) => {
  const statsSql = `
    SELECT
      COUNT(*) AS total_count,
      COALESCE(SUM(d.volume_ml), 0) AS total_volume_ml,
      SUM(CASE WHEN a.campaign_id IS NOT NULL THEN 1 ELSE 0 END) AS campaign_count,
      SUM(CASE WHEN c.is_emergency = 1 THEN 1 ELSE 0 END) AS emergency_count
    FROM donations d
    JOIN appointments a ON a.id = d.appointment_id
    LEFT JOIN campaigns c ON c.id = a.campaign_id
    WHERE d.donor_user_id = :donorUserId
  `;

  const [rows] = await sequelize.query(statsSql, {
    replacements: { donorUserId },
    transaction,
  });

  const row = rows?.[0] || {};

  return {
    total_count: Number(row.total_count || 0),
    total_volume_ml: Number(row.total_volume_ml || 0),
    campaign_count: Number(row.campaign_count || 0),
    emergency_count: Number(row.emergency_count || 0),
  };
};

const getCurrentValueByType = (achievementType, stats) => {
  switch (achievementType) {
    case "donation_count":
      return stats.total_count;
    case "donation_volume":
      return stats.total_volume_ml;
    case "campaign":
      return stats.campaign_count;
    case "emergency":
      return stats.emergency_count;
    default:
      return 0;
  }
};

const syncDonorAchievements = async (donorUserId, transaction = null) => {
  const stats = await getStatsByDonorUserId(donorUserId, transaction);

  const achievements = await Achievement.findAll({
    where: { is_active: 1 },
    order: [["sort_order", "ASC"]],
    transaction,
  });

  const unlockedNow = [];

  for (const achievement of achievements) {
    const currentValue = getCurrentValueByType(
      achievement.achievement_type,
      stats
    );

    const existed = await DonorAchievement.findOne({
      where: {
        donor_id: donorUserId,
        achievement_id: achievement.id,
      },
      transaction,
    });

    const shouldUnlock =
      Number(currentValue || 0) >= Number(achievement.requirement_value || 0);

    if (!existed) {
      const created = await DonorAchievement.create(
        {
          donor_id: donorUserId,
          achievement_id: achievement.id,
          current_value: currentValue,
          is_unlocked: shouldUnlock ? 1 : 0,
          unlocked_at: shouldUnlock ? new Date() : null,
        },
        { transaction }
      );

      if (shouldUnlock) {
        unlockedNow.push({
          ...achievement.toJSON(),
          donor_achievement_id: created.id,
          current_value: currentValue,
          unlocked_at: created.unlocked_at,
        });
      }

      continue;
    }

    const wasUnlocked = Number(existed.is_unlocked) === 1;

    existed.current_value = currentValue;

    if (shouldUnlock && !wasUnlocked) {
      existed.is_unlocked = 1;
      existed.unlocked_at = new Date();

      unlockedNow.push({
        ...achievement.toJSON(),
        donor_achievement_id: existed.id,
        current_value: currentValue,
        unlocked_at: existed.unlocked_at,
      });
    }

    await existed.save({ transaction });
  }

  const expPoints = stats.total_count * 100;
  const rank = getRankByDonationCount(stats.total_count);

  await Donor.update(
    {
      donation_count: stats.total_count,
      total_blood_ml: stats.total_volume_ml,
      emergency_donation_count: stats.emergency_count,
      exp_points: expPoints,
      donor_rank: rank,
    },
    {
      where: { user_id: donorUserId },
      transaction,
    }
  );

  return {
    stats,
    exp_points: expPoints,
    donor_rank: rank,
    unlocked_now: unlockedNow,
  };
};

const getDonorAchievementProfile = async (donorUserId) => {
  await syncDonorAchievements(donorUserId);

  const donor = await Donor.findOne({
    where: { user_id: donorUserId },
    raw: true,
  });

  const user = await User.findByPk(donorUserId, {
    attributes: [
      "id",
      "full_name",
      "email",
      "phone",
      "address",
      "birthday",
      "gender",
      "blood_group",
    ],
    raw: true,
  });

  const rows = await DonorAchievement.findAll({
    where: { donor_id: donorUserId },
    include: [
      {
        model: Achievement,
        as: "achievement",
        where: { is_active: 1 },
      },
    ],
    order: [[{ model: Achievement, as: "achievement" }, "sort_order", "ASC"]],
  });

  const achievements = rows.map((row) => {
    const raw = row.toJSON();
    const achievement = raw.achievement || {};
    const current = Number(raw.current_value || 0);
    const requirement = Number(achievement.requirement_value || 0);

    const displayCurrentValue =
  requirement > 0 ? Math.min(current, requirement) : current;

return {
  id: raw.id,
  achievement_id: achievement.id,
  code: achievement.code,
  name: achievement.name,
  description: achievement.description,
  icon: achievement.icon,
  badge_color: achievement.badge_color,
  achievement_type: achievement.achievement_type,
  requirement_value: requirement,

  // Giá trị thật để xử lý logic
  current_value: current,

  // Giá trị hiển thị để tránh 2/1, 10/5...
  display_current_value: displayCurrentValue,

  progress_percent:
    requirement > 0
      ? Math.min(Math.round((current / requirement) * 100), 100)
      : 0,

  exp_reward: achievement.exp_reward,
  is_unlocked: Number(raw.is_unlocked) === 1,
  unlocked_at: raw.unlocked_at,
};
  });

  const unlockedCount = achievements.filter((item) => item.is_unlocked).length;

  return {
    user,
    donor: donor || {},
    summary: {
      donation_count: Number(donor?.donation_count || 0),
      total_blood_ml: Number(donor?.total_blood_ml || 0),
      emergency_donation_count: Number(donor?.emergency_donation_count || 0),
      exp_points: Number(donor?.exp_points || 0),
      donor_rank: donor?.donor_rank || "bronze",
      unlocked_achievements: unlockedCount,
      total_achievements: achievements.length,
    },
    achievements,
  };
};

module.exports = {
  getRankByDonationCount,
  getStatsByDonorUserId,
  syncDonorAchievements,
  getDonorAchievementProfile,
};