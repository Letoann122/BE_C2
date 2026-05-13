"use strict";

module.exports = (sequelize, DataTypes) => {
  const SlotTemplate = sequelize.define(
    "SlotTemplate",
    {
      id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true,
      },

      donation_site_id: {
        type: DataTypes.BIGINT,
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

      default_capacity: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 10,
      },

      is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
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
      tableName: "slot_templates",
      timestamps: false,
    }
  );

  SlotTemplate.associate = (models) => {
    SlotTemplate.belongsTo(models.DonationSite, {
      foreignKey: "donation_site_id",
      as: "donation_site",
    });
  };

  return SlotTemplate;
};