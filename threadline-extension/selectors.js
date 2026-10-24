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
  function classifyPage(origin) {
    let url;
    try { url = new URL(origin); } catch { return {type:'unknown', reason:'invalid_url'}; }
    if (!['chatgpt.com', 'chat.openai.com'].includes(url.hostname))
      return {type:'unknown', reason:'unsupported_origin'};
    const params = url.searchParams;
    const temporary = params.get('temporary-chat') ?? params.get('temporary_chat');
    if (temporary !== null) {
      if (temporary === 'true') return {type:'temporary_chat', reason:'temporary_chat_parameter'};
      if (temporary !== 'false') return {type:'unknown', reason:'unrecognized_temporary_chat_value'};
    }
    const path = url.pathname;
    const segments = path.split('/').filter(Boolean);
    if (segments[0] === 'g') {
      return /^g-p-[a-z0-9_-]+$/i.test(segments[1] || '')
        ? {type:'project_chat', reason:'project_scoped_path'}
        : {type:'unknown', reason:'unrecognized_g_path'};
    }
    if (/^\/(share|auth|login)(\/|$)/i.test(path))
      return {type:'unknown', reason:'non_chat_route'};
    // Refuse to infer a plain chat from an unfamiliar query. A new ChatGPT
    // parameter must be reviewed before it can qualify for Fork.
    const allowedQuery = new Set(['model','reasoning','show','temporary-chat','temporary_chat']);
    for (const key of params.keys()) {
      if (!allowedQuery.has(key.toLowerCase()))
        return {type:'unknown', reason:'unrecognized_query'};
    }
    if (path === '/' || path === '') return {type:'plain_chat', reason:'new_chat'};
    if (/^\/c\/[a-z0-9-]+\/?$/i.test(path))
      return {type:'plain_chat', reason:'saved_plain_chat'};
    return {type:'unknown', reason:'unrecognized_path'};
  }
  function pageType(origin) { return classifyPage(origin).type; }
  function forkEligibility(origin) {
    const classified = classifyPage(origin);
    return {allowed:classified.type === 'plain_chat', pageType:classified.type,
      reason:classified.reason};
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
    const kind = pageType(origin);
    const fork = forkEligibility(origin);
    const pageLabel = {plain_chat:'普通聊天',project_chat:'Project Chat',
      temporary_chat:'Temporary Chat',unknown:'无法可靠判断'}[kind] || '无法可靠判断';
    const status = parts.composer.available ? 'basic_ready' : 'degraded';
    let notes = parts.composer.available
      ? '检测到输入框。采集分页和网页写入操作仍需单独真实验收。'
      : '未发现可识别输入框，可能尚未登录或页面结构已变化。';
    if (parts.conversation.candidate)
      notes += ' 只找到无角色标记的页面文字（可能含欢迎语），无法判定用户消息或回复完整性。';
    notes += ` 页面类型：${pageLabel}；Fork ${fork.allowed ? '允许' : '拒绝'}。`;
    if (!fork.allowed)
      notes += ' 第一期只允许经验证的普通聊天；当前页面或未知状态不能进入 Fork。';
    return {status,parts,operations:{capture:'unverified',createProject:'unverified',
      move:'unverified',archive:'unverified',webAnalysis:'unverified'},notes,
      pageType:kind,forkAllowed:fork.allowed,forkReason:fork.reason};
  }
  return {RULES,probe,pageType,forkEligibility};
})();
if (typeof globalThis !== 'undefined') globalThis.ThreadLineSelectors = ThreadLineSelectors;
if (typeof module !== 'undefined') module.exports = ThreadLineSelectors;
