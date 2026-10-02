# Phase 9 notifications core

## Scope and starting point

Implemented on `codex/phase9-notifications-core`, based on the tested Phase 8I staging-acceptance commit `acd5e51f4c0e1ec98614db7683650d1dc97ea382`. This work adds a local notification foundation and a staff detail panel. It does not deploy, migrate staging or production, change secrets, or modify public portal files.

## Behavior

- Staff reviewers and admins can preview an allowlisted template, explicitly enqueue it, inspect masked history, and request an eligible transient retry from an application detail.
- Recipients come only from the application record. Phone consent is set only through the authenticated applicant session endpoint and is bound to the current normalized phone fingerprint. Missing consent defaults to opted out. The staff API rejects recipient overrides.
- Notification, outbox, idempotency record, and enqueue audit are written in one D1 batch. Replaying the same key and payload returns the original result; reusing the key for a changed payload returns a conflict.
- Messages are fixed local strings in Turkish, English, Russian, Turkmen, and Arabic. They contain only a normal `/basvurum/` portal link and do not include passport/YKN data, document contents, internal notes, authority tokens, or signed URLs. These strings are not Meta-approved templates.
- Preview, enqueue, retry, and delivery-result audits record safe event metadata. History contains masked recipients and provider state, not message bodies or full recipients.
- Outbox claims use a D1 lease. Before provider I/O begins, the attempt is marked as potentially ambiguous. A crash before that marker can be reclaimed after lease expiry; a stale attempt marked as started becomes `unknown` and is dead-lettered rather than blindly sent again. Explicit transient failures retry with bounded backoff and a five-attempt limit. Opt-out, phone change, and template/status eligibility are rechecked before dispatch.
- Provider acceptance, provider-confirmed send, delivery, and read remain separate states. Queueing never reports delivery.

## Local validation

Migration `0005_notification_preferences_and_delivery_state.sql` is applied by the in-memory D1 test fixture. Tests use injected mock providers only. No provider credentials, live provider calls, or production consumer are configured. The applicant preference API is implemented, but its public consent UI is deferred with the public portal work. Email remains a disabled adapter contract; WhatsApp also reports disabled unless an internal provider adapter is explicitly supplied.

The archive workspace remains unchanged and read-only. No notification action changes application or document status.

## Checks

- `npm run test:backend`: 144 passed.
- `npm test`: 409 passed.
- `npm run test`: 409 passed; this invokes the same `test` script as `npm test`, so it is repeatability evidence rather than separate coverage.
- Focused notification and staff application UI suite: 30 passed.
- `npm run build`: passed. Vite reports the existing ineffective dynamic import warning for `src/services/ocrService.js`.
- `git diff --check`: passed.
