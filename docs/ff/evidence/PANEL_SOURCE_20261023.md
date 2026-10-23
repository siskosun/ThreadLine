# NEW_CHAT panel source compatibility and authorization — 2026-10-23

This is code/regression evidence, not live acceptance or authority to merge.

Delivery: stacked [Draft PR #6](https://github.com/siskosun/ThreadLine/pull/6), base PR5, implementation commit [`c10dc1134b29ef6d274aa2795b1a8daea6f09e00`](https://github.com/siskosun/ThreadLine/commit/c10dc1134b29ef6d274aa2795b1a8daea6f09e00). Snapshot-bound CI: [Linux39936910564](https://github.com/siskosun/ThreadLine/actions/runs/39936910564), [Windows39936910447](https://github.com/siskosun/ThreadLine/actions/runs/39936910447); inspect each run for its actual conclusion, not this document's local test counts. Subsequent evidence-link-only changes leave source/tests unchanged; final HEAD checks are on PR6.

## Snapshot and observed evidence

- main `f3109ebb6e5e76f4c34670b10654bd0127471bea`; Draft PR1 HEAD `93199fbee134f74ff45fc21df86674025f833be0`; Draft PR5 HEAD and local baseline `93a88d834f74ebf486a8f4572b42a5d87b008fc7`. No tracked local changes at start; existing local `.ai/` logs preserved.
- Independent branch `codex/fix-panel-source-20261023`, based on PR5, not an amendment to its attachment fix. No main push, merge, release, browser permission, data schema, formal plan or P2/P3 changes.
- User reports: three PR5 source file hashes matched, runtimeAvailable/exactPanel/topFrame all true; NEW_CHAT returned `ok:false` and the panel-only source error twice. No created test tab was confirmed. Actual backend MessageSender tuple was not captured. Readable file bytes do not prove a previously started worker is executing the same snapshot.
- Confirmed source facts: old no-tab branch accepted immediately. Old tab branch required exact own extension ID, sender URL and absent-or-exact tab URL. Missing tab / missing tab URL was NOT the cause imposed by this code. A caller's local location is not a substitute for receiver metadata.
- Actual live mismatch reason remains UNKNOWN. No further live NEW_CHAT or user-command request was made in this fix round. No real message sent.

## Authority design and official reference

Official [Chrome runtime reference](https://developer.chrome.com/docs/extensions/reference/api/runtime) distinguishes the sending document URL from the containing tab and documents optional sender.tab. Chrome 116+ MV3 `getContexts()` can identify own active extension documents by document ID, document URL and context type; repository minimum Chrome is 141. This documents the API, NOT a claim that the reported Tabbit failure is a documented browser bug.

1. Require own runtime ID and exact `panel.html` sender URL even without a tab. If present, sender origin must be own extension origin and frame must be top-level.
2. Preserve exact/absent tab URL cases. A conflicting tab URL is NOT ignored: require sender documentId and independent `runtime.getContexts()` proof of exactly one own active panel document, exact ID/URL/origin, top-level frame, and SIDE_PANEL or TAB bound to the same tab ID.
3. No matching context, stale/wrong/duplicate context, wrong ID/URL/origin/frame, absent API/document ID, exception or 1-second timeout means deny before any business side effect. Payload identity fields never count.
4. All ten privileged panel operations use the same required authorization. Handoff content-script ownership and one-shot reservation logic are unchanged.
5. Preserve error strings; add `PANEL_SOURCE_REJECTED` and fixed boolean/reason diagnostics. Never return raw sender values, URLs, extension/document identifiers, credentials, payload text or underlying API errors. No persistent diagnostic log, new permission or automatic replay.

## Red/green and runtime verification

Commands run inside `threadline-extension/` on Windows Node v26.10.0, Python 3.12.10, Playwright 1.64.0.

| Snapshot / command | Exit / observation |
| --- | --- |
| Baseline `npm run verify` | 0; 138/138 |
| New `node --test test/panel-source.test.js`, old production | 1; 4 pass / 7 fail across 11 grouped tests |
| Final `npm run verify` | 0; 149/149; 41 JS syntax files; version/plan valid |
| Final `npm run test:e2e` | 0; both original integration suites PASS, extended source tests; 0 real sends |

Negative controls include unauthorized no-tab source accepted by old code, browser-attested own document rejected solely by container URL conflict, and missing diagnostic receipts. These reproduce code-level rule gaps, not the unavailable actual live sender tuple.

Unit coverage: valid no-tab side panel/full panel tab/missing tab URL; exact independently attested SIDE_PANEL and same-tab TAB; wrong ID/page/origin/frame; stale/duplicate/wrong context; missing/throwing/hanging API; injected payload sender; redacted errors; all ten privileged operations denied without state/tab/script/close side effects.

Real MV3 Chromium but synthetic site only: ordinary top-level panel UI and browser getContexts metadata; actual child frame at the same panel URL is rejected before NEW_CHAT tab creation; original shared-state, backup, restart and IndexedDB tests; 23,569-byte exact draft, whitespace/nontext/native-style attachment protection, late-attachment/focus race, empty upload controls and one-shot reload no replay.

Original fixture senders were empty objects relying on the old unconditional allowance. Fixtures now provide own ID/exact panel URL; original business assertions retained. Intermediate full verify failed four old backup fixtures for this reason; its log is preserved. Initial complete E2E also exposed the existing banner-before-awaited-ACK timing: exact banner can precede storage deletion. Test now waits at most 5 seconds for the real storage receipt without sending/reinserting; missing ACK still fails. Production handoff.js is unchanged. All raw baseline/red/intermediate/final logs remain local, not published with user paths.

Tested local SHA-256:

- background.js: `8d2159b5194a840efab78db60d30add0e30b273faa697fd35664e575c16ce908`
- handoff.js unchanged from PR5: `6bc21c481c69e97e484bb03c380446d3de3813bb5867840bf085c20693c2561f`
- selectors.js unchanged: `0bdeb077aacd8f508d5eb7fe0919900729700bd422cbb596db722862b2e29e5a`

This Windows checkout uses CRLF (`core.autocrlf=true`). Git blobs/CI use LF, so their raw byte hashes differ without a code difference. LF byte hashes: background.js `5628383a7f3191078861f9bafe96d9c59e05be43e7d426576136a92f7bee04c4`, handoff.js `4a577e6fc9d952d28dd4bdcd7f8f030c48bde87cd9da0459f5470dd679723c71`, selectors.js `e5b436a4595276df34f3cfd4ef53a359953ae301e3c17fcffca64247a6317e26`. Always compare fingerprints for the actual installation's byte/line-ending convention; do not claim a fetched LF blob equals installed CRLF bytes.

## Human Stop Gate — not accepted

- OPEN_UNKNOWNS: actual failing sender field, actual Tabbit runtime metadata/getContexts behavior, correct running-worker snapshot, live restoration of normal panel NEW_CHAT, three real native-attachment acceptance cases. No live root cause or recovery claim.
- ASSUMPTIONS: browser-generated runtime sender/context metadata is authoritative; unavailable or conflicting proof must deny. Unknown variants may remain blocked. Compatibility fallback success is synthetic Node evidence; full-panel and child-frame checks use real MV3 Chromium, not authenticated Tabbit/Edge.
- DISPUTED_FINDINGS: none. Independent read-only LOCAL_PRE_REVIEW returned NO SUBSTANTIVE FINDINGS for the integrated authorization design and tests. External Plan and Final Gates explicitly waived by user for THIS L3 task; local review is not external review.
- IRREVERSIBLE_EFFECTS: none in live systems; no messages, merge, release or schema migration. Code permits an independently attested own panel, not arbitrary containers. Public Draft PR submission is authorized, not approval.
- ROLLBACK_STATUS: separate branch/commit allows reverting this source/test fix while retaining PR5; runtime rollback still requires explicit reload and manual version confirmation. No rollback executed.

Pending human risk acceptance. Keep Draft; Z0-LIVE remains blocked / NOT SIGNED; real attachment tests BLOCKED; Beta not complete.
