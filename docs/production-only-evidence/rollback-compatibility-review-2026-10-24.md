# Production rollback review after D1 migrations 0028–0031

Reviewed at 2026-10-24 14:53:58 UTC, after applying migrations 0028 through 0031.

- Production migration ledger has no pending migrations; aggregate checks show zero transition-route application rows.
- The active Worker remains `c0a250d6-4ef8-4eff-bd27-b40246b5a5f9`; Cloudflare reports its source as `Unknown`.
- The prior passed rollback review covered the schema only through 0027 and does not establish compatibility with the current schema.
- The known rollback Worker does not implement transition-route behavior. No transition-route applications may be accepted until a reviewed Worker and rollback path are confirmed.
- No post-migration compatibility proof was established for schema, runtime secrets, bindings, or cron schedules. The compatibility gate therefore remains NOT VERIFIED and blocks Worker publication.
- No Worker deployment, rollback, or production data restoration was performed.

## Follow-up inspection at 2026-10-24 14:59 UTC

- `wrangler versions view` confirms both known versions still expose 34 bindings. Binding names, types, D1/R2 identifiers, and non-secret text values match; secret values were not read. Their script ETags differ.
- The preserved `5434d4c` rollback artifact's source map shows no references to `application_route`, transition fields, or `academic_year_start_date`; its document policy reads `display_order`. The new route columns default to `standard`, and the artifact does not implement transition-route behavior.
- This is static compatibility evidence only. The rollback Worker was not run against the post-0031 restored database, and the active `c0a250d6` Worker source still cannot be tied to a reviewed commit/artifact. The schema/rollback gate remains NOT VERIFIED.

## Active version refresh at 2026-10-24 18:51 UTC

- Cloudflare's production deployment history shows version `4e83065f-a92f-45c2-82b5-a873aa94c478` active at 100%, with message `release:14c944e3235b40789bc80b76d5e08d5b33e5f6f0`. The dashboard lists its source as API.
- Protected workflow run [40112775368](https://github.com/kagandms/uluslarasiofis/actions/runs/40112775368) built and verified exact commit `14c944e3235b40789bc80b76d5e08d5b33e5f6f0`; its artifact is ID `12566993954`, archive SHA-256 `6982d5e5ace7dacd6154be398bd60108ab84d6b778f5c816d6cc90bc3a03c044`, and runtime module SHA-256 `0505900a1424965d0d8e9528be78c8e94d2fa3ea38714ea82f9b9ba5aeaa8f9a`. The staged version ID matches Cloudflare's active version ID.
- The release run's final active-version API check returned HTTP 404 after staging, so the workflow ended as failed/uncertain. The subsequent Cloudflare deployment history now confirms the exact staged version is active; no inference from Git HEAD alone was used.
- The last successful schedule read (2026-10-24 18:37 UTC) returned `* * * * *` and `0 0 * * *`. They match the current active release's old configuration and the reviewed rollback source; the four reduced schedules remain a separate pending release change.
- D1 ledger, D1/R2 bindings, runtime secret names/types, and exact artifact dry-run passed in run `40112775368`. Secret values, student rows, and production data were not read or changed. The rollback rehearsal remains the isolated-local-D1 test recorded in `rollback-runtime-rehearsal-2026-10-24.md`.
