# Pilot integration review ledger

Scope: user-authorized attached integration/security task, local only; no remote migration/deploy/secret activation, no Oracle, no main merge or push.

Inputs: scanner `9864c33dabf0ad3ea0ccaaa7175c2a90612b0ebc`; ancestor `a9304568d7484244f05ad65101086d5c7bfdfbaf`. Access source is an uncommitted frozen ZIP, SHA-256 `ff5550003ff4b1f3f73988f5cb186539f5fe67c44c031e26100fffe6bbbe5f3b`, 15 source files plus patch/report/manifest. Archive paths, symlinks, duplicate names, bounded sizes and 18 manifest hashes checked. The tracked patch reproduces all 11 full tracked files exactly from ancestor; four new files are included separately.

Workspace: separate managed worktree `/Users/kagansmtdms/.codex/worktrees/pilot-integration-review/uluslarasiofis-production-readiness-assessment`, branch `codex/pilot-integration-review`, created from scanner SHA. Active access/scanner source branches stay untouched.

1. Read scanner source/delivery/runbook and existing phase8h scanner design; verify scanner baseline and independent guards.
2. Import only verified ZIP patch/new files; resolve shared worker/wizard/messages/tests preserving both features.
3. Audit access entropy/normalization/hash/runtime, session/reset races, lifecycle/CSRF/rate limits, legacy and conflict UX. Reproduce actionable findings before minimal fixes.
4. Audit scanner authority/content/lease/results and failure/operation paths; add focused regressions for confirmed findings.
5. Verify fresh and 0001–0007 upgrade migrations; run combined Node/Python/build/diff, actual ClamAV against combined API, native local Worker runtime evidence and explicit UAT boundaries.
6. Deliver prioritized findings/validation report, staging target/config/rotation/rollback/UAT plan, local final commit and secret-free ZIP/patch with source hashes. Remove owned temporary credentials/test resources and report service states.

No source reviewed yet is called fully VERIFIED solely from an earlier branch's test summary. Historical phase8h Queue/Oracle suggestions are superseded by the user's current MacBook/D1 pull design; current rules and source control the review.

Follow-up: continue from clean `d4b7356114998934805c14808e05d4b612b681e0`, same branch/worktree. Reverify identical access ZIP/manifest/ancestor; preserve previous fixes and existing staff DTO contract. Apply independent review's extra task: campus create 120/900s and public tracking 300/900s with 20-student/excess/window/duplicate tests; fence revoked owner draft SQL; rerun combined Node/Python/build/actual ClamAV/native proofs. Independent A-only 490 PASS remains attributed to its report, not used as combined validation. Update evidence/report/package, no remote action.
