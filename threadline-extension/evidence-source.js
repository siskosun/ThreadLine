/* Resolve a user-confirmed selection against persisted source text. */
(() => {
  "use strict";
  function fragment(run, message, input) {
    if (!run || !message || typeof message.content !== "string") throw Error("原始消息不可用，请重新采集");
    const text = message.content, selection = input.selection;
    if (typeof selection !== "string" || !selection.trim()) throw Error("请明确选择依据片段");
    let start = input.selectionStart;
    if (start == null) {
      start = text.indexOf(selection);
      if (start !== -1 && text.indexOf(selection, start + 1) !== -1) throw Error("片段在原文中出现多次，请在原文中选择准确位置");
    }
    if (!Number.isSafeInteger(start) || start < 0 || text.slice(start,start+selection.length) !== selection)
      throw Error("选区与原始消息不一致，未采纳");
    const end = start + selection.length;
    const exactId = typeof message.id === "string" && !/^(?:\d+:)*(?:dom-|page-)/.test(message.id) ? message.id : null;
    return {
      kind:"capture",captureRunId:run.id || null,conversationId:run.conversationId || null,
      messageId:exactId,url:run.url || null,capturedAt:run.updatedAt || run.createdAt || null,
      sourceLocalId:message.id || null,sourceRole:message.role || "unknown",
      sourceLength:text.length,selectionStart:start,selectionEnd:end,
      captureComplete:run.complete === true,captureMode:run.mode || "unknown",
      captureNotice:String(run.notice || ""),hasNonText:!!message.hasNonText,
      before:Array.from(text.slice(0,start)).slice(-500).join(""),selection,
      after:Array.from(text.slice(end)).slice(0,500).join(""),relation:input.relation || "cites",
      completeness:run.complete === true && !message.hasNonText && start === 0 && end === text.length ? "complete" : "partial"
    };
  }
  const Source = {fragment};
  if (typeof module !== "undefined" && module.exports) module.exports=Source;
  else globalThis.ThreadLineEvidenceSource=Source;
})();
