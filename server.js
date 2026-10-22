/**
 * 零依赖静态服务 + DeepSeek OpenAI 兼容代理
 *
 * LLM_API_KEY 通过环境变量配置，本地运行示例：
 *   Windows:  set LLM_API_KEY=sk-xxx && node server.js
 *   macOS/Linux: LLM_API_KEY=sk-xxx node server.js
 */
"use strict";

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

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
const DENY_NAMES = new Set(["server.js", "package.json"]);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

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
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        error: "LLM_API_KEY is not set on the server",
      })
    );
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
      // SSE：直接管道，不缓冲全文
      res.writeHead(proxyRes.statusCode || 502, outHeaders);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on("error", function (err) {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    }
    res.end(
      JSON.stringify({ error: "upstream_error", message: String(err.message || err) })
    );
  });

  req.pipe(proxyReq);
}

const server = http.createServer(function (req, res) {
  const urlPath = req.url || "/";
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

server.listen(PORT, "0.0.0.0", function () {
  console.log("atoms-demo listening on http://0.0.0.0:" + PORT);
  if (!process.env.LLM_API_KEY) {
    console.warn("warning: LLM_API_KEY is not set; /v1 proxy will return 500");
  }
});
