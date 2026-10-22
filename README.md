# Atoms Demo — 自然语言 → 可运行 Web 应用

3–4 小时笔试 Demo：用对话生成、预览、迭代并导出**单文件 HTML**。重点是可体验的产品闭环，而非脚手架。

## 功能清单

| 能力 | 说明 |
| --- | --- |
| 本地登录门禁 | 邮箱写入会话即可进入（不做云 OTP） |
| 流式生成 | 自备 OpenAI 兼容 API（如 DeepSeek）SSE + AbortController |
| 沙箱预览 | `iframe sandbox` + `srcdoc`，禁止 `eval` / 宿主 DOM 注入 |
| 对话式修改 | 仅携带最近 3 轮用户指令摘要 + 当前完整代码 |
| 版本快照 | 预览 `load` 成功后自动存档；上限 50 |
| 版本管理 | 列表、二次确认回滚、导出 `.html` |
| 项目切换 | 新建 / 切换项目，刷新后 LocalStorage 恢复 |
| Agent 阶段可视化 | 理解需求 → 生成代码 → 渲染预览 → 完成/失败 |
| 预览控制台 | 捕获 iframe `console` / `error`，一键「发给 AI 修复」 |

## 架构示意

```
┌──────────── 宿主 SPA（index.html + app.js）────────────┐
│  对话 / 代码 / 版本 Tab     │   预览区 + 控制台抽屉      │
│  Agent 阶段指示器            │   iframe[sandbox+srcdoc]  │
│         │                    │          ▲ postMessage   │
│         ▼                    │   （console / onerror）  │
│  AtomsCloud（SSE LLM）       │                          │
│  AtomsExtract（围栏剥离）    │                          │
│  AtomsStore → LocalStorage   │                          │
│  （projects/versions/messages）│                         │
└──────────────┬───────────────┴──────────────────────────┘
               │ 同源 /v1（server.js 代理）
               ▼
     DeepSeek OpenAI 兼容 API（SSE）
     Key 仅存服务端环境变量 LLM_API_KEY
```

## 技术取舍（Won't）

| 砍掉 | 理由 |
| --- | --- |
| WorkBuddy 云服务 / 免密钥 LLM / 云库三表 | 改用 LocalStorage + 自备 API Key，零云依赖 |
| 微信 / GitHub / 云端邮箱 OTP | 本地会话门禁已够 Demo |
| Diff 对比视图 | 用版本列表 + 回滚 + 导出替代 |
| 一键部署分享 | Demo 只做导出 `.html` |
| Token 计费 / 配额 | 仅保留单并发生成 + 停止按钮 |

## 本地运行

无构建依赖。在 `atoms-demo/` 目录：

```bash
# Windows
set LLM_API_KEY=sk-xxx && node server.js

# macOS / Linux
LLM_API_KEY=sk-xxx node server.js

# 或
npm start
```

浏览器打开 `http://localhost:5173`。`config.js` 中 `llmBaseUrl` 默认为同源 `/v1`，由 `server.js` 转发到 DeepSeek；前端 `llmApiKey` 保持为空。

## 分享链接（Render，无需自购服务器）

仓库已含 `render.yaml`。步骤：

1. 将本目录推送到 GitHub（例如 [zhushiping2026/keruidemo](https://github.com/zhushiping2026/keruidemo)）
2. 打开 [Render Dashboard](https://dashboard.render.com/) → **New** → **Web Service** → 连接该仓库
3. 若未自动读到 Blueprint：Runtime `Node`，Build `npm install`，Start `node server.js`
4. **Environment** 增加 `LLM_API_KEY` = 你的 DeepSeek Key（勿写进代码）
5. 部署完成后把 `https://xxx.onrender.com` 发给对方即可

免费档休眠后首次打开可能要等约 30–60 秒唤醒。他人使用会消耗你的 DeepSeek 额度。

## 目录

```
atoms-demo/
  index.html    # 结构
  styles.css    # 暗黑极客风 UI
  config.js     # 前端配置（无 Key）
  cloud.js      # Auth + LLM SSE 客户端
  extract.js    # HTML / 围栏提取
  store.js      # LocalStorage 持久化
  app.js        # 主逻辑
  server.js     # 静态托管 + /v1 代理
  package.json
  README.md
```

## 安全红线

- 生成代码仅经 `iframe.srcdoc` 注入，`sandbox="allow-scripts allow-same-origin"`
- 宿主不使用 `eval`，不把模型 HTML 直接写入宿主业务 DOM
- 控制台桥接脚本只附加在预览用 srcdoc 上，**不写入**落库 / 导出文件
- API Key 仅存于服务端环境变量 `LLM_API_KEY`，前端不持有

## 已知限制

- 单文件 HTML 天花板明显：无 Node 运行时、无真实后端 DB（产品文案需管理预期）
- LocalStorage 不跨设备、清站点数据即丢
- `srcdoc` + `allow-same-origin` 需在主流浏览器各验一次
- 模型偶发不遵守单文件约束：靠提取器兜底；连续失败请换 Prompt 重试

## 建议回归路径

进入工作台 → 生成 → 对话修改（看阶段指示器）→ 人为制造预览报错 →「发给 AI 修复」→ 回滚 → 导出 → 刷新恢复。
