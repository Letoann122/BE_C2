"use strict";

const { User, Donor, Notification } = require("../../models");
const { sendMail } = require("../../services/mailService");

module.exports = {
    async sendNotification(req, res) {
        try {
            const { title, recipient, emergency, content } = req.body;
            const currentUserId = req.user?.id || req.user?.userId || null;
            if (!title || !content) {
                return res.status(400).json({
                    status: false,
                    message: "Tiêu đề và nội dung không được để trống.",
                });
            }
            const whereDonor = { tinh_trang: 1 }; // ACTIVE
            if (recipient !== "all") {
                whereDonor.blood_type_id = null;
            }
            const donors = await Donor.findAll({
                where: { tinh_trang: 1 },
                attributes: ["id", "user_id"],
            });
            if (donors.length === 0) {
                return res.status(404).json({
                    status: false,
                    message: "Không tìm thấy donor nào đang hoạt động.",
                });
            }
            const userIds = donors.map((d) => d.user_id);
            const users = await User.findAll({
                where: {
                    id: userIds,
                    role: "donor",
                    ...(recipient !== "all" ? { blood_group: recipient } : {}),
                },
                attributes: ["id", "full_name", "email", "blood_group"],
            });
            const validUsers = users.filter(
                (u) => u.email && u.email.trim() !== ""
            );
            const totalRecipients = validUsers.length;
            if (totalRecipients === 0) {
                return res.status(404).json({
                    status: false,
                    message: "Không có donor phù hợp để gửi thông báo.",
                });
            }
            const subject = (emergency ? "[KHẨN CẤP] " : "") + title;
            const jobs = validUsers.map((u) => {
                const mailData = {
                    ten: u.full_name,
                    nhom_mau: u.blood_group,
                    title,
                    noi_dung: content,
                    emergency: emergency ? true : false,
                };
                return sendMail({
                    to: u.email,
                    subject,
                    template: "support_notification",
                    data: mailData,
                });
            });
            await Promise.all(jobs);
            const saved = await Notification.create({
                user_id: currentUserId,
                title,
                content,
                recipient,
                emergency,
                sent_count: totalRecipients,
                status: "sent",
            });
            return res.status(200).json({
                status: true,
                message: `Đã gửi đến ${totalRecipients} donor.`,
                sent_count: totalRecipients,
                notification: saved,
            });
        } catch (err) {
            console.error("❌ Lỗi gửi thông báo:", err);
            return res.status(500).json({
                status: false,
                message: "Lỗi hệ thống khi gửi thông báo.",
            });
        }
    },

    async listNotifications(req, res) {
        try {
            const list = await Notification.findAll({
                order: [["created_at", "DESC"]],
            });
            return res.json({
                status: true,
                data: list,
            });
        } catch (err) {
            console.error("❌ Lỗi lấy danh sách:", err);
            return res.status(500).json({
                status: false,
                message: "Không thể tải danh sách thông báo.",
            });
        }
    },
};
