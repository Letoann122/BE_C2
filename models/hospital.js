"use strict";
module.exports = (sequelize, DataTypes) => {
  const Hospital = sequelize.define(
    "Hospital",
    {
      id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
      name: DataTypes.STRING(255),
      address: DataTypes.TEXT,
      hotline: DataTypes.STRING(30),    // ✅ đúng với DB
      email: DataTypes.STRING(255),
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE,
    },
    {
      tableName: "hospitals",
      timestamps: false,
    }
  );

  Hospital.associate = (models) => {
    Hospital.hasMany(models.DonationSite, { foreignKey: "hospital_id" });
  };

  return Hospital;
};
