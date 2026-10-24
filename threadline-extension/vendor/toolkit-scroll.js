/*
 * Adapted subset of GPT Conversation Toolkit (S0b spike, plan §十一.3).
 * Upstream: https://github.com/bujue3709/GPT-Conversation-Toolkit
 * Pinned commit: 119d3728bc4cb583d75da72b067a74b1dce90d60 (MIT, see
 * licenses/MIT-GPT-Conversation-Toolkit.txt and THIRD_PARTY_NOTICES.md).
 * Source files: utils/dom.js (isConversationDocumentScrollRoot,
 * isConversationReverseScrollRoot, resolveConversationScrollRoot internals,
 * scrollElementIntoConversationView) and features/virtualized-jump.js
 * (getVirtualJumpScrollController).
 *
 * Adaptations (recorded per REUSE_AUDIT_20261024.md §3):
 *  - The scroll root is INJECTED (resolveScrollRoot callback). The upstream
 *    global-state root resolver and its broad fallbacks (which can pick the
 *    sidebar) are NOT vendored; ThreadLine's own selector probe owns that.
 *  - No module-level mutable state; every call is pure over (root, element).
 *  - The coordinate math (document-root, column-reverse negative scrollTop,
 *    block=center/end/nearest) is upstream code kept verbatim in behavior —
 *    the three upstream behavioral tests are ported against THIS file.
 */
(() => {
  "use strict";

  const isConversationDocumentScrollRoot = (root, env) =>
    root === env.document.scrollingElement ||
    root === env.document.documentElement ||
    root === env.document.body;

  const isConversationReverseScrollRoot = (root, env) =>
    root instanceof env.HTMLElement &&
    env.window.getComputedStyle(root).flexDirection === "column-reverse";

  const scrollElementIntoConversationView = (element, options, adapter) => {
    if (!(element instanceof adapter.env.HTMLElement)) return;
    const { behavior = "smooth", block = "center" } = options || {};
    const scrollRoot = adapter.resolveScrollRoot();
    if (!(scrollRoot instanceof adapter.env.HTMLElement) ||
        isConversationDocumentScrollRoot(scrollRoot, adapter.env)) {
      element.scrollIntoView({ behavior, block });
      return;
    }
    const rootRect = scrollRoot.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    if (!(rootRect.height > 0) || !(elementRect.height >= 0)) {
      element.scrollIntoView({ behavior, block });
      return;
    }
    let top = scrollRoot.scrollTop + (elementRect.top - rootRect.top);
    if (block === "center") {
      top -= Math.max(0, (scrollRoot.clientHeight - elementRect.height) / 2);
    } else if (block === "end") {
      top -= Math.max(0, scrollRoot.clientHeight - elementRect.height);
    } else if (block === "nearest") {
      if (elementRect.top >= rootRect.top && elementRect.bottom <= rootRect.bottom) return;
      top = elementRect.top < rootRect.top
        ? scrollRoot.scrollTop + (elementRect.top - rootRect.top)
        : scrollRoot.scrollTop + (elementRect.bottom - rootRect.bottom);
    }
    const maxTop = Math.max(0, scrollRoot.scrollHeight - scrollRoot.clientHeight);
    const reverse = isConversationReverseScrollRoot(scrollRoot, adapter.env);
    const minTop = reverse ? -maxTop : 0;
    const maxNativeTop = reverse ? 0 : maxTop;
    scrollRoot.scrollTo({ top: Math.min(Math.max(minTop, top), maxNativeTop), behavior });
  };

  const getVirtualJumpScrollController = (adapter) => {
    const root = adapter.resolveScrollRoot();
    const env = adapter.env;
    if (!(root instanceof env.HTMLElement)) return null;
    const documentLike = isConversationDocumentScrollRoot(root, env);
    const reverse = !documentLike && isConversationReverseScrollRoot(root, env);
    const getTop = () =>
      documentLike
        ? env.window.scrollY || env.window.pageYOffset ||
          env.document.documentElement?.scrollTop || 0
        : reverse ? getMaxTop() + root.scrollTop : root.scrollTop;
    const getHeight = () =>
      documentLike
        ? env.window.innerHeight || env.document.documentElement?.clientHeight ||
          root.clientHeight || 1
        : root.clientHeight || 1;
    const getScrollHeight = () =>
      documentLike
        ? Math.max(env.document.documentElement?.scrollHeight || 0,
            env.document.body?.scrollHeight || 0, root.scrollHeight || 0)
        : root.scrollHeight || 0;
    const getMaxTop = () => Math.max(0, getScrollHeight() - getHeight());
    const setTop = (top, behavior = "auto") => {
      const clampedTop = Math.min(Math.max(0, top), getMaxTop());
      if (documentLike) { env.window.scrollTo({ top: clampedTop, behavior }); return; }
      root.scrollTo({ top: reverse ? clampedTop - getMaxTop() : clampedTop, behavior });
    };
    return { root, getTop, getHeight, getScrollHeight, getMaxTop, setTop };
  };

  const ToolkitScroll = {
    isConversationDocumentScrollRoot,
    isConversationReverseScrollRoot,
    scrollElementIntoConversationView,
    getVirtualJumpScrollController
  };
  if (typeof module !== "undefined" && module.exports) module.exports = ToolkitScroll;
  else globalThis.ThreadLineToolkitScroll = ToolkitScroll;
})();
