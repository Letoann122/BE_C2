"use strict";

const cron = require("node-cron");
const { generateFixedPointSlots } = require("./slotGenerateService");

function startSlotCron() {
  cron.schedule("0 0 * * *", async () => {
    try {
      const result = await generateFixedPointSlots(30);
      console.log(`✅ Auto generated ${result.createdCount} fixed-point slots`);
    } catch (error) {
      console.error("❌ Auto generate slots error:", error);
    }
  });
}

module.exports = {
  startSlotCron,
};