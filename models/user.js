"use strict";
const { Model, uuidv4 } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class User extends Model {
    static associate(models) {
    }
  }

  User.init(
    {
      full_name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      birthday: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      gender: {
        type: DataTypes.ENUM("Nam", "Nữ"),
        allowNull: false,
      },
      phone: {
        type: DataTypes.STRING(10),
        allowNull: false,
        unique: true,
      },
      email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
        validate: {
          isEmail: true,
        },
      },
      address: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      blood_group: {
        type: DataTypes.ENUM("A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"),
        allowNull: true,
      },
      role: {
        type: DataTypes.ENUM("donor", "admin", "hospital","doctor"),
        allowNull: false,
        defaultValue: "donor",
      },
      medical_history: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      password: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      tinh_trang: {
        type: DataTypes.TINYINT,
        allowNull: false,
        defaultValue: 0,
        comments: "Trạng thái tài khoản",
      },
      hash_active: {
        type: DataTypes.STRING(36),
        allowNull: true,
        require: false,
      },
      reset_token: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      reset_expires: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "User",
      tableName: "users",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return User;
};
