"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("users", {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      full_name: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      birthday: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      gender: {
        type: Sequelize.ENUM("Nam", "Nữ"),
        allowNull: false,
      },
      phone: {
        type: Sequelize.STRING(10),
        allowNull: false,
        unique: true,
      },
      email: {
        type: Sequelize.STRING(255),
        allowNull: false,
        unique: true,
      },
      address: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      blood_group: {
        type: Sequelize.ENUM("A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"),
        allowNull: false,
      },
      role: {
        type: Sequelize.ENUM("donor", "admin", "hospital", "doctor"),
        allowNull: false,
        defaultValue: "donor",
      },
      medical_history: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      password: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      resetPasswordToken: {
        type: Sequelize.STRING(255),
        allowNull: true, // Cho phép NULL khi tạo tài khoản mới
      },
      resetPasswordExpires: {
        type: Sequelize.DATE,
        allowNull: true, // Cho phép NULL khi tạo tài khoản mới
      },
      
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        field: "created_at",
        defaultValue: Sequelize.fn("NOW"),
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        field: "updated_at",
        defaultValue: Sequelize.fn("NOW"),
      },

    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable("users");
  },

};