"use strict";

const { APPOINTMENT_STATUS } = require("../constants/appointmentStatus");

module.exports = (sequelize, DataTypes) => {
  const Appointment = sequelize.define(
    "Appointment",
    {
      id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true,
      },
      donor_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      donation_site_id: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },
      appointment_slot_id: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },
      slot_id: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },
      campaign_id: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },
      appointment_code: {
        type: DataTypes.STRING(50),
        allowNull: true,
        unique: true,
      },
      scheduled_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      preferred_volume_ml: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: APPOINTMENT_STATUS.REQUESTED,
        validate: {
          isIn: [Object.values(APPOINTMENT_STATUS)],
        },
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      approved_by_doctor_id: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },
      approved_by_admin_id: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },
      approved_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      rejected_reason: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      checked_in_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      checked_in_by_doctor_id: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },
      screening_started_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      donation_started_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      completed_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      no_show_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      created_at: {
        type: DataTypes.DATE,
        defaultValue: sequelize.literal("CURRENT_TIMESTAMP"),
      },
      updated_at: {
        type: DataTypes.DATE,
        defaultValue: sequelize.literal("CURRENT_TIMESTAMP"),
      },
    },
    {
      tableName: "appointments",
      timestamps: false,
    }
  );

  Appointment.associate = (models) => {
    Appointment.belongsTo(models.User, {
      foreignKey: "donor_id",
      as: "donor",
    });

    Appointment.belongsTo(models.DonationSite, {
      foreignKey: "donation_site_id",
      as: "donation_site",
    });

    Appointment.belongsTo(models.AppointmentSlot, {
      foreignKey: "appointment_slot_id",
      as: "slot",
    });

    Appointment.belongsTo(models.AppointmentSlot, {
      foreignKey: "slot_id",
      as: "legacy_slot",
    });

    Appointment.belongsTo(models.Campaign, {
      foreignKey: "campaign_id",
      as: "campaign",
    });

    Appointment.belongsTo(models.Doctor, {
      foreignKey: "approved_by_doctor_id",
      as: "approved_doctor",
    });

    Appointment.belongsTo(models.Doctor, {
      foreignKey: "checked_in_by_doctor_id",
      as: "checked_in_doctor",
    });
  };

  return Appointment;
};