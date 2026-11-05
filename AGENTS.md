# Production development and release policy

- The current clean workspace for new sessions is branch `codex/repo-hygiene-clean-workspace-20261105`
  at `/Users/kagansmtdms/Downloads/Проекты/uluslarasiofis-clean-workspace-20261105`. The older
  `/Users/kagansmtdms/Downloads/Проекты/uluslarasiofis-main` checkout is dirty and behind; do not
  use it as a new development or release source until its changes are individually reconciled. Keep
  existing worktrees for their current purpose; do not assume they are obsolete or interchangeable.
- If the current workspace is dirty or stale, use a separate clean worktree based on freshly fetched
  `origin/production` only when the user authorizes that workspace. At each new session, verify the
  actual Git root, branch, HEAD, `origin/production` SHA and ahead/behind count, worktree list, and
  pending tracked and untracked changes before editing. Preserve user changes; do not rely on an
  earlier session's snapshot.
- Never edit one working tree concurrently from multiple sessions. Parallel sessions use separate
  worktrees; review and integrate their changes explicitly before using them together.
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
