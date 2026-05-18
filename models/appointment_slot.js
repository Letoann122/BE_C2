"use strict";

module.exports = (sequelize, DataTypes) => {
  const AppointmentSlot = sequelize.define(
    "AppointmentSlot",
    {
      id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true,
      },

      campaign_id: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },

      donation_site_id: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },

      slot_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },

      start_time: {
        type: DataTypes.TIME,
        allowNull: false,
      },

      end_time: {
        type: DataTypes.TIME,
        allowNull: false,
      },

      slot_capacity: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 10,
      },

      current_count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },

      total_registered: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },

      type: {
        type: DataTypes.ENUM("fixed_point", "campaign"),
        allowNull: false,
        defaultValue: "fixed_point",
      },

      donation_point_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },

      location_custom: {
        type: DataTypes.STRING(255),
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
      tableName: "appointment_slots",
      timestamps: false,
    }
  );

  AppointmentSlot.associate = (models) => {
    AppointmentSlot.belongsTo(models.DonationSite, {
      foreignKey: "donation_site_id",
      as: "donation_site",
    });

    AppointmentSlot.belongsTo(models.Campaign, {
      foreignKey: "campaign_id",
      as: "campaign",
    });

    AppointmentSlot.hasMany(models.Appointment, {
      foreignKey: "appointment_slot_id",
      as: "appointments",
    });
  };

  return AppointmentSlot;
};