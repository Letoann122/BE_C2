'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addColumn('Users','tinh_trang', {
      type: Sequelize.TINYINT,
      allowNull: false,
      defaultValue: 0,
      comment: "0 = chưa kích hoạt, 1 = đã kích hoạt"
    });
    await queryInterface.addColumn('Users', 'hash_active',{
      type: Sequelize.STRING(36),
      allowNull: true,
      comments: "UUID để kích hoạt tài khoản"
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.removeColumn('Users', 'tinh_trang');
    await queryInterface.removeColumn('Users', 'hash_active');
  }
};
