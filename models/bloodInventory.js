"use strict";

module.exports = (sequelize, DataTypes) => {
  const BloodInventory = sequelize.define(
    "BloodInventory",
    {
      id: {
        type: DataTypes.BIGINT,
        autoIncrement: true,
        primaryKey: true,
      },

      donation_id: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },

      hospital_id: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },

      blood_type_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },

      units: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },

      donation_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },

      expiry_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },

      status: {
        type: DataTypes.ENUM(
          "testing",
          "available",
          "discarded",
          "expired"
        ),
        allowNull: false,
        defaultValue: "testing",
      },

      quality_note: {
        type: DataTypes.STRING,
        allowNull: true,
      },

      tested_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },

      tested_by_doctor_id: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },

      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE,
    },
    {
      tableName: "blood_inventory",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  BloodInventory.associate = (models) => {
    BloodInventory.belongsTo(models.BloodType, {
      foreignKey: "blood_type_id",
      as: "blood_type",
    });

    BloodInventory.belongsTo(models.Hospital, {
      foreignKey: "hospital_id",
      as: "hospital",
    });

    BloodInventory.belongsTo(models.Donation, {
      foreignKey: "donation_id",
      as: "donation",
    });

    BloodInventory.belongsTo(models.Doctor, {
      foreignKey: "tested_by_doctor_id",
      as: "tested_by_doctor",
    });
  };

  return BloodInventory;
};