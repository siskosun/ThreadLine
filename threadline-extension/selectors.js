/* Read-only selector canary. Never treat a DOM match as successful capture or response completion. */
const ThreadLineSelectors = (() => {
  const RULES = Object.freeze({
    composer:['#prompt-textarea','[data-testid="prompt-textarea"]','[data-testid="composer-input"]','div.ProseMirror[contenteditable="true"]'],
    sendButton:['[data-testid="send-button"]','[data-testid="composer-send-button"]','button[aria-label="Send prompt"]','button[aria-label="Send message"]'],
    sidebar:['nav[aria-label*="chat" i]','aside','[data-testid*="sidebar" i]'],
    conversation:['[data-message-author-role]','[data-testid*="conversation-turn"]']
  });
  function first(doc, choices) {
    for (const selector of choices) {
      try {
        const element = doc.querySelector(selector);
        if (element) return {selector,element};
      } catch {}
    }
    return null;
  }
  function probe(doc, origin) {
    const host = new URL(origin).hostname;
    if (host !== 'chatgpt.com' && host !== 'chat.openai.com')
      throw new Error('只支持 ChatGPT 网页');
    const parts = {};
    const found = {};
    for (const [name, choices] of Object.entries(RULES)) {
      const match = first(doc, choices);
      found[name] = match;
      parts[name] = {available:!!match, selector:match?.selector || null};
    }
    // The real composer may have a plain submit button with no data-testid.
    // Only accept a button from the EXACT form enclosing the recognized composer,
    // never an unrelated search, login, upload or comment form.
    if (!parts.sendButton.available && found.composer?.element) {
      try {
        const form = found.composer.element.closest?.('form');
        if (form?.querySelector('button[type="submit"]'))
          parts.sendButton = {available:true, selector:'form button[type="submit"]',
            method:'recognized_composer_form'};
      } catch {}
    }
    // Generic prose (main p) or user bubbles alone don't prove a conversation
    // message's role, source, cardinality or completeness. Expose as candidate only.
    // Unattributed page text is not a user or assistant message. In an
    // empty chat, whitespace-pre-wrap may even be the welcome prompt.
    const segments = new URL(origin).pathname.split('/').filter(Boolean);
    const hasConversationRoute = segments.some((segment,i) =>
      segment === 'c' && /^[a-z0-9-]+$/i.test(segments[i+1] || ''));
    if (!parts.conversation.available && hasConversationRoute) {
      const textBubble = first(doc, ['main div.whitespace-pre-wrap']);
      const prose = first(doc, ['main p']);
      if (textBubble || prose) {
        parts.conversation = {available:false, selector:null, candidate:true,
          roleVerified:false, origin:'unattributed_dom',
          observed:{whitespacePreWrap:!!textBubble, paragraph:!!prose}};
      }
    }
    const status = parts.composer.available ? 'basic_ready' : 'degraded';
    let notes = parts.composer.available
      ? '检测到输入框。采集分页和网页写入操作仍需单独真实验收。'
      : '未发现可识别输入框，可能尚未登录或页面结构已变化。';
    if (parts.conversation.candidate)
      notes += ' 只找到无角色标记的页面文字（可能含欢迎语），无法判定用户消息或回复完整性。';
    return {status,parts,operations:{capture:'unverified',createProject:'unverified',
      move:'unverified',archive:'unverified',webAnalysis:'unverified'},notes};
  }
  return {RULES,probe};
})();
if (typeof globalThis !== 'undefined') globalThis.ThreadLineSelectors = ThreadLineSelectors;
if (typeof module !== 'undefined') module.exports = ThreadLineSelectors;
