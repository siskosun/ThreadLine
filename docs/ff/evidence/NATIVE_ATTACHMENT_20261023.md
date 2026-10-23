# Native attachment draft protection — 2026-10-23

This is regression evidence, NOT Z0-LIVE signoff or Beta completion.

## Snapshot and scope

- Verified GitHub main: `f3109ebb6e5e76f4c34670b10654bd0127471bea`.
- Verified Draft PR #1 HEAD / local clean starting point: `93199fbee134f74ff45fc21df86674025f833be0`.
- Branch: `codex/fix-native-attachment-draft-20261023`, based on PR #1.
- Only production change: `threadline-extension/handoff.js`. No data/schema/background/selectors/permission/plan changes.
- External Plan/Final Gates explicitly waived by user for this task; review is local only.

Implementation commit: [`1cba735154658391ecd5cd1a8e134fedbc236987`](https://github.com/siskosun/ThreadLine/commit/1cba735154658391ecd5cd1a8e134fedbc236987). Delivery: stacked [Draft PR #5](https://github.com/siskosun/ThreadLine/pull/5), base PR #1 branch. Verified CI for that implementation snapshot: [Linux 39918631630](https://github.com/siskosun/ThreadLine/actions/runs/39918631630) and [Windows 39918631633](https://github.com/siskosun/ThreadLine/actions/runs/39918631633), both success with 138/138 Node and both MV3 E2E suites PASS. Release skipped. Subsequent documentation-only evidence linking does not change the tested source/test files; current HEAD checks are visible in PR #5.

## Original failure (FAIL, retained)

Previously observed using a fictional TXT attachment: editor text empty, attachment chip outside the editor but inside the same form. Baseline handoff inserted the fictional continuation, reported exact success and ACKed. The attachment survived, but the existing draft was modified. Send count: 0. This is a failure, never a PASS. Raw local logs are retained outside public evidence; account, conversation identifiers, real content, screenshots and local user paths are not copied here.

Root cause confirmed by source and red tests: `tick()` and `fill()` called `isEmptyEditor()` on contenteditable only. External native attachment state did not participate in either safety check.

## Red → green

Commands executed inside `threadline-extension/` on Windows; Node v26.10.0, Python 3.12.10, Playwright 1.64.0.

| Snapshot / command | Exit | Observed |
| --- | --- | --- |
| Original production, `npm run verify` | 0 | 132/132 |
| New tests, original production, `node --test test/handoff.test.js` | 1 | 17 pass / 4 fail; actual `MUST NOT INSERT` instead of empty draft |
| Attachment fix before focus hardening, new redirected-focus test | 1 | 21 pass / 1 fail; insertion command count 1 instead of 0 |
| Final `npm run verify` | 0 | 138/138; 40 JS syntax files; version/plan valid |
| Final `npm run test:e2e` | 0 | Original MV3 integration + handoff integration, 2/2 PASS; zero submit events |

Red regression is the negative control: the same protection assertions reject the original unsafe production behavior. Raw baseline/red/intermediate/final logs remain in local `.ai/` and are not overwritten. An intermediate complete E2E failed because an explicitly noneditable node is now refused before reservation. Its fault fixture was changed to an unfocusable empty editor; attemptedAt, retained state, zero insertion and reload-no-replay assertions remain mandatory.

## Coverage

| Requirement | Result / boundary |
| --- | --- |
| A empty editor, no attachment | PASS Node + synthetic MV3; 23,569-byte mixed Unicode/code/linebreak exact |
| B attachment outside editor in same form | PASS Node + synthetic MV3; unchanged editor/chip, no BEGIN/ACK |
| C external preview/removal controls | PASS Node + synthetic MV3; Chinese/English removal labels, preview/data identifiers |
| D unselected hidden file input/upload button | PASS Node + synthetic MV3; normal prefill/ACK |
| E internal IMG/noneditable chips | PASS original Node regressions retained |
| F existing text/whitespace/multiline | PASS original Node + synthetic MV3; no overwrite |
| G arrives after initial check | PASS Node during BEGIN and focus; actual browser focus injection blocked; no insertion/ACK |
| Focus redirected to another draft | PASS Node + synthetic MV3; other selected text remains USER DRAFT |
| One-shot BEGIN/reload unknown state | PASS concurrent Node reservation tests + synthetic MV3 attemptedAt and no replay |
| Project/Temporary/saved/unknown URL refusal | PASS Node; actual live pages NOT RUN this round |
| Empty paragraph LF and exact ACK semantics | PASS retained Node; synthetic browser accepts exact or explicitly refuses mismatch, never false ACK |
| New source loaded in authenticated Edge | BLOCKED / NOT RUN |
| Native attachment and attachment-free real Edge retest | BLOCKED / NOT RUN; synthetic is not live evidence |
| Automatic sends this task | PASS: 0; synthetic submit counters 0, no live send performed |

## Implementation and file fingerprints

`isEmptyComposer()` requires a known containing form and checks selected files, media/noneditable nodes, attachment/file identifiers, progress state, file/attachment/upload test markers and removal controls. Unknown scope/read failures/unknown attachment markers fail closed. Ordinary empty upload controls are not attachments. `tick()` checks before BEGIN; `fill()` checks again after reservation and after focus, including current editor identity, page eligibility, active element and collapsed selection ownership before writing. No attachment deletion or send path is added.

SHA-256 of tested local source bytes:

- handoff.js: `6bc21c481c69e97e484bb03c380446d3de3813bb5867840bf085c20693c2561f`
- selectors.js (unchanged): `0bdeb077aacd8f508d5eb7fe0919900729700bd422cbb596db722862b2e29e5a`
- background.js (unchanged): `ff735bc493fb34c1f628d2535c4e88a8a45deb580c7becb03526126a3fba1dc4`

## Remaining acceptance

Independent read-only LOCAL_PRE_REVIEW: first focus-redirection finding CONFIRMED by ROOT's failing regression, fixed and retested; second review of the integrated source returned NO SUBSTANTIVE FINDINGS. This is not an external review or human signoff.

Current instructions prohibit automated ChatGPT Web use; real authenticated acceptance requires user operation. No Tabbit retry, ACL/security modification or site operation was performed in this fix round. Arbitrary new attachment DOM without detectable markers/file state/removal controls remains unverified; fail-closed cases may require manual copy. Need source-bound real Edge attachment/no-attachment tests and broader Z0-LIVE signoff (see BLOCKED.md). Historical T6 original payload remains NOT RUN. Z0-LIVE stays blocked / NOT SIGNED; no merge, Release, P2/P3 or Beta-complete claim.
