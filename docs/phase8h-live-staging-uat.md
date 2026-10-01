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

## 15. Continuation pass — 2026-10-01

This pass continued from `7cc44d8852462ca7c947c821cfc5850ba58125f8` on `codex/phase8h-live-staging-uat`. The branch matched its upstream and the worktree was clean at the start. The intended owner-provided shared username/password were not present in the supplied request attachments or execution environment; no credentials were guessed or entered.

### Provisioning and staging configuration

- A read-only query against the verified staging D1 database returned **0 total staff records**, **0 active staff records**, and **0 bootstrap-state records**. This is the first-account bootstrap case. No D1 write or bootstrap request was made.
- The staging Worker secret-name list still does not contain `STAFF_SHARED_USERNAME`. No username value was available to configure. Existing secret values were not retrieved.
- `APPS_SCRIPT_URL` and `APPS_SCRIPT_API_KEY` remain unavailable. YKN/Tebliğ external calls are **NOT EXECUTED — external integration configuration unavailable**.
- Staging Worker, D1, and R2 identities were confirmed by the successful dry-run configuration resolution. No production resource was queried or changed.

### Deployment and live UAT status

- No real Worker deployment occurred. The required username/password were unavailable, so the Worker was not configured for the shared identity, first-account bootstrap was not attempted, and no deployed SHA, new Worker version, or deployment timestamp exists.
- Routes and live API behavior were not re-tested in this continuation; the route results in sections 7–8 are from the prior pass and the previously deployed Worker. The staging dry-run resolved `goc-staging`, `uluslarasiofis-staging`, and `uluslarasiofis-documents-staging`, then exited without deployment.
- Shared login (valid/invalid credentials, session cookie, refresh, logout), public draft/autosave, synthetic uploads, R2 signing/PUT/finalize/privacy, submission, tracking of a submitted synthetic application, staff queue/detail, private preview/download, approval, resubmission request, replacement upload, second review, IDOR across two synthetic applications, and persisted-field XSS checks were **NOT EXECUTED**. No synthetic application or object was created, so no cleanup was needed.
- Authenticated legacy staff workspace checks (Belgeler, Kapak Hazırla, staff OCR, YKN, Tebliğ, and extension UI) were **NOT EXECUTED** because no staff account could be provisioned. Apps Script external calls also remain not executed as noted above. No university/YÖKSİS records were accessed or changed.
- No new browser/network observation was made because no live deployment or authenticated workflow was started. No staging defect was confirmed; no source fix was made.

### Continuation validation

| Command | Result |
|---|---|
| `npm ci` | Passed; 95 packages installed, 0 vulnerabilities. |
| `npm test` | Passed: 352 passed, 0 failed, 0 skipped. |
| `npm run test:backend` | Passed: 124 passed, 0 failed, 0 skipped. |
| `npm run build` | Passed. Existing Vite `INEFFECTIVE_DYNAMIC_IMPORT` warning for `src/services/ocrService.js`. |
| `npm run build:staging` | Passed with the same existing Vite warning. |
| `npm run deploy:dry-run:staging` | Passed; resolved the expected staging Worker, D1, and R2 bindings; no deployment occurred. |
| `npm audit` | Passed; 0 vulnerabilities. |
| `git diff --check` | Passed. |

### Remaining completion blockers

The owner must provide the intended shared account values through a secure execution channel, or provision the account through the supported staging bootstrap flow and provide the username for login UAT. Until then, `STAFF_SHARED_USERNAME` cannot be safely configured, staging must not be deployed, and the required live application-to-second-review chain remains incomplete. Phase 8H is **NOT COMPLETE**. Production remains untouched; no D1 mutation, migration, R2 mutation, Worker deployment, bootstrap, Apps Script call, or YÖKSİS interaction occurred in this continuation.

## 16. Continuation pass — live staging UAT and final blocker (2026-10-01)

This continuation supersedes earlier continuation statements above where they say the supplied shared credentials were unavailable or that live draft/upload/submit UAT was not performed. The user-provided credential values were available through the designated environment variables, used only for staging provisioning and UAT, and never written to this report, source, or command output. The report records secret names and outcomes only.

### Shared staff provisioning and deployment

- The `STAFF_SHARED_USERNAME` Worker secret was provisioned to the intended staging Worker. `STAFF_BOOTSTRAP_TOKEN` was also present by name; its value was rotated to a fresh random value after the failed bootstrap attempt. Neither value is recorded here.
- Before bootstrap, a read-only staging D1 check showed 0 staff rows, 0 active staff rows, and 0 bootstrap rows.
- `POST /api/staff/auth/bootstrap` returned HTTP 500 `INTERNAL_ERROR`; no staff or bootstrap row was created. `wrangler tail` identified `NotSupportedError` from the Workerd WebCrypto PBKDF2 iteration limit: the repository's PBKDF2-SHA256 600,000-iteration hash cannot be calculated in this Workers Free runtime. A `node:crypto.pbkdf2` experiment hit the same runtime cap and was reverted. The configured Free plan's 10 ms CPU limit cannot be raised with `limits.cpu_ms`; an attempted staging-only 1,000 ms setting was rejected by Cloudflare with error 100328 and was removed along with its temporary test. No KDF weakening was retained.
- A Wrangler invocation combining `--env staging` and `--name goc-staging` briefly created an unintended empty Worker named `goc-staging-staging` with a random bootstrap-token secret. It was immediately deleted; a subsequent deployment-list request returned Cloudflare error 10007 (“This Worker does not exist”). No production or intended staging resource was changed by that incident.
- The canonical repository code was then deployed successfully to the intended `goc-staging` Worker with `npm run deploy:staging`. The active version is `ace8aa8d-f031-45a1-8ecb-772516537db4`, created `2026-10-01T18:52:05.519Z`, from repository SHA `7cc44d8852462ca7c947c821cfc5850ba58125f8`. Staging D1 and R2 bindings resolved to `uluslarasiofis-staging` and `uluslarasiofis-documents-staging`. Production remains untouched.
- Cloudflare documents a 10 ms CPU limit for Workers Free and custom CPU limits for paid plans; the Worker runtime issue documents the PBKDF2 cap observed here. The remaining bootstrap blocker requires an account/plan decision or a separately reviewed compatible authentication design. No account plan change was made.

### Public draft, document, submission, and tracking UAT

All application records and uploaded content in this pass were synthetic. The test PDF contained only `SYNTHETIC UAT FILE - NOT A REAL DOCUMENT` and was deleted from the local temporary path after use.

- A synthetic owner session created a draft, saved contact and fingerprint fields, and resumed the draft after refresh. Current-application and document-list calls returned HTTP 200; the initial application displayed 9 applicable document requirements.
- Attempting to continue without the required acknowledgement was blocked by the browser's native required-field message. The acknowledgement was then completed with synthetic test data; the declaration API returned HTTP 200. The interface identifies the declaration copy as not final legal/KVKK text.
- All 9 required categories accepted the harmless synthetic PDF: upload-intent returned 201, R2 preflight returned 204, direct R2 PUT returned 200, finalize returned 200, and subsequent document-list reads returned 200. D1 showed 9 document records, 9 finalized records, 9 `pending_scan` records, and 9 completed intents. The UI stated that the security scan was pending; no scan completion is claimed.
- Submit with all required documents returned HTTP 200 and the UI displayed `Başvurunuz gönderildi` / `Gönderildi`. An incomplete-submit attempt returned 409 with a missing-application/documents message. Repeating successful submit returned 409 `APPLICATION_NOT_SUBMITTABLE`.
- `/basvurum/` displayed the submitted synthetic application and all 9 documents as `İnceleme bekliyor`. A no-cookie tracking lookup returned HTTP 200 with a limited public DTO containing application type, timestamps, status, and student number, plus document code, label key, required flag, and status. The response did not expose storage keys, capabilities, presigned data, or filenames.
- Cross-owner IDOR check: two separate synthetic owner sessions each created a draft and could read their own current application. Owner B created a passport upload intent (201); owner A attempting to finalize B's intent received 404 `DOCUMENT_REQUIREMENT_NOT_FOUND`. B then removed the unused intent through the owner-session cleanup route (200, cleanup complete). No object was uploaded for this IDOR case.
- Anonymous requests to owner-session documents, staff session, and staff download with a synthetic application UUID returned 401. Public R2 `r2.dev` access is disabled and no custom domain is connected. A raw unsigned GET with the authorization query removed was blocked by browser CORS (`MissingAllowOriginHeader`); this does not establish the HTTP status. Finalize succeeded after Worker-side R2 HEAD verification, confirming object existence without exposing an object to an anonymous caller.

### Staff review, legacy workspace, and remaining live checks

- Staging D1 currently contains 3 synthetic applications: 1 submitted application with 9 documents and 2 drafts used for the cross-owner test. Staff users, active staff users, and bootstrap rows remain at 0. The unused IDOR upload intent was cleaned up. No supported application-delete route was identified, so the three synthetic application records remain in staging. No real student PII was used.
- Staff login, invalid-login behavior, session refresh/logout, queue/detail, document preview, approval, resubmission request, replacement upload, second review, and persisted-field XSS rendering remain **NOT EXECUTED**. The account bootstrap blocker prevented creating the first staff account. No XSS payload was submitted.
- Authenticated legacy workspace checks for Belgeler, Kapak, OCR, YKN, Tebliğ, and related controls remain unverified for the same staff-account blocker. Public YKN/Tebliğ calls are **NOT EXECUTED — external integration configuration unavailable** because Apps Script secrets are absent. No YÖKSİS or other university records were accessed or changed.
- Captured browser checks after the final deployment showed no console errors or uncaught exceptions in the captured diagnostics. Expected API statuses and the browser-native acknowledgement message are described above. The reloaded `/basvurum/` view still showed the submitted synthetic application.
- The final client bundle secret scan examined 217 files: 0 matches for the actual supplied credential values and 0 matches for the four checked secret-variable names. Only counts were emitted; values were not printed.

### Final validation and phase status

| Command | Result |
|---|---|
| `npm ci` | Passed; 95 packages, 0 vulnerabilities. |
| `npm test` | Passed: 352 passed, 0 failed. |
| `npm run test:backend` | Passed: 124 passed, 0 failed. |
| `npm run build` | Passed; existing Vite dynamic/static import warning for `src/services/ocrService.js`. |
| `npm run build:staging` | Passed with the same existing Vite warning. |
| `npm run deploy:dry-run:staging` | Passed; expected staging bindings resolved. |
| `npm run deploy:staging` | Passed; deployed the canonical source SHA and staging bindings stated above. |
| `npm audit` | Passed; 0 vulnerabilities. |
| `git diff --check` | Passed. |

No source fix was retained: the confirmed blocker is the runtime's inability to perform the existing 600,000-iteration PBKDF2 operation on the current Workers Free plan, and the attempted CPU-limit configuration is unsupported there. Production, schema, and migrations remain untouched. Phase 8H is **NOT COMPLETE** because first-staff bootstrap and the staff-side review/resubmission/second-review chain could not be completed. No Phase 8I work was started.
