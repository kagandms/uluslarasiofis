# Delegated AI agent task template

Operating guide, not a dated record. Applies the delegation rules in [AGENTS.md](../AGENTS.md) and
[GEMINI.md](../GEMINI.md) when an orchestrating session hands work to another AI agent (Gemini CLI
is no longer supported for individual accounts; use Antigravity `agy`).

## Rules for the orchestrator

- Read-only tasks run in the main folder or a task worktree with `agy --mode plan`. Check `git status`
  afterwards; it must be unchanged.
- Write tasks run only in a separate worktree on a task branch, one writer per worktree, only after
  the user approved the task. The branch stays unmerged until the user decides it goes live.
- The agent never commits, pushes, publishes, or deletes. The orchestrator reviews the full diff
  (`git diff`, untracked files included), runs the checks, and only then commits if the user asks.
- Verify the agent's claims by reading the code or running a check; an agent report is not evidence.
- In headless `accept-edits` mode the delegated agent cannot run shell commands (execution is
  auto-denied and produces nothing), so tell it not to run any command and have the orchestrator
  run tests, build, and dry-run. Do not use `--dangerously-skip-permissions` to work around this.
- Pass the task prompt with `-p`. Example for a read-only review:

```bash
agy --mode plan --print-timeout 120s -p "<prompt from the template>"
```

## Division of labor (owner decision, 2026-11-14)

- The orchestrating Claude session (Opus or Sonnet) is the decision-maker and reviewer: it
  diagnoses precisely, writes targeted prompts using the template below, reviews the delegated
  agent's diff, runs checks, and sends concrete corrective directives back when the result is wrong
  or incomplete.
- The orchestrator does not write or edit product code itself while a task is delegated; the
  delegated agent (Hydrogen, Argon) implements and follows the orchestrator's directives.
- Reason: save Claude-side tokens and use the Gemini models for implementation work while the Claude
  model's judgment guards quality.
- Docs-only edits by the orchestrator are not product code, but should still be delegated when
  practical.

## Model policy (owner decision, 2026-11-14)

- Delegated sub-agents default to Gemini 4 Hydrogen (`--model gemini-4-hydrogen-high`, or `-medium`
  for lighter tasks).
- When Hydrogen's five-hour limit is exhausted, switch to Gemini 4 Argon (`gemini-4-argon-high`) until
  the Hydrogen window refreshes. Argon has its own weekly limit.
- Gemini 3.8 Flash ranks below both and below the orchestrator; use it only for trivial bulk reading.
- Before each delegated task run `agy -p "/usage"` and pick the model from the remaining limits. If a
  run stops with a quota error, do not retry on the same model; switch per the rules above.
- Do not use `/swarm`. The Claude/GPT models in `agy` draw from a separate quota group and are not
  part of this policy.
- The limits are an observed account state, not guaranteed: Google does not publish numeric caps and
  the docs do not state whether the IDE and `agy` share a pool.

## Prompt template

Copy, fill every field, delete unused lines.

```text
TASK TYPE: read-only review | write (approved by the user on <date>)
GOAL: <one sentence outcome>
WORKTREE / BRANCH: <absolute path> / <branch>   (write tasks only)
YOU OWN (may edit): <exact files or directories>
DO NOT TOUCH: everything else, especially migrations/, package.json, package-lock.json,
  wrangler.jsonc, config/production-publication.json, docs/README.md
CONTEXT: <relevant files to read first, links to docs, the bug or requirement>
DONE WHEN: <observable result, e.g. test X passes, behavior Y>
CHECKS YOU MAY RUN: npm test | <specific test file> | none
RULES: Follow AGENTS.md and GEMINI.md. No commit, no push, no merge, no branch or worktree
  changes. No deploy, no wrangler, no workflow dispatch. No deleting anything. Read-only tasks
  must not create or modify any file.
REPORT: files changed, commands run with results, anything not verified, open questions.
```

## Review checklist (orchestrator)

1. `git status` and `git diff` show only the owned files.
2. No shared file changed unless the task named it; no logs, screenshots, or build outputs added.
3. `npm test`, `npm run build:production`, `npm run deploy:dry-run:production` pass before delivery.
4. Findings were confirmed against the code or by running the example.
5. Commit or merge only on the user's explicit request; publication stays a separate request.
