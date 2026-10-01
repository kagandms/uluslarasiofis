# Phase 8H — Cloudflare Live Staging Deployment & End-to-End UAT

## Scope and result

This phase was restricted to Cloudflare staging. Production resources were not queried or changed. The staging audit and safe read-only browser checks completed, but a full deployment and end-to-end workflow did not: the required `STAFF_SHARED_USERNAME` Worker secret is missing from the declared staging configuration. Deploying the Phase 8G shared-account code without it would fail closed for all staff authentication. No staff credentials were available or entered. Per the stop condition, deployment and tests that depend on an authenticated staff account were not attempted.

No source-code fix was required or made. The synthetic tracking lookup described below was the only application-level UAT request; it created no application or document record.

## 1. Starting state and branch

- Starting checkout: `codex/phase8g-integration-baseline` at `5a6c9aba0c4a16c163a79053009b6f868b2b7b78`.
- Starting upstream: `origin/codex/phase8g-integration-baseline` at the same SHA; working tree clean after `git fetch origin`.
- Phase 8G code integration commit: `a1407352b1f5c3fc1ebc863f35b4a4f0e36ccade`.
- No equivalent Phase 8H branch existed. Work continued in a separate worktree on `codex/phase8h-live-staging-uat`, based on the Phase 8G tip above.

## 2. Staging infrastructure audit

| Resource | Configured and inspected target | Status |
|---|---|---|
| Worker | `goc-staging` | Present. Target hostname: `goc-staging.topkapiuni.workers.dev`. |
| Worker environment | `APP_ENV=staging`, `R2_BUCKET_NAME=uluslarasiofis-documents-staging`, `PUBLIC_DECLARATION_VERSION=student-information-accuracy-v1` | Present in `wrangler.jsonc`; dry-run resolved the staging bindings. |
| D1 | `uluslarasiofis-staging`, ID `8f034e90-17fc-43d7-aa5d-125571019612` | Present; the remote read-only query confirmed this exact database. |
| R2 | `uluslarasiofis-documents-staging` | Present and bound to the staging Worker; object contents and keys were not listed or read. |
| CORS | `https://goc-staging.topkapiuni.workers.dev` | Present as the only allowed origin; methods `GET`, `PUT`, `HEAD`; allowed headers `Content-Type`, `If-None-Match`; exposed header `ETag`. |
| Cloudflare CLI authentication | Authenticated Wrangler session | Present and valid for the read-only staging inspection. Credential values were not displayed. |
| Production target | Not used | No production command or resource query was run. |

Cloudflare reported active staging version `69e6b1e5-2d5d-4209-bf42-80d7bf52ecc2` (version 24, following a secret-change version event). Deployment metadata did not provide a source commit SHA for that active version. This phase did not publish a new Worker version.

## 3. Secret and configuration status

Only secret names were inspected. Secret values were never retrieved, logged, or included here.

| Secret/configuration | Status | UAT effect |
|---|---|---|
| `STAFF_SHARED_USERNAME` | **Missing** from the staging secret list and `wrangler.jsonc` staging vars | Critical blocker: Phase 8G shared-account login and session authorization require this configured identity. Staff login, review, and resubmission UAT were stopped. |
| `STAFF_BOOTSTRAP_TOKEN` | Present by name; value and validity not inspected | No bootstrap request was made. Secure staff-account provisioning remains owner-controlled. |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Present by name; values and validity not inspected | No upload, finalize, or signed-object operation was attempted, so signing credentials are not confirmed operational. |
| `AZURE_VISION_ENDPOINT`, `AZURE_VISION_KEY`, `GOOGLE_VISION_API_KEY` | Present by name; values and validity not inspected | Live OCR was not invoked. |
| `APPS_SCRIPT_URL`, `APPS_SCRIPT_API_KEY` | **Missing** from the staging secret list | Tebliğ/YKN proxy calls requiring Apps Script configuration were not executed. |
| Staging public declaration version | Present as `student-information-accuracy-v1` | Confirmed in the staging config and dry-run binding summary. |

An example username in repository documentation is not treated as the provisioned production-like staff identity. No credentials were guessed, generated, or submitted.

## 4. D1 migration status

The five repository migrations were inspected and already applied to the exact staging database. `wrangler d1 migrations list uluslarasiofis-staging --remote --env staging` reported no migrations to apply. A read-only query of `d1_migrations` confirmed:

| Migration | Applied at (UTC) |
|---|---|
| `0001_backend_foundation.sql` | 2026-09-29 13:45:21 |
| `0002_session3_fingerprint_and_birth_certificate.sql` | 2026-09-29 13:45:22 |
| `0003_session3_document_cleanup.sql` | 2026-09-29 13:45:22 |
| `0004_public_portal_document_policy.sql` | 2026-09-30 07:02:12 |
| `0005_document_scoped_application_notes.sql` | 2026-10-01 12:37:38 |

No migration was applied. The legacy `assignments` table remains present and untouched, as required.

## 5. R2 privacy and binding status

- Wrangler confirmed the staging bucket exists and the staging dry-run bound `DOCUMENTS` to that bucket.
- Public `r2.dev` access is disabled; no custom domain is connected.
- Bucket CORS is limited to the staging Worker origin and the methods/headers listed above.
- The bucket metadata showed two existing objects. Their keys and contents were not enumerated or accessed.
- The repository uses short-lived signed capabilities and opaque object keys. No live upload, finalize, signed GET, or direct-object fetch was performed; credential validity and end-to-end privacy therefore remain unverified.

## 6. Deployment result

- Official staging path: `npm run deploy:staging`.
- **Not executed.** The missing `STAFF_SHARED_USERNAME` makes the shared-staff path unavailable and would leave the Phase 8G Worker unable to authorize staff sessions. No Phase 8G deployment ID, Worker version, or deployed commit SHA exists for this session.
- `npm run deploy:dry-run:staging` passed and resolved the expected `goc-staging`, staging D1, and staging R2 resources. Wrangler ended with `--dry-run: exiting now`; it did not deploy or mutate resources.
- Legacy Vercel deployment remains outside the canonical Cloudflare deployment path. No Vercel settings were inspected or changed.

## 7. Live route smoke tests

Performed direct HTTPS GETs and browser navigation on the existing staging deployment:

| Route/resource | Result |
|---|---|
| `/` | 200; public landing page rendered. |
| `/basvuru/` | 200; five-step application wizard rendered; Continue remained disabled until required contact fields and acknowledgement are supplied. |
| `/basvurum/` | 200; tracking lookup rendered and direct reload succeeded. |
| `/yetkili/` | 200; login overlay rendered; no authenticated staff session was present. |
| `/api/staff/auth/session` without a cookie | 401. |
| Staff document download for a synthetic all-zero application UUID without a cookie | 401; no document content was returned. |
| Observed public and staff JavaScript/CSS assets | 200 on direct fetch; browser conditional reloads also returned expected 304 responses. |

The captured browser network trace for one `/basvurum/` reload had no `Network.loadingFailed` events or uncaught runtime exceptions: the route returned 200, cached JS/CSS assets returned 304, the no-owner-session tracking request returned 401, and the icon returned 200. Two console error entries corresponded to the expected no-owner-session response. No secret-bearing response was observed.

## 8. Public application, document, and submission UAT

- The public wizard page loaded, but no application draft was created. Autosave, owner-session persistence, validation beyond the initial disabled Continue state, and refresh/reopen of a draft were not exercised.
- No synthetic upload file was created or uploaded. Upload intent, R2 PUT, finalize, replacement/revision, and private-file authorization remain unverified.
- No application was submitted. Submission idempotency and invalid-submit behavior remain unverified.
- These workflows were not started because the end-to-end review path could not be completed without the required shared staff identity. This avoided leaving an orphaned draft or private test file in staging.

## 9. Tracking UAT

- Before the browser lookup, a read-only staging D1 count confirmed `PH8H-UAT-NOT-REAL-2026` matched zero student records.
- Submitted that synthetic identifier once through `/basvurum/`. The page returned the generic “no viewable application” result and disclosed no application or document data.
- The lookup did not create an application or file. A live existing-application lookup, owner-session actions, and resubmission view were not tested.

## 10. Shared staff login, review, and resubmission

- `/yetkili/` presented the login form and no authenticated session.
- Valid login, invalid username/password, cookie persistence, logout, protected queue/detail, document preview, approval, resubmission request, student replacement, and second review were **not executed** because `STAFF_SHARED_USERNAME` is missing and shared credentials were unavailable. No credentials were entered or guessed.
- Staff account-management and assignment workflows were not exposed on the unauthenticated page. Post-login absence of those controls could not be live-verified.
- No new state transition or authentication mechanism was added.

## 11. Legacy staff workspace smoke tests

- The unauthenticated staff shell and its main JS/CSS bundles loaded successfully.
- YKN, staff passport OCR, Kapak Hazırla, Tebliğ Bul, Belgeler preview/download, and post-login navigation were **not executed** because staff authentication was unavailable.
- Apps Script-backed YKN/Tebliğ requests were additionally blocked by missing `APPS_SCRIPT_URL` and `APPS_SCRIPT_API_KEY`. No YÖKSİS or other external university record was read or mutated. No Chrome extension interaction was attempted.
- These integrations are marked **NOT EXECUTED — authentication/configuration unavailable; external side-effect risk**.

## 12. Security findings

- Live unauthenticated staff session and synthetic document-download requests returned 401.
- Staging R2 public access checks showed `r2.dev` disabled and no custom domain. No private object was fetched.
- The browser reported no service-worker registration and no Cache Storage entries in the inspected session. `public/sw.js` also excludes `/api/`, `/yetkili/`, `/basvuru/`, and `/basvurum/` from its caching path; it precaches only the manifest, icon, and logo.
- A bundle scan found no staging secret variable names or common credential-pattern markers in `dist/client`. Actual secret values were not available for comparison and were not printed.
- Live IDOR across two real synthetic applications and live XSS rendering in persisted applicant/staff fields were not tested because no synthetic application was created. Existing local contract/security tests passed.
- No real student PII was used. No production resource was queried or changed.

## 13. Bugs, fixes, and validation

No confirmed staging code defect was found, so no source fix or deployment was made. The concrete blocker is missing staging configuration (`STAFF_SHARED_USERNAME`; also `APPS_SCRIPT_URL` and `APPS_SCRIPT_API_KEY` for their dependent legacy calls).

| Command | Result |
|---|---|
| `npm ci` | Passed; 95 packages installed, 0 vulnerabilities. |
| `npm test` | Passed: 352 passed, 0 failed, 0 skipped. |
| `npm run test:backend` | Passed: 124 passed, 0 failed, 0 skipped. |
| `npm run build` | Passed. Existing Vite `INEFFECTIVE_DYNAMIC_IMPORT` warning for `src/services/ocrService.js`. |
| `npm run build:staging` | Passed with the same existing Vite warning. |
| `npm run deploy:dry-run:staging` | Passed; expected staging bindings resolved; no deployment occurred. |
| `npm audit` | Passed; 0 vulnerabilities. |
| `git diff --check` | Passed. |

## 14. Limitations and remaining blockers before Phase 8I

1. An owner must securely provision `STAFF_SHARED_USERNAME` to match the authorized shared D1 account and ensure that account is securely provisioned. Do not send a password through source control or this report.
2. If Phase 8I includes Apps Script-backed YKN/Tebliğ verification, an owner must configure `APPS_SCRIPT_URL` and `APPS_SCRIPT_API_KEY` in staging through the approved secret mechanism.
3. After configuration, repeat the staging deployment gate and complete browser UAT for application creation/autosave, upload/finalize, submit, tracking, staff login, review, resubmission, and second review using only synthetic identities/files.
4. Complete live signed-R2 capability checks, two-synthetic-application IDOR checks, harmless XSS checks, and authenticated legacy-workspace smoke tests. Do not use real student data or mutate real YÖKSİS records.

Production remains untouched. No staging migration, R2 object mutation, Worker deployment, staff bootstrap, Apps Script call, or YÖKSİS interaction occurred.
