/**
 * 本地 Demo 配置：LLM 经同源 /v1 代理（server.js → DeepSeek）
 * 前端不持 API Key。
 */
window.ATOMS_CONFIG = {
  llmBaseUrl: "/v1", // 同源代理，由 server.js 转发到 DeepSeek
  llmApiKey: "", // 前端不持 Key，由代理在服务端注入
  defaultModel: "deepseek-chat",
  generateTimeoutMs: 60000,
};
