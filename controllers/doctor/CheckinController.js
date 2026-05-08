"use strict";

const { Op } = require("sequelize");
const { Appointment, Doctor, User, DonationSite } = require("../../models");
const { emitAppointmentUpdated } = require("../../socket");
const {
    APPOINTMENT_STATUS,
    QR_ALLOWED_STATUSES,
} = require("../../constants/appointmentStatus");

function parseQrPayload(raw) {
    if (!raw) return {};

    if (typeof raw === "object") return raw;

    const text = String(raw).trim();

    try {
        const json = JSON.parse(text);
        if (json && typeof json === "object") {
            return json;
        }
    } catch (_) { }

    try {
        const url = new URL(text);
        return {
            appointment_id: url.searchParams.get("appointment_id"),
            appointment_code:
                url.searchParams.get("appointment_code") ||
                url.searchParams.get("code") ||
                url.searchParams.get("qr_code"),
        };
    } catch (_) { }

    return {
        appointment_code: text,
    };
}
const ACTIVE_BEFORE_CHECKIN_STATUSES = ["APPROVED", "BOOKED"];

function getNoShowCutoff(scheduledAt) {
    const date = new Date(scheduledAt);
    const hour = date.getHours();

    const cutoff = new Date(date);

    if (hour < 12) {
        cutoff.setHours(11, 30, 0, 0);
    } else {
        cutoff.setHours(17, 30, 0, 0);
    }

    return cutoff;
}

async function markNoShowAppointments() {
    const now = new Date();

    const appointments = await Appointment.findAll({
        where: {
            status: {
                [Op.in]: ACTIVE_BEFORE_CHECKIN_STATUSES,
            },
            checked_in_at: null,
            scheduled_at: {
                [Op.lte]: now,
            },
        },
    });

    let updatedCount = 0;

    for (const appointment of appointments) {
        const cutoff = getNoShowCutoff(appointment.scheduled_at);

        if (now >= cutoff) {
            appointment.status = "NO_SHOW";
            appointment.no_show_at = now;

            await appointment.save();
            emitAppointmentUpdated(appointment.id, {
                status: appointment.status,
                event: "CHECKED_IN",
                message: "Bạn đã check-in thành công.",
            });
            updatedCount++;
        }
    }

    return updatedCount;
}
module.exports = {
    async checkin(req, res) {
        try {
            const payload = parseQrPayload(
                req.body.qr_code || req.body.qr_payload || req.body
            );

            const appointment_id = payload.appointment_id || req.body.appointment_id;

            const appointment_code =
                payload.appointment_code ||
                payload.qr_code ||
                req.body.appointment_code ||
                req.body.qr_code;

            if (!appointment_id && !appointment_code) {
                return res.status(400).json({
                    status: false,
                    message: "Thiếu dữ liệu QR!",
                });
            }

            const doctorUserId = req.user?.userId || req.user?.id;

            const doctor = await Doctor.findOne({
                where: {
                    user_id: doctorUserId,
                },
            });

            if (!doctor) {
                return res.status(404).json({
                    status: false,
                    message: "Không tìm thấy thông tin bác sĩ!",
                });
            }

            const where = {};

            if (appointment_id) {
                where.id = appointment_id;
            }

            if (appointment_code) {
                where.appointment_code = appointment_code;
            }

            const appointment = await Appointment.findOne({
                where,
                include: [
                    {
                        model: User,
                        as: "donor",
                        attributes: ["id", "full_name", "email", "phone", "blood_group"],
                    },
                    {
                        model: DonationSite,
                        as: "donation_site",
                        attributes: ["id", "name", "address"],
                    },
                ],
            });

            if (!appointment) {
                return res.status(404).json({
                    status: false,
                    message: "Không tìm thấy lịch hẹn từ mã QR!",
                });
            }

            if (appointment.status === APPOINTMENT_STATUS.CHECKED_IN) {
                return res.json({
                    status: true,
                    message: "Lịch hẹn này đã được check-in trước đó!",
                    data: {
                        appointment_id: appointment.id,
                        appointment_code: appointment.appointment_code,
                        scheduled_at: appointment.scheduled_at,
                        status: appointment.status,
                        checked_in_at: appointment.checked_in_at,
                        checked_in_by_doctor_id: appointment.checked_in_by_doctor_id,
                        donor: appointment.donor,
                        donation_site: appointment.donation_site,
                    },
                });
            }

            if (!QR_ALLOWED_STATUSES.includes(appointment.status)) {
                return res.status(400).json({
                    status: false,
                    message: `Lịch hẹn đang ở trạng thái ${appointment.status}, không thể check-in!`,
                });
            }

            appointment.status = APPOINTMENT_STATUS.CHECKED_IN;
            appointment.checked_in_at = new Date();
            appointment.checked_in_by_doctor_id = doctor.id;

            await appointment.save();

            return res.json({
                status: true,
                message: "Check-in thành công!",
                data: {
                    appointment_id: appointment.id,
                    appointment_code: appointment.appointment_code,
                    scheduled_at: appointment.scheduled_at,
                    status: appointment.status,
                    checked_in_at: appointment.checked_in_at,
                    checked_in_by_doctor_id: appointment.checked_in_by_doctor_id,
                    donor: appointment.donor,
                    donation_site: appointment.donation_site,
                },
            });
        } catch (error) {
            console.error("CHECKIN ERROR:", error);

            return res.status(500).json({
                status: false,
                message: "Lỗi server khi check-in!",
                error: error.message,
            });
        }
    },
    async todayCheckedIn(req, res) {
        try {
            const { time_slot, status } = req.query;

            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);

            const endOfDay = new Date();
            endOfDay.setHours(23, 59, 59, 999);

            const where = {
                checked_in_at: {
                    [Op.between]: [startOfDay, endOfDay],
                },
            };

            if (status) {
                where.status = status;
            } else {
                where.status = {
                    [Op.in]: [
                        APPOINTMENT_STATUS.CHECKED_IN,
                        APPOINTMENT_STATUS.SCREENING,
                        APPOINTMENT_STATUS.DONATING,
                        APPOINTMENT_STATUS.COMPLETED,
                    ],
                };
            }

            if (time_slot === "morning") {
                where.scheduled_at = {
                    [Op.between]: [
                        new Date(`${startOfDay.toISOString().slice(0, 10)} 07:00:00`),
                        new Date(`${startOfDay.toISOString().slice(0, 10)} 11:59:59`),
                    ],
                };
            }

            if (time_slot === "afternoon") {
                where.scheduled_at = {
                    [Op.between]: [
                        new Date(`${startOfDay.toISOString().slice(0, 10)} 13:00:00`),
                        new Date(`${startOfDay.toISOString().slice(0, 10)} 17:59:59`),
                    ],
                };
            }

            const appointments = await Appointment.findAll({
                where,
                include: [
                    {
                        model: User,
                        as: "donor",
                        attributes: ["id", "full_name", "email", "phone", "blood_group"],
                    },
                    {
                        model: DonationSite,
                        as: "donation_site",
                        attributes: ["id", "name", "address"],
                    },
                ],
                order: [["checked_in_at", "DESC"]],
            });

            const data = appointments.map((item) => {
                const scheduledAt = item.scheduled_at ? new Date(item.scheduled_at) : null;
                const hour = scheduledAt ? scheduledAt.getHours() : null;

                return {
                    appointment_id: item.id,
                    appointment_code: item.appointment_code,
                    scheduled_at: item.scheduled_at,
                    checked_in_at: item.checked_in_at,
                    status: item.status,
                    preferred_volume_ml: item.preferred_volume_ml,
                    donor: item.donor,
                    donation_site: item.donation_site,
                    time_slot:
                        hour === null
                            ? ""
                            : hour < 12
                                ? "morning"
                                : "afternoon",
                    time_slot_label:
                        hour === null
                            ? "Không xác định"
                            : hour < 12
                                ? "Ca sáng"
                                : "Ca chiều",
                };
            });

            return res.json({
                status: true,
                message: "Lấy danh sách check-in hôm nay thành công!",
                data,
            });
        } catch (error) {
            console.error("TODAY CHECKED IN ERROR:", error);

            return res.status(500).json({
                status: false,
                message: "Lỗi server khi lấy danh sách check-in hôm nay!",
                error: error.message,
            });
        }
    },
    async markNoShow(req, res) {
        try {
            const updatedCount = await markNoShowAppointments();

            return res.json({
                status: true,
                message: "Cập nhật vắng mặt thành công!",
                data: {
                    updated_count: updatedCount,
                },
            });
        } catch (error) {
            console.error("MARK NO SHOW ERROR:", error);

            return res.status(500).json({
                status: false,
                message: "Lỗi server khi cập nhật vắng mặt!",
                error: error.message,
            });
        }
    },

    markNoShowAppointments,
};