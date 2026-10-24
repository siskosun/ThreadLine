# PR7 real Tabbit zero-send evidence and remaining acceptance

Observed on 2026-10-23; source candidate: `07b37731326517fa8c70fca3c7676eaaac526edd` ([Draft PR #7](https://github.com/siskosun/ThreadLine/pull/7)). This is a desensitized publication of retained local observations, not a new browser run, independent external review, Edge acceptance, or human signoff. Later documentation-only commits do not re-date these observations.

## Scope and source identity

The operator authorized owned test tabs and fictional TXT files only. Real Tabbit was controlled through its normal browser connection; native computer control was used for the actual extension side-panel inspector. The existing unpacked extension was reloaded without uninstalling it or changing permissions. Version `0.6.1` alone does not identify this candidate.

The actual top-frame panel reported the expected panel context. SHA-256 was computed over resources fetched through `chrome.runtime.getURL()` in that extension context; all six matched the Windows candidate files:

| File | SHA-256 of Windows resource bytes |
| --- | --- |
| handoff.js | 6bc21c481c69e97e484bb03c380446d3de3813bb5867840bf085c20693c2561f |
| selectors.js | 0bdeb077aacd8f508d5eb7fe0919900729700bd422cbb596db722862b2e29e5a |
| background.js | f64ff703e8bae81b115a1f1728ef22cc50d6bbda5da62698c99c9bc817d03c3f |
| ff-page.js | a53c448bc13d26ee8ae0210778863012839523a03928a409580bc934b0021b13 |
| ff-core.js | 2c25701adcc8b3986db5af9b3a74c8fa60d504a8e95e2fc46f9eb31c62baee09 |
| ff-db.js | 8f7a2bcf2349d882968aeadd55740226450618410e31771ae526c834882cd0c6 |

Windows CRLF bytes may differ from Git LF blobs. Resource hashes prove the loaded extension's resource contents; they are not direct inspection of a running worker's compiled body. The existing extension was reloaded before these tests. A successful actual panel `NEW_CHAT` created an ordinary test tab; production code then closed the panel, so its response-console receipt was not retained. This establishes successful creation on this path, not the original receiver-side cause of the older source rejection.

## Real observations

| Case | Result | Evidence and boundary |
| --- | --- | --- |
| Existing known fictional text draft | PASS | Newly created chat inherited the known 34-character test marker; production refused overwrite; 0 visible message nodes |
| Empty editor, no attachment | PASS | 93-character multiline fixture matched structural readback; success banner; later known handoff key absent |
| Native attachment outside editor, inside same form | PASS | Fictional native attachment chips and remove controls retained; editor textContent empty; production refusal banner |
| Refusal consumes no successful reservation or ACK | PASS | Corrected own-key observer: finite attemptedAt absent, reservation writes 0, ACK removals 0, original intent retained |
| Remove attachments | PASS | Native remove controls used; editor empty, selected files 0; no retry in the 1.5-second observation window |
| Explicit reload after proven unattempted state | PASS | One reservation write and one ACK removal; exact 23,569-byte draft |
| Automatic real sends | PASS | 0 send actions; all observed test pages had 0 message nodes; not a network-level audit of every site request |
| Real Edge with this candidate | NOT RUN | Tabbit results must not be labeled Edge PASS |
| Full Z0-LIVE | BLOCKED / NOT SIGNED | Remaining items below |

The native-attachment cases used a controlled session intent with the production `{text, createdAt}` shape and the unmodified `TL_HANDOFF_READY`/handoff/background path. This is narrower than a full research-report-to-chat UI workflow. Only task-owned intent keys were inspected or seeded; identifiers and machine paths are omitted here.

The corrected observer counted `Number.isFinite(newValue.attemptedAt)` when the old record had no finite `attemptedAt`; deletion of the known record counted ACK removal. Negative receipt:

```json
{"recordPresent":true,"fixtureMatches":true,"attemptedAtPresent":false,"trace":{"reservationWrites":0,"ackRemovals":0,"events":[{"present":true,"reserved":false}]}}
```

After attachment removal, the same fixture and absent `attemptedAt` were verified before explicit reload. Positive receipt:

```json
{"recordPresent":false,"trace":{"reservationWrites":1,"ackRemovals":1,"events":[{"present":true,"reserved":false},{"present":true,"reserved":true},{"present":false,"reserved":false}]}}
```

These are persisted state-transition counts, not intercepted counts of every message invocation. The successful production `HANDOFF_BEGIN` writes `attemptedAt`; `HANDOFF_ACK` requires it before removing the intent. The positive control demonstrates that this observer detects both transitions. The observer was removed afterward.

## Reproducible long fixture

This standalone fixture recipe performs no browser operation or send:

```js
const size = s => new TextEncoder().encode(s).length;
const unit = '\n第一段：虚构中文材料🧪。\n\n```text\n  alpha  beta\n```\n';
const tail = '\nTL_LONG_END\n';
let expected = 'TL_PR7_LONG_23569_20261023\n';
while (size(expected + unit + tail) <= 23569) expected += unit;
expected += 'x'.repeat(23569 - size(expected + tail)) + tail;
```

Real readback reconstructed the actual top-level P/PRE/LI/BLOCKQUOTE blocks with single LF separators; an empty P containing only its placeholder BR represented an empty line. Raw `innerText` adds visual paragraph spacing and is not the same representation. The returned structural string matched the fixture exactly:

```json
{"exact":true,"expectedBytes":23569,"observedBytes":23569,"expectedHash":"dbe5d30905e1241c0905f48bd1d1fa4b2874078cd9e7f51b7a2eacf831b711c2","observedHash":"dbe5d30905e1241c0905f48bd1d1fa4b2874078cd9e7f51b7a2eacf831b711c2","hashMatches":true,"expectedLineFeeds":2139,"observedLineFeeds":2139,"blockCount":2140,"endsWithFixtureTail":true,"messages":0,"sendActions":0}
```

Coverage includes Chinese, emoji, fenced code, blank lines, leading/internal spaces and a terminal marker. This fixture uses LF, not CRLF; it does not recover the lost historical T6 payload, prove all serialization variants, or validate a sent message/server context.

## Preserved failures and HTTP 429

- The older native-attachment overwrite remains a historical FAIL. A later success does not rewrite it.
- The first live counter mistakenly watched `autoAttempted`, which is a derived HANDOFF_GET field, rather than persisted `attemptedAt`. Its zero count is invalid reservation evidence. The corrected negative/positive run above supersedes only that gap.
- During the earlier attachment follow-up, a batched read returned HTTP 429 but a second fictional upload ran before the result was inspected. This was an agent orchestration violation of the stop rule, disclosed and preserved; it is not a production extension defect. No send occurred.
- In the corrected run, the same receipt as the final long readback reported HTTP 429 for the ChatGPT origin, with no endpoint or retry-after supplied. Further site operations stopped. Only extension-local state read/observer cleanup, local evidence work and task finish followed. No site operations were performed while preparing this publication.
- Retained test drafts were not removed as cleanup. No ACL changes, permission changes, limit bypass, new real sends, merge or release occurred.

Original local summaries and tool/session history remain local. These SHA-256 values bind the retained summaries, not publicly downloadable raw browser logs or an independent witness:

| Local summary basename | SHA-256 |
| --- | --- |
| LIVE_RUNTIME_TEST_20261023.md | 01eb287ed5e864128832bfeeac3685faf5f5d777163c472a4ea5f64d24c5c631 |
| LIVE_ATTACHMENT_RETEST_20261023.md | e8e8798e9c7f57e796fc9c491399a21004c1202b1494c6387c13d120cf47b070 |
| LIVE_COUNTED_LONG_20261023.md | e5b5f67454323daf12d52c3691423e615d4f2781dfc38939fc194e5ab9535819 |

## Remaining work and release boundary

The latest main PLAN and AGENTS still require Z0-LIVE and P1-CORE acceptance before P2-FORK; P3-REPORT depends on P2-FORK. The request to continue development does not supply missing live evidence or a human acceptance signature.

1. Complete remaining zero-send checks on a source-identified supported browser: whitespace/multiline drafts, late-attachment race, unknown-attempt reload, Project/Temporary/old-session refusal, old listeners and abnormal recovery. Synthetic tests already cover these contracts; this document does not add live proof for them.
2. Obtain separately authorized human-send evidence for trusted full input comparison, session/role identity, complete final reply and at least two usable completion signals. Earlier human sends used the recorded 3/3 budget; this run adds none. A fresh send budget is not inferred from general development authorization.
3. Verify two ordinary tabs' identity, overlapping generation/interleaved completion and failure recovery at the current adapter level. Future P2 persistent branch binding is its own implementation acceptance, not a claim this zero-send run already established.
4. Review the P1/source-authorization residual risks, approve the actual integration/merge sequence explicitly, and retain exact merged-SHA automated evidence. All implementation PRs remain Draft/open at this snapshot; this publication does not change their bases or merge them.
5. After the applicable live items pass, the owner supplies the required exact-head manual acceptance in GitHub. Agent-created comments cannot substitute. Only then may formal completion evidence and dependency states be updated under `EVIDENCE.md`.

Human Stop Gate: OPEN_UNKNOWNS are the items above and unsupported DOM variants, original source-rejection cause, existing-profile upgrade and closed-tab/session-storage loss recovery. ASSUMPTIONS retain the documented same-tab/same-input P1 recovery scope. DISPUTED_FINDINGS: none introduced by this publication. IRREVERSIBLE_EFFECTS: none in this documentation-only increment. ROLLBACK_STATUS: code unchanged; evidence can be reverted without changing the installed candidate, and original logs remain preserved. Human final risk acceptance is still pending. Z0-LIVE remains BLOCKED / NOT SIGNED; Beta is incomplete.
