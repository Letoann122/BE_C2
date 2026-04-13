"use strict";

module.exports = (sequelize, DataTypes) => {
  const Notification = sequelize.define(
    "Notification",
    {
      id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
      user_id: DataTypes.BIGINT,
      title: DataTypes.STRING,
      content: DataTypes.TEXT,
      recipient: DataTypes.STRING,
      emergency: DataTypes.BOOLEAN,
      sent_count: DataTypes.INTEGER,
      status: DataTypes.STRING,
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE,
    },
    {
      tableName: "notifications",
      timestamps: true,
      underscored: true,
    }
  );

  Notification.associate = (models) => {
    Notification.belongsTo(models.User, {
      foreignKey: "user_id",
      as: "sender",
    });
  };

  return Notification;
};
