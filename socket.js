"use strict";

let io = null;

function initSocket(server) {
  const { Server } = require("socket.io");

  io = new Server(server, {
    cors: {
      origin: "http://localhost:5173",
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
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

    socket.on("join_slot", (slotId) => {
      if (!slotId) return;

      socket.join(`slot_${slotId}`);
      console.log(`📌 ${socket.id} joined slot_${slotId}`);
    });

    socket.on("leave_slot", (slotId) => {
      if (!slotId) return;

      socket.leave(`slot_${slotId}`);
      console.log(`📤 ${socket.id} left slot_${slotId}`);
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

function emitSlotUpdated(slotId, payload = {}) {
  if (!io || !slotId) return;

  io.to(`slot_${slotId}`).emit("slot_updated", {
    slot_id: slotId,
    ...payload,
  });

  io.emit("slot_capacity_updated", {
    slot_id: slotId,
    ...payload,
  });
}

function emitEmergencyAlertUpdated(payload = {}) {
  if (!io) return;

  io.emit("emergency_alert_updated", payload);
}

module.exports = {
  initSocket,
  emitAppointmentUpdated,
  emitSlotUpdated,
  emitEmergencyAlertUpdated,
};