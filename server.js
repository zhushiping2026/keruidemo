/**
 * 静态服务 + DeepSeek /v1 代理 + 邮箱验证码登录
 *
 * 环境变量：
 *   LLM_API_KEY
 *   SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM
 *   （可选）SMTP_SECURE=true|false  默认 465 为 SSL
 */
"use strict";

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const otp = require("./otp");
const mail = require("./mail");

loadDotEnv();

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 5173;
const ALLOWED_EXT = new Set([
  ".html",
  ".css",
  ".js",
  ".svg",
  ".png",
  ".ico",
  ".json",
]);
const DENY_NAMES = new Set([
  "server.js",
  "package.json",
  "mail.js",
  "otp.js",
  "render.yaml",
]);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

function loadDotEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.charAt(0) === "#") continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.charAt(0) === '"' && val.charAt(val.length - 1) === '"') ||
      (val.charAt(0) === "'" && val.charAt(val.length - 1) === "'")
    ) {
      val = val.slice(1, -1);
    }
    if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
      process.env[key] = val;
    }
  }
}

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    let size = 0;
    req.on("data", function (c) {
      size += c.length;
      if (size > 1e6) {
        reject(new Error("body_too_large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", function () {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (_) {
        reject(new Error("invalid_json"));
      }
    });
    req.on("error", reject);
  });
}

function resolveSafe(urlPath) {
  let pathname;
  try {
    pathname = decodeURIComponent(String(urlPath || "/").split("?")[0]);
  } catch (_) {
    return null;
  }
  if (!pathname || pathname === "/") pathname = "/index.html";
  if (pathname.endsWith("/")) pathname += "index.html";

  const full = path.normalize(path.join(ROOT, pathname));
  const rootWithSep = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep;
  if (full !== ROOT && !full.startsWith(rootWithSep)) return null;

  const base = path.basename(full);
  if (DENY_NAMES.has(base)) return null;

  const ext = path.extname(full).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) return null;

  return full;
}

function serveStatic(req, res) {
  const filePath = resolveSafe(req.url || "/");
  if (!filePath) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, function (err, data) {
    if (err) {
      res.writeHead(err.code === "ENOENT" ? 404 : 500, {
        "Content-Type": "text/plain; charset=utf-8",
      });
      res.end(err.code === "ENOENT" ? "Not Found" : "Server Error");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

function proxyDeepSeek(req, res) {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    json(res, 500, { error: "LLM_API_KEY is not set on the server" });
    return;
  }

  const targetPath = req.url || "/v1";
  const headers = {
    Authorization: "Bearer " + apiKey,
    Host: "api.deepseek.com",
    Accept: req.headers.accept || "*/*",
  };
  if (req.headers["content-type"]) {
    headers["Content-Type"] = req.headers["content-type"];
  }
  if (req.headers["content-length"]) {
    headers["Content-Length"] = req.headers["content-length"];
  }

  const proxyReq = https.request(
    {
      hostname: "api.deepseek.com",
      port: 443,
      path: targetPath,
      method: req.method,
      headers: headers,
    },
    function (proxyRes) {
      const outHeaders = {};
      const ct = proxyRes.headers["content-type"];
      if (ct) outHeaders["Content-Type"] = ct;
      if (proxyRes.headers["cache-control"]) {
        outHeaders["Cache-Control"] = proxyRes.headers["cache-control"];
      } else {
        outHeaders["Cache-Control"] = "no-cache";
      }
      res.writeHead(proxyRes.statusCode || 502, outHeaders);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on("error", function (err) {
    if (!res.headersSent) {
      json(res, 502, {
        error: "upstream_error",
        message: String(err.message || err),
      });
    } else {
      res.end();
    }
  });

  req.pipe(proxyReq);
}

async function handleSendCode(req, res) {
  try {
    const body = await readBody(req);
    if (!mail.smtpConfigured()) {
      json(res, 503, {
        error: "smtp_not_configured",
        message: "服务器未配置 SMTP，无法发送验证码",
      });
      return;
    }
    const issued = otp.issue(body.email);
    await mail.sendMail({
      to: issued.email,
      subject: "Atoms Demo 登录验证码",
      text:
        "您的验证码是：" +
        issued.code +
        "\n\n" +
        issued.expiresInSec +
        " 秒内有效。如非本人操作请忽略。",
    });
    json(res, 200, {
      ok: true,
      email: issued.email,
      expiresInSec: issued.expiresInSec,
    });
  } catch (e) {
    const msg = (e && e.message) || "发送失败";
    const status =
      e &&
      (e.code === "cooldown" ||
        e.code === "rate_limit" ||
        e.code === "invalid_email")
        ? 400
        : 500;
    json(res, status, { error: (e && e.code) || "send_failed", message: msg });
  }
}

async function handleVerifyLogin(req, res) {
  try {
    const body = await readBody(req);
    const result = otp.verify(body.email, body.code);
    json(res, 200, {
      ok: true,
      user: { id: "otp:" + result.email, email: result.email },
    });
  } catch (e) {
    json(res, 400, {
      error: (e && e.code) || "verify_failed",
      message: (e && e.message) || "验证失败",
    });
  }
}

const server = http.createServer(function (req, res) {
  const urlPath = (req.url || "/").split("?")[0];

  if (urlPath === "/api/send-code" && req.method === "POST") {
    handleSendCode(req, res);
    return;
  }
  if (urlPath === "/api/login" && req.method === "POST") {
    handleVerifyLogin(req, res);
    return;
  }

  if (urlPath === "/v1" || urlPath.indexOf("/v1/") === 0) {
    proxyDeepSeek(req, res);
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Method Not Allowed");
    return;
  }
  serveStatic(req, res);
});

server.on("error", function (err) {
  if (err && err.code === "EADDRINUSE") {
    console.error(
      "端口 " + PORT + " 已被占用。请先结束旧进程再启动，或换 PORT。"
    );
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(PORT, "0.0.0.0", function () {
  console.log("atoms-demo listening on http://0.0.0.0:" + PORT);
  if (!process.env.LLM_API_KEY) {
    console.warn("warning: LLM_API_KEY is not set; /v1 proxy will return 500");
  }
  if (!mail.smtpConfigured()) {
    console.warn(
      "warning: SMTP not set; /api/send-code will return 503 (need SMTP_HOST/USER/PASS)"
    );
  }
});
