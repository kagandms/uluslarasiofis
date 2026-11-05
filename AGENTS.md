# Production development and release policy

- The routine development checkout is the `production` branch at
  `/Users/kagansmtdms/Downloads/Проекты/uluslarasiofis-main`. Do not create a branch or worktree for
  routine work. A user may explicitly authorize a task-specific candidate worktree; that exception
  does not change the routine branch policy.
- At every new session, before editing, verify the Git root, branch, HEAD, worktree list, and all
  existing changes. Fetch `origin/production` and compare its current SHA with the intended base.
  Preserve user changes; do not assume an earlier session's status is current.
- Run `npm test`, `npm run build:production`, and `npm run deploy:dry-run:production` before delivery.
  The dry-run is not a publication.
- Production Worker `goc` is published only by the GitHub Actions **Production release (manual)**
  workflow, from `production`, for the exact full SHA that equals current `origin/production`.
  Publishing also requires a separate, explicit user request for that SHA and operation, plus the
  configured Production environment review. Do not dispatch the workflow automatically.
- Before publication, verify the candidate checkout is clean, re-fetch and confirm the exact SHA,
  and reconcile the current active Worker version/source with the approved preflight. Stop if any
  identity or live-version check is uncertain. The workflow concurrency lock serializes only runs of
  that workflow; Dashboard, direct CLI, other automation, and other sessions are outside that lock
  and must be paused and checked separately.
- `npm run deploy:production` intentionally exits with instructions and does not publish. Keep
  `npm run deploy:dry-run:production`, tests, and builds available. This does not technically block
  raw `wrangler deploy` or another tool/session from publishing; do not claim a global deployment lock.
- Preserve production D1/R2 data, secret bindings, cron jobs, scanner integration, Windows Print
  Agent v7, `PRINT_ENABLED=true`, and `PHYSICAL_INTAKE_MODE=on`. Never bypass exact-SHA, artifact,
  concurrency, active-version, settings, or migration-ledger checks, and never change the release
  baseline to bypass a blocked migration.
- Staging configuration and historical worktrees are retained until the user's final deletion
  approval. Do not delete branches, worktrees, folders, or Cloudflare resources without that approval.
