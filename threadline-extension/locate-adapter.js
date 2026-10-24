/* ThreadLine source locator (S0b, plan §十一.3/4).
 * Identity first: prefer the exact stable message id and verify role/content
 * prefix; fuzzy text is a candidate only and NEVER counts as located. When
 * location is unreliable the caller must degrade to "fragment + source link"
 * instead of jumping. Cancellation is cooperative via AbortSignal — a pending
 * virtualized retry loop stops as soon as the caller aborts. */
(() => {
  "use strict";
  const ToolkitScroll = globalThis.ThreadLineToolkitScroll ||
    (typeof require !== "undefined" ? require("./vendor/toolkit-scroll.js") : null);

  const MESSAGE_ID_SELECTOR = "[data-message-id]";

  function createScrollAdapter({ env, resolveScrollRoot }) {
    if (!env || typeof resolveScrollRoot !== "function")
      throw new Error("locate adapter needs env and a scroll-root probe");
    return { env, resolveScrollRoot };
  }

  /* Identity check: the node's message id must match, and if a role/content
   * expectation is given it must agree. A mismatched node is NOT the message. */
  function verifyMessageIdentity(node, expectation = {}) {
    if (!node || !node.getAttribute) return { ok: false, reason: "no-node" };
    const id = node.getAttribute("data-message-id");
    if (expectation.messageId && id !== expectation.messageId)
      return { ok: false, reason: "id-mismatch" };
    if (expectation.role) {
      const role = node.getAttribute("data-message-author-role");
      if (role !== expectation.role) return { ok: false, reason: "role-mismatch" };
    }
    if (expectation.contentPrefix) {
      const text = (node.textContent || "").replace(/\s+/g, " ").trim();
      const expected = expectation.contentPrefix.replace(/\s+/g, " ").trim();
      if (!text.startsWith(expected)) return { ok: false, reason: "content-mismatch" };
    }
    return { ok: true, node };
  }

  const esc = value => (typeof CSS !== "undefined" && CSS.escape) ? CSS.escape(value) : value;

  /* Locate a message by identity inside a (possibly virtualized) conversation.
   * The virtualizer may not have rendered the target yet, so probe on each
   * scroll settle until found, aborted, or the attempt budget runs out. */
  async function locateMessage(document_, expectation, {
    adapter, signal, attempts = 12, stepTop = 600, settleMs = 120, allowWeak = false
  } = {}) {
    if (!adapter) throw new Error("locateMessage needs a scroll adapter");
    const byId = expectation.messageId
      ? document_.querySelector(`${MESSAGE_ID_SELECTOR}[data-message-id="${esc(expectation.messageId)}"]`)
      : null;
    const direct = byId ? verifyMessageIdentity(byId, expectation) : null;
    if (direct && direct.ok) return { located: true, verified: true, node: direct.node };
    if (signal?.aborted) return { located: false, reason: "aborted" };
    const controller = ToolkitScroll.getVirtualJumpScrollController(adapter);
    if (!controller) return { located: false, reason: "no-scroll-root" };
    for (let i = 0; i < attempts; i++) {
      if (signal?.aborted) return { located: false, reason: "aborted" };
      // Walk the rendered window downward (virtualized lists render lazily).
      controller.setTop(Math.min(controller.getMaxTop(), i * stepTop));
      await new Promise(resolve => setTimeout(resolve, settleMs));
      if (signal?.aborted) return { located: false, reason: "aborted" };
      const candidate = expectation.messageId
        ? document_.querySelector(`${MESSAGE_ID_SELECTOR}[data-message-id="${esc(expectation.messageId)}"]`)
        : null;
      if (candidate) {
        const verified = verifyMessageIdentity(candidate, expectation);
        if (verified.ok) return { located: true, verified: true, node: verified.node };
        return { located: true, verified: false, reason: verified.reason, node: candidate };
      }
      if (controller.getTop() >= controller.getMaxTop()) break;
    }
    if (allowWeak && expectation.contentPrefix) {
      const nodes = [...document_.querySelectorAll(MESSAGE_ID_SELECTOR)];
      const weak = nodes.find(n =>
        (n.textContent || "").replace(/\s+/g, " ").trim()
          .startsWith(expectation.contentPrefix.replace(/\s+/g, " ").trim()));
      if (weak) return { located: true, verified: false, weak: true, node: weak };
    }
    return { located: false, reason: "not-found" };
  }

  /* Jump to an already-located node with the vendored coordinate math. */
  function scrollNodeIntoView(node, adapter, options) {
    ToolkitScroll.scrollElementIntoConversationView(node, options || { behavior: "auto", block: "center" }, adapter);
  }

  const Locator = { createScrollAdapter, verifyMessageIdentity, locateMessage, scrollNodeIntoView };
  if (typeof module !== "undefined" && module.exports) module.exports = Locator;
  else globalThis.ThreadLineLocator = Locator;
})();
