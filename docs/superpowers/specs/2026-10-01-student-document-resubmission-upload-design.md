# Student Document Resubmission Upload Design

## Status and baseline

- Phase: 8E, student replacement-document upload after staff requests resubmission.
- Accepted baseline: `90ac0f658655743f722a85c6a5e1b51db33dd6af` on `codex/phase8d-long-lived-owner-session`.
- Feature branch: `codex/phase8e-student-resubmission-upload`, created from the accepted baseline.
- This document specifies the design only. It does not authorize implementation before the design and implementation plan have been reviewed.

## Goal

Allow an applicant with the valid owner-session to upload a replacement for the exact document that staff requested, using a short-lived direct-to-private-R2 upload capability. Keep draft upload contracts, student-number lookup, and existing staff review behavior unchanged.

## Locked security and product decisions

- Private mutation authority comes only from a valid application owner-session belonging to the application being changed. The 180-day session remains fixed-lifetime; this phase adds no recovery, refresh, password, OTP, or new-device access.
- Student-number lookup is read-only. It does not create or renew sessions, call owner-only requirements or mutation endpoints, or issue an upload capability.
- Replacement uploads use dedicated routes and dedicated repository operations. Existing draft intent/finalize/delete contracts remain draft-only.
- The application must remain `resubmission_required` for a replacement intent and finalize.
- Server-persisted application, policy, document, revision, file, intent, and staff-message state determines eligibility. A student-visible staff message for the exact document is additional persisted proof, never sufficient on its own.
- Internal application, document-record, and revision IDs are resolved server-side. The browser mutation contract uses only a stable document `code` when creating an intent and an opaque `intent_id` when finalizing.
- Approved and unrelated documents remain locked. No general replacement or draft-delete relaxation is introduced.

## Architecture and API boundary

Add dedicated owner-session endpoints following existing Worker route conventions:

- `POST /api/public/applications/current/documents/resubmission-upload-intent`
  - Body: `{ code, filename, media_type, byte_size }`.
  - Resolves application, applicable policy, document record, and current revision from the owner-session and D1.
  - Returns an opaque intent reference and the short-lived signed PUT capability for its private quarantine object.
- `POST /api/public/applications/current/documents/resubmission-finalize`
  - Body: `{ intent_id }` only.
  - Revalidates owner-session, application/document/revision state, and intent before verifying the R2 object and attempting finalization.

Neither body accepts student number, application ID, document-record ID, revision ID, or a client-provided resubmission authorization flag. The UI eligibility value, if returned by an owner-only requirements response, is only a display hint; both mutation endpoints independently enforce all authorization and state rules.

Reuse the existing centralized document policy, filename sanitizer, media allowlist, byte limits, quarantine key generation, upload capability signing, 10-minute upload intent lifetime, short-lived signed PUT, and direct browser-to-R2 transport. Accepted media types remain PDF, JPEG, PNG, and WebP. The Worker never proxies file bytes.

## Eligibility

### First replacement attempt

All conditions must hold at intent creation and again at finalize:

1. The request has a valid owner-session for the target application.
2. The application belongs to that session and has status `resubmission_required`.
3. The document code is an active requirement in the centralized policy for the application's current type, age, and address-evidence branch.
4. The existing document record belongs to that application and requirement.
5. The current revision belongs to that exact record and has status `resubmission_required` and `is_current = 1`.
6. The record review status is `resubmission_required`.
7. A persisted student-visible staff message exists for that exact application/document record as supplementary evidence.
8. No cleanup-pending or otherwise incompatible state exists for the target record/revision.

An approved or unrelated document cannot be replaced even when another document caused the application-level resubmission state.

### Retry after a finalized replacement scan failure

A new attempt may be created only if the application remains `resubmission_required`, the exact record still has its staff request/message, its review status is `pending`, its current revision is `submitted`, and its current file scan status is `unsafe` or `failed`. Retry is denied for scan `pending` or `clean`, approved, under-review, cleanup-pending, missing, stale, or non-applicable state.

## Revision and intent lifecycle

- Reuse the same `document_records` row. Allocate `MAX(revision_number) + 1` on that record.
- Creating an intent does not change or supersede the staff-reviewed current revision.
- Before finalize, the replacement revision is non-current (`is_current = 0`) and `pending_scan`; its upload intent is pending and its file is not finalized.
- For a new attempt, invalidate any prior pending replacement intent and its non-current pending revision before making the new attempt authoritative. A stale intent must not be finalizable after invalidation.
- Finalize verifies the intent is pending and unexpired, belongs to the session's application and exact target record, and still expects the persisted current revision/state. Stale or incompatible finalize returns stable HTTP 409 code `RESUBMISSION_UPLOAD_CONFLICT`.
- On successful finalize, in one atomic D1 batch: mark the prior current revision non-current and `superseded`; make the replacement revision current and `submitted`; mark its file `finalized` with scan `pending`; set document review status `pending`; complete the intent; update application `updated_at` and `last_activity_at`; and write the audit event.
- The application remains `resubmission_required`. Staff explicitly resumes review through the existing guarded transition after no requested replacements remain.
- Later staff resubmission requests and student replacements continue revision numbering without creating a new document record.

## R2 verification, failure handling, and cleanup

Before finalize, verify the uploaded object's existence, actual size equals declared size, size is within policy, actual content type equals declared type, and type remains policy-approved. Metadata from intent creation is not trusted in place of object verification.

Missing/mismatched/expired/replaced attempts must not become current. Their intent and non-current revision are invalidated in D1 before best-effort object deletion. The previously reviewed/current revision must never be marked for cleanup or deleted by replacement cleanup.

During implementation, inspect the existing cleanup path specifically for expired, rejected, superseded, and abandoned resubmission intents. Reuse it only if it deterministically tracks cleanup and supports safe retry. Otherwise add a narrowly scoped pending-cleanup mechanism within Phase 8E using the existing schema; cleanup failure must remain retryable and must never reopen upload authority or roll back invalidation. No migration is expected.

A signed PUT already issued to a quarantine key may not be immediately revocable. It grants only short-lived write capability to that private object, not application/document state mutation. If session expiry/revocation is detected, the browser aborts its active upload and does not retry or reuse the capability. A valid session is required again for any new intent and is mandatory for finalize. An uploaded-but-unfinalized quarantine object is never a current document and is left to safe cleanup.

## Tracking UI and localization

- The owner-session `/basvurum/` view may render replacement upload controls only for server-indicated eligible documents, alongside document status and the office's student-visible explanation. Eligibility hints do not authorize mutation.
- The student-number lookup view renders only privacy-minimized application/document status and office message. It has no file input, upload button, retry action, or private mutation language and does not call owner-only requirements or upload APIs.
- The upload lifecycle shows file validation, intent creation, direct PUT progress, finalize state, and safe localized failure messages. Direct PUT success alone is not reported as completed. Show completion only after finalize succeeds, then refresh owner tracking; the document should display as waiting for review while the application may remain `resubmission_required`.
- A detected 401/session failure stops private actions, aborts active browser upload where possible, prevents capability reuse, and falls back to read-only tracking without converting lookup into authority.
- Complete strings are required in TR, EN, RU, TK, and AR. Preserve the existing Arabic RTL behavior.

## Audit and privacy

Successful finalize writes `student.document_resubmitted` atomically with the state mutation. Safe metadata allowlist:

- `documentCode`
- `revisionNumber`
- `documentStatus`
- `result`

Do not record filename, staff reason, student number, storage key, signed URL, or internal IDs in audit metadata. Do not expose storage keys, signed URLs, or internal IDs in public tracking responses.

## Validation and regression boundaries

Add tests to the normal `npm test` suite and include relevant backend tests in `npm run test:backend`. Cover:

- owner-session authorization, cross-application denial, expired/revoked sessions, and completed/draft/submitted/under-review denial;
- student-number lookup of resubmission state without `Set-Cookie`, session mutation, capability issuance, or private controls, including mutation attempts with student number/application/document IDs in the body;
- first-replacement eligibility, supplementary exact-document staff-message proof, policy applicability, approved/unrelated/missing/inactive/conditional document denial, and the narrow unsafe/failed retry matrix;
- one-active-intent invalidation, concurrent intents, stale finalize conflict, no client-supplied current/document IDs, and safe cleanup behavior;
- revision 1 preservation on intent creation, revision numbering, same-record reuse, atomic current swap, audit rollback, and no automatic application transition;
- missing object, object size/content-type/policy mismatch, intent expiry, session failure during upload, and strict direct-R2/finalize success semantics;
- Phase 8C staff detail/review of the new current revision and guarded explicit return to `under_review` only after all requested replacements are resolved;
- owner and lookup UI differences, direct PUT progress versus finalize success, safe errors, all five locale keys, and Arabic RTL.

Keep the existing draft-only upload and delete behavior, 180-day fixed owner-session contract, completion revocation, read-only tracking privacy, staff review/OCR, document policy, private R2 architecture, YKN, Kapak, and Tebligat unchanged. Public passport OCR remains absent.

Required local validation after implementation:

- `npm test`
- `npm run test:backend`
- `npm run build`
- `npm run deploy:dry-run:staging`

No real staging or production deployment, remote migration, `0006` migration, or recovery flow. Existing migrations remain `0001`–`0005`; `0005` remains not remotely applied.

## Delivery boundary

Implementation belongs on `codex/phase8e-student-resubmission-upload`, based on the accepted Phase 8D commit. The eventual focused implementation commit message is `feat(public): add secure document resubmission upload`, pushed normally to `origin/codex/phase8e-student-resubmission-upload`. No amend, force-push, rebase, merge, main modification, deployment, or remote migration.
