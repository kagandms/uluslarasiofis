# Pilot scanner implementation ledger

Baseline: `a9304568d7484244f05ad65101086d5c7bfdfbaf`; branch `codex/pilot-local-clamav`.
Scope: attached Prompt B only. No Oracle, access-code feature, remote migrations, deployment or final integration review.

1. Add migration 0009, atomic finalize job inserts, historical pending reconciliation, fenced lease/retry repository and behavioral SQLite tests.
2. Add machine-only HTTPS claim/content/result/heartbeat routes and staff status/retry; validate current revision, ETag, SHA-256, scan metadata and safe failure codes.
3. Add portable Python runner with bounded private download, explicit ClamAV policy, stale-signature checks, temporary cleanup, process timeouts and runner tests.
4. Install and update real ClamAV on this MacBook; execute synthetic local HTTPS end-to-end evidence, including a second replacement scan. Preserve clean access/review/ZIP gates and improve existing student status copy.
5. Run full suite, staging build, diff checks; deliver operator runbook, evidence, UAT and rollback boundaries.

Ruling: use indexed D1 pull queue rather than Cloudflare Queue — one fewer service/credential; atomic inserts cover both finalize transactions and uploads persist while host is off. The migration also backfills existing pending files.
Ruling: wait until max(upload-intent expiry, finalize + 300 seconds) before claim — prevents legacy reusable upload capabilities from changing content after a verdict. Initial PUT becomes write-once. Cost: up to ten minutes of intentional queue delay.
Ruling: Worker-authenticated content endpoint rather than R2 presigned GET — lease limits one object and Worker binds its SHA-256; runner never receives bucket credentials or public capability URLs. Cost: bounded Worker memory for files <=10 MiB.
Ruling: production runner uses explicit `clamscan` options for each file; optional clamd operations documented separately — avoids trusting an uncontrolled daemon configuration on later hosts. Cost: database load/CPU per scan, concurrency remains one.

Progress: baseline `npm test` passed 464/464. macOS 27.0.1 arm64, 16 GiB RAM, 71 GiB disk. Homebrew installed ClamAV 1.5.4; freshclam in progress. No AGENTS.md found under checked project paths; conversation AGENTS instructions apply.

Progress: queue/API/UI tests green; real synthetic HTTPS + backend SQLite + real ClamAV acceptance passed (PDF/PNG/JPEG/WebP, EICAR, encrypted/broken content, replacement, staff download/review/ZIP, outage/restart and real timeout). A result-I/O expiry regression was reproduced (200 instead of 409) and fixed with fresh time plus a database-clock lease guard; 9 scanner tests passed afterward.
Progress: Wrangler applied migrations 0001–0007 and 0009 to a fresh LOCAL D1 successfully. Native workerd smoke initially used Vite's staging-build config redirect (all bindings still LOCAL), so the local database was different; correcting the local config before native R2 proof. No remote request/migration/deploy performed.

Ruling: native D1 reported finalize row counts [1,1,1,1,1,2,1] with the job trigger; fixture SQLite reports only direct changes. Removed the trigger and appended a conditional job insert to both existing finalize batches. Existing strict row-count/rollback guards remain intact. Cost: narrow edits in both repositories; covered by native rerun.
Progress: native HTTPS workerd + LOCAL D1 + LOCAL R2 acceptance now PASS: initial real clean, exact staff download/archive bytes, preview authorization, replacement real clean, second replacement EICAR unsafe and access denial. Both finalize endpoints returned success with strict guards retained. Verification uses a fresh `.wrangler/scanner-final` namespace with the final no-trigger migration; synthetic queue timing was advanced, no verdict was assigned manually.

Progress: final Node suite passed 477/478 (one opt-in real test skipped), staging build passed. Python update-failure + heartbeat-outage regression reproduced update call count 1 instead of 2; set retry state before heartbeat, now 10/10 Python tests pass. Real ClamAV acceptance rerun after the final runner fix. Owned ephemeral TLS/secret and synthetic native R2/D1 resources removed; engine/signature/venv private state retained, services stopped. Remote activation and final integration remain separate.
