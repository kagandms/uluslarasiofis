# Physical intake live

**PHYSICAL INTAKE LIVE — READY FOR USE**

Production Worker: `goc`. Physical gate: `PHYSICAL_INTAKE_MODE=on`. PRINT_ENABLED remains true.

Deployment ID: `3440c2f9-97e4-48d6-8f9a-803f7f5fb175`.

Worker Version ID: `5975e7d3-3881-476c-a4c6-13dfe79b9a0c`.

The change is exactly one production configuration value, off → on. The live Worker script ETag is identical before/after. All other plain-text settings, secret/D1/R2 bindings and cron schedules match. Existing Print Agent/scanner code/tasks and staging resources were not changed. No new UAT mechanism, scanner queue/service or clean-verdict requirement was added.

Migration 0018 was verified ALREADY_APPLIED_SKIP; no migration was rerun. Existing server authentication still admits only active verified reviewer/admin staff sessions to physical intake and QR creation. Student sessions do not supply the required staff cookie. QR lifetime, one-use claim, owning-PC binding, private R2 access, file validation and size limits are unchanged.

## Checks

- Operator confirmed the QR code appears in the authenticated production staff panel. This verifies the normal live staff QR creation flow through the UI; no candidate hash or Console action was used.
- Anonymous physical query and QR creation: HTTP 401 UNAUTHORIZED.
- Invalid phone claim: HTTP 410 TRANSFER_EXPIRED; no phone authority granted.
- Main, staff, online application, print and phone pages: HTTP 200.
- Existing authentication/QR tests: 24 pass, 0 fail. Production build/dry-run: passed.
- Print status is identical before/after, available=false. Existing Print Agent/scanner records remain the same stale ready records; these were not presented as current healthy heartbeats and did not block activation.
- Real phone camera/gallery file delivery remains the user's next test. No real student record or document was created by these checks.

Normal path: staff panel → İkamet Başvuruları → Fiziksel → PDF editor → Telefondan ekle (QR). Scan the QR on the phone, choose camera/gallery and send; the image should arrive at the same PC. QR access expires after 15 minutes; create a new QR if needed. No physical antivirus/Windows-agent operation is required.

If a physical-specific problem is reported, set only PHYSICAL_INTAKE_MODE=off and publish the same code/settings. Preserve PRINT_ENABLED=true and all other resources. The preceding gate-OFF Worker version is `28dcac23-abb7-446c-9c7d-f0889a5c627f` with the same script ETag and protected bindings. No database restore/down migration is part of a gate rollback.
