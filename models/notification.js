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

      emergency: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },

      sent_count: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },

      status: {
        type: DataTypes.STRING,
        defaultValue: "sent",
      },

      is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      expires_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },

      closed_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },

      closed_by_user_id: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },

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

    Notification.belongsTo(models.User, {
      foreignKey: "closed_by_user_id",
      as: "closed_by_user",
    });
  };

  return Notification;
};