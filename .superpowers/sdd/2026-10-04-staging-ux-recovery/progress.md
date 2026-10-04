# SDD ledger — plan: docs/superpowers/plans/2026-10-04-staging-ux-recovery.md

Base: b2c1aa087c69c81614accceba65aa18a64cf40b8. Isolated branch: codex/staging-ux-recovery. Spec: docs/superpowers/specs/2026-10-04-staging-ux-recovery-and-application-deletion.md.

Pre-flight: Task 1 produces no interfaces consumed by other tasks; Task 2 archive schema/routes are independent of Task 3 scan queue; Task 4 documents library exists on base, so compare only. The only staging migration pending was additive `0010_application_deletions.sql`.

Completed: Restored approved applicant flow and staff UI; implemented archive → Silinen → restore/permanent purge lifecycle, with retry-safe R2 cleanup; added per-document PC ClamAV queue priority; confirmed the existing documents card/print layout is present on the selected base. Excluded deleted records from public student-number lookup and denied staff detail/file access while purge is pending.

Verification: `npm test` — 581 tests, 580 pass, 1 skipped, 0 failures. `npm run deploy:dry-run:staging` passed and listed only staging D1/R2 bindings. Applied `0010_application_deletions.sql` to `uluslarasiofis-staging`; subsequent migration list reports none pending. `npm run deploy:staging` succeeded (Worker `goc-staging`, version `a27e2d52-7c51-46b2-9d7b-d9e616a8e244`); public staging root returned HTTP 200. Actual ClamAV verdict still requires the PC runner to be online during manual UAT.
