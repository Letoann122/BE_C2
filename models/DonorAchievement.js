"use strict";

module.exports = (sequelize, DataTypes) => {
  const DonorAchievement = sequelize.define(
    "DonorAchievement",
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      donor_id: { type: DataTypes.BIGINT, allowNull: false },
      achievement_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      current_value: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      is_unlocked: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 0 },
      unlocked_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: "donor_achievements",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  DonorAchievement.associate = (models) => {
    DonorAchievement.belongsTo(models.User, {
      foreignKey: "donor_id",
      as: "donor",
    });

    DonorAchievement.belongsTo(models.Achievement, {
      foreignKey: "achievement_id",
      as: "achievement",
    });
  };

  return DonorAchievement;
};