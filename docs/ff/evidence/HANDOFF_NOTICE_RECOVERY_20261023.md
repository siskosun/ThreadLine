# Handoff notice recovery: bounded UI repair

Scope: Z0 page-adapter maintenance, based on PR7 `52e3219f89d6a0f88bb2ffc8c1fc06c3bd62e359`. No change to sender authorization, draft detection, intent storage, automatic retry or sending. Z0-LIVE remains **BLOCKED / NOT SIGNED**; no P2/P3, merge or release.

## Observed defect and preceding live cases

Real Tabbit, ordinary new ChatGPT page, fictional material, zero messages:

- A three-space draft remained exactly three spaces. Pending intent retained; reservation/ACK transitions 0/0.
- A multiline draft with an empty paragraph survived an explicit reload unchanged. Pending intent retained; reservation/ACK 0/0.
- Controlled interruption: the real isolated-world `HANDOFF_BEGIN` handler reserved the owned intent, without inserting. Storage transitions 1/0. Reload left the editor empty and `autoAttempted=true`; no automatic replay occurred.
- A read-only, bounded DOM observer on that owned page saw the unknown-state notice added at 1,722 ms and removed at 1,905 ms. Afterward there was no notice. The remover's identity is **unknown**; this does not prove a particular framework or extension caused removal.
- Therefore: no-replay safety **PASS** for this observation, persistence of the manual-recovery notice **FAIL**. These are separate results.

Pre-fix loaded `handoff.js` SHA-256: `6bc21c481c69e97e484bb03c380446d3de3813bb5867840bf085c20693c2561f`. `selectors.js`: `0bdeb077aacd8f508d5eb7fe0919900729700bd422cbb596db722862b2e29e5a`. `background.js`: `f64ff703e8bae81b115a1f1728ef22cc50d6bbda5da62698c99c9bc817d03c3f`.

HTTP 429 handling in this continuation follows the user's new instruction: pause 30 seconds, then inspect state before continuing. Four observed 429 receipts before the repair were each followed by that pause. No rate-limit bypass, private endpoint calls, cookie reads or blind mutation replay. Earlier stop-rule deviations remain in the prior evidence, unchanged.

## Test-first evidence

All commands run from the actual extension directory on Windows. Full raw logs remain in local `.ai/`; paths and session-specific identifiers are not published.

Reviewable derived logs redact local machine paths and remove trailing display whitespace: [Node red](banner-red-node.txt), [MV3 red](banner-red-e2e.txt), [full verification](banner-verify.txt), [all MV3 suites](banner-e2e.txt), [final verification](banner-final-verify.txt). Original raw hashes below remain unchanged; the old Python diagnostic contains its original console encoding artifacts.

| Command / phase | Actual result | Raw log SHA-256 |
| --- | --- | --- |
| `node --test test/handoff.test.js`, old production source + first four new tests | exit 1; 23/26 PASS, 3 new restoration assertions FAIL | `846de963a15d3199a007592408f743c993a91538aa221f0064c59730615e74a6` |
| `python test/handoff-e2e.py`, old production source + new regression | exit 1; restored unknown notice absent after 3 seconds | `630e6688288a9c229ba63203cdf5dc0e490a0d2209910a871b4b44da831ab68a` |
| `npm run verify`, repaired source + six new Node cases | exit 0; 189/189 PASS | `067a00bd9ad71bf8b5b618e8ef7781f066584183515544b3ea80d7f1e918199a` |
| `npm run test:e2e`, repaired source | exit 0; all 3 synthetic MV3 suites PASS | `f7048b03c907073179b8d6b0fcd658e2ba211e7637f30d6eb4921c4d70f6e3bd` |
| `npm run verify`, final strengthened no-replacement-host assertion | exit 0; 189/189 PASS | `8346c60ca10a09107fde0e2c15b4c9ab731b9f71b6bee71a1e8eeb5e2a3c585b` |

The old production file was unchanged when both red commands ran. Existing assertions were not weakened. New cases load production `handoff.js` and cover unknown and exact-success notices, explicit dismissal, delayed copy completion, replacement body, and the three-restoration cap. The MV3 case verifies the same DOM node, unchanged stored attempt, no editor input and zero form submissions. Full regression retains 23,569-byte prefill, blank paragraphs, native-style attachments, focus races, source checks and P1 recovery.

The prescribed PowerShell verification wrapper remains blocked by the existing unsigned-script policy. Direct command results above are not wrapper-certified FRESH Gate records. No execution policy or permissions were changed.

## Repair and review

`handoff.js` retains the notice node and watches document child-list mutations. If the node is detached, it reattaches it to the current body at most three times per document. Recovery never invokes handoff processing. Explicit Close disconnects the observer and prevents asynchronous copy completion from reviving the notice. No new dependencies.

Repaired Windows resource SHA-256: `429b0e50eecd6594937aa08db208caca8ee5230389ec839ee11eb5d8556565ab`.

Independent read-only LOCAL_PRE_REVIEW: **NO SUBSTANTIVE FINDINGS**. Reviewer inspected production changes, tests and existing logs; did not independently execute tests or browser operations. This is not external approval or human acceptance.

## Remaining acceptance

Code commit `1f7578f73ca184f464f96c9542cd458842170682`, [Draft PR8](https://github.com/siskosun/ThreadLine/pull/8), stacked on Draft PR7. Its exact-HEAD [Linux CI](https://github.com/siskosun/ThreadLine/actions/runs/39978366347) and [Windows CI](https://github.com/siskosun/ThreadLine/actions/runs/39978366339) both succeeded. Later documentation/test-assertion HEAD checks are reported on the PR and must not be confused with these code-commit receipts. Production source is unchanged after this commit.

Fixed-code real Tabbit retest is **BLOCKED**, not PASS: the already-open native extension inspector twice returned `failed to activate captured window`, including the allowed fresh-selection recovery. Native input stopped. The same Tabbit browser control channel then refused navigation to the known extension panel URL (`Navigation URL is not allowed`). No alternate executable, elevation, ACL change, permission change or protocol bypass was attempted.

The installed source checkout was moved non-destructively from `07b3773` to `1f7578f`; local untracked evidence was preserved. The candidate's disk hash matches the repaired hash above, but the extension was **not reloaded** and a freshly loaded runtime hash could not be obtained. Therefore no current fixed-code live result is claimed. The original owned unknown-state page remains empty, zero messages, with its old added/removed notice trace; its pending record was not cleared or reset. Only the task-created unused blank tab was closed, and all four useful fixtures were retained in the resumable group.

Real Edge remains NOT RUN. Bounded restoration cannot guarantee a notice survives more than three removals, CSS hiding or continuous DOM interference. The no-replay guard remains independent of visibility.

Z0-LIVE still requires trusted actual-message/response identity and completion evidence, remaining exception/concurrency cases, and human acceptance. No new real sends are authorized or performed. Existing manual send budget 3/3 is exhausted. PR review and final risk acceptance remain human gates.

## Parent Human Stop Gate (not accepted)

- OPEN_UNKNOWNS: fixed-code real runtime behavior, current Edge, remaining full Z0 message/response and exception/concurrency acceptance.
- ASSUMPTIONS: three notice restorations are a bounded mitigation for the observed removal, not a guarantee for every page lifecycle or third-party extension.
- DISPUTED_FINDINGS: none currently identified; no human acceptance inferred from local/CI success.
- IRREVERSIBLE_EFFECTS: code and desensitized diagnostics published in a Draft PR. No merges, releases, real messages, permission changes or user-data deletion.
- ROLLBACK_STATUS: production change is isolated to one source file and can be reverted by a reviewed commit. Installed source's prior `07b3773` commit and all local evidence remain available. Existing test drafts and unknown intent were preserved; rollback must not automatically replay them.
