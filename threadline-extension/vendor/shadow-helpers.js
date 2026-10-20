/*
 * Adapted portions of dialoguesai/chatgpt-shadow-extension/extract.js
 * Copyright 2026 Dialogues and contributors. Apache License 2.0.
 * Original: https://github.com/dialoguesai/chatgpt-shadow-extension
 * Modifications: removed chat content extraction; retained only URL/title/stream indicators.
 * See ../licenses/Apache-2.0.txt.
 */
const ThreadLinePage = (() => {
  const THREAD_RE = /\/(?:c)\/([a-z0-9-]+)/i;
  function conversationIdFromUrl(href) {
    const match = String(href || "").match(THREAD_RE);
    return match ? match[1] : "";
  }
  function conversationTitleFromPageTitle(title) {
    const raw = String(title || "").trim();
    if (!raw) return "新对话";
    return raw.replace(/\s+[-–|]\s+ChatGPT\s*$/i, "").trim() || "新对话";
  }
  function extractTitle(root) {
    const doc = root.ownerDocument || root;
    const current =
      doc.querySelector('nav a[aria-current="page"]') ||
      doc.querySelector('nav a[data-active="true"]') ||
      doc.querySelector('a[href*="/c/"][aria-current="page"]');
    const labeled = current && (current.getAttribute("title") || current.textContent);
    if (labeled && labeled.trim()) return labeled.trim();
    return conversationTitleFromPageTitle(doc.title);
  }
  function isStreaming(root) {
    const doc = root.ownerDocument || root;
    return Boolean(doc.querySelector('[data-testid="stop-button"], [data-testid="composer-stop-button"]'));
  }
  return { conversationIdFromUrl, conversationTitleFromPageTitle, extractTitle, isStreaming };
})();

if (typeof globalThis !== "undefined") globalThis.ThreadLinePage = ThreadLinePage;
