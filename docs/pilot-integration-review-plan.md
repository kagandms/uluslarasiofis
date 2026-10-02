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

PM closure: user explicitly authorized the attached PM task on 2026-10-02. Start from clean `f2d50eb32b7f8d3612bc89cdc0e2f58b64c956f4`, same branch/worktree; preserve all existing corrections and old delivery.

1. Reproduce initial unsafe/failed recovery denial with real Worker/SQLite regressions. Permit reasoned reviewer/admin resubmission for current finalized/completed-intent documents after Start Review, without broadening safe file reads or approvals. Keep pending denial and atomic revision/status/note/audit guards; align DTO, route, SQL and owner eligibility.
2. Prove initial non-clean → second owner device → requested replacement/current pending/new job → actual clean scan → access/approval, with terminal failed retries, old verdict preservation, stale result rejection and existing retry behavior.
3. Document identity-verified read-only operator lookup + existing staff reset API for lost drafts; prove discovery, duplicate denial, reset revocation, old code denial and stable reference locally. No recovery UI/API/schema expansion or direct credential SQL.
4. Update student/staff guidance and remote UAT expectations. Windows backup stays a separate untested item. Rollback requires a recorded trusted deployment and evaluated data compatibility; no automatic old Worker rollback.
5. Run focused/all Node/Python/build/diff and actual ClamAV/native acceptance on final product source; publish safe evidence, local commit, new HEAD-named source ZIP/manifest/SHA/patch; clean owned temporary runtime resources. All remote UAT remains NOT EXECUTED; no remote mutation, push or main merge.
