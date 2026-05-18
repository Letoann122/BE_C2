"use strict";

const { sequelize, SlotTemplate, AppointmentSlot, Campaign } = require("../models");

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function toDateString(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function normalizeDateOnly(value) {
  return String(value).slice(0, 10);
}

function getDatesBetween(startDate, endDate) {
  const dates = [];

  const start = new Date(normalizeDateOnly(startDate));
  const end = new Date(normalizeDateOnly(endDate));

  for (let d = start; d <= end; d = addDays(d, 1)) {
    dates.push(toDateString(d));
  }

  return dates;
}

async function generateFixedPointSlots(days = 30) {
  const t = await sequelize.transaction();

  try {
    const templates = await SlotTemplate.findAll({
      where: {
        is_active: true,
      },
      transaction: t,
    });

    let createdCount = 0;

    for (let i = 0; i < days; i++) {
      const slotDate = toDateString(addDays(new Date(), i));

      for (const template of templates) {
        const existed = await AppointmentSlot.findOne({
          where: {
            type: "fixed_point",
            campaign_id: null,
            donation_site_id: template.donation_site_id,
            slot_date: slotDate,
            start_time: template.start_time,
            end_time: template.end_time,
          },
          transaction: t,
        });

        if (existed) continue;

        await AppointmentSlot.create(
          {
            campaign_id: null,
            donation_site_id: template.donation_site_id,
            slot_date: slotDate,
            start_time: template.start_time,
            end_time: template.end_time,
            slot_capacity: template.default_capacity,
            current_count: 0,
            total_registered: 0,
            type: "fixed_point",
          },
          { transaction: t }
        );

        createdCount++;
      }
    }

    await t.commit();

    return {
      status: true,
      createdCount,
    };
  } catch (error) {
    await t.rollback();
    throw error;
  }
}

async function generateCampaignSlots({
  campaign_id,
  slot_capacity = 10,
  include_morning = true,
  include_afternoon = true,
}) {
  const t = await sequelize.transaction();

  try {
    const campaign = await Campaign.findByPk(campaign_id, {
      transaction: t,
    });

    if (!campaign) {
      throw new Error("Không tìm thấy chiến dịch!");
    }

    const capacity = Number(slot_capacity);

    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error("Sức chứa slot phải lớn hơn 0!");
    }

    const dates = getDatesBetween(campaign.start_date, campaign.end_date);

    const slotRanges = [];

    if (include_morning) {
      slotRanges.push({
        start_time: "07:00:00",
        end_time: "11:00:00",
      });
    }

    if (include_afternoon) {
      slotRanges.push({
        start_time: "13:00:00",
        end_time: "17:00:00",
      });
    }

    if (slotRanges.length === 0) {
      throw new Error("Vui lòng chọn ít nhất một khung giờ!");
    }

    let createdCount = 0;
    let skippedCount = 0;

    for (const slotDate of dates) {
      for (const range of slotRanges) {
        const existed = await AppointmentSlot.findOne({
          where: {
            type: "campaign",
            campaign_id: campaign.id,
            slot_date: slotDate,
            start_time: range.start_time,
            end_time: range.end_time,
          },
          transaction: t,
        });

        if (existed) {
          skippedCount++;
          continue;
        }

        await AppointmentSlot.create(
          {
            campaign_id: campaign.id,
            donation_site_id: campaign.donation_site_id || null,
            slot_date: slotDate,
            start_time: range.start_time,
            end_time: range.end_time,
            slot_capacity: capacity,
            current_count: 0,
            total_registered: 0,
            type: "campaign",
            location_custom: campaign.location || null,
          },
          { transaction: t }
        );

        createdCount++;
      }
    }

    await t.commit();

    return {
      status: true,
      campaign_id: campaign.id,
      createdCount,
      skippedCount,
    };
  } catch (error) {
    await t.rollback();
    throw error;
  }
}

module.exports = {
  generateFixedPointSlots,
  generateCampaignSlots,
};