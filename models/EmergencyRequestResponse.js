"use strict";

module.exports = (sequelize, DataTypes) => {
  const EmergencyRequestResponse = sequelize.define(
    "EmergencyRequestResponse",
    {
      id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true,
      },

      emergency_request_id: DataTypes.BIGINT,

      donor_id: DataTypes.BIGINT,

      response_status: {
        type: DataTypes.ENUM(
          "pending",
          "accepted",
          "declined",
          "expired"
        ),
        defaultValue: "pending",
      },

      ai_score: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },

      distance_km: DataTypes.DECIMAL(10, 2),

      reason_summary: DataTypes.TEXT,

      notified_at: DataTypes.DATE,
      responded_at: DataTypes.DATE,

      appointment_id: DataTypes.BIGINT,

      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE,
    },
    {
      tableName: "emergency_request_responses",
      timestamps: false,
    }
  );

  EmergencyRequestResponse.associate = (models) => {
    EmergencyRequestResponse.belongsTo(models.EmergencyRequest, {
      foreignKey: "emergency_request_id",
    });

    EmergencyRequestResponse.belongsTo(models.User, {
      foreignKey: "donor_id",
    });

    EmergencyRequestResponse.belongsTo(models.Appointment, {
      foreignKey: "appointment_id",
    });
  };

  return EmergencyRequestResponse;
};