"use strict";
module.exports = (sequelize, DataTypes) => {
  const DonationSite = sequelize.define(
    "DonationSite",
    {
      id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
      hospital_id: DataTypes.BIGINT,
      name: DataTypes.STRING(255),
      address: DataTypes.TEXT,
      lat: DataTypes.DECIMAL(9, 6),
      lon: DataTypes.DECIMAL(9, 6),
      is_active: DataTypes.TINYINT,
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE,
    },
    { tableName: "donation_sites", timestamps: false }
  );

  DonationSite.associate = (models) => {
  DonationSite.belongsTo(models.Hospital, { foreignKey: "hospital_id" });
  DonationSite.hasMany(models.AppointmentSlot, { foreignKey: "donation_site_id" });
  DonationSite.hasMany(models.Appointment, { foreignKey: "donation_site_id" });
  };

  return DonationSite;
};
