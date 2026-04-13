"use strict";

module.exports = (sequelize, DataTypes) => {
  const EmailJob = sequelize.define(
    "EmailJob",
    {
      email: DataTypes.STRING,
      subject: DataTypes.STRING,
      template: DataTypes.STRING,
      payload: DataTypes.JSON,
      scheduled_at: DataTypes.DATE,
      sent_at: DataTypes.DATE,
      status: DataTypes.STRING,
      fail_reason: DataTypes.TEXT,
    },
    {
      tableName: "email_jobs",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return EmailJob;
};
