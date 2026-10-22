# P0 + P1 integrated preflight (2026-10-22, revision 2)

**CI-only branch. DO NOT MERGE.** This is a synthetic rehearsal combining PR #1 `93199fbee134f74ff45fc21df86674025f833be0` and PR #3 `a8f7ce6dcca03f819846fbf4f75e5a1f02dddb11`. All three Chromium suites are retained in `npm run test:e2e` and the full Node suite is retained. No automated messages, PR approval, release, or modification of `docs/PLAN.md`.

The newest P1 code adds the one-active-attempt guard and a real MV3/IndexedDB negative integration case. The previous integrated SHA `cc2caa5292eba93cb0c62aa5e89a9704841959dd` passed 150/150 Node and three synthetic browser suites; those results **do not** automatically apply to the updated combined tree. Wait for new Linux/Windows checks on this exact commit. Preserve this record; close Draft PR #4 without merging once checked.
