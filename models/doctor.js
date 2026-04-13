module.exports = (sequelize, DataTypes) => {
  const Doctor = sequelize.define(
    "Doctor",
    {
      id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true,
      },
      user_id: DataTypes.BIGINT,        // ➕ thêm
      full_name: DataTypes.STRING(100),
      birthday: DataTypes.DATEONLY,
      gender: DataTypes.STRING(10),
      phone: DataTypes.STRING(20),
      email: DataTypes.STRING(100),
      address: DataTypes.STRING(255),
      // nếu trong DB có tinh_trang thì thêm luôn:
      // tinh_trang: DataTypes.TINYINT,
    },
    {
      tableName: "doctors",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  Doctor.associate = (models) => {
    Doctor.belongsTo(models.User, { foreignKey: "user_id" });
    // có thể hasMany Appointment sau này nếu cần
  };

  return Doctor;
};
