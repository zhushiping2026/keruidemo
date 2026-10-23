# Atoms Demo — 自然语言 → 可运行 Web 应用

3–4 小时笔试 Demo：用对话生成、预览、迭代并导出**单文件 HTML**。重点是可体验的产品闭环，而非脚手架。

## 功能清单

| 能力 | 说明 |
| --- | --- |
| 邮箱验证码登录 | 服务端经 SMTP 发 6 位码，校验通过后进入工作台 |
| 流式生成 | DeepSeek OpenAI 兼容 API（SSE）+ AbortController；默认关闭 thinking |
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
│  登录（邮箱+验证码）  对话 / 代码 / 版本 Tab │ 预览 + 控制台 │
│  AtomsCloud → /api/send-code、/api/login、/v1 SSE      │
│  AtomsStore → LocalStorage（按浏览器隔离，非多租户）   │
└───────┬───────────────────────────┬───────────────────┘
        │                           │
        ▼                           ▼
  SMTP 发验证码              DeepSeek API（服务端 LLM_API_KEY）
  （SMTP_* 环境变量）         server.js 同源 /v1 代理
```

## 技术取舍（Won't）

| 砍掉 | 理由 |
| --- | --- |
| WorkBuddy 云服务 / 免密钥 LLM / 云库三表 | LocalStorage + 自备 Key / SMTP，无第三方云账号体系 |
| 微信 / GitHub OAuth、短信验证码 | Demo 仅做邮箱 SMTP OTP |
| 服务端用户库 / 跨设备同步 | 会话与项目数据仅存各浏览器 LocalStorage |
| Diff 对比视图 | 用版本列表 + 回滚 + 导出替代 |
| Token 计费面板 | 仅单并发生成 + 停止；额度在 DeepSeek 侧 |

## 配置（`.env`）

复制 `.env.example` 为 `.env`（已 gitignore，勿提交真实密钥）：

```env
LLM_API_KEY=sk-你的DeepSeek密钥

# 发信邮箱（寄验证码用）；登录用户可填任意能收信的邮箱
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=你的QQ号@qq.com
SMTP_PASS=QQ邮箱SMTP授权码
SMTP_FROM=你的QQ号@qq.com
```

- **SMTP_USER**：固定的**发件人**（如你的 QQ 邮箱）  
- **登录框邮箱**：任意**收件人**，不限制为 SMTP_USER  
- QQ 授权码：网页版 [mail.qq.com](https://mail.qq.com) → 设置 → 账号与安全 → 开启 SMTP → **生成授权码**（不是 QQ 登录密码）

`server.js` 启动时会自动加载同目录 `.env`。

## 本地运行

无构建步骤。在 `atoms-demo/`：

```powershell
# 已写好 .env 后
node .\server.js
# 或
npm start
```

浏览器打开 **http://127.0.0.1:5173**。

流程：邮箱 →「发送验证码」→ 填 6 位码 → 进入工作台 → 对话生成。

默认模型为 `deepseek-flash`（见 `config.js`）。前端不持有 API Key。

## 分享链接怎么来（本机 + 隧道）

本机 `127.0.0.1` 外网访问不到。需要另开一个终端做临时隧道，终端里打印出的 `https://….trycloudflare.com` 才是分享链接：

```powershell
# 终端 1：先保证服务在跑
cd C:\Users\18505\OneDrive\Desktop\demo\atoms-demo
node .\server.js

# 终端 2：开隧道（需已安装 cloudflared）
& "C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://127.0.0.1:5173 --protocol http2
```

| 说明 | |
| --- | --- |
| 链接从哪看 | 终端 2 输出中的 `https://xxxx.trycloudflare.com` |
| 是否固定 | 否，每次重开隧道地址常会变 |
| 何时失效 | 关闭电脑，或停掉 `node` / `cloudflared` |
| 费用与数据 | 别人用会消耗你的 DeepSeek 额度；项目数据在对方浏览器 LocalStorage |

也可使用 ngrok（需自行注册并配置 authtoken）：`ngrok http 5173`。

### 可选：Render 长期托管

仓库含 `render.yaml`。需 Render 账号（常要求绑卡），Environment 中配置 `LLM_API_KEY` 与全部 `SMTP_*`，Start：`node server.js`。得到 `https://xxx.onrender.com` 后可长期分享（免费档会休眠）。

## 目录

```
atoms-demo/
  index.html       # 结构与登录页
  styles.css       # UI
  config.js        # 前端配置（无 Key；默认 deepseek-flash）
  cloud.js         # 验证码登录客户端 + LLM SSE
  extract.js       # HTML / 围栏提取
  store.js         # LocalStorage 持久化
  app.js           # 主逻辑
  server.js        # 静态托管 + /api 验证码 + /v1 代理
  mail.js          # 零依赖 SMTP 发信
  otp.js           # 验证码签发与校验（内存）
  .env.example     # 环境变量模板
  render.yaml      # 可选 Render 蓝图
  package.json
  README.md
```

## 安全红线

- 生成代码仅经 `iframe.srcdoc` 注入，`sandbox="allow-scripts allow-same-origin"`
- 宿主不使用 `eval`，不把模型 HTML 直接写入宿主业务 DOM
- 控制台桥接脚本只附加在预览用 srcdoc 上，**不写入**落库 / 导出文件
- `LLM_API_KEY`、SMTP 授权码仅存服务端 / `.env`，前端不持有
- 分享链接等于公开你的生成能力，注意额度与停服

## 已知限制

- 单文件 HTML：无 Node 运行时、无真实后端 DB
- LocalStorage 不跨设备；无服务端账户隔离（仅「能否登录」靠验证码）
- 验证码存服务端内存，重启进程后未使用的码失效
- 隧道链接不稳定时请优先用本机 `127.0.0.1:5173` 自测
- 模型偶发不遵守单文件约束：靠提取器兜底

## 建议回归路径

配置 `.env` → 启动 → 验证码登录 → 生成 → 对话修改 → 预览报错「发给 AI 修复」→ 回滚 → 导出 → 刷新恢复。
