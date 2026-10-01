# Workers.dev naming

Cloudflare Workers.dev account subdomain target: `topkapiuni`.

| Environment | Worker | Expected URL |
| --- | --- | --- |
| Staging | `goc-staging` | <https://goc-staging.topkapiuni.workers.dev> |
| Production | `goc` | <https://goc.topkapiuni.workers.dev> |

The account-level `workers.dev` subdomain must be configured externally in Cloudflare. Production Worker configuration must wait until real production D1 and R2 resources exist. No production resource identifiers are configured in this repository.

Routes:

- `/` — public/student portal
- `/basvurum` — student tracking
- `/yetkili` — staff portal

Staff credentials are provisioned at runtime through the secure bootstrap flow and must never be committed.
