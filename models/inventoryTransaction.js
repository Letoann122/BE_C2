"use strict";
module.exports = (sequelize, DataTypes) => {
  const InventoryTransaction = sequelize.define(
    "InventoryTransaction",
    {
      id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true,
      },
      inventory_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      user_id: {
        type: DataTypes.BIGINT,
        allowNull: true, // auto expire có thể không có user
      },
      tx_type: {
        type: DataTypes.STRING(10), // 'IN' | 'OUT' | 'ADJUST' | 'EXPIRE'
        allowNull: false,
      },
      units: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      reason: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      ref_donation_id: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },
      occurred_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "inventory_transactions",
      timestamps: false,
    }
  );

  InventoryTransaction.associate = (models) => {
    InventoryTransaction.belongsTo(models.BloodInventory, {
      foreignKey: "inventory_id",
    });
    InventoryTransaction.belongsTo(models.User, {
      foreignKey: "user_id",
    });
  };

  return InventoryTransaction;
};
