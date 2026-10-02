# Phase 8I staging acceptance

Date: 2026-10-02

## Scope and deployment

- Acceptance branch: `codex/phase8i-staging-acceptance`.
- Tested and deployed code SHA: `157170662c5ac54f8b59b8f106d3d80c395de47c` (the Phase 8I integration commit).
- Staging target verified before deployment: Worker `goc-staging`, origin `https://goc-staging.topkapiuni.workers.dev`, D1 `uluslarasiofis-staging` (`8f034e90-17fc-43d7-aa5d-125571019612`), R2 `uluslarasiofis-documents-staging`.
- Active pre-deployment version: `7baed542-0e47-4353-9e7a-9770edb77037`.
- Deployment command: `npm run deploy:staging` — PASS. Wrangler deployed `goc-staging`; version `20ccb47f-a194-4ddd-b908-e8e90a068cbc`.
- No migrations, secret changes, new resources, or production access. No rollback was needed.

## Local verification

| Check | Result |
| --- | --- |
| `npm ci` in this worktree | PASS; 96 packages installed, audit reported 0 vulnerabilities |
| `npm run test:backend` | PASS; 127/127 |
| `npm run build:staging` | PASS; staging bundle built |
| `npm run test` | PASS; 389/389, including ZIP, archive, and delayed-response tests |
| `npm run build` | PASS; existing `ocrService.js` ineffective dynamic-import warning |
| `git diff --check` | PASS |

The tests confirm the localized pending/unsafe/failed access explanations, ZIP all-or-nothing behavior, archive UI states, and no success message if the writable close fails. These are local test results, not live browser evidence.

## Live staging HTTP and API evidence

| Scenario | Result | Evidence |
| --- | --- | --- |
| `/`, `/basvuru`, `/basvurum`, `/yetkili/` | PASS | Followed normal redirects; each final response was HTTP 200 HTML. |
| Anonymous staff application query | PASS | `POST /api/staff/applications/query` returned 401. |
| Authenticated shared-staff session | PASS | Existing `PH8H_STAFF_*` environment values were used only inside a short-lived Node API process. Login and session verification returned 200; no credential or cookie was printed or saved. |
| Current synthetic queue/detail | PASS | Queue returned one `submitted` application; detail returned nine applicable documents, all with `scan_status=pending`. No application or document state was changed. |
| Pending single-document download | PASS | Existing document route returned 404 for pending documents. |
| Pending ZIP manifest | PASS | Returned 404 `DOCUMENT_NOT_AVAILABLE`; no partial ZIP was issued. |
| Terminal/archive filters | PASS | `terminal`, `cancelled`, and `rejected` returned empty results (0 items); this staging database has no terminal application to open. |
| Server search | PASS | A non-matching search returned 0 items. |
| Logout | PASS | API logout returned 200. |

## Browser UAT

- `/yetkili/` was opened in a controlled in-app browser tab. It displayed the staff login form.
- Authenticated browser UAT is **BLOCKED**: the controlled browser had no authenticated session, and the permitted API credentials/cookie were not transferred into the browser.
- Authenticated visual queue/detail, pending copy in the rendered browser UI, archive navigation/empty/filter/error views, and refresh/navigation persistence were **NOT EXECUTED**. API and local-test evidence above does not substitute for them.
- The browser tab is left on the staging staff login page for owner-side continuation.

## Deferred acceptance gates

- No clean, finalized staging document exists in the synthetic application. A successful private R2 preview/download and complete ZIP were **NOT EXECUTED**; pending access denial was verified instead. No live data was seeded or changed to fabricate this case.
- Real malware scanning and scanner-dependent UAT remain deferred to the final preparation stage. Pending scans were not manually changed.
- Phase 8H and Phase 8I full live acceptance remain **NOT COMPLETE**.
