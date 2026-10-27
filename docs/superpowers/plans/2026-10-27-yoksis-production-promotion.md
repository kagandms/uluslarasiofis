# YÖKSİS Audit and Single-PDF Production Promotion Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align staging and production with the YÖKSİS missing-document audit and ordered single-PDF workflow, while keeping “Başvuruma Devam Et” on a dedicated page outside the crowded homepage.

**Architecture:** Port only the YÖKSİS audit integration from the staging candidate onto the current production base; retain the PDF code already merged in production. Move cross-device continuation to `/basvuruya-devam-et/`, linked from the application tracking page, and preserve the owner-access API. Keep audit data transient and preserve extension origin/message boundaries. Publish the matching candidate to staging and through the guarded production workflow after checks and supervised staging acceptance.

**Tech Stack:** JavaScript modules, Manifest V3 extension, Node test runner, Vite, Wrangler, GitHub Actions.

**Spec:** [YÖKSİS audit design](../../yoksis-missing-document-audit-design-2026-10-23.md) and the approved [staging implementation plan](2026-10-25-yoksis-missing-document-audit.md).

## Global Constraints

- Do not alter the dirty primary checkout or unrelated optimization work.
- Keep YÖKSİS scanning read-only: no upload, delete, save, API, D1, R2, or persistent audit results.
- Preserve the existing single-PDF sequence and 9 MiB ceiling already merged in production.
- Keep the cross-device continuation flow and owner-session API; host the form on its own page and link to it from application tracking, not the homepage action group.
- Preserve drafts, submitted applications, and existing owner-session behavior.
- Keep real YÖKSİS DOM acceptance as an explicit release gate; synthetic fixtures do not prove authenticated live behavior.
- Use `npm test`, `npm run build:production`, and `npm run deploy:dry-run:production` before delivery.
- Deploy only through the guarded `production-release.yml`; do not approve or cancel another person's pending run.

## Review Focus

- An incomplete or virtualized YÖKSİS list must never be reported as fully scanned.
- A delayed selection or identity mismatch must not attach another student's data to a result.
- “Eksik Belge Bekliyor” with no readable document rows must be `Kontrol edilemedi`, not complete.
- Portal commands must remain restricted to the authorized staff page and YÖKSİS tab.
- Both environments must expose the same requested UI/features; production publication must use the reviewed merge SHA and pass the configured environment gate.

---

## File Map

- `ykn_eklenti-main/yoksis-document-audit.js`, `yoksis-document-audit-controller.js`: read-only DOM parsing and serial list scanning.
- `ykn_eklenti-main/{manifest,background,bridge,content,portal-security}.js`: scoped extension injection and correlated, allowlisted transport.
- `src/managers/yoksisDocumentAuditManager.js`, `src/staff/main.js`, `src/staff/home.css`, `src/ui/workspaceNavigation.js`, `yetkili/index.html`: staff-only launch panel and transient results.
- `scripts/package-extension.mjs`: include audit scripts in the downloadable extension.
- `test/fixtures/yoksis-document-audit/` and focused audit/package/security tests: synthetic behavior contracts.
- `docs/superpowers/plans/2026-10-27-yoksis-production-promotion.md`: coordinated feature and environment promotion plan.

## Tasks

### Task 1: Port the read-only audit with regression tests

- [ ] Add focused failing tests for queue completeness, identity-gated parsing, stop/restore behavior, safe text rendering, and extension origin boundaries.
- [ ] Run the focused tests and confirm they fail because the production branch lacks the audit.
- [ ] Port only audit-specific source and test hunks; exclude staging PDF/D1/UI work already merged or outside scope.
- [ ] Run focused tests, then `npm test`.
- [ ] Inspect the final diff for writes, storage, API calls, migrations, extra origins, and unintended “Başvuruma Devam Et” changes.

### Task 2: Production build and release review

- [ ] Run `npm run build:production`, `npm run deploy:dry-run:production`, and `git diff --check`.
- [ ] Verify no D1/R2 bindings, secrets, migrations, cron, print, or physical-intake settings changed.
- [ ] Open a production PR and merge only the reviewed exact head after CI passes.

### Task 3: Staging acceptance and guarded production publish

- [ ] Confirm the latest staging candidate and isolated extension package.
- [ ] With an authorized YÖKSİS session, verify a missing-document record, a no-missing record, queue order, identity matching, stop behavior, and form selection restoration.
- [ ] Publish the exact reviewed production merge SHA through the guarded workflow only after staging acceptance; retain Production environment approval.
- [ ] Verify the production Worker version and served assets after publication.

### Task 4: Move the public continuation entry point off the homepage

- [x] Remove the continuation CTA/form from the homepage action area.
- [x] Add a dedicated `/basvuruya-devam-et/` page with the existing credentials flow and locale support.
- [x] Link the dedicated page from the application tracking page and preserve `accessApplicationWithReference()` plus its endpoint.
- [ ] Release the same reviewed code state to staging and production after the acceptance and release gates pass.

## Self-Review

- Audit behavior, extension security, production validation, staging acceptance, and the separately requested continuation-button plan each have an owning task.
- Production deployment remains gated on live staging acceptance and the repository's protected environment approval.
- No database or infrastructure changes are part of this promotion.
