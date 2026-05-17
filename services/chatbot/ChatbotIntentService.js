"use strict";

const normalizeText = (message) =>
  String(message || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");

const hasAny = (text, keywords) => keywords.some((keyword) => text.includes(keyword));

const detectIntent = (message) => {
  const text = normalizeText(message);

  if (!text.trim()) return "EMPTY";

  if (
    hasAny(text, [
      "nhom mau",
      "mau cua toi",
      "blood group",
      "blood type",
      "ho so",
      "profile",
      "thong tin ca nhan",
      "so dien thoai cua toi",
      "email cua toi",
    ])
  ) {
    return "MY_PROFILE";
  }

  if (
    hasAny(text, [
      "hien mau lai",
      "hien lai",
      "co the hien mau",
      "du dieu kien",
      "bao lau duoc hien",
      "khi nao duoc hien",
      "hien duoc chua",
    ])
  ) {
    return "DONATION_ELIGIBILITY";
  }

  if (
    hasAny(text, [
      "lich su hien",
      "da hien",
      "hien bao nhieu",
      "bao nhieu lan",
      "lan hien gan nhat",
      "tong cong bao nhieu ml",
      "donation history",
    ])
  ) {
    return "DONATION_HISTORY";
  }

  if (
    hasAny(text, [
      "lich hen",
      "lich hien",
      "cuoc hen",
      "ma lich hen",
      "trang thai lich",
      "appointment",
      "dat lich cua toi",
    ])
  ) {
    return "MY_APPOINTMENTS";
  }

  if (
    hasAny(text, [
      "thong bao",
      "notification",
      "tin nhan",
      "cap nhat gan day",
      "co gi moi",
    ])
  ) {
    return "MY_NOTIFICATIONS";
  }

  if (
    hasAny(text, [
      "slot",
      "khung gio",
      "con cho",
      "day chua",
      "so luong",
      "cho trong",
    ])
  ) {
    return "AVAILABLE_SLOTS";
  }

  if (
    hasAny(text, [
      "chien dich",
      "campaign",
      "su kien hien mau",
      "dot hien mau",
      "dang dien ra",
      "sap toi",
    ])
  ) {
    return "PUBLIC_CAMPAIGNS";
  }

  if (
    hasAny(text, [
      "dia diem",
      "diem hien mau",
      "noi hien mau",
      "benh vien nao",
      "donation site",
    ])
  ) {
    return "DONATION_SITES";
  }

  if (
    hasAny(text, [
      "kho mau",
      "ton kho",
      "nhom mau nao sap het",
      "mau con bao nhieu",
      "blood inventory",
    ])
  ) {
    return "INVENTORY_SUMMARY";
  }

  if (
    hasAny(text, [
      "hom nay co bao nhieu lich",
      "cho checkin",
      "cho check-in",
      "dang screening",
      "dang hien mau",
      "dashboard bac si",
    ])
  ) {
    return "DOCTOR_TODAY_SUMMARY";
  }

  if (
    hasAny(text, [
      "quy trinh",
      "cac buoc",
      "dieu kien hien mau",
      "can chuan bi gi",
      "an gi truoc khi hien",
      "sau khi hien mau",
    ])
  ) {
    return "GENERAL_BLOOD_DONATION";
  }

  return "GENERAL_AI";
};

module.exports = {
  detectIntent,
  normalizeText,
};
