# Phase 9 Consent Owner-Session Browser UAT

Date: 2026-10-02

## Starting point and staging preflight

- Requested source branch: `codex/phase9-consent-owner-session-uat`
- Requested source SHA: `2c3470576d5433433d829b70bb45a4a9e616335a`
- New task branch: `codex/phase9-consent-owner-session-uat-retry`
- The isolated worktree was created from the requested source SHA. The source branch still points to that SHA.
- `wrangler.jsonc` identifies staging Worker `goc-staging` at `https://goc-staging.topkapiuni.workers.dev`, with D1 `uluslarasiofis-staging` and R2 `uluslarasiofis-documents-staging`.
- Read-only `wrangler deployments list --env staging` showed Worker version `e40690bc-7644-488d-900c-d9f2c7320195`, the expected staging version. Read-only `GET /` returned HTTP 200.
- Static source review: `src/server/worker.js:145-146` routes consent PUT to `updateCurrentNotificationPreferences`; `src/server/routes/applicantNotificationPreferenceRoutes.js:55-74` validates owner session and same-origin request, reads/writes preference records, and returns the preference response. This path contains no provider call. Provider construction and dispatch are in the separate `scheduled()` handler at `src/server/worker.js:208-211`. No provider secret was read or listed.

## Browser session and stopping condition

- A separate Yandex Incognito window was opened and visibly identified by its Incognito title. Its staging `/basvuru/` page showed a blank new application form and no existing owner session. No real or synthetic applicant data was entered.
- The WhatsApp checkbox was visibly unchecked. After opening DevTools Network with Fetch/XHR selected and reloading the blank form, the visible request was `GET /api/public/applications/current` → `401 Unauthorized`; there was no consent endpoint request or consent PUT. No application creation request was sent.
- Creating a draft requires checking the separate statement: “İletişim bilgilerimin aktif ve ulaşılabilir olduğunu, bu bilgiler üzerinden bana ulaşılamaması hâlinde sorumluluğun bana ait olduğunu kabul ediyorum.” This is a responsibility declaration with potential legal effect. I stopped before accepting it or submitting the form. Therefore, no synthetic application was created, and there is no `application_id` or owner session to verify.
- No browser-control interruption or user activity was detected during this attempt. The stop was due to the required declaration, not a control interruption.

## Scenario results

| # | Check | Result | Observed evidence |
| --- | --- | --- | --- |
| 1 | Phone record completes before opt-in PUT | **NOT EXECUTED** | No draft, phone edit, or opt-in was attempted. The checkbox was unchecked on initial load; after a clean reload, Network showed the unauthenticated current-application GET returning 401 and no consent PUT. This does not verify phone-save ordering. |
| 2 | Opt-in GET in the same owner session confirms the same `application_id` and saved consent | **NOT EXECUTED** | No synthetic application or owner session was created; no consent was saved. |
| 3 | Refresh or page navigation preserves owner session and consent | **NOT EXECUTED** | No owner session or consent state existed to test. |
| 4 | Opt-out request sends only `{ "whatsapp_opt_in": false }` | **NOT EXECUTED** | No opt-out request was attempted. |
| 5 | Opt-out response confirms the same `application_id` and both `whatsapp_opt_in` and `effective_whatsapp_opt_in` are false | **NOT EXECUTED** | No application or opt-out response existed. |
| 6 | Refresh and repeat GET preserve opt-out state | **NOT EXECUTED** | No opt-out state existed to test. |

The consent staging acceptance remains open. This run verified the expected staging version, the blank form's default-off checkbox, the absence of a consent PUT before any selection, and the source-code separation between consent persistence and provider dispatch. It did not exercise an owner-session consent flow.

## Operation boundaries

- Worker deployment: **not performed**.
- Migration: **not performed**.
- D1 direct query or mutation: **not performed**.
- Dispatch setting, queue, or cron: **not changed or triggered**.
- Provider secret: **not read or listed**.
- Provider request or message: **not called or sent**.
- Production: **not accessed**.
- Applicant data: **no existing application accessed or modified; no application created**.
- Code: **not changed**.
- Changed file: this report only.

## Final verification

- `git diff --check`: PASS before commit.
- Commit patch whitespace check and final branch/SHA: recorded in the delivery summary after commit and push verification.
