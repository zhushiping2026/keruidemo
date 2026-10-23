/**
 * 内存验证码：5 分钟有效、60 秒冷却、每小时最多 5 次
 */
"use strict";

const crypto = require("crypto");

const TTL_MS = 5 * 60 * 1000;
const COOLDOWN_MS = 60 * 1000;
const MAX_PER_HOUR = 5;

/** @type {Map<string, { code: string, expires: number, lastSent: number, hourStart: number, hourCount: number }>} */
const store = new Map();

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function createCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

function issue(email) {
  const key = normalizeEmail(email);
  if (!isValidEmail(key)) {
    const err = new Error("请输入有效邮箱");
    err.code = "invalid_email";
    throw err;
  }

  const now = Date.now();
  let row = store.get(key);
  if (row && now - row.lastSent < COOLDOWN_MS) {
    const wait = Math.ceil((COOLDOWN_MS - (now - row.lastSent)) / 1000);
    const err = new Error("请 " + wait + " 秒后再发送");
    err.code = "cooldown";
    throw err;
  }

  if (!row || now - row.hourStart > 3600000) {
    row = {
      code: "",
      expires: 0,
      lastSent: 0,
      hourStart: now,
      hourCount: 0,
    };
  }
  if (row.hourCount >= MAX_PER_HOUR) {
    const err = new Error("该邮箱发送过于频繁，请稍后再试");
    err.code = "rate_limit";
    throw err;
  }

  const code = createCode();
  row.code = code;
  row.expires = now + TTL_MS;
  row.lastSent = now;
  row.hourCount += 1;
  store.set(key, row);
  return { email: key, code: code, expiresInSec: Math.floor(TTL_MS / 1000) };
}

function verify(email, code) {
  const key = normalizeEmail(email);
  const got = String(code || "").trim();
  if (!isValidEmail(key)) {
    const err = new Error("请输入有效邮箱");
    err.code = "invalid_email";
    throw err;
  }
  if (!/^\d{6}$/.test(got)) {
    const err = new Error("请输入 6 位验证码");
    err.code = "invalid_code";
    throw err;
  }

  const row = store.get(key);
  if (!row || !row.code) {
    const err = new Error("请先获取验证码");
    err.code = "no_code";
    throw err;
  }
  if (Date.now() > row.expires) {
    store.delete(key);
    const err = new Error("验证码已过期，请重新获取");
    err.code = "expired";
    throw err;
  }
  if (row.code !== got) {
    const err = new Error("验证码错误");
    err.code = "mismatch";
    throw err;
  }
  store.delete(key);
  return { email: key };
}

module.exports = {
  issue: issue,
  verify: verify,
  isValidEmail: isValidEmail,
  normalizeEmail: normalizeEmail,
};
