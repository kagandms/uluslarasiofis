# Production runtime secret metadata baseline

The preflight compares the complete set of Worker secret names against a checked-in baseline. Both name lists use default JavaScript string sorting (UTF-16 code units), independent of the runner locale. Incoming API order is irrelevant; an additional, missing, duplicate or renamed secret stops the preflight. Required print secrets must still have type `secret_text` according to `wrangler.jsonc`.

## Evidence for D1_ANALYTICS_API_TOKEN

- Commit [`9acc1d86116591be616e6083a030523bba65363e`](https://github.com/kagandms/uluslarasiofis/commit/9acc1d86116591be616e6083a030523bba65363e), an ancestor of production SHA `8703552dea1bc7529ba60f3fdd596944cf176458`, introduced the staff D1 usage counter and its production configuration.
- `src/server/services/d1-usage-metrics.js` uses this Worker secret to authenticate the Cloudflare GraphQL query for account-wide daily D1 rows read. `src/server/worker.js` exposes the counter only through the authenticated staff GET route `/api/staff/admin/d1-usage`.
- `wrangler.jsonc` already configures `D1_ANALYTICS_ACCOUNT_ID` under `env.production.vars`. `docs/d1-usage-counter.md`, added in the same historical commit, explicitly documents this production Worker secret and the required Account Analytics:Read permission.
- Production preflight [run 38774139721](https://github.com/kagandms/uluslarasiofis/actions/runs/38774139721) verified the exact 427-file artifact and then reported this additional secret name. Its assertion also exposed the different ordering of `PRINTER_SECRET` and `PRINT_R2_*` from mixed sorting methods.

These independent code, configuration, history and live name-metadata records justify adding this one name to the reviewed baseline. They do not verify the analytics token's value, permissions or current ability to query metrics. No secret values are needed for baseline validation.

## Next approved preflight

If the Worker still has exactly these 13 names and the required print secret types match, the runtime secret metadata check should pass regardless of API ordering or runner locale. Unreviewed future secrets still fail closed. Account/token identity, D1/R2 binding, configuration variables, cron, migration ledger, backup/restore and rollback compatibility checks remain in place. Passing the metadata check does not certify the remaining gates or authorize publication; the workflow's publication lock remains active.
