/**
 * AtomsCloud 适配层（邮箱验证码门禁 + OpenAI 兼容 SSE）
 * - 认证：sendLoginCode / signInWithCode / getSession
 * - LLM：OpenAI 兼容 fetch SSE + AbortController
 */
(function (global) {
  "use strict";

  const LOCAL_SESSION_KEY = "atoms-demo:local-session";

  const FALLBACK_MODELS = [
    { id: "deepseek-flash", name: "DeepSeek Flash" },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
  ];

  function cfg() {
    return global.ATOMS_CONFIG || {};
  }

  async function parseApiError(res) {
    let msg = "请求失败（HTTP " + res.status + "）";
    try {
      const j = await res.json();
      if (j && j.message) msg = j.message;
    } catch (_) {}
    return msg;
  }

  async function sendLoginCode(email) {
    const trimmed = String(email || "").trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      throw new Error("请输入有效邮箱");
    }
    const res = await fetch("/api/send-code", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email: trimmed }),
    });
    if (!res.ok) throw new Error(await parseApiError(res));
    return res.json();
  }

  async function signInWithCode(email, code) {
    const trimmed = String(email || "").trim();
    const otp = String(code || "").trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      throw new Error("请输入有效邮箱");
    }
    if (!/^\d{6}$/.test(otp)) {
      throw new Error("请输入 6 位验证码");
    }
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email: trimmed, code: otp }),
    });
    if (!res.ok) throw new Error(await parseApiError(res));
    const data = await res.json();
    const session = {
      auth: "otp",
      user: (data && data.user) || { id: "otp:" + trimmed, email: trimmed },
      at: Date.now(),
    };
    try {
      localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(session));
    } catch (_) {
      throw new Error("无法写入本地会话");
    }
    return session;
  }

  /** @deprecated 仅邮箱、无验证码；保留兼容，新流程请用 signInWithCode */
  function signInLocal(email) {
    throw new Error("请使用邮箱验证码登录");
  }

  async function getSession() {
    try {
      const raw = localStorage.getItem(LOCAL_SESSION_KEY);
      if (!raw) return null;
      const session = JSON.parse(raw);
      if (!session || !session.user || session.auth !== "otp") return null;
      return session;
    } catch (_) {
      return null;
    }
  }

  function signOut() {
    try {
      localStorage.removeItem(LOCAL_SESSION_KEY);
    } catch (_) {}
  }

  async function listModels() {
    const c = cfg();
    const base = (c.llmBaseUrl || "").replace(/\/$/, "");
    if (base) {
      try {
        const headers = { Accept: "application/json" };
        if (c.llmApiKey) headers.Authorization = "Bearer " + c.llmApiKey;
        const res = await fetch(base + "/models", { headers });
        if (res.ok) {
          const json = await res.json();
          const rows = (json.data || json.models || [])
            .map(function (m) {
              const id = m.id || m.model || m.Model;
              return { id: id, name: m.name || id };
            })
            .filter(function (m) {
              return m.id;
            });
          if (rows.length) return rows;
        }
      } catch (_) {}
    }
    return FALLBACK_MODELS.slice();
  }

  /**
   * OpenAI 兼容 SSE：POST /chat/completions stream:true
   */
  async function streamViaOpenAI(messages, model, signal, onDelta) {
    const c = cfg();
    const base = (c.llmBaseUrl || "").replace(/\/$/, "");
    if (!base) {
      throw new Error("请先在 config.js 配置 llmBaseUrl（同源代理如 /v1）");
    }

    const headers = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    };
    if (c.llmApiKey) headers.Authorization = "Bearer " + c.llmApiKey;

    // DeepSeek V4+ 默认开启 thinking：先推大量 reasoning_content，
    // 易触发前端超时且界面长时间无 HTML。Demo 关闭 thinking，直接出码。
    const res = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: headers,
      body: JSON.stringify({
        model: model,
        messages: messages,
        stream: true,
        temperature: 0.4,
        thinking: { type: "disabled" },
      }),
      signal: signal,
    });

    if (!res.ok) {
      let detail = "";
      try {
        detail = await res.text();
      } catch (_) {}
      const err = new Error(
        classifyHttpError(res.status, detail) ||
          "生成失败（HTTP " + res.status + "）"
      );
      err.status = res.status;
      err.raw = detail;
      throw err;
    }

    if (!res.body || !res.body.getReader) {
      throw new Error("当前浏览器不支持流式读取");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let full = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n");
      buffer = parts.pop() || "";
      for (let i = 0; i < parts.length; i++) {
        const line = parts[i].trim();
        if (!line || line.startsWith(":")) continue;
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload);
          const delta =
            (json.choices &&
              json.choices[0] &&
              json.choices[0].delta &&
              json.choices[0].delta.content) ||
            "";
          if (delta) {
            full += delta;
            if (onDelta) onDelta(delta, full);
          }
        } catch (_) {}
      }
    }
    return full;
  }

  async function streamChat(opts) {
    const messages = opts.messages || [];
    const model = opts.model || cfg().defaultModel || "deepseek-flash";
    const full = await streamViaOpenAI(
      messages,
      model,
      opts.signal,
      opts.onDelta
    );
    if (!String(full || "").trim()) {
      throw new Error("模型未返回正文（可能仍在思考或被中断），请重试");
    }
    return full;
  }

  function classifyHttpError(status, body) {
    const text = String(body || "").toLowerCase();
    if (status === 429 || text.indexOf("quota") !== -1) {
      return "quota_ 额度不足或触发限流，请稍后再试";
    }
    if (status >= 500 || text.indexOf("gateway") !== -1) {
      return "gateway_ 网关异常，请重新生成";
    }
    if (text.indexOf("model") !== -1 && (status === 400 || status === 404)) {
      return "model_ 模型不可用，请换模型或重新生成";
    }
    return "";
  }

  function isConfigured() {
    const c = cfg();
    // Key 由 server.js 环境变量注入；前端只需同源 llmBaseUrl
    return Boolean(c.llmBaseUrl);
  }

  global.AtomsCloud = {
    sendLoginCode: sendLoginCode,
    signInWithCode: signInWithCode,
    signInLocal: signInLocal,
    signOut: signOut,
    getSession: getSession,
    listModels: listModels,
    streamChat: streamChat,
    isConfigured: isConfigured,
    FALLBACK_MODELS: FALLBACK_MODELS,
  };
})(window);
