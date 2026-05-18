"use strict";

module.exports = (sequelize, DataTypes) => {
  const Achievement = sequelize.define(
    "Achievement",
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      code: { type: DataTypes.STRING(100), allowNull: false, unique: true },
      name: { type: DataTypes.STRING(255), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      icon: { type: DataTypes.STRING(100), allowNull: true },
      badge_color: { type: DataTypes.STRING(50), allowNull: true },
      achievement_type: { type: DataTypes.STRING(50), allowNull: false, defaultValue: "donation_count" },
      requirement_value: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      exp_reward: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      is_active: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 1 },
    },
    {
      tableName: "achievements",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  Achievement.associate = (models) => {
    Achievement.hasMany(models.DonorAchievement, {
      foreignKey: "achievement_id",
      as: "donor_achievements",
    });
  };

  return Achievement;
};