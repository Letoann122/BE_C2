"use strict";
module.exports = (sequelize, DataTypes) => {
  const VInventoryCurrent = sequelize.define(
    "VInventoryCurrent",
    {
      hospital_id: DataTypes.BIGINT,
      hospital_name: DataTypes.STRING(255),
      blood_type_id: DataTypes.BIGINT,
      blood_group: DataTypes.STRING(3),
      available_units: DataTypes.INTEGER,
      updated_at: DataTypes.DATE,
    },
    { tableName: "v_inventory_current", freezeTableName: true, timestamps: false }
  );
  return VInventoryCurrent;
};
