# Student Document Resubmission Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add owner-session-only student replacement uploads for the exact documents staff requested while preserving draft upload, lookup privacy, revision history, and atomic review state.

**Architecture:** Use dedicated resubmission routes and D1 repository operations. Resolve authority from the 180-day owner-session and persisted application/document/revision state, upload directly to a short-lived private R2 quarantine key, verify the object server-side, and atomically finalize revision state plus audit. Extend the owner-only tracking view with a non-authoritative eligibility hint and localized replacement controls; keep student-number lookup read-only.

**Tech Stack:** Cloudflare Workers, D1, private R2 via `aws4fetch`, vanilla JavaScript ES modules, Node test runner, jsdom, Vite, Wrangler.

**Spec:** `docs/superpowers/specs/2026-10-01-student-document-resubmission-upload-design.md`

## Global Constraints

- Private mutation authority is only the valid application owner-session; student-number lookup stays read-only.
- Keep existing draft upload/finalize/delete routes and SQL constrained to `applications.status = 'draft'`.
- Use dedicated resubmission intent/finalize routes and repository operations.
- Browser mutation bodies contain only document `code` for intent and opaque `intent_id` for finalize; no application/document-record/revision IDs or student number.
- Application must remain `resubmission_required`; never transition it automatically to `under_review`.
- First replacement requires the exact active policy record, current revision, document review status, application status, and supplementary exact-record staff message to agree.
- Retry after finalize is permitted only for the same requested document with current submitted revision and file scan `unsafe` or `failed`; deny pending, clean, approved, under-review, cleanup-pending, and unrelated states.
- Intent creation preserves the prior current revision; new revision remains non-current `pending_scan` until atomic finalize.
- Finalize revalidates owner-session, eligibility, intent, exact persisted current state, expiry, and verified R2 object.
- Atomic finalize includes revision swap, file/document states, application timestamps, intent completion, and `student.document_resubmitted` audit.
- Signed PUT is short-lived quarantine write capability only; session authority is independently required for finalize.
- No migration, new recovery flow, real deployment, remote migration, merge, rebase, or force push.
- Support public locales TR, EN, RU, TK, and AR; preserve Arabic RTL.
- Deliver one focused implementation commit: `feat(public): add secure document resubmission upload`.

## Review Focus

- A stale finalize racing a newer intent or changed current revision must not partially swap state — repository tests force each guarded step to miss and assert full rollback plus stable 409.
- An invalidated signed capability can still PUT until its short expiry — tests prove the object remains non-current/unfinalized and cleanup waits until the capability/intent expiry barrier before marking complete.
- A cleanup delete failure must not reopen an intent or touch the reviewed current file — tests assert pending cleanup is scoped to the invalidated non-current revision and remains retryable.
- Session revocation after capability issuance may leave an unfinalized quarantine object — UI tests assert upload abort/no automatic capability reuse and backend tests assert finalize 401 and no state mutation.
- Conditional policy changes or an unrelated resubmission request must not authorize a document — integration tests cover inactive/address/under-18 policy branches and approved/unrelated records.

---

## Planned file map

**Create:**
- `src/server/domain/studentUploadMetadata.js` — shared, pure upload filename/metadata validation reused without changing draft route semantics.
- `src/server/domain/resubmissionUploadPolicy.js` — pure first-attempt/retry eligibility evaluation over server-loaded state.
- `src/server/repositories/d1/resubmissionUploadRepository.js` — dedicated eligibility, intent lifecycle, exact-file cleanup, and atomic finalize operations.
- `src/server/routes/resubmissionUploadRoutes.js` — owner-only eligibility hint, intent creation, finalize, object verification, and best-effort cleanup orchestration.
- `src/public/resubmissionUpload.js` — owner-view replacement form and upload lifecycle behavior.
- `test/resubmissionUploadRepository.test.js` — D1 state, transaction, concurrency, and cleanup tests.
- `test/resubmissionUploadApi.test.js` — Worker route authorization, object verification, and end-to-end persistence tests.
- `test/resubmissionUploadUi.test.js` — owner/lookup separation, progress/finalize, failure, and locale/RTL tests.

**Modify:**
- `src/server/domain/documentPolicy.js` only if a shared policy helper is needed; do not expand supported media or requirements.
- `src/server/routes/applicationDocumentRoutes.js` — delegate existing draft metadata checks to shared pure helper; keep route and repository draft guards unchanged.
- `src/server/repositories/d1/index.js` — expose the dedicated resubmission repository.
- `src/server/worker.js` — register only the dedicated owner-only routes.
- `src/public/applicationApi.js` — add owner-only eligibility, intent, and finalize request helpers; reuse direct R2 PUT helper.
- `src/public/applicationTracking.js` — load eligibility only for a successfully authenticated owner view and mount replacement controls there; do not load it in lookup mode.
- `src/public/i18n/messages.js` — add complete replacement UI/error strings in all five locales.
- `test/applicationApi.test.js` — assert exact same-origin mutation paths and minimal bodies.
- `test/applicationTrackingUi.test.js` — assert lookup has no private endpoint calls or mutation controls.
- `test/staffReviewWorkflow.test.js` — verify the new revision appears as current and existing guarded review transition remains explicit.
- `test/applicationUploadApi.test.js` — keep the direct PUT transport contract and error semantics stable for reuse.
- `package.json` — include new repository/API backend test files in `test:backend`; `npm test` already discovers `test/**/*.test.js`.

**Must remain unchanged:** all migration files (`0001`–`0005`), `wrangler.jsonc` deployment bindings/triggers, staff authentication/OCR, public passport OCR absence, YKN/Kapak/Tebligat, and existing draft endpoint status guards.

## Task 1: Shared metadata contract and server-derived eligibility

**Files:**
- Create `src/server/domain/studentUploadMetadata.js`
- Create `src/server/domain/resubmissionUploadPolicy.js`
- Modify `src/server/routes/applicationDocumentRoutes.js`
- Create `test/resubmissionUploadRepository.test.js` (eligibility fixtures/tests begin here)
- Extend `test/applicationApi.test.js` only for the unchanged draft request contract if needed

**Interfaces:**
- `readStudentUploadMetadata(body, policy)` consumes an untrusted parsed request body and one active document policy; returns sanitized `{ code, filename, mediaType, byteSize }` or throws the existing safe validation error.
- `evaluateResubmissionEligibility(input)` consumes server-loaded application, policy applicability, document record, current revision/file, and exact-record staff-message facts; returns `{ allowed, mode }` where `mode` is `first_replacement`, `unsafe_scan_retry`, or `null`.

- [ ] Add table-driven failing tests for first-replacement requirements and each retry allow/deny state, including message-only denial, approved/unrelated document denial, policy inapplicability, and cleanup-pending denial.
- [ ] Run `node --test test/resubmissionUploadRepository.test.js`; confirm expected missing-module/function failures.
- [ ] Implement the pure policy evaluator and metadata helper. Refactor only the existing draft route's metadata parser to call the shared helper; preserve its draft status guard, route shape, SQL, media allowlist, sanitizer, and error codes.
- [ ] Re-run the focused tests plus `node --test test/applicationApi.test.js`; assert draft API behavior is unchanged.

## Task 2: Dedicated D1 repository, intent invalidation, and safe cleanup

**Files:**
- Create `src/server/repositories/d1/resubmissionUploadRepository.js`
- Modify `src/server/repositories/d1/index.js`
- Extend `test/resubmissionUploadRepository.test.js`

**Interfaces:**
- `createResubmissionUploadRepository(database)` exposes narrow methods: `readEligibility(applicationId, code?)`, `createIntent(input)`, `findIntent(applicationId, intentId)`, `expireIntent(applicationId, intentId, at)`, `invalidatePendingIntent(applicationId, documentRecordId, intentId, at)`, `listRetryableCleanup(applicationId, code?)`, `markCleanupComplete(applicationId, fileId)`, and `finalizeReplacement(input)`.
- `createD1Repositories(database).resubmissionUploads` exposes that repository without changing `documents.createStudentUploadIntent`, `documents.finalizeStudentUpload`, or draft deletion operations.

- [ ] Add failing repository tests proving intent creation reuses the existing record, uses `MAX(revision_number)+1`, preserves the current revision, and produces non-current `pending_scan` replacement state.
- [ ] Add failing tests proving only one pending attempt remains valid; older intents are invalidated, their file/revision authority is closed before cleanup, and current/historical reviewed files are excluded from cleanup queries.
- [ ] Inspect and test schema-backed cleanup behavior: `migrations/0003_session3_document_cleanup.sql` provides `cleanup_status` and `cleanup_requested_at`; current draft delete cleanup selects by document code across a record, while existing intent expiry only marks the intent and rejection does not durably queue retryable cleanup. Do not reuse the broad draft-delete selection for replacement cleanup.
- [ ] Implement exact-intent/non-current cleanup marking and listing with existing columns, guarded by `is_current = 0`, superseded/pending replacement state, application/record ownership, and expired/rejected intent. Delay the durable cleanup-complete transition until the existing signed capability/intent expiry barrier has passed; object deletion is idempotent and failure leaves `cleanup_status = 'pending'`.
- [ ] Add failing tests for D1 audit/guard failure rollback and concurrent/stale intent ordering. Use SQL guards for every expected state change and a statement-level failure sentinel inside `database.batch()` so a zero-change precondition or failed audit rolls the entire batch back; a JavaScript post-batch changes check alone is insufficient for atomicity.
- [ ] Implement atomic intent invalidation/create and atomic finalize persistence. Finalize compares persisted expected current revision/state; old intents return conflict and cannot supersede a newer revision.
- [ ] Run `node --test test/resubmissionUploadRepository.test.js test/d1Repositories.test.js`; expect repository, cleanup, stale concurrency, and rollback cases to pass.

## Task 3: Dedicated eligibility, intent, and finalize Worker routes

**Files:**
- Create `src/server/routes/resubmissionUploadRoutes.js`
- Modify `src/server/worker.js`
- Create/extend `test/resubmissionUploadApi.test.js`
- Extend `test/backendApiContract.test.js` only for cross-cutting owner-session contract assertions if appropriate

**Interfaces:**
- `readCurrentResubmissionEligibility(request, environment)` is an owner-session-only GET and returns safe policy/document-code/message/limits plus a server-derived UI hint; it does not authorize any later mutation.
- `createCurrentResubmissionUploadIntent(request, environment, requestId)` accepts only `{ code, filename, media_type, byte_size }`, checks same-origin and owner-session, independently validates eligibility, creates the replacement revision/intent, and returns the existing capability DTO shape.
- `finalizeCurrentResubmissionUpload(request, environment, requestId)` accepts only `{ intent_id }`, repeats owner and eligibility checks, verifies R2 object metadata, invokes the atomic repository operation, and returns a student-safe finalized DTO.

- [ ] Add failing Worker tests: missing/expired/revoked owner session returns 401; student lookup and bodies containing student/application/document IDs cannot mint a capability; cross-application, draft/submitted/under-review/completed, approved/unrelated/inactive/conditional records are denied.
- [ ] Add failing object tests for missing, expired, wrong-size, over-limit, unsupported/mismatched content-type, changed policy, and direct PUT success without finalize.
- [ ] Implement independent route validation for intent and finalize; resolve all internal IDs from session and D1; retain exact policy/filename/size checks; sign only an opaque private quarantine key; never proxy bytes.
- [ ] Implement cleanup orchestration: close DB authority first, attempt R2 deletion only for exact invalidated non-current replacement files after the capability-expiry barrier, mark complete only after successful delete, leave failure pending, and retry pending cleanup opportunistically on later owner-only replacement mutation requests. Never pass broad document-code cleanup lists to R2 deletion.
- [ ] Add atomic finalize audit event `student.document_resubmitted` with only `documentCode`, `revisionNumber`, `documentStatus`, and `result` in metadata. Do not include filename, reason, student number, storage key, signed URL, or internal IDs in metadata.
- [ ] Run `node --test test/resubmissionUploadApi.test.js test/applicationTracking.test.js test/staffReviewWorkflow.test.js`; verify lookup response has no `Set-Cookie`, does not mutate sessions, and exposes no capability or private identifiers.

## Task 4: Owner-only tracking hint and replacement UI

**Files:**
- Create `src/public/resubmissionUpload.js`
- Modify `src/public/applicationApi.js`
- Modify `src/public/applicationTracking.js`
- Modify `src/public/i18n/messages.js`
- Modify `test/applicationApi.test.js`
- Extend `test/applicationTrackingUi.test.js`
- Create `test/resubmissionUploadUi.test.js`

**Interfaces:**
- `applicationApi.readCurrentResubmissionEligibility()` performs same-origin GET only after owner-session tracking succeeds and app status is `resubmission_required`.
- `applicationApi.createResubmissionUploadIntent(code, file)` sends only code, safe filename, media type, and byte size.
- `applicationApi.finalizeResubmissionUpload(intentId)` sends only the opaque intent ID.
- `initializeResubmissionUpload(card, requirement, api, options)` manages file validation, progress, abort signal, finalize, safe errors, and owner tracking refresh; it does not make authorization decisions.

- [ ] Add UI/API tests proving lookup mode makes no eligibility/intent/finalize calls and renders no input/button/retry controls; owner mode renders controls only for server-indicated eligible codes and shows the exact office message.
- [ ] Add lifecycle tests proving file validation, intent loading, direct PUT progress, PUT success without final success, finalize-only success, tracking refresh to `waiting_review`, safe 409/401/network/R2/expiry errors, active-upload abort on detected session failure, and no capability reuse.
- [ ] Implement API methods and the owner-only eligibility call. Ensure `publicReady` lookup path never invokes them; do not send internal IDs or student number in replacement bodies.
- [ ] Implement a focused replacement upload controller and mount it only in the owner-authenticated tracking renderer. Reuse `putStudentDocumentDirect`; only finalize response changes state to success. On detected 401, stop private actions, abort the active PUT where possible, and fall back to read-only tracking without retrying/reusing signed capability.
- [ ] Add/verify complete UI and error keys across TR/EN/RU/TK/AR; verify locale change redraw and Arabic document direction remains RTL.
- [ ] Run `node --test test/applicationApi.test.js test/applicationTrackingUi.test.js test/resubmissionUploadUi.test.js`.

## Task 5: Staff compatibility, regression, and phase verification

**Files:**
- Extend `test/staffReviewWorkflow.test.js`
- Extend `test/applicationTracking.test.js` and `test/applicationTrackingUi.test.js` as needed
- Modify `package.json` to include `test/resubmissionUploadRepository.test.js` and `test/resubmissionUploadApi.test.js` in `test:backend`
- No migrations or deployment configuration changes

- [ ] Add integration tests proving staff detail reads the new current revision after finalize, clean-scan preview/download and approval target the new current revision, and staff can request replacement again with the next revision number.
- [ ] Add integration tests proving replacing one requested document does not auto-transition the application, remaining resubmission-required documents block review continuation, and only the existing explicit guarded staff transition can return the application to `under_review` once none remain.
- [ ] Add regression assertions for draft upload/delete status guards, 180-day fixed owner-session behavior, completion revocation, lookup read-only privacy, staff OCR/auth, and absence of public passport OCR.
- [ ] Ensure new backend tests run under both normal `npm test` and the explicit `npm run test:backend` list.
- [ ] Run focused suites, then `npm test`, `npm run test:backend`, `npm run build`, and `npm run deploy:dry-run:staging`; record exact totals/results and the accepted Vite `INEFFECTIVE_DYNAMIC_IMPORT` warning if present.
- [ ] Run `git diff --check`; confirm no migration, `0006`, secrets, staging deploy, production deploy, or remote migration.
- [ ] Review the diff against the approved design, stage only implementation files, create exactly one implementation commit with the specified message, push normally to `origin/codex/phase8e-student-resubmission-upload`, and verify remote SHA plus clean status.

## Final review criteria

- The implementation diff is limited to the files above; no migrations, deployment settings, or unrelated refactors.
- Old pending intents and stale finalizes cannot win over newer persisted state.
- Cleanup authority is limited to invalidated non-current replacement revisions, and retryable failure never reopens upload authority.
- Database mutation and audit either both commit or neither does.
- Owner tracking can upload only under owner-session; student-number lookup remains visibly and technically read-only.
- The application remains `resubmission_required` after finalize; staff review continuation remains explicit.
- All required tests/build/dry-run pass, one focused implementation commit is pushed, and the working tree is clean.
