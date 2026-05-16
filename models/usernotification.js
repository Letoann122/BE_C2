"use strict";

module.exports = (sequelize, DataTypes) => {
  const UserNotification = sequelize.define(
    "UserNotification",
    {
      id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true,
      },

      user_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },

      type: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: "system",
      },

      title: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },

      message: {
        type: DataTypes.TEXT,
        allowNull: false,
      },

      priority: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "normal",
      },

      action_url: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },

      is_read: {
        type: DataTypes.TINYINT,
        allowNull: false,
        defaultValue: 0,
      },

      read_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },

      meta_json: {
        type: DataTypes.JSON,
        allowNull: true,
      },

      created_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },

      updated_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "user_notifications",
      timestamps: true,
      underscored: true,
    }
  );

  UserNotification.associate = (models) => {
    UserNotification.belongsTo(models.User, {
      foreignKey: "user_id",
      as: "user",
    });
  };

  return UserNotification;
};