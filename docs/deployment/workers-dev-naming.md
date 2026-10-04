# Workers.dev naming

Cloudflare Workers.dev account subdomain: `topkapiuni` (confirmed by the staging URL).

| Environment | Worker | Expected URL |
| --- | --- | --- |
| Staging | `goc-staging` | <https://goc-staging.topkapiuni.workers.dev> |
| Production | `goc` | <https://goc.topkapiuni.workers.dev> |

The production D1 and R2 resources were created empty on 2026-10-04 and are configured in `wrangler.jsonc`:

- D1: `uluslarasiofis-production`
- R2: `uluslarasiofis-documents-production`
- Worker name: `goc`

All 10 production D1 migrations are applied to the new empty database. The `goc` Worker is not deployed yet. Keep `goc-staging` online and separate. Do not deploy production until the production staff bootstrap token and required integration secrets have been securely provisioned and the owner approves the production readiness check.

The production bucket CORS policy is in `production-r2-cors.json`. Before accepting uploads, provision production-only R2 signing credentials (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY`), configure them as Worker secrets, and validate upload/finalize/download against the production origin. Configure only the integrations the office intends to use; staging secrets must not be copied into production.

Routes:

- `/` — public/student portal
- `/basvurum` — student tracking
- `/yetkili` — staff portal

Staff credentials are provisioned at runtime through the secure bootstrap flow and must never be committed.
