# Production development and release policy

- Use one active project folder on `production`. On this Mac, it is
  `/Users/kagansmtdms/Downloads/Проекты/uluslarasiofis-clean-workspace-20261105`; other machines use
  their actual authorized repository folder. The old `uluslarasiofis-main` folder is preserved at
  its previous HEAD with unreconciled local changes; do not use it for development or release.
- Develop directly on `production`. Create another branch or worktree only when the user explicitly
  requests it. Sessions sharing this folder work sequentially; never write to the same worktree at
  once.
- At each session start, fetch `origin/production` and verify the actual Git root, branch, HEAD,
  ahead/behind state, worktree list, and tracked, staged, and untracked changes. Stop on unexpected
  divergence or dirty state; preserve user changes and do not rely on an earlier snapshot.
- Keep application sources and tests in the existing component directories. Link new operating guides from [the documentation index](docs/README.md).
- Dated plans and evidence must state their date, scope/source and validation status; treat them as historical by default.
- Do not add temporary logs, screenshots, or build outputs to Git by default. Retained fixtures, evidence, and delivery outputs must state why they are kept and how they were produced.
- A distribution package must identify its version and exact source SHA or source manifest/checksum.
- Run `npm test`, `npm run build:production`, and `npm run deploy:dry-run:production` before delivery.
  The dry-run is not a publication.
- After scoped local validation, create a reviewed commit and push it to `production` only if
  repository protection permits; never change protection or bypass it. Push and CI are separate
  from publication and do not deploy the Worker.
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
