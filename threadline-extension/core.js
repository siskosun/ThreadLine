/* ThreadLine domain model: pure functions shared by service worker and tests. */
const ThreadLineCore = (() => {
  const STAGES = Object.freeze(["active", "review", "done"]);
  const PROJECT_STAGES = Object.freeze(["active", "closed"]);
  const MAX_PROJECTS = 100;
  const MAX_CHATS = 600;
  const SCHEMA = 2, HISTORY_LIMIT = 30;

  function emptyState() { return { schema: SCHEMA, revision: 0, projects: [], chats: {} }; }
  // Explicit, idempotent schema migration: refuse future schema instead of silently clearing data.
  function migrate(input) {
    if (input === undefined || input === null) return emptyState();
    if (typeof input !== "object" || !Array.isArray(input.projects) || !input.chats || typeof input.chats !== "object" || Array.isArray(input.chats))
      asError("本地课题状态格式损坏，已停止写入以保护数据");
    const state = structuredClone(input);
    if (state.schema > SCHEMA) asError("课题数据来自更新版本，请升级扩展后再操作");
    if (state.schema !== 1 && state.schema !== 2) asError("无法识别课题数据版本");
    if (state.projects.length > MAX_PROJECTS || Object.keys(state.chats).length > MAX_CHATS) asError("课题备份超出数量上限");
    if (state.schema === 1) {
      for (const p of state.projects) {
        if (!Array.isArray(p.history)) p.history = [];
        if (!Number.isSafeInteger(p.knowledgeVersion) || p.knowledgeVersion < 0) p.knowledgeVersion = 0;
        if (!p.lastChange || typeof p.lastChange !== "object") p.lastChange = null;
      }
      for (const c of Object.values(state.chats)) {
        if (!c || typeof c !== "object") continue;
        const p = state.projects.find(p => p.id === c.projectId);
        if (!Number.isSafeInteger(c.seenVersion) || c.seenVersion < 0) c.seenVersion = p?.knowledgeVersion ?? 0;
      }
      state.schema = 2;
    }
    for (const p of state.projects) {
      if (!p || typeof p !== "object" || typeof p.id !== "string" || typeof p.name !== "string") asError("课题记录损坏");
      if (!Number.isSafeInteger(p.knowledgeVersion) || p.knowledgeVersion < 0) p.knowledgeVersion = 0;
      p.history = Array.isArray(p.history) ? p.history.slice(-HISTORY_LIMIT) : [];
      if (typeof p.goal !== "string") p.goal = "";
      if (typeof p.decision !== "string") p.decision = "";
      if (!PROJECT_STAGES.includes(p.stage)) asError("课题阶段无效");
    }
    if (new Set(state.projects.map(p => p.id)).size !== state.projects.length) asError("课题 ID 重复");
    for (const [key,c] of Object.entries(state.chats)) {
      if (!validChatKey(key) || !c || typeof c !== "object" || !state.projects.some(p => p.id === c.projectId)) asError("关联对话记录损坏");
      const p = state.projects.find(p => p.id === c.projectId);
      if (!Number.isSafeInteger(c.seenVersion) || c.seenVersion < 0) c.seenVersion = p.knowledgeVersion;
    }
    state.revision = Number.isSafeInteger(state.revision) && state.revision >= 0 ? state.revision : 0;
    return state;
  }
  function normalizedState(input) { return migrate(input); }
  function normalizeSubstance(value) {
    // Keep decimal points, minus signs, percent signs and operators: numeric findings must not collapse.
    return String(value ?? "").replace(/(\d)\.(\d)/g,"$1\uE000$2")
      .replace(/[\s，。！？；：、,!?:;“”‘’（）()\[\]{}]+/gu, "")
      .replace(/\uE000/g,".");
  }
  function changesSince(project, seenVersion) {
    const history = Array.isArray(project?.history) ? project.history : [];
    const latest = history.filter(h => h.version > (seenVersion || 0));
    return {items:latest, truncated: history.length > 0 && history[0].version > (seenVersion || 0) + 1};
  }
  function isChatURL(href) {
    try { return ["chatgpt.com", "chat.openai.com"].includes(new URL(href).hostname); }
    catch { return false; }
  }
  function getChatKey(href, tabId) {
    if (!isChatURL(href)) return null;
    let path;
    try { path = new URL(href).pathname; } catch { return null; }
    if (path.startsWith("/share/") || path.startsWith("/auth/") || path.startsWith("/login")) return null;
    const match = path.match(/(?:^|\/)c\/([a-z0-9-]+)(?:\/|$)/i);
    if (match) return `chat:${match[1].toLowerCase()}`;
    return Number.isInteger(tabId) && tabId >= 0 ? `tab:${tabId}` : null;
  }
  function text(value, max) { return String(value ?? "").trim().slice(0, max); }
  function suggestProject(title, projects) {
    const normalized = value => String(value || "").toLowerCase().replace(/chatgpt/ig, "").replace(/[\s\d\p{P}\p{S}]+/gu, "").slice(0, 80);
    const grams = value => {
      const s = normalized(value);
      const out = new Set();
      for (let i=0;i<s.length-1;i++) out.add(s.slice(i,i+2));
      return out;
    };
    const titleGrams = grams(title);
    if (titleGrams.size < 2) return null;
    let best = null;
    for (const project of projects || []) {
      if (project.stage !== "active") continue;
      const projectGrams = grams(project.name);
      if (projectGrams.size < 2) continue;
      let overlap=0;
      for (const gram of projectGrams) if (titleGrams.has(gram)) overlap++;
      const score=overlap/Math.max(1,Math.min(projectGrams.size,titleGrams.size));
      if (overlap>=2 && score>=0.37 && (!best || score>best.score)) best={id:project.id,score};
    }
    return best;
  }
  function validChatKey(key) { return /^(?:chat:[a-z0-9-]{1,120}|tab:[0-9]{1,20})$/i.test(String(key)); }
  function getProject(state, id) { return state.projects.find(p => p.id === id) || null; }
  function getContext(state, key) {
    const chat = state.chats[key] || null;
    return { chat, project: chat ? getProject(state, chat.projectId) : null };
  }
  function isOutdated(state, chat) {
    if (!chat) return false;
    const project = getProject(state, chat.projectId);
    return !!project && (project.knowledgeVersion || 0) > (chat.seenVersion || 0);
  }
  function asError(message) { throw new Error(message); }
  function makeId() { return "p_" + (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)); }
  function setChat(state, {key, projectId, title, url}, now) {
    if (!validChatKey(key)) asError("无法识别对话标识");
    if (!getProject(state, projectId)) asError("课题不存在");
    if (!state.chats[key] && Object.keys(state.chats).length >= MAX_CHATS) asError("临时对话已达上限，请清理旧课题");
    const old = state.chats[key];
    const project = getProject(state, projectId);
    state.chats[key] = {
      key, projectId,
      title: text(title, 130) || old?.title || "未命名对话",
      label: old?.projectId === projectId ? old.label : "",
      stage: old?.projectId === projectId ? old.stage : "active",
      note: old?.projectId === projectId ? old.note : "",
      // Relinking within the same project never silently marks an old branch as read.
      seenVersion: old?.projectId === projectId ? (old.seenVersion ?? project.knowledgeVersion) : project.knowledgeVersion,
      url: isChatURL(url) ? String(url).slice(0, 900) : old?.url || "",
      createdAt: old?.createdAt || now,
      updatedAt: now
    };
  }
  function apply(stateInput, action, now = Date.now()) {
    const state = normalizedState(stateInput);
    if (!action || typeof action !== "object") asError("无效操作");
    let result = null;
    switch (action.type) {
      case "createProject": {
        const name = text(action.name, 80);
        if (!name) asError("请输入课题名称");
        if (state.projects.length >= MAX_PROJECTS) asError("课题已达上限，请清理旧课题");
        const id = makeId();
        state.projects.unshift({ id, name, goal: "", decision: "", stage: "active", knowledgeVersion: 0, lastChange: null, history: [], createdAt: now, updatedAt: now, closedAt: null });
        if (action.chat) setChat(state, {...action.chat, projectId:id}, now);
        result = { projectId: id };
        break;
      }
      case "linkChat": {
        setChat(state, action, now);
        result = {key:action.key};
        break;
      }
      case "updateProject": {
        const p = getProject(state, action.projectId);
        if (!p) asError("课题不存在");
        const patch = action.patch || {};
        const before = {goal: p.goal, decision: p.decision, stage: p.stage};
        if (Object.prototype.hasOwnProperty.call(patch, "name")) {
          if (!text(patch.name, 80)) asError("课题名称不能为空");
          p.name = text(patch.name, 80);
        }
        if (Object.prototype.hasOwnProperty.call(patch, "goal")) p.goal = text(patch.goal, 600);
        if (Object.prototype.hasOwnProperty.call(patch, "decision")) p.decision = text(patch.decision, 1000);
        if (Object.prototype.hasOwnProperty.call(patch, "stage")) {
          if (!PROJECT_STAGES.includes(patch.stage)) asError("无效课题状态");
          if (p.stage !== patch.stage) {
            p.stage = patch.stage;
            p.closedAt = patch.stage === "closed" ? now : null;
          }
        }
        // Pure punctuation, whitespace and reformatting edits are saved but do not create stale-branch warnings.
        const diffs = ["goal", "decision", "stage"].filter(field =>
          field === "stage" ? before[field] !== p[field] : normalizeSubstance(before[field]) !== normalizeSubstance(p[field]));
        const changed = diffs.length > 0;
        if (changed) {
          p.knowledgeVersion += 1;
          const source = validChatKey(action.sourceKey) ? state.chats[action.sourceKey] : null;
          const sourceKey = source?.projectId === p.id ? action.sourceKey : null;
          const descriptions = {goal:"研究目标",decision:"有效结论",stage:"课题状态"};
          p.lastChange = {
            version: p.knowledgeVersion,
            at: now,
            sourceKey,
            label: before.stage !== p.stage ? (p.stage === "closed" ? "课题已收口" : "课题已重新开启") :
              diffs.map(f => descriptions[f]).join("、") + "已更新"
          };
          p.history = Array.isArray(p.history) ? p.history : [];
          for (const field of diffs) p.history.push({version:p.knowledgeVersion,at:now,sourceKey,field,before:before[field],after:p[field]});
          p.history = p.history.slice(-HISTORY_LIMIT);
          if (sourceKey) state.chats[sourceKey].seenVersion = p.knowledgeVersion;
        }
        p.updatedAt = now;
        result = {knowledgeVersion: p.knowledgeVersion, changed};
        break;
      }
      case "acknowledgeProject": {
        if (!validChatKey(action.key)) asError("无法识别要核对的对话");
        const c = state.chats[action.key];
        if (!c) asError("对话尚未关联课题");
        const p = getProject(state, c.projectId);
        if (!p) asError("课题不存在");
        c.seenVersion = p.knowledgeVersion;
        result = {knowledgeVersion: p.knowledgeVersion, key: c.key};
        break;
      }
      case "updateChat": {
        const chat = state.chats[action.key];
        if (!chat) asError("对话尚未关联课题");
        const patch = action.patch || {};
        if (Object.prototype.hasOwnProperty.call(patch, "stage")) {
          if (!STAGES.includes(patch.stage)) asError("无效分支状态");
          chat.stage = patch.stage;
        }
        if (Object.prototype.hasOwnProperty.call(patch, "label")) chat.label = text(patch.label, 80);
        if (Object.prototype.hasOwnProperty.call(patch, "note")) chat.note = text(patch.note, 300);
        chat.updatedAt = now;
        break;
      }
      case "unlinkChat": {
        delete state.chats[action.key];
        break;
      }
      case "deleteProject": {
        if (!getProject(state, action.projectId)) asError("课题不存在");
        state.projects = state.projects.filter(p => p.id !== action.projectId);
        Object.keys(state.chats).forEach(k => {if (state.chats[k].projectId === action.projectId) delete state.chats[k];});
        break;
      }
      case "clearClosed": {
        const ids = new Set(state.projects.filter(p => p.stage === "closed").map(p => p.id));
        state.projects = state.projects.filter(p => !ids.has(p.id));
        Object.keys(state.chats).forEach(k => {if (ids.has(state.chats[k].projectId)) delete state.chats[k];});
        result = { cleared: ids.size };
        break;
      }
      case "remapPending": {
        if (!validChatKey(action.from) || !validChatKey(action.to) || !action.from.startsWith("tab:") || !action.to.startsWith("chat:")) asError("无效对话迁移");
        const src = state.chats[action.from];
        if (src) {
          if (!state.chats[action.to]) state.chats[action.to] = {...src, key:action.to, url:isChatURL(action.url) ? action.url : src.url, updatedAt: now};
          delete state.chats[action.from];
        }
        break;
      }
      case "observeChat": {
        const chat = state.chats[action.key];
        if (chat) {
          const newTitle = text(action.title,130);
          if (newTitle && newTitle !== "ChatGPT" && newTitle !== "新对话" && newTitle !== chat.title && !chat.label) chat.title = newTitle;
          if (isChatURL(action.url)) chat.url = String(action.url).slice(0,900);
          // Preserve user-authored stage and project closure. Observation never makes a decision.
          chat.updatedAt = now;
        }
        break;
      }
      default: asError("未知操作：" + action.type);
    }
    state.revision += 1;
    return {state, result};
  }
  return {emptyState,normalizedState,migrate,changesSince,normalizeSubstance,isChatURL,getChatKey,getContext,getProject,isOutdated,suggestProject,apply,STAGES,PROJECT_STAGES,SCHEMA};
})();
if (typeof globalThis !== "undefined") globalThis.ThreadLineCore = ThreadLineCore;
if (typeof module !== "undefined") module.exports = ThreadLineCore;
