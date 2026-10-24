const test = require('node:test');
const assert = require('node:assert/strict');
const ToolkitScroll = require('../vendor/toolkit-scroll.js');
const Locator = require('../locate-adapter.js');

/* Upstream behavioral contract (GPT Conversation Toolkit
 * tests/timeline-reverse-scroll.test.js at 119d372, MIT) ported to run
 * against THE VENDORED module — reverse coordinates, negative native
 * scroll position, ordinary positive coordinates. */
function fixture(flexDirection) {
  class Element {}
  const root = new Element();
  root.scrollTop = 0;
  root.scrollHeight = 2000;
  root.clientHeight = 600;
  root.getBoundingClientRect = () => ({ top: 0, bottom: 600, height: 600 });
  root.scrollTo = ({ top }) => { root.scrollTop = top; };
  const env = {
    HTMLElement: Element,
    document: { scrollingElement: null, documentElement: null, body: null },
    window: { getComputedStyle: () => ({ flexDirection }) }
  };
  const adapter = { env, resolveScrollRoot: () => root };
  return { adapter, root, Element };
}

test('reverse timeline coordinates move from newest to older messages', () => {
  const { adapter, root } = fixture('column-reverse');
  const controller = ToolkitScroll.getVirtualJumpScrollController(adapter);
  assert.equal(controller.getMaxTop(), 1400);
  assert.equal(controller.getTop(), 1400);
  controller.setTop(0);
  assert.equal(root.scrollTop, -1400);
  assert.equal(controller.getTop(), 0);
  controller.setTop(700);
  assert.equal(root.scrollTop, -700);
  assert.equal(controller.getTop(), 700);
});

test('direct message jumps permit a negative native scroll position', () => {
  const { adapter, root, Element } = fixture('column-reverse');
  const message = new Element();
  message.getBoundingClientRect = () => ({ top: -500, bottom: -100, height: 400 });
  ToolkitScroll.scrollElementIntoConversationView(
    message, { behavior: 'auto', block: 'center' }, adapter);
  assert.equal(root.scrollTop, -600);
});

test('ordinary scroll containers still use positive coordinates', () => {
  const { adapter, root, Element } = fixture('column');
  const controller = ToolkitScroll.getVirtualJumpScrollController(adapter);
  controller.setTop(700);
  assert.equal(root.scrollTop, 700);
  const message = new Element();
  message.getBoundingClientRect = () => ({ top: 500, bottom: 900, height: 400 });
  ToolkitScroll.scrollElementIntoConversationView(
    message, { behavior: 'auto', block: 'center' }, adapter);
  assert.equal(root.scrollTop, 1100);
});

/* ThreadLine S0b requirements on top of the ported contract: identity
 * verification and cooperative cancellation. */
function domFixture() {
  class Element {
    constructor(text) { this.text = text; }
    getAttribute(name) { return this.attrs[name] ?? null; }
    get textContent() { return this.text; }
  }
  const nodes = new Map();
  const document_ = {
    querySelector(selector) {
      const m = selector.match(/\[data-message-id="(.+)"\]$/);
      if (!m) return null;
      return nodes.get(m[1]) || null;
    },
    queryAll: selector => selector === '[data-message-id]' ? [...nodes.values()] : [],
    get querySelectorAll() { return this.queryAll; }
  };
  return {
    document_,
    renderedIds: new Set(),
    render(id, role, text) {
      const node = new Element(text);
      node.attrs = { 'data-message-id': id, 'data-message-author-role': role };
      nodes.set(id, node);
      this.renderedIds.add(id);
      return node;
    }
  };
}

test('identity check: id + role + content prefix must all agree', () => {
  const dom = domFixture();
  const node = dom.render('m1', 'user', '线路B转化率高于线路A的原始提问');
  assert.equal(Locator.verifyMessageIdentity(node,
    { messageId: 'm1', role: 'user', contentPrefix: '线路B转化率' }).ok, true);
  assert.equal(Locator.verifyMessageIdentity(node, { messageId: 'm2' }).ok, false);
  assert.equal(Locator.verifyMessageIdentity(node,
    { messageId: 'm1', role: 'assistant' }).reason, 'role-mismatch');
  assert.equal(Locator.verifyMessageIdentity(node,
    { messageId: 'm1', contentPrefix: '完全不同的内容' }).reason, 'content-mismatch');
});

test('locate finds a lazily rendered message and scrolls it into view', async () => {
  const { adapter, root } = fixture('column');
  const dom = domFixture();
  const probe = async () => {
    // The virtualizer reveals the target after the second scroll step.
    if (root.scrollTop >= 600 && !dom.renderedIds.has('m9'))
      dom.render('m9', 'assistant', '结论所依据的原始回复正文开头');
  };
  const originalSetTop = root.scrollTo.bind(root);
  root.scrollTo = ({ top }) => { originalSetTop({ top }); probe(); };
  const result = await Locator.locateMessage(dom.document_,
    { messageId: 'm9', role: 'assistant', contentPrefix: '结论所依据' },
    { adapter, settleMs: 1, attempts: 8 });
  assert.equal(result.located, true);
  assert.equal(result.verified, true);
  Locator.scrollNodeIntoView(result.node, adapter, { behavior: 'auto', block: 'center' });
  assert.ok(root.scrollTop > 0);
});

test('cancellation stops the pending retry loop without a result', async () => {
  const { adapter, root } = fixture('column');
  const dom = domFixture();
  const controller = new AbortController();
  // Deterministic cancellation: abort during the SECOND scroll step, well
  // before the attempt budget or the virtual end of the list.
  let scrolls = 0;
  const baseScrollTo = root.scrollTo.bind(root);
  root.scrollTo = patch => { baseScrollTo(patch); scrolls += 1; if (scrolls === 2) controller.abort(); };
  const result = await Locator.locateMessage(dom.document_,
    { messageId: 'missing', role: 'user', contentPrefix: 'x' },
    { adapter, signal: controller.signal, settleMs: 1, attempts: 50 });
  assert.equal(result.located, false);
  assert.equal(result.reason, 'aborted');
  assert.equal(scrolls <= 3, true, 'loop stopped early instead of exhausting attempts');
});

test('weak text match never counts as verified location', async () => {
  const { adapter } = fixture('column');
  const dom = domFixture();
  dom.render('other', 'assistant', '结论所依据的原始回复正文开头');
  const weak = await Locator.locateMessage(dom.document_,
    { messageId: 'absent', role: 'assistant', contentPrefix: '结论所依据' },
    { adapter, settleMs: 1, attempts: 2, allowWeak: true });
  assert.equal(weak.located, true);
  assert.equal(weak.verified, false);
  assert.equal(weak.weak, true);
});
