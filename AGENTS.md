# Production development and release policy

- Use one active project folder on `production`. On this Mac, it is
  `/Users/kagansmtdms/Downloads/Проекты/uluslarasiofis-clean-workspace-20261105` (task worktrees
  live beside it); other machines use their actual authorized repository folder. The old `uluslarasiofis-main` folder is preserved at
  its previous HEAD with unreconciled local changes; do not use it for development or release.
- Small, scoped fixes may be committed directly to `production`. A new feature, or any change that
  will take more than one session, uses a short-lived branch named for the task, created in its own
  git worktree next to the main folder. A task branch stays unmerged while it is developed and tested
  locally (`npm test`, `npm run build:production`, `npm run deploy:dry-run:production`). Only when the
  user decides it should go live is it merged into `production`, and the release workflow is then
  requested for that merge SHA. Only `production` is ever released: no feature branch is published,
  and two branches are never live at once. Merging is not publishing; publishing still needs the
  separate explicit request below. The live SHA is the one in the active Worker version's release
  annotation.
- Merge task branches into `production` with a merge commit. Do not squash or rebase-merge: the
  reviewed baseline anchor commit must stay an ancestor of `production` (see
  `docs/manual-production-release.md`) and either method can break that check.
- Several sessions or AIs may work at the same time only when each has its own worktree and branch.
  Never run two writers in the same worktree. At task start, state which files or directories the task
  owns and do not edit another task's files. Shared files have a single owner at a time:
  `migrations/` (new migration numbers collide), `package.json`, `package-lock.json`,
  `wrangler.jsonc`, `config/production-publication.json`, and `docs/README.md`. Git resolves any
  remaining conflicts at merge time; re-run the tests after resolving them.
- Other AI agents (for example Gemini) follow this same file. They may not commit, push, publish,
  dispatch workflows, or delete anything unless the user explicitly asks; the orchestrating session
  reviews their diff before it is committed.
- At each session start, fetch `origin/production` and verify the actual Git root, branch, HEAD,
  ahead/behind state, worktree list, and tracked, staged, and untracked changes. Stop on unexpected
  divergence or dirty state (a task branch that is simply behind `production` is expected);
  preserve user changes and do not rely on an earlier snapshot.
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
- Fast path for small, code-only fixes: when the user requests `operation=publish` directly for an
  exact SHA, the separate `preflight` run may be skipped. The `publish` run executes the same CI
  validation and the same protected checks (SHA binding, artifact, Cloudflare metadata, migration
  ledger, dry-run, active-version comparison) before its single deployment step and stops without
  publishing if any of them fails. The Production environment review and the explicit request are
  unchanged. Anything touching `migrations/`, `wrangler.jsonc`, D1/R2, cron, secrets, scanner, or
  Print Agent uses the full path: `preflight`, review of its evidence, then `publish`.
- Before publication, verify the candidate checkout is clean, re-fetch and confirm the exact SHA,
  and reconcile the current active Worker version/source with the approved preflight (on the fast
  path, with the same run's preflight steps). Stop if any
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
