/**
 * 从模型输出中提取单文件 HTML
 * 1) 剥离 markdown 围栏  2) 定位 <!DOCTYPE>/<html>…</html> 兜底
 */
(function (global) {
  "use strict";

  function stripFences(text) {
    let s = String(text || "").trim();
    // ```html ... ``` 或 ``` ... ```
    const fence = /^```(?:html|HTML|htm)?\s*\r?\n([\s\S]*?)\r?\n```\s*$/;
    const m = s.match(fence);
    if (m) return m[1].trim();

    // 围栏夹杂前后说明文字：取最大围栏块
    const re = /```(?:html|HTML|htm)?\s*\r?\n([\s\S]*?)\r?\n```/g;
    let best = "";
    let match;
    while ((match = re.exec(s)) !== null) {
      if (match[1].length > best.length) best = match[1];
    }
    if (best) return best.trim();
    return s;
  }

  function sliceHtmlDocument(text) {
    const s = String(text || "");
    const lower = s.toLowerCase();
    let start = lower.indexOf("<!doctype");
    if (start < 0) start = lower.indexOf("<html");
    if (start < 0) return "";
    const end = lower.lastIndexOf("</html>");
    if (end > start) {
      return s.slice(start, end + "</html>".length).trim();
    }
    return s.slice(start).trim();
  }

  function looksLikeHtml(html) {
    if (!html || html.length < 20) return false;
    const l = html.toLowerCase();
    return (
      l.indexOf("<html") !== -1 ||
      l.indexOf("<!doctype") !== -1 ||
      (l.indexOf("<body") !== -1 && l.indexOf("<") !== -1)
    );
  }

  /**
   * @returns {{ ok: boolean, html: string, reason?: string }}
   */
  function extractHtml(raw) {
    const stripped = stripFences(raw);
    let html = sliceHtmlDocument(stripped) || stripped;
    if (!looksLikeHtml(html)) {
      return {
        ok: false,
        html: "",
        reason: "输出不是合法的单文件 HTML（缺少 html/doctype 结构）",
      };
    }
    // 若只有片段，包一层最小文档
    const l = html.toLowerCase();
    if (l.indexOf("<html") === -1 && l.indexOf("<!doctype") === -1) {
      html =
        "<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\"><title>App</title></head><body>" +
        html +
        "</body></html>";
    }
    return { ok: true, html: html };
  }

  global.AtomsExtract = {
    extractHtml: extractHtml,
    stripFences: stripFences,
  };
})(window);
