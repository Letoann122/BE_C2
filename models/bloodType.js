module.exports = (sequelize, DataTypes) => {
  const BloodType = sequelize.define(
    "BloodType",
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      abo: DataTypes.STRING(2),
      rh: DataTypes.STRING(2),
    },
    {
      tableName: "blood_types",
      timestamps: false,
    }
  );
  BloodType.associate = (models) => {
    BloodType.hasMany(models.BloodInventory, { foreignKey: "blood_type_id" });
  };
  return BloodType;
};
