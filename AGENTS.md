# Production consolidation policy

- Work on `production` in `/Users/kagansmtdms/Downloads/Проекты/uluslarasiofis-main`.
- Verify the Git root, branch, HEAD and working changes before editing. Preserve unrelated work.
- Do not create staging or feature branches for routine development unless the user requests one.
- Use `npm test`, `npm run build:production` and `npm run deploy:dry-run:production` before delivery.
- Deploy only when requested. The production target is `goc` via `npm run deploy:production`.
- Preserve production D1/R2 data, secret bindings, cron jobs, scanner integration, Windows Print Agent v7,
  `PRINT_ENABLED=true` and `PHYSICAL_INTAKE_MODE=on`.
- Staging configuration and historical worktrees are retained until the user's final deletion approval.
- Do not delete branches, worktrees, folders or Cloudflare resources without the corresponding final approval.
