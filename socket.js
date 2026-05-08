"use strict";

let io = null;

function initSocket(server) {
    const { Server } = require("socket.io");

    io = new Server(server, {
        cors: {
            origin: "http://localhost:5173",
            methods: ["GET", "POST"],
            credentials: true,
        },
    });

    io.on("connection", (socket) => {
        console.log("🟢 Socket connected:", socket.id);

        socket.on("join_appointment", (appointmentId) => {
            if (!appointmentId) return;

            socket.join(`appointment_${appointmentId}`);
            console.log(`📌 ${socket.id} joined appointment_${appointmentId}`);
        });

        socket.on("leave_appointment", (appointmentId) => {
            if (!appointmentId) return;

            socket.leave(`appointment_${appointmentId}`);
            console.log(`📤 ${socket.id} left appointment_${appointmentId}`);
        });

        socket.on("disconnect", () => {
            console.log("🔴 Socket disconnected:", socket.id);
        });
    });

    console.log("✅ Socket.IO local initialized");

    return io;
}

function emitAppointmentUpdated(appointmentId, payload = {}) {
    if (!io || !appointmentId) return;

    io.to(`appointment_${appointmentId}`).emit("appointment_updated", {
        appointment_id: appointmentId,
        ...payload,
    });
}

module.exports = {
    initSocket,
    emitAppointmentUpdated,
};