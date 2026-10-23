# Accepted repairs and P1 core integration

## Acceptance scope

On 2026-10-23 the user stated acceptance and requested continued development. Asked to identify its scope, the user explicitly selected: **“当前所有修复与 P1 核心验收”** (all current fixes and P1 core acceptance).

This records the user's acceptance of the existing candidate, including the current recovery/draft-safety repairs and P1 local-only core. It is not an Agent-performed Edge result, a GitHub `MANUAL_ACCEPT` comment, or acceptance of the complete Z0-LIVE message/response/concurrency workflow. Earlier raw failed/blocked observations remain intact. No test environment, browser version or loaded fingerprint is invented for the user's report.

## Integration candidate

[Draft PR9](https://github.com/siskosun/ThreadLine/pull/9) targets main. Its branch starts at `102185b75226222446611cdefd337047644e449c`, the final PR8 code, and retains the accepted production source byte-for-byte. It consolidates PR1/3/5/6/7/8 for a single main-target review; existing PRs and their histories are unchanged.

Verified main at preparation: `f3109ebb6e5e76f4c34670b10654bd0127471bea`. The accepted stack includes Windows syntax portability, native-attachment protection across the full composer, one-shot reservation and no unknown replay, panel sender attestation, bounded notice recovery, frozen 24KB inputs, immutable attempts, isolated IndexedDB, reducer invariants and idempotent manual save recovery.

P1 remains disabled by default. Its enabled UI only freezes/saves/lists local experiments and hashes. P1 cannot accept webpage completion evidence or mark a branch done through the UI. No P2 creation/sending/capture adapter is added here.

## Progress and evidence contract

P1-CORE moves from the stale `planned` entry to `in_review`, referencing this real main-target PR. It is not marked done: the canonical evidence JSON requires an actual merge commit and a successful verification check on that commit. No merge SHA, manual-comment ID or completed Z0 status is fabricated.

This integration changes the progress record, not the dependency or acceptance rules. `AGENTS.md`, the plan checker, workflows, database format, release version and production source are unchanged relative to the accepted candidate. PLAN/status changes require human review.

## Verification

Windows commands run again from the actual extension directory:

| Check | Current result | Raw local log SHA-256 |
| --- | --- | --- |
| `npm run verify` | exit 0; 189/189 Node PASS | `f1c1a44a34f7474a8b4e2476a89a3df5c9411832540ccd4db8f9fd5b63d95811` |
| `npm run test:e2e` | exit 0; all 3 synthetic MV3 suites PASS | `f7048b03c907073179b8d6b0fcd658e2ba211e7637f30d6eb4921c4d70f6e3bd` |

Deterministic Git comparison confirms no production, test, script, workflow or AGENTS change from accepted `102185b`. A byte-based SHA-256 over the 79 corresponding tracked Windows files is `d6195c00fe12e1055e72f840612fde9f6f3949f96daecd04a73692c6a481084b` (ordered Git paths followed by NUL and file bytes). The only task-table change is P1-CORE to in_review/PR9. Checks for known private paths/IDs/credentials in new documentation passed.

The existing PowerShell evidence wrapper remains unavailable under the unsigned-script policy; direct results are not wrapper-certified FRESH Gate evidence. No execution policy was changed. Full raw logs remain preserved locally. The final PR description identifies the exact CI-tested integration commit and run links; older PR8 CI remains historical evidence.

Independent read-only LOCAL_PRE_REVIEW found **NO SUBSTANTIVE FINDINGS**. It confirmed accepted-source equality, the P1 modules and subsequent repairs, and the bounded plan/acceptance changes. The PR3 documentation tip is not an ancestor of this branch; its implemented P1 code is included with the later repairs. Reviewer did not rerun tests or operate a browser. ROOT ran the regression and evidence checks above.

## Remaining boundary

No merge, release or real message is performed during preparation. Existing release `v0.6.1` was observed on GitHub, published 2026-10-20. The inherited main-push workflow contains a publish job; this candidate does not alter that workflow. Any later merge decision must account for its behavior rather than assuming a PR approval disables it.

Next executable sequence: review this consolidated candidate; obtain explicit merge authority; merge through the PR; verify the resulting main commit and add P1 completion evidence; separately complete full Z0-LIVE and its required owner comment; then begin P2. Full Z0-LIVE remains blocked, P2/P3 remain planned, second phase deferred.
