// BE/models/news.js
// models/News.js
module.exports = (sequelize, DataTypes) => {
  const News = sequelize.define(
    "News",
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },

      title: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },

      content: {
        type: DataTypes.TEXT("long"),
        allowNull: false,
      },

      image_url: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },

      published_date: {
        type: DataTypes.DATEONLY,
        defaultValue: DataTypes.NOW,
      },

      // ✅ doctor tạo bài
      created_by: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },

      // ✅ workflow duyệt
      status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "pending", // draft | pending | approved | rejected
      },

      reviewed_by: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },

      reviewed_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },

      review_note: {
        type: DataTypes.TEXT("long"),
        allowNull: true,
      },
    },
    {
      tableName: "news",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return News;
};
