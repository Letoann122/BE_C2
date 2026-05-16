"use strict";

const { UserNotification } = require("../models");
const { emitUserNotification } = require("../socket");

const normalizeMetaJson = (value) => {
  if (!value) return null;

  if (typeof value === "object") return value;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

module.exports = {
  async create({
    user_id,
    type = "system",
    title,
    message,
    priority = "normal",
    action_url = null,
    meta_json = null,
    transaction = null,
  }) {
    if (!user_id || !title || !message) {
      return null;
    }

    const now = new Date();

    const notification = await UserNotification.create(
      {
        user_id,
        type,
        title,
        message,
        priority,
        action_url,
        meta_json: normalizeMetaJson(meta_json),
        is_read: 0,
        read_at: null,
        created_at: now,
        updated_at: now,
      },
      {
        transaction,
      }
    );

    emitUserNotification(user_id, {
      notification,
    });

    return notification;
  },

  async createMany({ user_ids = [], ...payload }) {
    const uniqueUserIds = [...new Set(user_ids.filter(Boolean))];

    const rows = [];

    for (const userId of uniqueUserIds) {
      const row = await this.create({
        ...payload,
        user_id: userId,
      });

      if (row) rows.push(row);
    }

    return rows;
  },
};