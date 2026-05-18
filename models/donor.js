"use strict";

module.exports = (sequelize, DataTypes) => {
  const Donor = sequelize.define(
    "Donor",
    {
      id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
      user_id: DataTypes.BIGINT,
      full_name: DataTypes.STRING,
      email: DataTypes.STRING,
      phone: DataTypes.STRING,
      address: DataTypes.STRING,
      blood_type_id: DataTypes.BIGINT,
      gender: DataTypes.STRING,
      birthday: DataTypes.DATE,
      medical_history: DataTypes.TEXT,
      last_donation_date: DataTypes.DATE,
      last_known_lat: DataTypes.DECIMAL(10, 7),
      last_known_lng: DataTypes.DECIMAL(10, 7),
      last_location_at: DataTypes.DATE,
      donation_count: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },

      // GAMIFICATION
      exp_points: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      donor_rank: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: "bronze",
      },
      total_blood_ml: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      emergency_donation_count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },

      tinh_trang: DataTypes.TINYINT,
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE,
    },
    {
      tableName: "donors",
      timestamps: false,
    }
  );

  Donor.associate = (models) => {
    Donor.belongsTo(models.User, { foreignKey: "user_id" });
    Donor.belongsTo(models.BloodType, { foreignKey: "blood_type_id" });
  };

  return Donor;
};