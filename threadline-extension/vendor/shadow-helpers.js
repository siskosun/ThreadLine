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
    const stop = doc.querySelector('[data-testid="stop-button"], [data-testid="composer-stop-button"]');
    if (!stop) return false;
    // Visibility is only a UI signal, never evidence of response completion.
    if (stop.hidden || stop.getAttribute?.('aria-hidden') === 'true' ||
        stop.closest?.('[hidden], [inert], [aria-hidden="true"]')) return false;
    const view = doc.defaultView || stop.ownerDocument?.defaultView;
    const style = view?.getComputedStyle?.(stop);
    if (style && (style.display === 'none' || style.visibility === 'hidden' ||
        style.visibility === 'collapse')) return false;
    if (typeof stop.getClientRects === 'function' && stop.getClientRects().length === 0)
      return false;
    return true;
  }
  return { conversationIdFromUrl, conversationTitleFromPageTitle, extractTitle, isStreaming };
})();

if (typeof globalThis !== "undefined") globalThis.ThreadLinePage = ThreadLinePage;
if (typeof module !== "undefined") module.exports = ThreadLinePage;
