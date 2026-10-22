# ThreadLine P0 + P1 integration preflight (not a release)

- Built from PR #1 HEAD `93199fbee134f74ff45fc21df86674025f833be0` and PR #3 HEAD `f1d0c284cc1b21ce3a1a89a81e62f69e8c2c8ff2`.
- This temporary review branch preserves `docs/PLAN.md` from GitHub main/PR #1. Nothing is marked done, no live gates are bypassed, and no P2/P3 browser workflow has been added.
- Combined `background.js` dispatches both existing handoff/page workflows and restricted `FF_*` local-only commands.
- Combined `package.json` runs **all three** synthetic suites: extension, handoff, and FF core.
- This branch is **not** PR #1 or PR #3; test results of the combined source must be independently checked before any authorized merge. Do not merge this preflight branch or publish a release.
