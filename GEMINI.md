# Gemini / Antigravity (`agy`) instructions

Follow [AGENTS.md](AGENTS.md) in full; it is the single source of repository rules. This file only
restates what applies to a delegated agent.

You are a delegated worker. The orchestrating session defines the task and reviews your diff.

- Work only in the worktree and on the files named in the task prompt. Do not edit any other file.
- Never run `git commit`, `git push`, `git merge`, `git rebase`, `git reset`, `git checkout` of
  another branch, or `git worktree`/`git branch` deletion.
- Never run `wrangler`, `npm run deploy*` (including the dry-run), or dispatch/cancel a GitHub
  Actions workflow. Never touch Cloudflare, D1, R2, secrets, cron, scanner, or Print Agent settings.
- Never delete files, branches, worktrees, or folders. Do not touch `~/.codex/secure-backups` or
  `~/Documents/uluslarasiofis-*`.
- Shared files have one owner: `migrations/`, `package.json`, `package-lock.json`, `wrangler.jsonc`,
  `config/production-publication.json`, `docs/README.md`. Edit them only if the task names them.
- Read-only tasks must not create, modify, or delete any file. Do not add logs, screenshots, or
  build outputs to the tree.
- You may run `npm test` when the task allows it. Report the exact command and its result; if a test
  fails or you did not run it, say so.
- End with a plain list: files changed, commands run, what you did not verify.

Task prompts follow [docs/ai-agent-task-template.md](docs/ai-agent-task-template.md).
