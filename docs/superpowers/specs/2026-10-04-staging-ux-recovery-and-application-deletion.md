# Staging UX Recovery and Application Deletion Design

## Goal

Restore the expected application, staff, and document-library experience on the feature-complete portal line, carry forward the six previously approved application changes, and add an explicit reversible-to-permanent deletion lifecycle for staff.

## Evidence and base

The staging regression was deployed from `codex/application-flow-fixes` at `83d1b86`, whose source omits the nationality autocomplete, phone country selector, burgundy application-table actions, and document-card print/preview treatment. The validated comparison line is commit `b2c1aa0` (`codex/pilot-integration-ready`), which contains those existing UX features and the current PC ClamAV runner path. Work is isolated from the dirty `application-flow-fixes` worktree; its six approved changes must be ported deliberately, not copied over the newer source wholesale.

## Public application behavior

- Restore nationality country autocomplete and international phone country selection from the feature-complete source.
- Derive the under-18 answer from date of birth; keep it read-only and calculate the eighteenth birthday as adult.
- Keep the fingerprint-code hint, submission confirmation focus/scroll, localized Istanbul submission timestamp, new-application flow, same-student duplicate protection, and student-number prompt on every tracking lookup.
- Contact-step changes must not display a successful-save state until a server-owned draft exists and the server confirms the write. Once required contact fields and the responsibility acknowledgement are valid, create one owner-session draft and persist subsequent edits through the existing authenticated autosave API. Do not put passport, phone, or other application data in browser storage. Duplicate-student rejection remains server-authoritative.
- Preserve the public upload flow and its current server-side readiness checks.

## Staff application and scan actions

- The application table keeps the established burgundy layout for **Detay** and **İndir** and adds **Sil** beside them.
- **Sil** moves a non-draft application into the read-only archive's new **Silinen** filter. It does not erase the application or its files. It revokes owner sessions and hides the record from active queues and public owner-session access.
- A **Geri al** action in **Silinen** restores the application to its previous terminal/active status while it remains in the soft-deleted state. The exact previous status is retained so restoration does not invent a new review transition.
- **Kalıcı sil** appears only for soft-deleted records. Require an explicit second confirmation and an administrator staff session. Once permanent purge starts, restoration is disabled.
- Purge removes all R2 objects before removing D1 application data. If any object deletion fails, retain a hidden, non-restorable purge-pending record and expose a retry action; never report success or leave the record publicly accessible. On completion, remove the application's personal data and child rows in foreign-key-safe order, remove an otherwise-unused student row, and retain only an anonymized purge audit event with no application/document references or personal metadata.
- The existing real ClamAV runner remains the scan engine. Add a per-current-document **Belgeyi tara** action that requests the existing scanner queue for that application/document. The UI shows queued/running/result states, spaces the action from the pending status, uses burgundy for the action, and keeps the Tara control white as requested. It must not label a queued result as clean before the PC runner reports a real ClamAV verdict.

## Documents workspace

- Match the first attached reference: responsive three-column cards with document title, category pill, first-page PDF preview, metadata, a full-width burgundy **Yazdır (Hızlı Çıkar)** action, and **Önizle** / **İndir** controls beneath it.
- Keep the current search, category filter, count, empty state, document catalogue, and staff-only authentication.
- Use the current catalogue's URLs and file names. The print action opens the source PDF in the browser's native viewer as in the reference flow; preview and download retain their existing behavior.

## Data lifecycle and failure handling

- Add forward-only D1 schema for the soft-deletion marker and durable purge progress; do not expand the application's existing status enum.
- Staff mutations are same-origin and session-authenticated. Soft deletion and restoration use an atomic D1 state-plus-audit change. Permanent purge is administrator-only and idempotent so a failed R2 pass can be retried safely.
- During purge, deny applicant mutation/access and private document access. Remove or anonymize associated sessions, notifications, notes, scanner jobs, upload intents, document revisions/files, and application-linked audit metadata in dependency order.
- Do not change production resources. Staging deployment and migration remain limited to the configured `goc-staging`, staging D1, and private staging R2.

## Acceptance criteria

1. All six earlier approved application changes work on the feature-complete source without losing nationality, phone-country, other existing staff tools, or visual styling.
2. Contact fields are never labelled saved before the server confirms a draft/save; valid contact details survive a refresh through the owner session, and duplicate student numbers are rejected server-side.
3. Staff can soft-delete, find the application under **Arşiv → Silinen**, restore it, or permanently purge it with the specified authorization and failure behavior.
4. A manual scan action queues the selected file for the real PC ClamAV runner and shows its actual outcome.
5. The Documents view matches the first reference layout, including the visible print action and PDF card preview.
6. Local PC verification passes before a staging-only deploy; no production deployment or production data mutation occurs.

## Review decisions captured

- Archive first; permanent deletion is available only from **Silinen** and cannot be restored after purge begins.
- The **Sil** action is reversible until the separate permanent-purge action.
- The Documents screen follows the first attached visual reference.
- Permanent purge is administrator-only; soft delete/restore follows the existing staff application permissions.
- The contact acknowledgement precedes automatic server draft creation so contact data is not persisted before the applicant's explicit acknowledgement.
