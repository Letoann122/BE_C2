"use strict";

function randomSuffix() {
  return Math.floor(100000 + Math.random() * 900000);
}

function generateAppointmentCode(type = "HM") {
  const prefix = type === "CD" ? "CD" : "HM";
  const now = new Date();

  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");

  return `${prefix}${yyyy}${mm}${dd}${randomSuffix()}`;
}

module.exports = {
  generateAppointmentCode,
};