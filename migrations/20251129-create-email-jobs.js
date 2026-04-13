"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("email_jobs", {
      id: {
        type: Sequelize.BIGINT,
        autoIncrement: true,
        primaryKey: true,
      },

      email: { type: Sequelize.STRING(255), allowNull: false },
      subject: { type: Sequelize.STRING(255), allowNull: false },
      template: { type: Sequelize.STRING(100), allowNull: false },

      payload: { type: Sequelize.JSON, allowNull: true },

      scheduled_at: { type: Sequelize.DATE, allowNull: false },
      sent_at: { type: Sequelize.DATE, allowNull: true },

      status: {
        type: Sequelize.ENUM("pending", "processing", "sent", "failed"),
        defaultValue: "pending",
      },

      fail_reason: { type: Sequelize.TEXT, allowNull: true },

      created_at: Sequelize.DATE,
      updated_at: Sequelize.DATE,
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("email_jobs");
  },
};
