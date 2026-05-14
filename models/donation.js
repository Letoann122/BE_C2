"use strict";

module.exports = (sequelize, DataTypes) => {
  const Donation = sequelize.define(
    "Donation",
    {
      id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true,
      },

      donor_user_id: DataTypes.BIGINT,

      appointment_id: DataTypes.BIGINT,

      emergency_request_id: DataTypes.BIGINT,

      hospital_id: DataTypes.BIGINT,

      blood_type_id: DataTypes.BIGINT,

      volume_ml: DataTypes.INTEGER,

      collected_at: DataTypes.DATE,

      screened_ok: DataTypes.TINYINT,

      confirmed_by_doctor_id: DataTypes.BIGINT,

      confirmed_at: DataTypes.DATE,

      notes: DataTypes.STRING(255),
    },
    {
      tableName: "donations",
      timestamps: false,
    }
  );

  Donation.associate = (models) => {
    Donation.belongsTo(models.Appointment, {
      foreignKey: "appointment_id",
    });

    Donation.belongsTo(models.EmergencyRequest, {
      foreignKey: "emergency_request_id",
      as: "emergency_request",
    });

    Donation.belongsTo(models.User, {
      foreignKey: "donor_user_id",
      as: "donor",
    });

    Donation.belongsTo(models.BloodType, {
      foreignKey: "blood_type_id",
      as: "blood_type",
    });
  };

  return Donation;
};