# Rollback compatibility rehearsal — 2026-10-24

Verified at 2026-10-24 15:23 UTC. No production writes, Worker deployment, or rollback were performed.

## Isolated rollback runtime

- Built commit `5434d4ca368d73db70858ddd471a33403bc9a5a6` in a temporary source copy and ran its full suite: 1,144 tests, 1,143 passed, 1 skipped, 0 failed.
- Applied migrations 0001–0031 to Wrangler's local D1 only. Wrangler reported no pending migrations. Worker bindings were all shown as local; production D1/R2 and secret values were not used.
- Local Worker returned HTTP 200 for `/` and `/basvuru/`. A synthetic application draft POST returned 201 (`draft`), and its owner-session reload returned 200. A fake, absent tracking lookup returned 200 with `found:false`.
- Inserted a synthetic transition-route row into the isolated D1, then queried it through the rollback Worker by student number. The lookup returned HTTP 200, found the case, and exposed the same eight required document codes as the candidate transition policy. The fallback labels it as renewal because the older UI has no transition label. The old Worker test suite includes passing resubmission API cases.
- The old Worker returned 404 for `/api/public/applications/privacy-notice`, which that pre-release source does not implement. A rollback therefore restores the pre-release student-number lookup and notice UX; it does not erase applications or documents. The new ITU-reference lookup and five-language notice are temporarily unavailable during rollback.

## Production cron and source provenance

- Read the active `goc` Worker schedules through Cloudflare's read-only schedules API. The actual schedules are `* * * * *` and `0 0 * * *`, matching both the reviewed production `wrangler.jsonc` and the rollback source configuration.
- `production-only-worker-cron-provenance-2026-10-23.json` ties the active `c0a250d6-4ef8-4eff-bd27-b40246b5a5f9` runtime module SHA-256 to the exact CI artifact for commit `8be47f394ca06080e7bc2426e0e0d8fd205b9b34`.
- Secret values were not read. Existing metadata review confirms 34 bindings with matching names, types, and non-secret values between active and rollback versions.

## Decision

Schema compatibility, live cron configuration, binding metadata, and the previous student application paths are evidenced. The technical rollback gate may pass for the pre-release fallback. This is not feature parity and does not establish live student UAT: rollback temporarily removes ITU-reference lookup and the privacy notice, and transition cases display with the older renewal label. Production D1/R2 data was not changed or restored during this rehearsal.
