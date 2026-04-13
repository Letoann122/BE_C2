"use strict";
module.exports = (sequelize, DataTypes) => {
  const AppointmentSlot = sequelize.define(
    "AppointmentSlot",
    {
      id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
      donation_site_id: DataTypes.BIGINT,
      start_time: DataTypes.DATE,
      end_time: DataTypes.DATE,
      capacity: DataTypes.INTEGER,
      booked_count: DataTypes.INTEGER,
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE,
    },
    { tableName: "appointment_slots", timestamps: false }
  );

  AppointmentSlot.associate = (models) => {
    AppointmentSlot.belongsTo(models.DonationSite, { foreignKey: "donation_site_id" });
    AppointmentSlot.hasMany(models.Appointment, { foreignKey: "appointment_slot_id" });
  };

  return AppointmentSlot;
};
