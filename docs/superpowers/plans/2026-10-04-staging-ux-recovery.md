# Staging UX Recovery Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to execute this plan inline. Run each task test-first and keep the plan ledger current.

**Goal:** Bring the six approved application-flow changes and requested staff/archive/document UX to the feature-complete portal branch, then verify locally and deploy only to staging.

**Architecture:** Keep existing D1 application status and PC ClamAV queue contracts. Add reversible archive metadata and audited staff endpoints, preserve old document-card renderer if present, and port application/UI fixes selectively from the dirty deployed worktree. No production operations or real student data.

**Stack:** JavaScript modules, Cloudflare Worker, D1, R2, node:test, Wrangler.

**Spec:** `docs/superpowers/specs/2026-10-04-staging-ux-recovery-and-application-deletion.md`

## Tasks

1. **Restore and reconcile six applicant-flow changes** — DOB-based age, fingerprint helper, submission focus/time, new application/tracker lookup, server duplicate guard, truthful autosave and selectors. Add/adjust focused tests; run application wizard/tracking/API tests.
2. **Staff archive deletion lifecycle** — schema, D1 repository, authenticated APIs, archive filters, restore and admin purge UI/flow with retry-safe storage cleanup. Add repository/API/UI coverage and run focused tests.
3. **Manual PC scanner control and staff visual polish** — enqueue a selected document through existing real scanner jobs; show actual states, style actions. Add route/UI coverage and run focused tests.
4. **Documents library and visual regression checks** — confirm first screenshot card/print/preview/download layout and restore staff table burgundy styling. Run focused UI tests and build.
5. **Whole-branch verification and staging release** — run full local suite/build and staging dry-run; reconcile D1 migration history, apply forward-only staging migration, deploy only after all checks pass, then verify staging behavior without real student records.

## Review Focus

- Restore/purge authorization, foreign-key-safe purge order, R2 partial failure, and retry idempotency.
- Autosave does not claim success before a server-confirmed draft; no personal data is stored in browser storage.
- Scanner UI cannot claim clean before a real ClamAV verdict.
- Staging config only; production bindings untouched.
