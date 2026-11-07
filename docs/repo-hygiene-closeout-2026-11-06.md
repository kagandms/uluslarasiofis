# Repository hygiene closeout

This is a workspace handoff, not a release procedure. The current source of truth is the freshly fetched `origin/production` commit. Since commit `c2e1c1d` (2026-11-06), development happens directly on `production` in the single active folder described in [AGENTS.md](../AGENTS.md); the earlier `codex/repo-hygiene-clean-workspace-20261105` branch is no longer the working branch. Other machines must use their actual authorized checkout and must not depend on this machine's path.

## Start each session

- Check the actual Git root, branch, HEAD, `origin/production` SHA and ahead/behind count.
- Check the worktree list and tracked, staged, and untracked changes before editing.
- Sessions sharing the active folder work sequentially and never write to it at the same time; create another worktree only when the user explicitly requests it.
- Review and integrate changes into production explicitly. Do not use old dirty workspaces as a development or release source until their files are individually reconciled.
- These instructions guide new sessions; they do not technically lock sessions already using an older checkout.

## Production publication

Production publication uses only the manual exact-SHA workflow and requires a separate explicit request for that SHA. Preserve the exact tested artifact and its checksums, verify the active Worker version and release record, and follow the current [manual release procedure](manual-production-release.md). A branch push or pull request is not a publication. The workflow lock does not include Dashboard, direct CLI, external integrations, or other sessions.

## Remaining follow-ups

These items do not block repository organization:

- Check whether any real Apps Script caller still omits `targetSheetName`; assess compatibility only if one exists.
- Decide the scope of the full application PDF and which identifier appears on the physical receipt.
- Verify the installed Print Agent version.
- Verify the live Worker source identity and external publication integrations.
- Review storage and retention policy separately.
- Make a separate archive or deletion decision for old worktrees, packages, and evidence.

As of the local reconciliation report dated 2026-11-06 and source SHA `065503ddb83dcc25e92554b10dc73ecc63eae1ec`, no production-missing behavior was established as requiring transfer. The report is kept in the user's local protection directory, outside this repository. This conclusion is limited to the inspected source SHA and does not mean all local files may be deleted.
