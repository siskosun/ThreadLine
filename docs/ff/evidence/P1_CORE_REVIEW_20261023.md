# P1-CORE independent source review and recovery safety evidence
Date: 2026-10-23

This file records inspected code and CI; it is NOT the machine `P1-CORE.json` completion artifact, an owner approval, or a production/real-browser signoff.

## Authority and scope
- Authoritative plan: main `docs/PLAN.md` with P1-CORE = `planned`, Z0-LIVE = `blocked`.
- PR #3: https://github.com/siskosun/ThreadLine/pull/3 — Draft, no merge.
- Code reviewed: `ff-core.js`, `ff-db.js`, `ff-page.js`, background's FF source/opt-in dispatch, `ff-core.test.js`, `ff-db.test.js`, `ff-core-e2e.py`.
- No permission, schema, `docs/PLAN.md`, old-topic or ChatGPT send-path changes.

## Finding 1 — duplicate experiment after an uncertain create ACK
- Prior flow: UI's UUID survives only in memory; background commits `FF_CREATE`, UI ACK dropped, user reloads and explicitly retries identical inputs; new UUID creates another independent experiment. No automatic retry required.
- Negative control: [GitHub run 39947872853](https://github.com/siskosun/ThreadLine/actions/runs/39947872853) failed in persistent Chromium MV3 on assertion "same manual retry after lost ACK created a duplicate"; actual `FF_LIST` had four records instead of expected three, including two with the same length/input scenario.
- Fix: use the same-tab `sessionStorage` to hold ONLY `{operationId,inputHash}`, where inputHash is SHA-256 of the exact W₀/P input pair. After reload, a deliberate manual retry with the same text reuses ID. A positive `FF_CREATE` ACK clears it. No plaintext copy, automatic retry or cross-tab inference.
- [Fix green run 39948497591](https://github.com/siskosun/ThreadLine/actions/runs/39948497591): 123/123 Node, Fork synthetic MV3 E2E success. Subsequent tests verify that the lease has no plaintext and corrupted lease fails closed.
- LIMITATION: tab closure/new-tab restore, deleted `sessionStorage` or different W₀/P cannot be guaranteed to reuse the same operation. Manual list review is required for these cases. No exact account/Edge claim.

## Finding 2 — abandoned IndexedDB open may leak a live connection
- A `versionchange` `indexedDB.open` can issue `onblocked`, then eventually `onsuccess`. Before repair, `onblocked` rejected `open()`, but `onsuccess` still opened a database handle without any consumer closing it.
- Negative control: [run 39948659902](https://github.com/siskosun/ThreadLine/actions/runs/39948659902), 123/124 Node, the only failure was `FF late success after an IndexedDB blocked event closes the abandoned handle`: expected one close, observed zero.
- Fix: track abandoned request; abort a late upgrade transaction and close any late-opened connection.
- [Green run 39948779597](https://github.com/siskosun/ThreadLine/actions/runs/39948779597): 124/124 Node, Fork synthetic MV3 E2E success.

## Latest full-head results
- Code and test commit `8c026b30473a088315d83608bcd00178ac8498e0`
- [Linux GitHub Actions 39949015216](https://github.com/siskosun/ThreadLine/actions/runs/39949015216): SUCCESS, 124/124 Node; Fork MV3 synthetic Chromium E2E PASS. Publish Release job SKIPPED.
- Retained coverage: 24,000 UTF-8 byte gate, canonicalization-v1 hashes, independently versioned IndexedDB, explicit local opt-in, no automatic ChatGPT open/send, CAS and operation ID replay, one active attempt per branch, fake sent/complete evidence refusal at P1 message layer, XSS-safe text, legacy topic isolation, persistent-browser restart.
- This exact HEAD has no user-owned Windows computer validation in this turn. Historic Windows preflight of an earlier merged-combination tree is not proof for this HEAD.

## Review disposition
- Evidence validates isolated P1 core implementation plus two specific fixes; it does not establish real authenticated ChatGPT browser capability or compatibility of future combined PR #1/#5/#6 + PR #3 on a final merged commit.
- Formal main plan still says P1-CORE `planned` although PR #3 contains working Draft code; this is a pending status/evidence reconciliation, not permission to set `done`.
- Do not merge, auto-release, approve, or begin P2-FORK/P3-REPORT without required separate gates.
