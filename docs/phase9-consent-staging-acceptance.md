# Phase 9 Consent Staging Acceptance

Date: 2026-10-02

## Scope and starting state

- Acceptance branch: `codex/phase9-consent-staging-acceptance`
- Acceptance base: `b29f1d5a6fb848912decf3b5f3d9fe3fae1c911c` (`codex/phase9-10-consent-integration`)
- The integration branch matched the requested SHA after `git fetch origin`; it was clean and descended from base `fba153c1f34d76555b76bdef920fc9ce26a07f46`.
- Work was isolated in a new worktree. Source worktrees and branches were not changed.
- Application code was not changed. This acceptance report and a stale verification note in `docs/phase9-public-consent.md` are the only intended tracked changes.

## Staging target and migrations

`wrangler.jsonc` and the staging deploy output identified Worker `goc-staging`, URL `https://goc-staging.topkapiuni.workers.dev`, D1 `uluslarasiofis-staging` (`8f034e90-17fc-43d7-aa5d-125571019612`), and R2 `uluslarasiofis-documents-staging`.

Before migration, `wrangler d1 migrations list uluslarasiofis-staging --remote --env staging` reported only:

- `0006_notification_preferences_and_delivery_state.sql`
- `0007_notification_provider_webhook_events.sql`

Both pending migrations were applied through `npm run db:migrate:staging`. The same read-only migration-list command then reported `No migrations to apply`. No application records were queried or modified.

## Build and deployment

- `npm run build:staging`: PASS. Vite emitted the existing `INEFFECTIVE_DYNAMIC_IMPORT` warning for `src/services/ocrService.js`; the build completed.
- `npm run deploy:staging`: PASS. Wrangler confirmed the staging D1 and R2 bindings and deployed Worker `goc-staging` at the URL above.
- Deployed Worker version: `e40690bc-7644-488d-900c-d9f2c7320195`.
- `GET /`: HTTP 200.
- No dispatch-enablement action was taken, no queue or cron trigger was added, and no provider request or message was sent. The deployment's listed environment bindings did not include `NOTIFICATION_DISPATCH_ENABLED`; provider secrets were not read or listed. Existing secret configuration was not inspected, so this acceptance does not claim a live dispatch-state check.

## Live consent acceptance

An unauthenticated GET to `/api/public/applications/current/notification-preferences` returned HTTP 401 without application data. This confirms the anonymous owner-session boundary only.

The staging browser session was not safe to reuse for a new synthetic application, and browser control was interrupted before a separate clean session could be established. No existing application was modified. The following end-to-end checks are therefore **NOT EXECUTED**:

1. New synthetic application has WhatsApp consent unchecked by default; no opt-in is sent before selection.
2. Selecting opt-in waits for phone autosave before sending consent PUT.
3. Owner-session GET confirms the saved consent for the same synthetic application.
4. Refresh/navigation preserves the application session and consent view.
5. Opt-out sends only `{ "whatsapp_opt_in": false }` and validates stored/effective false against the same application.
6. Refresh/re-GET preserves the opted-out state.

The local mock-browser script is not counted as live staging evidence. The anonymous GET check is **PASS** (HTTP 401); authenticated consent GET/PUT and persistence remain unverified.

## Verification and remaining gates

- `npm run test:backend`: PASS, 162/162.
- `npm test`: PASS, 464/464.
- `npm run build:staging`: PASS, with the warning noted above.
- `git diff --check`: PASS after the report edits. The integration commit's post-integration `git diff --check` result is also recorded as PASS in `docs/phase9-public-consent.md`.
- No application-code changes were made.

This is a partial staging acceptance because authenticated browser/API consent flows were not executed. It does not complete Phase 8H, whose scanner-dependent acceptance remains open. Provider credentials, approved templates, webhook setup, real message delivery, production access, and production changes are outside this acceptance.
