# Phase 9–10 integration hardening

## Branch and merge

- Integration branch: `codex/phase9-10-integration-hardening`
- Phase 9 base: `c59e56ccc68cb9680fa764b0213b83703bb4aac8`
- Merged Phase 10 public commit: `617e4f0281c0ee2b6b4d177631fc921ecd083c4d`
- Merge commit before this report and implementation: `36543111e881ab15c6502c26f5f03fb7f957c177`
- Both feature branches and the starting checkout were left unchanged. The untracked Phase 8H scanner design draft remains in its original worktree.

## Implemented

- Staff notification history is an authenticated, read-only GET and no longer requires an `Origin` header. Preview, enqueue, retry, and consent writes still enforce same-origin checks.
- Consent GET and PUT responses now include the application ID, current consent version, effective opt-in, re-consent requirement, and current-phone opt-in availability. Stored consent remains visible separately; the phone hash is never returned.
- A stale consent version blocks both a new staff enqueue and an already queued provider dispatch.
- Staff notification preview responses are ignored after their selection changes. A successful enqueue is reported independently from history refresh; history has its own retry action. Enqueue stays locked during the request, preserves its idempotency key after ambiguous failures, and requires a fresh preview before another deliberate send.
- The Meta adapter uses the fixed `graph.facebook.com` host and the documented phone-number `/messages` endpoint. It sends only an institutionally mapped template name and locale; no client message body or destination URL is accepted. Provider acceptance remains distinct from delivery. Incomplete credentials or an empty approved-template map leave it unavailable; HTTP 5xx and transport ambiguity are never blindly retried.
- `/api/webhooks/whatsapp` supports the subscription challenge and bounded raw-body POSTs signed with `X-Hub-Signature-256`. It checks the configured phone-number ID, rejects unknown provider message IDs, deduplicates status events, and only advances provider status. It stores neither message text nor student phone numbers in webhook audit metadata.
- A scheduled consumer entry point is present, but is gated by `NOTIFICATION_DISPATCH_ENABLED === "true"`, requires a configured adapter, and processes at most five notifications per invocation. No cron trigger was added; dispatch remains disabled by default.
- The pre-existing document-notes migration retains version `0005`. The colliding notification migration is now `0006`; webhook idempotency storage is `0007`.

The adapter shape follows Meta's [WhatsApp Cloud API collection](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api), including the template request to `/{Version}/{Phone-Number-ID}/messages`. Raw-body signature verification and the `hub.challenge` handshake follow Meta's [Cloud API SDK webhook reference](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/webhooks/start/). No provider request was sent during this work.

## Local D1 migration verification

Wrangler `4.143.0` was run with separate temporary local D1 persistence directories and temporary configs; neither the project D1 state nor a remote database was used.

- Upgrade path: applied migrations `0001`–`0005`, inserted synthetic application, document, revision, note, and audit rows, then applied `0006` and `0007`. All five baseline rows remained present; migration history recorded one `0005`, one `0006`, and one `0007`.
- Clean path: applied all seven migrations. The D1 migration ledger contains seven rows, the new webhook table is queryable, and `wrangler d1 migrations list` reports no pending migrations.
- Reapplying the upgrade migrations reported no migrations to apply. The repository migration contract test also checks unique numeric versions and the retained `0005` filename.

## Verification results

| Command | Result |
| --- | --- |
| `npm run test:backend` | PASS, 162 tests; includes notification API, provider, webhook, migration, and dispatch-consumer tests |
| `npm test` | PASS, 437 tests |
| `npm run build:staging` | PASS; Vite emitted the existing `INEFFECTIVE_DYNAMIC_IMPORT` notice for `src/services/ocrService.js` |
| `git diff --check` | PASS |

## Remaining institutional setup and acceptance

- Supply the Meta phone-number ID, current Graph API version, access token, webhook app secret, and verification token through the institution's approved secret/configuration process.
- Map each enabled internal template and language to a reviewed, approved Meta template; confirm remote wording and locale match the staff preview before enabling dispatch. Email remains disabled.
- Configure the Meta webhook subscription and callback after deployment, then run a controlled live send and verify signed delivery/read callbacks. Enable the dispatch flag and any trigger only after that institutional review.
- Deployments, staging/production migrations, secrets, provider sends, live D1/R2 changes, scanner state, and browser acceptance were not performed. Phase 8H scanner-dependent acceptance remains pending.

## Public WhatsApp consent integration — 2026-10-02

- New integration branch: `codex/phase9-10-consent-integration`, created at exact base `fba153c1f34d76555b76bdef920fc9ce26a07f46`.
- Merged source: `antigravity/phase9-public-consent-hardening` at `3ffb734ee9387601a34cf26b5a6f2b18948cecf3`; `git merge-base` equals the base SHA. Both source branches and their clean worktrees were left unchanged.
- Consent API contract review: owner-session GET/PUT uses the current session application ID; response metadata matches the UI contract. Missing/broken metadata never establishes effective opt-in or success. Unsupported current text blocks new opt-in while a stored opt-in remains revocable. Opt-out sends only `{ "whatsapp_opt_in": false }` and requires matching application identity plus explicit false stored/effective values before success.
- Public student-number lookup does not call the preference endpoint. Initial-draft preference failure stays visible and its retry reuses the existing application. Phone persistence completes before an opt-in PUT; a detected phone edit during autosave prevents the PUT. The temporary phone lock is client-side ordering only, not a distributed Worker/D1 concurrency guarantee; opt-out leaves the field unlocked.
- Added two UI regression cases for phone unlock after rejected consent PUT and no phone lock during opt-out. No production application source correction was indicated by the review.
- `node --test test/notificationPreferencesUi.test.js`: PASS, **27/27** consent UI cases.
- `npm run test:backend`: PASS, **162/162** backend cases, including `notificationApi.test.js`; this command does not include the browser UI test file.
- `npm test`: PASS, **464/464** across the full repository test glob, including the consent UI tests.
- `node scripts/check-public-consent-browser.mjs`: PASS on a local headless Puppeteer/Chromium browser backed by a local mock API (20 viewport/locale combinations plus opt-in/opt-out, tracking, public lookup, and home-page checks). This is not live Cloudflare acceptance.
- `npm run build:staging`: PASS; the existing `INEFFECTIVE_DYNAMIC_IMPORT` warning remains for `src/services/ocrService.js`.
- These checks do not perform a real WhatsApp send or live Cloudflare test. Live staging consent GET/PUT, approved-template configuration, provider/webhook delivery, and owner-reviewed acceptance remain outstanding. No deploy, migration, secret change, production access, real WhatsApp message, or scanner-state mutation was performed.
