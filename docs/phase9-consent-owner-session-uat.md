# Phase 9 Consent Owner-Session Browser UAT

Date: 2026-10-02

## Starting point and staging target

- Requested starting branch: `codex/phase9-consent-staging-acceptance`
- Requested starting SHA: `af0854eed8915fd01a2502a2abfb4d764e8d8d19`
- Task branch: `codex/phase9-consent-owner-session-uat`
- The new isolated worktree started at the requested SHA without changing it.
- `wrangler.jsonc` identified staging Worker `goc-staging`, URL `https://goc-staging.topkapiuni.workers.dev`, D1 `uluslarasiofis-staging`, and R2 `uluslarasiofis-documents-staging`.
- Read-only `wrangler deployments list --env staging` showed existing Worker version `e40690bc-7644-488d-900c-d9f2c7320195`; `GET /` returned HTTP 200.

## Browser session and synthetic application

Yandex Browser's separate Incognito window was opened and its title visibly identified it as an Incognito window. The staging `/basvuru/` page displayed a blank new application contact form; no existing application or owner session was shown. The WhatsApp consent checkbox was unchecked on initial load.

No application draft was created or persisted. Synthetic form entry was interrupted before pressing Continue, so there is no application ID to report. No real student or contact data was used. The browser control was interrupted during form entry; to avoid acting on a UI the user had taken control of, the remaining browser steps were not attempted.

## Scenario results

| # | Check | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Consent defaults off; no opt-in PUT before selection | **PASS** | In the new Incognito session, the blank form's WhatsApp checkbox showed unchecked. The initial load was observed in the Network panel with Fetch/XHR selected; no consent endpoint request appeared before any selection. |
| 2 | Phone persistence completes before opt-in PUT | **NOT EXECUTED** | No application draft was created and no opt-in was selected. |
| 3 | Same owner session can GET and verify stored consent | **NOT EXECUTED** | No owner-session consent was written. |
| 4 | Refresh/navigation preserves session and consent | **NOT EXECUTED** | No application session or consent state was created. |
| 5 | Opt-out sends only `{ "whatsapp_opt_in": false }` and confirms same-application effective false | **NOT EXECUTED** | No opt-out action was attempted. |
| 6 | Refresh/re-GET preserves opted-out state | **NOT EXECUTED** | No opt-out state was created. |

## Change and operation boundaries

- Worker deployment: **not performed**.
- D1 migration: **not performed**.
- D1 query or mutation: **not performed**.
- Dispatch setting, queue, and cron trigger: **not changed**.
- Provider secret: **not read or listed**.
- Provider API or message: **not called or sent**.
- Production: **not accessed**.
- Application code: **not changed**.
- Documentation: this report only.

The result is partial: only the default-off / pre-selection behavior was verified. The authenticated owner-session opt-in, phone-ordering, GET, opt-out, and persistence scenarios remain unverified.

## Final verification

- `git diff --check`: PASS after writing this report; the commit will be checked again after creation.
- Final task branch: `codex/phase9-consent-owner-session-uat`. The pushed HEAD SHA is recorded in the delivery summary.
