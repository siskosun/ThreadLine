/* Read-only selector canary. This deliberately does NOT claim menu actions work. */
const ThreadLineSelectors = (() => {
  const RULES = Object.freeze({
    composer:['#prompt-textarea','[data-testid="prompt-textarea"]','[data-testid="composer-input"]','div.ProseMirror[contenteditable="true"]'],
    sendButton:['[data-testid="send-button"]','[data-testid="composer-send-button"]','button[aria-label="Send prompt"]','button[aria-label="Send message"]'],
    sidebar:['nav[aria-label*="chat" i]','aside','[data-testid*="sidebar" i]'],
    conversation:['[data-message-author-role]','[data-testid*="conversation-turn"]']
  });
  function probe(doc, origin) {
    const host = new URL(origin).hostname;
    if (host !== 'chatgpt.com' && host !== 'chat.openai.com') throw new Error('只支持 ChatGPT 网页');
    const parts = {};
    for (const [name,choices] of Object.entries(RULES)) {
      let selector = null;
      for (const item of choices) {
        try { if (doc.querySelector(item)) {selector = item; break;} } catch {}
      }
      parts[name] = {available:!!selector, selector};
    }
    // Absence of the message region in a new chat does not indicate a broken adapter.
    // Archive/move/create controls appear only after opening their menus: cannot verify them passively.
    const status = parts.composer.available ? 'basic_ready' : 'degraded';
    return {status,parts,operations:{capture:'unverified',createProject:'unverified',move:'unverified',archive:'unverified',webAnalysis:'unverified'},
      notes:parts.composer.available ? '检测到输入框。采集分页和网页写入操作仍需单独真实验收。' : '未发现可识别输入框，可能尚未登录或页面结构已变化。'};
  }
  return {RULES,probe};
})();
if (typeof globalThis !== 'undefined') globalThis.ThreadLineSelectors = ThreadLineSelectors;
if (typeof module !== 'undefined') module.exports = ThreadLineSelectors;
