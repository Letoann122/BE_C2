"use strict";

module.exports = (sequelize, DataTypes) => {
  const EmergencyRequest = sequelize.define(
    "EmergencyRequest",
    {
      id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true,
      },

      hospital_id: DataTypes.BIGINT,
      donation_site_id: DataTypes.BIGINT,
      created_by_doctor_id: DataTypes.BIGINT,

      blood_type_id: DataTypes.BIGINT,

      blood_group: DataTypes.STRING(5),

      required_volume_ml: {
        type: DataTypes.INTEGER,
        defaultValue: 500,
      },

      fulfilled_volume_ml: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },

      urgency_level: {
        type: DataTypes.ENUM("normal", "high", "critical"),
        defaultValue: "critical",
      },

      needed_before: DataTypes.DATE,

      title: DataTypes.STRING,
      message: DataTypes.TEXT,

      status: {
        type: DataTypes.ENUM(
          "open",
          "fulfilled",
          "cancelled",
          "expired"
        ),
        defaultValue: "open",
      },

      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE,
    },
    {
      tableName: "emergency_requests",
      timestamps: false,
    }
  );

  EmergencyRequest.associate = (models) => {
    EmergencyRequest.belongsTo(models.Hospital, {
      foreignKey: "hospital_id",
    });

    EmergencyRequest.belongsTo(models.DonationSite, {
      foreignKey: "donation_site_id",
    });

    EmergencyRequest.belongsTo(models.Doctor, {
      foreignKey: "created_by_doctor_id",
    });

    EmergencyRequest.belongsTo(models.BloodType, {
      foreignKey: "blood_type_id",
    });

    EmergencyRequest.hasMany(models.EmergencyRequestResponse, {
      foreignKey: "emergency_request_id",
    });

    EmergencyRequest.hasMany(models.Appointment, {
      foreignKey: "emergency_request_id",
    });

    EmergencyRequest.hasMany(models.Donation, {
      foreignKey: "emergency_request_id",
    });
  };

  return EmergencyRequest;
};