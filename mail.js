/**
 * 零依赖 SMTP 发信（AUTH LOGIN）
 * 支持 465 SSL 与 587 STARTTLS（常见 QQ/163/Gmail）
 */
"use strict";

const net = require("net");
const tls = require("tls");

function b64(s) {
  return Buffer.from(String(s), "utf8").toString("base64");
}

function smtpConfigured() {
  return Boolean(
    process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS
  );
}

/**
 * @param {{ to: string, subject: string, text: string }} mail
 */
function sendMail(mail) {
  return new Promise(function (resolve, reject) {
    if (!smtpConfigured()) {
      reject(new Error("SMTP 未配置：请设置 SMTP_HOST / SMTP_USER / SMTP_PASS"));
      return;
    }

    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT) || 465;
    const secure =
      process.env.SMTP_SECURE === "false" || process.env.SMTP_SECURE === "0"
        ? false
        : port === 465;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.SMTP_FROM || user;
    const to = mail.to;
    const subject = mail.subject || "";
    const text = mail.text || "";

    let socket;
    let buffer = "";
    let step = 0;
    let settled = false;

    function fail(err) {
      if (settled) return;
      settled = true;
      try {
        if (socket) socket.destroy();
      } catch (_) {}
      reject(err instanceof Error ? err : new Error(String(err)));
    }

    function ok() {
      if (settled) return;
      settled = true;
      try {
        if (socket) socket.end();
      } catch (_) {}
      resolve();
    }

    function write(cmd) {
      socket.write(cmd + "\r\n");
    }

    function onLine(line) {
      const code = parseInt(line.slice(0, 3), 10);
      if (!code) return;

      // multiline: 250-... keep reading until 250 
      if (line[3] === "-") return;

      try {
        if (step === 0) {
          // greeting
          if (code !== 220) throw new Error("SMTP greeting: " + line);
          write("EHLO atoms-demo");
          step = 1;
          return;
        }
        if (step === 1) {
          if (code !== 250) throw new Error("EHLO failed: " + line);
          if (!secure && port === 587) {
            write("STARTTLS");
            step = 10;
            return;
          }
          write("AUTH LOGIN");
          step = 2;
          return;
        }
        if (step === 10) {
          if (code !== 220) throw new Error("STARTTLS failed: " + line);
          socket.removeListener("data", onData);
          socket = tls.connect(
            { socket: socket, host: host, servername: host },
            function () {
              buffer = "";
              socket.on("data", onData);
              socket.on("error", fail);
              write("EHLO atoms-demo");
              step = 1;
            }
          );
          return;
        }
        if (step === 2) {
          if (code !== 334) throw new Error("AUTH LOGIN: " + line);
          write(b64(user));
          step = 3;
          return;
        }
        if (step === 3) {
          if (code !== 334) throw new Error("AUTH user: " + line);
          write(b64(pass));
          step = 4;
          return;
        }
        if (step === 4) {
          if (code !== 235) throw new Error("SMTP 登录失败（检查授权码）: " + line);
          write("MAIL FROM:<" + from + ">");
          step = 5;
          return;
        }
        if (step === 5) {
          if (code !== 250) throw new Error("MAIL FROM: " + line);
          write("RCPT TO:<" + to + ">");
          step = 6;
          return;
        }
        if (step === 6) {
          if (code !== 250 && code !== 251) throw new Error("RCPT TO: " + line);
          write("DATA");
          step = 7;
          return;
        }
        if (step === 7) {
          if (code !== 354) throw new Error("DATA: " + line);
          const headers = [
            "From: " + from,
            "To: " + to,
            "Subject: =?UTF-8?B?" + b64(subject) + "?=",
            "MIME-Version: 1.0",
            "Content-Type: text/plain; charset=UTF-8",
            "Content-Transfer-Encoding: base64",
            "",
            b64(text),
            ".",
          ].join("\r\n");
          write(headers);
          step = 8;
          return;
        }
        if (step === 8) {
          if (code !== 250) throw new Error("发送失败: " + line);
          write("QUIT");
          step = 9;
          return;
        }
        if (step === 9) {
          ok();
        }
      } catch (e) {
        fail(e);
      }
    }

    function onData(chunk) {
      buffer += chunk.toString("utf8");
      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop() || "";
      for (let i = 0; i < parts.length; i++) {
        if (parts[i]) onLine(parts[i]);
      }
    }

    function attach(sock) {
      socket = sock;
      socket.setEncoding("utf8");
      socket.on("data", onData);
      socket.on("error", fail);
      socket.setTimeout(30000, function () {
        fail(new Error("SMTP 连接超时"));
      });
    }

    if (secure) {
      attach(
        tls.connect({ host: host, port: port, servername: host }, function () {})
      );
    } else {
      attach(net.connect({ host: host, port: port }));
    }
  });
}

module.exports = {
  sendMail: sendMail,
  smtpConfigured: smtpConfigured,
};
