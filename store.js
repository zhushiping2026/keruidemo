/**
 * 持久化：projects / versions / messages（仅 LocalStorage）
 * 版本上限 50。
 */
(function (global) {
  "use strict";

  const LOCAL_KEY = "atoms-demo:store";
  const ACTIVE_KEY = "atoms-demo:active-project";
  const MAX_VERSIONS = 50;

  function uuid() {
    if (global.crypto && typeof global.crypto.randomUUID === "function") {
      return global.crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function readLocal() {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      if (!raw) {
        return { projects: [], versions: [], messages: [] };
      }
      const data = JSON.parse(raw);
      return {
        projects: data.projects || [],
        versions: data.versions || [],
        messages: data.messages || [],
      };
    } catch (_) {
      return { projects: [], versions: [], messages: [] };
    }
  }

  function writeLocal(data) {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
  }

  function getActiveProjectId() {
    try {
      return localStorage.getItem(ACTIVE_KEY) || "";
    } catch (_) {
      return "";
    }
  }

  function setActiveProjectId(id) {
    try {
      if (id) localStorage.setItem(ACTIVE_KEY, id);
      else localStorage.removeItem(ACTIVE_KEY);
    } catch (_) {}
  }

  async function getOwnerId() {
    const session = await global.AtomsCloud.getSession();
    if (!session || !session.user) return "local";
    return session.user.email || "local";
  }

  function sortByCreatedAsc(rows) {
    return rows.slice().sort(function (a, b) {
      return String(a.created_at || "").localeCompare(String(b.created_at || ""));
    });
  }

  function sortByCreatedDesc(rows) {
    return sortByCreatedAsc(rows).reverse();
  }

  function listProjects() {
    return sortByCreatedDesc(readLocal().projects);
  }

  function getProject(id) {
    const pid = id || getActiveProjectId();
    const list = readLocal().projects;
    if (pid) {
      for (let i = 0; i < list.length; i++) {
        if (list[i].id === pid) return list[i];
      }
    }
    return list.length ? list[list.length - 1] : null;
  }

  function listVersions(projectId) {
    return sortByCreatedAsc(
      readLocal().versions.filter(function (v) {
        return v.project_id === projectId;
      })
    );
  }

  function listMessages(projectId) {
    return sortByCreatedAsc(
      readLocal().messages.filter(function (m) {
        return m.project_id === projectId;
      })
    );
  }

  /** 超出 50 淘汰最旧版本及其关联消息 */
  function pruneVersions(local, projectId) {
    const mine = sortByCreatedAsc(
      local.versions.filter(function (v) {
        return v.project_id === projectId;
      })
    );
    if (mine.length <= MAX_VERSIONS) return;
    const drop = mine.slice(0, mine.length - MAX_VERSIONS);
    const dropIds = {};
    drop.forEach(function (v) {
      dropIds[v.id] = true;
    });
    local.versions = local.versions.filter(function (v) {
      return !dropIds[v.id];
    });
    local.messages = local.messages.filter(function (m) {
      return !dropIds[m.version_id];
    });
  }

  async function createProject(title) {
    const ownerId = await getOwnerId();
    const row = {
      id: uuid(),
      owner_id: ownerId,
      title: (title || "未命名项目").slice(0, 80),
      conversation_id: uuid(),
      created_at: new Date().toISOString(),
    };
    const local = readLocal();
    local.projects.push(row);
    writeLocal(local);
    setActiveProjectId(row.id);
    return row;
  }

  async function ensureProject(title) {
    const active = getProject();
    if (active) {
      setActiveProjectId(active.id);
      return active;
    }
    return createProject(title || "未命名项目");
  }

  function switchProject(projectId) {
    const p = getProject(projectId);
    if (!p) throw new Error("项目不存在");
    setActiveProjectId(p.id);
    return p;
  }

  /**
   * iframe 渲染成功后：写入 version + messages，并淘汰超量旧版本
   */
  async function saveSnapshot(opts) {
    const projectId = opts.projectId;
    const code = opts.code;
    const prompt = opts.prompt || "";
    const ownerId = await getOwnerId();
    const now = new Date().toISOString();

    const version = {
      id: uuid(),
      owner_id: ownerId,
      project_id: projectId,
      code: code,
      prompt: prompt,
      created_at: now,
    };

    const userMsg = {
      id: uuid(),
      owner_id: ownerId,
      project_id: projectId,
      role: "user",
      content: prompt,
      version_id: version.id,
      created_at: now,
    };

    const assistantMsg = {
      id: uuid(),
      owner_id: ownerId,
      project_id: projectId,
      role: "assistant",
      content: "[snapshot] 已生成并渲染成功",
      version_id: version.id,
      created_at: now,
    };

    const local = readLocal();
    local.versions.push(version);
    local.messages.push(userMsg, assistantMsg);
    pruneVersions(local, projectId);
    writeLocal(local);
    setActiveProjectId(projectId);

    const versionIndex = listVersions(projectId).length;

    return {
      version: version,
      versionIndex: versionIndex,
    };
  }

  /**
   * 线性回滚：恢复到目标版本，删除其后的版本与消息
   */
  async function rollbackToVersion(projectId, versionId) {
    const local = readLocal();
    const versions = sortByCreatedAsc(
      local.versions.filter(function (v) {
        return v.project_id === projectId;
      })
    );
    const idx = versions.findIndex(function (v) {
      return v.id === versionId;
    });
    if (idx < 0) throw new Error("版本不存在");

    const keep = versions.slice(0, idx + 1);
    const keepIds = {};
    keep.forEach(function (v) {
      keepIds[v.id] = true;
    });

    local.versions = local.versions.filter(function (v) {
      if (v.project_id !== projectId) return true;
      return keepIds[v.id];
    });
    local.messages = local.messages.filter(function (m) {
      if (m.project_id !== projectId) return true;
      return keepIds[m.version_id];
    });
    writeLocal(local);

    const target = keep[keep.length - 1];
    return {
      version: target,
      versions: keep,
      messages: listMessages(projectId),
    };
  }

  global.AtomsStore = {
    MAX_VERSIONS: MAX_VERSIONS,
    uuid: uuid,
    createProject: createProject,
    ensureProject: ensureProject,
    switchProject: switchProject,
    listProjects: listProjects,
    getProject: getProject,
    getActiveProjectId: getActiveProjectId,
    setActiveProjectId: setActiveProjectId,
    listVersions: listVersions,
    listMessages: listMessages,
    saveSnapshot: saveSnapshot,
    rollbackToVersion: rollbackToVersion,
  };
})(window);
