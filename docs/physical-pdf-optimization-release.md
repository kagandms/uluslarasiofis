# Production PDF image optimization

Released on 2026-10-09 to Worker `goc` from commit `73272a0` on `codex/physical-intake-production-port`.

Deployment ID: `d7e666a0-3cb0-4591-9c91-6cf01703a0b9`.

Worker version: `e01ffdfb-1a4c-4205-8f68-ccd15d629a2e` at 100%.

Large JPEGs above 1 MiB are now encoded at the existing 0.84 quality setting. Images within the existing 3508-pixel long-edge limit keep their dimensions and use the compressed result only if it is smaller. Small JPEGs pass through unchanged. Oversized image resizing and PNG conversion retain their previous behavior. Existing PDF pages are copied without rasterization or recompression. The merger UI is unchanged.

## Validation

- Full Node suite: 749 passed, 0 failed, 1 skipped; includes 9 new image optimization tests with mocked browser encoding boundaries.
- Production build and Wrangler dry-run passed.
- Live `/assets/optimize-document-image-D7w7IXml.js` SHA-256 equals the built asset.
- Main, staff, application, print and phone pages returned HTTP 200.
- Anonymous QR creation, physical query and staff online query returned HTTP 401; invalid phone claim returned HTTP 410.
- All non-asset Worker bindings, variables, secret binding metadata and cron expressions match the pre-deploy version.
- `PHYSICAL_INTAKE_MODE=on` and `PRINT_ENABLED=true` retained.
- Public print status and Print Agent/scanner heartbeat records match the baseline. Those heartbeat records remain stale; this is not evidence of current device health.
- No migration, data restore, new scanner infrastructure or staging operation was performed.
- Real-document byte savings, visual readability and real-phone upload remain user validation steps; unit tests do not measure browser JPEG quality.

## Verification correction and rollback

The initial verification compared cron metadata including `modified_on`, which deployment legitimately updates. It automatically restored the previous version. Inspection confirmed both actual cron expressions were unchanged (`* * * * *`, `0 0 * * *`). Verification was corrected to compare cron expressions, the same uploaded optimization version was published again, and all checks passed.

Fast rollback restores the preceding production ON version, preserving online/print and physical access:

```sh
npx wrangler versions deploy 5975e7d3-3881-476c-a4c6-13dfe79b9a0c@100% --env production --yes --message 'Rollback PDF image optimization'
```

Private pre/post Worker, binding, schedule and health snapshots are stored under `~/.codex/secure-backups/physical-image-20261009T044148Z/`. Secret values were not read or rotated.
