// File: migrations/YYYYMMDD...add-reset-password-fields.js

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // thêm reset_token
    await queryInterface.addColumn("Users", "reset_token", {
      type: Sequelize.STRING,
      allowNull: true,
    });

    // thêm reset_expires
    await queryInterface.addColumn("Users", "reset_expires", {
      type: Sequelize.DATE,
      allowNull: true,
    });
  },

  down: async (queryInterface, Sequelize) => {
    // Logic rollback (xóa cột)
    await queryInterface.removeColumn("Users", "reset_token");
    await queryInterface.removeColumn("Users", "reset_expires");
  }
};