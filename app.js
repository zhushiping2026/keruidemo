/**
 * Atoms Demo — M5 亮点
 * Agent 阶段可视化 + 预览控制台/报错自愈 + M1–M4 全链路
 */
(function () {
  "use strict";

  const STORAGE_LEFT_RATIO = "atoms-demo:left-ratio";
  const GEN_TIMEOUT =
    (window.ATOMS_CONFIG && window.ATOMS_CONFIG.generateTimeoutMs) || 60000;

  const SYSTEM_PROMPT = [
    "你是专业的前端代码生成器。",
    "必须且只能输出一个可独立运行的单文件 HTML 文档：",
    "- 以 <!DOCTYPE html> 开头，包含完整 <html>、<head>、<body>",
    "- CSS 与 JavaScript 全部内联，不要引用外部脚本/样式文件",
    "- 不要使用 React/Vue 等需要构建的框架；可用原生 HTML/CSS/JS",
    "- 不要输出解释性文字、前言或后记",
    "- 如需使用 markdown 代码围栏，只能有一个 ```html 围栏包裹完整 HTML",
    "- 在已有代码上修改时，保留未要求改动的部分，输出修改后的完整文件",
    "- 页面需可交互且视觉完整，适配桌面与窄屏",
  ].join("\n");

  const PLACEHOLDER_HTML = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Atoms</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;
background:#0d1117;color:#8b949e}
p{margin:0;opacity:.8}
</style></head>
<body><p>在左侧描述需求，生成后将在此预览</p></body></html>`;

  const SYSTEM_BUBBLE_HTML =
    '<p>描述你想要的页面，例如「做一个暗黑风个人主页」。</p>' +
    '<p class="chat-hint">可连续对话修改；上下文仅携带最近 3 轮指令摘要 + 当前完整代码。预览成功后自动存版本。</p>';

  const state = {
    generating: false,
    abortController: null,
    timeoutId: null,
    lastPrompt: "",
    currentCode: PLACEHOLDER_HTML,
    hasCode: false,
    userTurns: [],
    project: null,
    pendingSnapshot: null,
    expectLoadSave: false,
    pendingRollbackId: null,
    /** 当前生成气泡的阶段指示器 */
    activeStagesEl: null,
    consoleEntries: [],
    consoleOpen: false,
  };

  const STAGE_ORDER = ["understand", "codegen", "render", "done"];

  const STAGES_HTML =
    '<ol class="agent-stages" aria-label="Agent 阶段">' +
    '<li data-stage="understand">理解需求</li>' +
    '<li data-stage="codegen">生成代码</li>' +
    '<li data-stage="render">渲染预览</li>' +
    '<li data-stage="done">完成</li>' +
    "</ol>";

  /** 注入到 srcdoc 的控制台桥（不写入落库代码） */
  const CONSOLE_BRIDGE =
    '<script data-atoms-bridge="1">(function(){' +
    'if(window.__ATOMS_BRIDGE__)return;window.__ATOMS_BRIDGE__=1;' +
    "function send(level,parts){try{parent.postMessage({source:'atoms-demo',type:'console',level:level,args:parts,ts:Date.now()},'*');}catch(e){}}" +
    "function ser(a){try{if(typeof a==='string')return a;if(a&&a.stack)return String(a.stack);return JSON.stringify(a);}catch(e){return String(a);}}" +
    "['log','info','warn','error'].forEach(function(level){var o=console[level];console[level]=function(){var args=Array.prototype.slice.call(arguments).map(ser);send(level,args);return o.apply(console,arguments);};});" +
    "window.addEventListener('error',function(e){send('error',[e.message+(e.filename?(' @ '+e.filename+':'+e.lineno):'')]);});" +
    "window.addEventListener('unhandledrejection',function(e){var r=e.reason;send('error',['UnhandledRejection: '+(r&&(r.message||r.stack)||r)]);});" +
    "})();<\/script>";

  const els = {
    authOverlay: document.getElementById("auth-overlay"),
    authEmail: document.getElementById("auth-email"),
    authCode: document.getElementById("auth-code"),
    btnSendCode: document.getElementById("btn-send-code"),
    btnEnter: document.getElementById("btn-enter"),
    authConfigHint: document.getElementById("auth-config-hint"),
    app: document.getElementById("app"),
    versionBadge: document.getElementById("version-badge"),
    projectSelect: document.getElementById("project-select"),
    modelSelect: document.getElementById("model-select"),
    btnNewProject: document.getElementById("btn-new-project"),
    btnExport: document.getElementById("btn-export"),
    paneLeft: document.getElementById("pane-left"),
    splitter: document.getElementById("splitter"),
    workspace: document.querySelector(".workspace"),
    tabs: document.querySelectorAll(".tab"),
    panelChat: document.getElementById("panel-chat"),
    panelCode: document.getElementById("panel-code"),
    panelVersions: document.getElementById("panel-versions"),
    chatList: document.getElementById("chat-list"),
    codeText: document.getElementById("code-text"),
    versionsList: document.getElementById("versions-list"),
    composer: document.getElementById("composer"),
    promptInput: document.getElementById("prompt-input"),
    btnSend: document.getElementById("btn-send"),
    btnStop: document.getElementById("btn-stop"),
    iframe: document.getElementById("preview-iframe"),
    frameWrap: document.getElementById("preview-frame-wrap"),
    previewStage: document.getElementById("preview-stage"),
    previewSkeleton: document.getElementById("preview-skeleton"),
    btnViewportPc: document.getElementById("btn-viewport-pc"),
    btnViewportMobile: document.getElementById("btn-viewport-mobile"),
    btnRefresh: document.getElementById("btn-refresh"),
    btnFullscreen: document.getElementById("btn-fullscreen"),
    toastRoot: document.getElementById("toast-root"),
    confirmModal: document.getElementById("confirm-modal"),
    confirmBody: document.getElementById("confirm-body"),
    confirmCancel: document.getElementById("confirm-cancel"),
    confirmOk: document.getElementById("confirm-ok"),
    consoleDrawer: document.getElementById("console-drawer"),
    btnConsoleToggle: document.getElementById("btn-console-toggle"),
    consoleCount: document.getElementById("console-count"),
    consoleBody: document.getElementById("console-body"),
    consoleLog: document.getElementById("console-log"),
    btnConsoleClear: document.getElementById("btn-console-clear"),
    btnAiFix: document.getElementById("btn-ai-fix"),
  };

  function toast(message, opts) {
    opts = opts || {};
    const node = document.createElement("div");
    node.className = "toast" + (opts.error ? " toast--error" : "");
    const text = document.createElement("div");
    text.textContent = message;
    node.appendChild(text);

    if (opts.regenerate) {
      const actions = document.createElement("div");
      actions.className = "toast-actions";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-primary";
      btn.textContent = "重新生成";
      btn.addEventListener("click", function () {
        node.remove();
        if (state.lastPrompt) {
          els.promptInput.value = state.lastPrompt;
          startGenerate(state.lastPrompt, { isRetry: true });
        }
      });
      actions.appendChild(btn);
      node.appendChild(actions);
    }

    els.toastRoot.appendChild(node);

    if (opts.sticky || opts.regenerate) {
      node.style.cursor = opts.regenerate ? "default" : "pointer";
      if (!opts.regenerate) {
        node.title = "点击关闭";
        node.addEventListener("click", function () {
          node.remove();
        });
      }
    } else {
      setTimeout(function () {
        node.remove();
      }, 3000);
    }
    return node;
  }

  function summarizePrompt(prompt) {
    const t = String(prompt || "")
      .trim()
      .replace(/\s+/g, " ");
    if (t.length <= 120) return t;
    return t.slice(0, 117) + "...";
  }

  function formatTime(iso) {
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso || "";
      const pad = function (n) {
        return n < 10 ? "0" + n : String(n);
      };
      return (
        d.getMonth() +
        1 +
        "/" +
        d.getDate() +
        " " +
        pad(d.getHours()) +
        ":" +
        pad(d.getMinutes())
      );
    } catch (_) {
      return iso || "";
    }
  }

  function updateVersionBadge() {
    if (!els.versionBadge) return;
    if (!state.project) {
      els.versionBadge.textContent = "v0";
      return;
    }
    const n = window.AtomsStore.listVersions(state.project.id).length;
    els.versionBadge.textContent = "v" + n;
  }

  function refreshProjectSelect() {
    const projects = window.AtomsStore.listProjects();
    const activeId =
      (state.project && state.project.id) ||
      window.AtomsStore.getActiveProjectId();
    els.projectSelect.innerHTML = "";
    if (!projects.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "暂无项目";
      els.projectSelect.appendChild(opt);
      return;
    }
    projects.forEach(function (p) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.title || "未命名项目";
      if (p.id === activeId) opt.selected = true;
      els.projectSelect.appendChild(opt);
    });
  }

  function clearChatKeepSystem() {
    els.chatList.innerHTML = "";
    const sys = document.createElement("div");
    sys.className = "chat-bubble chat-bubble--system";
    sys.innerHTML = SYSTEM_BUBBLE_HTML;
    els.chatList.appendChild(sys);
  }

  function restoreChatFromMessages(messages) {
    clearChatKeepSystem();
    (messages || []).forEach(function (m) {
      if (m.role === "user") {
        const bubble = appendBubble("user", "<p></p>");
        bubble.querySelector("p").textContent = m.content || "";
      } else if (m.role === "assistant") {
        const bubble = appendBubble(
          "assistant",
          '<p class="chat-status"></p>'
        );
        bubble.querySelector(".chat-status").textContent =
          m.content || "已生成";
      }
    });
  }

  function renderVersionsList() {
    const list = els.versionsList;
    list.innerHTML = "";
    if (!state.project) {
      list.innerHTML = '<li class="versions-empty">请先生成或新建项目</li>';
      return;
    }
    const versions = window.AtomsStore.listVersions(state.project.id).slice().reverse();
    if (!versions.length) {
      list.innerHTML = '<li class="versions-empty">尚无版本快照</li>';
      return;
    }
    const latestId = versions[0].id;
    versions.forEach(function (v, i) {
      const total = versions.length;
      const indexFromOldest = total - i;
      const li = document.createElement("li");
      li.className =
        "version-item" + (v.id === latestId ? " is-current" : "");
      const promptText = v.prompt || "(无 Prompt)";
      const meta = document.createElement("div");
      meta.className = "version-meta";
      meta.innerHTML =
        "<span>v" +
        indexFromOldest +
        "</span><span></span>";
      meta.querySelectorAll("span")[1].textContent = formatTime(v.created_at);

      const prompt = document.createElement("p");
      prompt.className = "version-prompt";
      prompt.textContent = summarizePrompt(promptText);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-ghost";
      if (v.id === latestId) {
        btn.textContent = "当前版本";
        btn.disabled = true;
      } else {
        btn.textContent = "回滚到此版本";
        btn.addEventListener("click", function () {
          openRollbackConfirm(v, indexFromOldest);
        });
      }

      li.appendChild(meta);
      li.appendChild(prompt);
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  function applyProjectState(project, opts) {
    opts = opts || {};
    state.project = project;
    if (project) {
      window.AtomsStore.setActiveProjectId(project.id);
    }
    const versions = project
      ? window.AtomsStore.listVersions(project.id)
      : [];
    const messages = project
      ? window.AtomsStore.listMessages(project.id)
      : [];

    if (versions.length) {
      const latest = versions[versions.length - 1];
      state.hasCode = true;
      state.currentCode = latest.code;
      state.userTurns = versions.map(function (v) {
        return {
          prompt: v.prompt || "",
          summary: summarizePrompt(v.prompt || ""),
        };
      });
      els.codeText.textContent = latest.code;
      state.expectLoadSave = false;
      state.pendingSnapshot = null;
      clearConsole();
      els.iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
      els.iframe.srcdoc = withConsoleBridge(latest.code);
      restoreChatFromMessages(messages);
    } else {
      state.hasCode = false;
      state.currentCode = PLACEHOLDER_HTML;
      state.userTurns = [];
      state.lastPrompt = "";
      clearChatKeepSystem();
      renderPreview(PLACEHOLDER_HTML, null);
    }

    updateVersionBadge();
    refreshProjectSelect();
    renderVersionsList();
    if (opts.toastMsg) toast(opts.toastMsg);
  }

  function buildMessages(userPrompt) {
    const summary = summarizePrompt(userPrompt);
    const turnsForContext = state.userTurns
      .concat([{ prompt: userPrompt, summary: summary }])
      .slice(-3);

    const msgs = [{ role: "system", content: SYSTEM_PROMPT }];

    if (!state.hasCode) {
      msgs.push({
        role: "user",
        content:
          "请根据以下需求生成单文件 HTML 应用：\n\n" + userPrompt,
      });
      return msgs;
    }

    const lines = turnsForContext
      .map(function (t, i) {
        return i + 1 + ". " + t.summary;
      })
      .join("\n");

    msgs.push({
      role: "user",
      content: [
        "【最近用户指令摘要（最多 3 轮）】",
        lines,
        "",
        "【当前完整代码】",
        "```html",
        state.currentCode,
        "```",
        "",
        "请根据最新一条指令修改上述代码，只输出修改后的完整单文件 HTML。",
        "最新指令：" + userPrompt,
      ].join("\n"),
    });
    return msgs;
  }

  function setAgentStage(stagesEl, stage, failed) {
    if (!stagesEl) return;
    const idx = STAGE_ORDER.indexOf(stage);
    stagesEl.querySelectorAll("li[data-stage]").forEach(function (li) {
      const s = li.getAttribute("data-stage");
      const i = STAGE_ORDER.indexOf(s);
      li.classList.remove("is-active", "is-done", "is-fail");
      if (failed && s === stage) {
        li.classList.add("is-fail");
      } else if (i < idx) {
        li.classList.add("is-done");
      } else if (i === idx) {
        li.classList.add(failed ? "is-fail" : "is-active");
        if (!failed && stage === "done") {
          li.classList.remove("is-active");
          li.classList.add("is-done");
        }
      }
    });
  }

  function withConsoleBridge(html) {
    const cleaned = String(html || "").replace(
      /<script[^>]*data-atoms-bridge="1"[^>]*>[\s\S]*?<\/script>/gi,
      ""
    );
    if (/<head[^>]*>/i.test(cleaned)) {
      return cleaned.replace(/<head[^>]*>/i, function (m) {
        return m + CONSOLE_BRIDGE;
      });
    }
    if (/<html[^>]*>/i.test(cleaned)) {
      return cleaned.replace(/<html[^>]*>/i, function (m) {
        return m + "<head>" + CONSOLE_BRIDGE + "</head>";
      });
    }
    return CONSOLE_BRIDGE + cleaned;
  }

  function updateConsoleBadge() {
    const n = state.consoleEntries.length;
    const errN = state.consoleEntries.filter(function (e) {
      return e.level === "error";
    }).length;
    els.consoleCount.textContent = String(n);
    els.consoleCount.classList.toggle("has-error", errN > 0);
    els.btnAiFix.hidden = errN === 0;
  }

  function appendConsoleEntry(level, args) {
    const text = (args || []).join(" ");
    state.consoleEntries.push({ level: level, text: text });
    if (state.consoleEntries.length > 200) {
      state.consoleEntries = state.consoleEntries.slice(-200);
    }
    const li = document.createElement("li");
    li.className = "level-" + (level || "log");
    li.textContent = "[" + (level || "log") + "] " + text;
    els.consoleLog.appendChild(li);
    els.consoleLog.parentElement.scrollTop = els.consoleLog.parentElement.scrollHeight;
    updateConsoleBadge();
    if (level === "error" && !state.consoleOpen) {
      state.consoleOpen = true;
      els.consoleBody.hidden = false;
      els.btnConsoleToggle.setAttribute("aria-expanded", "true");
    }
  }

  function clearConsole() {
    state.consoleEntries = [];
    els.consoleLog.innerHTML = "";
    updateConsoleBadge();
  }

  function requestAiFix() {
    const errors = state.consoleEntries
      .filter(function (e) {
        return e.level === "error";
      })
      .map(function (e) {
        return e.text;
      });
    if (!errors.length) {
      toast("当前没有可修复的报错");
      return;
    }
    if (!state.hasCode) {
      toast("暂无代码可修复", { error: true });
      return;
    }
    const prompt =
      "预览运行时报错，请修复后输出完整单文件 HTML。\n\n报错信息：\n" +
      errors.slice(-8).join("\n");
    startGenerate(prompt, { isFix: true });
  }

  function renderPreview(html, snapshotMeta) {
    els.iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
    els.codeText.textContent = html;
    state.currentCode = html;
    clearConsole();

    if (snapshotMeta) {
      state.pendingSnapshot = snapshotMeta;
      state.expectLoadSave = true;
    } else {
      state.pendingSnapshot = null;
      state.expectLoadSave = false;
    }

    // 仅预览注入桥接脚本；落库/导出仍用原始 html
    els.iframe.srcdoc = withConsoleBridge(html);
  }

  async function onIframeLoad() {
    if (!state.expectLoadSave || !state.pendingSnapshot) return;
    state.expectLoadSave = false;
    const meta = state.pendingSnapshot;
    state.pendingSnapshot = null;

    try {
      if (!state.project) {
        state.project = await window.AtomsStore.ensureProject(
          summarizePrompt(meta.prompt)
        );
      }
      const result = await window.AtomsStore.saveSnapshot({
        projectId: state.project.id,
        code: meta.code,
        prompt: meta.prompt,
      });

      state.hasCode = true;
      state.userTurns.push({
        prompt: meta.prompt,
        summary: summarizePrompt(meta.prompt),
      });
      if (state.userTurns.length > 20) {
        state.userTurns = state.userTurns.slice(-20);
      }

      updateVersionBadge();
      refreshProjectSelect();
      renderVersionsList();
      if (meta.stagesEl) {
        setAgentStage(meta.stagesEl, "done");
      }
      if (meta.statusEl) {
        meta.statusEl.textContent = "完成 · 已存 v" + result.versionIndex;
      } else {
        const statuses = els.chatList.querySelectorAll(".chat-status");
        if (statuses.length) {
          statuses[statuses.length - 1].textContent =
            "完成 · 已存 v" + result.versionIndex;
        }
      }
      toast("已保存版本 v" + result.versionIndex + "（本地）");
    } catch (e) {
      toast((e && e.message) || "版本保存失败", {
        error: true,
        sticky: true,
      });
    }
  }

  function setGeneratingUI(on) {
    state.generating = on;
    els.btnSend.disabled = on;
    els.btnStop.hidden = !on;
    els.promptInput.disabled = on;
    els.previewSkeleton.hidden = !on;
    els.modelSelect.disabled = on;
    els.projectSelect.disabled = on;
    els.btnNewProject.disabled = on;
    els.btnExport.disabled = on;
  }

  function appendBubble(role, htmlContent) {
    const div = document.createElement("div");
    div.className =
      "chat-bubble chat-bubble--" +
      (role === "user" ? "user" : role === "system" ? "system" : "assistant");
    div.innerHTML = htmlContent;
    els.chatList.appendChild(div);
    els.chatList.scrollTop = els.chatList.scrollHeight;
    return div;
  }

  function clearAbort() {
    if (state.timeoutId) {
      clearTimeout(state.timeoutId);
      state.timeoutId = null;
    }
    state.abortController = null;
  }

  function stopGenerate(reason) {
    if (state.abortController) {
      try {
        state.abortController.abort(reason || "stop");
      } catch (_) {
        state.abortController.abort();
      }
    }
    clearAbort();
    setGeneratingUI(false);
  }

  async function startGenerate(prompt, options) {
    options = options || {};
    const text = String(prompt || "").trim();
    if (!text) {
      toast("请先输入需求描述");
      return;
    }
    if (state.generating) {
      toast("正在生成中，请先停止或等待完成");
      return;
    }

    state.lastPrompt = text;
    if (!options.isRetry && !options.isFix) {
      appendBubble("user", "<p></p>").querySelector("p").textContent = text;
    } else if (options.isFix) {
      appendBubble("user", "<p></p>").querySelector("p").textContent =
        "🔧 修复预览报错";
    }

    const modeHint = options.isFix
      ? "根据报错修复中…"
      : state.hasCode
        ? "按上下文修改中…"
        : "理解需求中…";
    const assistant = appendBubble(
      "assistant",
      STAGES_HTML +
        '<p class="chat-status">' +
        modeHint +
        '</p><pre class="chat-stream"></pre>'
    );
    const stagesEl = assistant.querySelector(".agent-stages");
    const statusEl = assistant.querySelector(".chat-status");
    const streamEl = assistant.querySelector(".chat-stream");
    state.activeStagesEl = stagesEl;
    setAgentStage(stagesEl, "understand");

    setGeneratingUI(true);
    const controller = new AbortController();
    state.abortController = controller;
    state.timeoutId = setTimeout(function () {
      controller.abort("timeout");
    }, GEN_TIMEOUT);

    const model =
      els.modelSelect.value ||
      (window.ATOMS_CONFIG && window.ATOMS_CONFIG.defaultModel) ||
      "deepseek-chat";

    let sawDelta = false;

    try {
      // 短暂展示「理解需求」再进入编码（体感阶段，不阻塞首包）
      await new Promise(function (r) {
        setTimeout(r, 280);
      });
      if (controller.signal.aborted) throw Object.assign(new Error("Aborted"), { name: "AbortError" });

      setAgentStage(stagesEl, "codegen");
      statusEl.textContent = "生成代码中…";

      const raw = await window.AtomsCloud.streamChat({
        model: model,
        messages: buildMessages(text),
        signal: controller.signal,
        onDelta: function (_delta, full) {
          if (!sawDelta) {
            sawDelta = true;
            setAgentStage(stagesEl, "codegen");
          }
          streamEl.textContent = full;
          els.chatList.scrollTop = els.chatList.scrollHeight;
          els.codeText.textContent = full;
        },
      });

      clearAbort();
      statusEl.textContent = "正在提取 HTML…";
      const extracted = window.AtomsExtract.extractHtml(raw);
      if (!extracted.ok) {
        statusEl.textContent = "生成失败";
        setAgentStage(stagesEl, "codegen", true);
        addRegenInBubble(assistant);
        setGeneratingUI(false);
        toast(extracted.reason || "输出格式错误", {
          error: true,
          regenerate: true,
          sticky: true,
        });
        return;
      }

      setAgentStage(stagesEl, "render");
      statusEl.textContent = "渲染预览…";
      renderPreview(extracted.html, {
        prompt: text,
        code: extracted.html,
        stagesEl: stagesEl,
        statusEl: statusEl,
      });
      statusEl.textContent = "等待预览加载并保存版本…";
      streamEl.textContent =
        extracted.html.slice(0, 4000) +
        (extracted.html.length > 4000 ? "\n……" : "");
      setGeneratingUI(false);
    } catch (err) {
      clearAbort();
      setGeneratingUI(false);
      const aborted =
        err &&
        (err.name === "AbortError" ||
          err.message === "Aborted" ||
          String(err.message || "").toLowerCase().indexOf("abort") !== -1);
      if (aborted) {
        const timedOut =
          controller.signal.reason === "timeout" ||
          String(controller.signal.reason) === "timeout";
        statusEl.textContent = timedOut ? "超时" : "已停止";
        setAgentStage(stagesEl, sawDelta ? "codegen" : "understand", true);
        if (timedOut) {
          addRegenInBubble(assistant);
          toast("生成超时（" + GEN_TIMEOUT / 1000 + "s），请重试", {
            error: true,
            regenerate: true,
            sticky: true,
          });
        } else {
          toast("已停止生成");
        }
        return;
      }
      statusEl.textContent = "生成失败";
      setAgentStage(stagesEl, "codegen", true);
      addRegenInBubble(assistant);
      toast((err && err.message) || "流中断或生成失败，请重新生成", {
        error: true,
        regenerate: true,
        sticky: true,
      });
    }
  }

  function addRegenInBubble(assistantEl) {
    if (assistantEl.querySelector(".chat-actions")) return;
    const actions = document.createElement("div");
    actions.className = "chat-actions";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-primary";
    btn.textContent = "重新生成";
    btn.addEventListener("click", function () {
      if (state.lastPrompt) startGenerate(state.lastPrompt, { isRetry: true });
    });
    actions.appendChild(btn);
    assistantEl.appendChild(actions);
  }

  function openRollbackConfirm(version, indexLabel) {
    state.pendingRollbackId = version.id;
    els.confirmBody.textContent =
      "将回滚到 v" +
      indexLabel +
      "（" +
      formatTime(version.created_at) +
      "）。之后的版本会被删除，对话上下文同步恢复。此操作不可撤销。";
    els.confirmModal.hidden = false;
  }

  function closeRollbackConfirm() {
    state.pendingRollbackId = null;
    els.confirmModal.hidden = true;
  }

  async function confirmRollback() {
    if (!state.project || !state.pendingRollbackId) {
      closeRollbackConfirm();
      return;
    }
    const versionId = state.pendingRollbackId;
    closeRollbackConfirm();
    try {
      const result = await window.AtomsStore.rollbackToVersion(
        state.project.id,
        versionId
      );
      state.hasCode = true;
      state.currentCode = result.version.code;
      state.userTurns = result.versions.map(function (v) {
        return {
          prompt: v.prompt || "",
          summary: summarizePrompt(v.prompt || ""),
        };
      });
      state.lastPrompt =
        (result.version && result.version.prompt) || state.lastPrompt;
      els.codeText.textContent = result.version.code;
      state.expectLoadSave = false;
      state.pendingSnapshot = null;
      clearConsole();
      els.iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
      els.iframe.srcdoc = withConsoleBridge(result.version.code);
      restoreChatFromMessages(result.messages);
      updateVersionBadge();
      renderVersionsList();
      toast("已回滚，可继续基于此版本修改");
    } catch (e) {
      toast((e && e.message) || "回滚失败", { error: true, sticky: true });
    }
  }

  function exportHtml() {
    if (!state.hasCode || !state.currentCode) {
      toast("暂无可导出的代码", { error: true });
      return;
    }
    const title =
      (state.project && state.project.title) || "atoms-export";
    const safe = String(title)
      .replace(/[\\/:*?"<>|]+/g, "_")
      .slice(0, 40);
    const blob = new Blob([state.currentCode], {
      type: "text/html;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = safe + ".html";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast("已导出 " + safe + ".html");
  }

  async function handleNewProject() {
    if (state.generating) return;
    const name = window.prompt("新项目名称", "未命名项目");
    if (name === null) return;
    try {
      const project = await window.AtomsStore.createProject(
        name.trim() || "未命名项目"
      );
      applyProjectState(project, { toastMsg: "已新建项目" });
    } catch (e) {
      toast((e && e.message) || "新建失败", { error: true, sticky: true });
    }
  }

  function handleSwitchProject() {
    if (state.generating) return;
    const id = els.projectSelect.value;
    if (!id || (state.project && state.project.id === id)) return;
    try {
      const project = window.AtomsStore.switchProject(id);
      applyProjectState(project, { toastMsg: "已切换项目" });
    } catch (e) {
      toast((e && e.message) || "切换失败", { error: true, sticky: true });
    }
  }

  function enterWorkspace() {
    els.authOverlay.hidden = true;
    els.app.hidden = false;
    els.app.classList.remove("is-locked");
  }

  async function loadModels() {
    const models = await window.AtomsCloud.listModels();
    const preferred =
      (window.ATOMS_CONFIG && window.ATOMS_CONFIG.defaultModel) ||
      "deepseek-chat";
    els.modelSelect.innerHTML = "";
    models.forEach(function (m) {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.name || m.id;
      if (m.id === preferred) opt.selected = true;
      els.modelSelect.appendChild(opt);
    });
    if (!els.modelSelect.value && models[0]) {
      els.modelSelect.value = models[0].id;
    }
  }

  async function bootstrapProject() {
    const existing = window.AtomsStore.getProject();
    if (existing) {
      applyProjectState(existing);
    } else {
      refreshProjectSelect();
      renderVersionsList();
    }
  }

  let sendCodeCooldownTimer = null;

  function setSendCodeCooldown(sec) {
    if (sendCodeCooldownTimer) {
      clearInterval(sendCodeCooldownTimer);
      sendCodeCooldownTimer = null;
    }
    if (!els.btnSendCode) return;
    let left = Math.max(0, Number(sec) || 0);
    if (left <= 0) {
      els.btnSendCode.disabled = false;
      els.btnSendCode.textContent = "发送验证码";
      return;
    }
    els.btnSendCode.disabled = true;
    els.btnSendCode.textContent = left + "s";
    sendCodeCooldownTimer = setInterval(function () {
      left -= 1;
      if (left <= 0) {
        clearInterval(sendCodeCooldownTimer);
        sendCodeCooldownTimer = null;
        els.btnSendCode.disabled = false;
        els.btnSendCode.textContent = "发送验证码";
      } else {
        els.btnSendCode.textContent = left + "s";
      }
    }, 1000);
  }

  async function handleSendCode() {
    if (!els.btnSendCode || els.btnSendCode.disabled) return;
    els.btnSendCode.disabled = true;
    try {
      await window.AtomsCloud.sendLoginCode(els.authEmail.value);
      toast("验证码已发送，请查收邮箱");
      setSendCodeCooldown(60);
      if (els.authCode) els.authCode.focus();
    } catch (e) {
      els.btnSendCode.disabled = false;
      els.btnSendCode.textContent = "发送验证码";
      toast((e && e.message) || "发送失败", { error: true, sticky: true });
    }
  }

  async function handleEnterWorkspace() {
    els.btnEnter.disabled = true;
    try {
      await window.AtomsCloud.signInWithCode(
        els.authEmail.value,
        els.authCode && els.authCode.value
      );
      toast("已进入工作台");
      enterWorkspace();
      await loadModels();
      await bootstrapProject();
    } catch (e) {
      toast((e && e.message) || "进入失败", { error: true, sticky: true });
    } finally {
      els.btnEnter.disabled = false;
    }
  }

  function initAuth() {
    if (!window.AtomsCloud.isConfigured()) {
      els.authConfigHint.hidden = false;
      els.authConfigHint.textContent =
        "请用 server.js 启动，并设置 LLM_API_KEY 与 SMTP_*";
    }

    if (els.btnSendCode) {
      els.btnSendCode.addEventListener("click", handleSendCode);
    }
    els.btnEnter.addEventListener("click", handleEnterWorkspace);
    els.authEmail.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSendCode();
      }
    });
    if (els.authCode) {
      els.authCode.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          handleEnterWorkspace();
        }
      });
    }
  }

  function initTabs() {
    els.tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        const name = tab.dataset.tab;
        els.tabs.forEach(function (t) {
          const active = t === tab;
          t.classList.toggle("is-active", active);
          t.setAttribute("aria-selected", String(active));
        });
        els.panelChat.classList.toggle("is-active", name === "chat");
        els.panelChat.hidden = name !== "chat";
        els.panelCode.classList.toggle("is-active", name === "code");
        els.panelCode.hidden = name !== "code";
        els.panelVersions.classList.toggle("is-active", name === "versions");
        els.panelVersions.hidden = name !== "versions";
        if (name === "versions") renderVersionsList();
      });
    });
  }

  function applyLeftRatio(ratioPct) {
    const clamped = Math.min(70, Math.max(28, ratioPct));
    document.documentElement.style.setProperty("--left-ratio", clamped + "%");
    return clamped;
  }

  function initSplitter() {
    let saved = 42;
    try {
      const raw = localStorage.getItem(STORAGE_LEFT_RATIO);
      if (raw) saved = parseFloat(raw);
    } catch (_) {}
    applyLeftRatio(saved);

    let dragging = false;

    function onPointerMove(e) {
      if (!dragging) return;
      const rect = els.workspace.getBoundingClientRect();
      const isColumn = window.matchMedia("(max-width: 800px)").matches;
      let ratio;
      if (isColumn) {
        ratio = ((e.clientY - rect.top) / rect.height) * 100;
        els.paneLeft.style.height = Math.min(70, Math.max(25, ratio)) + "%";
        els.paneLeft.style.width = "100%";
        return;
      }
      ratio = ((e.clientX - rect.left) / rect.width) * 100;
      const applied = applyLeftRatio(ratio);
      els.paneLeft.style.width = applied + "%";
      els.paneLeft.style.height = "";
    }

    function stopDrag() {
      if (!dragging) return;
      dragging = false;
      els.splitter.classList.remove("is-dragging");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try {
        const current = getComputedStyle(document.documentElement)
          .getPropertyValue("--left-ratio")
          .trim()
          .replace("%", "");
        localStorage.setItem(STORAGE_LEFT_RATIO, current);
      } catch (_) {}
    }

    els.splitter.addEventListener("pointerdown", function (e) {
      dragging = true;
      els.splitter.classList.add("is-dragging");
      els.splitter.setPointerCapture(e.pointerId);
      document.body.style.cursor = window.matchMedia("(max-width: 800px)")
        .matches
        ? "row-resize"
        : "col-resize";
      document.body.style.userSelect = "none";
    });
    els.splitter.addEventListener("pointermove", onPointerMove);
    els.splitter.addEventListener("pointerup", stopDrag);
    els.splitter.addEventListener("pointercancel", stopDrag);
    els.splitter.addEventListener("keydown", function (e) {
      const step = e.shiftKey ? 5 : 2;
      let current = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--left-ratio"
        )
      );
      if (Number.isNaN(current)) current = 42;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        applyLeftRatio(current - step);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        applyLeftRatio(current + step);
      }
    });
  }

  function initComposer() {
    els.composer.addEventListener("submit", function (e) {
      e.preventDefault();
      startGenerate(els.promptInput.value);
      els.promptInput.value = "";
    });

    els.promptInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        els.composer.requestSubmit();
      }
    });

    els.btnStop.addEventListener("click", function () {
      stopGenerate("stop");
    });

    document.querySelectorAll(".chip[data-prompt]").forEach(function (chip) {
      chip.addEventListener("click", function () {
        els.promptInput.value = chip.getAttribute("data-prompt") || "";
        els.promptInput.focus();
      });
    });
  }

  function initProjectActions() {
    els.btnNewProject.addEventListener("click", handleNewProject);
    els.projectSelect.addEventListener("change", handleSwitchProject);
    els.btnExport.addEventListener("click", exportHtml);
    els.confirmCancel.addEventListener("click", closeRollbackConfirm);
    els.confirmOk.addEventListener("click", confirmRollback);
    els.confirmModal.addEventListener("click", function (e) {
      if (e.target === els.confirmModal) closeRollbackConfirm();
    });
  }

  function initConsole() {
    els.btnConsoleToggle.addEventListener("click", function () {
      state.consoleOpen = !state.consoleOpen;
      els.consoleBody.hidden = !state.consoleOpen;
      els.btnConsoleToggle.setAttribute(
        "aria-expanded",
        String(state.consoleOpen)
      );
    });
    els.btnConsoleClear.addEventListener("click", clearConsole);
    els.btnAiFix.addEventListener("click", requestAiFix);

    window.addEventListener("message", function (event) {
      const data = event.data;
      if (!data || data.source !== "atoms-demo" || data.type !== "console") {
        return;
      }
      // 仅接受来自预览 iframe 的消息
      if (event.source !== els.iframe.contentWindow) return;
      appendConsoleEntry(data.level || "log", data.args || []);
    });
  }

  function initPreviewChrome() {
    els.iframe.addEventListener("load", function () {
      onIframeLoad();
    });

    els.btnViewportPc.addEventListener("click", function () {
      els.frameWrap.dataset.viewport = "pc";
      els.btnViewportPc.classList.add("is-active");
      els.btnViewportMobile.classList.remove("is-active");
    });
    els.btnViewportMobile.addEventListener("click", function () {
      els.frameWrap.dataset.viewport = "mobile";
      els.btnViewportMobile.classList.add("is-active");
      els.btnViewportPc.classList.remove("is-active");
    });
    els.btnRefresh.addEventListener("click", function () {
      renderPreview(state.currentCode || PLACEHOLDER_HTML, null);
      toast("预览已刷新");
    });
    els.btnFullscreen.addEventListener("click", function () {
      els.previewStage.classList.toggle("is-fullscreen");
    });
    document.addEventListener("keydown", function (e) {
      if (
        e.key === "Escape" &&
        els.previewStage.classList.contains("is-fullscreen")
      ) {
        els.previewStage.classList.remove("is-fullscreen");
      }
      if (e.key === "Escape" && !els.confirmModal.hidden) {
        closeRollbackConfirm();
      }
    });
  }

  async function init() {
    renderPreview(PLACEHOLDER_HTML, null);
    initTabs();
    initSplitter();
    initComposer();
    initPreviewChrome();
    initConsole();
    initProjectActions();
    initAuth();

    try {
      const session = await window.AtomsCloud.getSession();
      if (session) {
        enterWorkspace();
        await loadModels();
        await bootstrapProject();
      }
    } catch (_) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
