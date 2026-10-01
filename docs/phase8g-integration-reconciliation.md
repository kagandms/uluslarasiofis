# Phase 8G — Integration Reconciliation

## Comparison baseline

- Reconciliation base: `31ba7bd129d69914500fbd94be698c30a6eaa7a6`
- Canonical Phase 8F starting commit: `ecb018b4eee9e2f632411f7b128b1633419e9f22`
- Main tip inspected: `9d055bf4f9f0e723bae2762d31d18c6395ed01ca`
- Main-only commits: 44
- Phase 8F-only commits: 32
- Main changed 57 files from the base (`+12,291 / -4,472`); Phase 8F changed 145 (`+22,174 / -2,027`). Applying all of main to Phase 8F would remove or replace much of the Worker, public portal, migration, and test architecture, so no merge or bulk cherry-pick is appropriate.

The matrix classifies every commit reachable only from `origin/main`. “Selected” means its scoped user-facing behavior or static assets are restored in the Phase 8G branch. Static residence and office PDFs are copied byte-for-byte; product policy text and PDF contents are not edited.

| Commit | Main-only change | Decision and Phase 8G treatment |
|---|---|---|
| `f696053` | Prevent duplicate acceptance-code transfer | Superseded by Phase 8F request correlation, single-flight guards, and YÖKSİS contract tests. |
| `973f88c` | Clear document-byte cache between students | **Selected.** Clear the cache in `resetStudentActions()` and assert the next student cannot reuse prior document bytes. |
| `ec21256` | Refresh YÖKSİS tab per student | Superseded by the current fresh-search/form readiness flow; do not reintroduce forced tab refresh. |
| `f42bd7f` | Preserve YÖKSİS form state without reload | Superseded by Phase 8F form readiness and reset behavior. |
| `aafeb73` | Handle delayed YÖKSİS form handoff | Superseded by the existing delayed-readiness contract and tests. |
| `e0b3bb2` | Repackage/rename the YKN extension | Excluded: replaces the maintained extension layout and removes Phase 8F security modules and regression tests. |
| `08d10a7` | Rework YKN portal into two primary actions | Superseded by the maintained Phase 8F staff YKN workspace. |
| `355679e` | Hide YKN actions until a student is found | Superseded by the current student-action state handling. |
| `68b562b` | YKN button placement and cache changes | Superseded; the cache lifecycle is handled by the selected narrow reset fix. |
| `452f144` | Open passport cropper in the portal page | Superseded by the current cropper module and staff workflow. |
| `4812c32` | Improve multilingual passport place/authority parsing | Superseded by the maintained parser and current Russian, Arabic, and multilingual coverage. |
| `5dab6c7` | Prioritize first-page rendering and OCR with legacy PDF.js | Excluded: tied to the old extension/package runtime and cache design. |
| `04d35f0` | YÖKSİS radio selection and multilingual fields | Not needed for this integration baseline; it does not justify importing the old extension implementation. |
| `e067d01` | Expand authority parsing | Superseded by the maintained parser and its current tests. |
| `06b4450` | Expand passport date parsing | Superseded by the maintained parser and current date-sync coverage. |
| `1869e65` | Backup commit for parser improvements | No distinct behavior to port; parser improvements are already represented by the maintained implementation. |
| `e5f4df9` | Add background YKN polling and automatic status checks | Excluded: introduces automatic external polling outside the requested baseline. |
| `799728a` | Fix YKN initialization temporal-dead-zone error | Superseded by the current manager initialization and interaction tests. |
| `2564e75` | Add and edit missing passport fields | Superseded by the current passport fields and YÖKSİS synchronization flow. |
| `5f4f920` | Add marital-status controls and synchronization | Excluded: adds an unsupported field and new external form behavior. |
| `16e2458` | Fix passport cropper initialization | Superseded by the current cropper startup path. |
| `61c8bf4` | Synchronize edited dates and clear warnings | Superseded by the current date handling and transfer tests. |
| `edda170` | Refresh marital-status UI after OCR | Excluded with the unsupported marital-status feature. |
| `052d59c` | Expand gender/marital-status synchronization | Excluded with the unsupported marital-status feature. |
| `61a1de3` | Add radio fixes and hard-code Pakistan authority | Excluded: the country-specific authority behavior is unverified; preserve the tested Türkmenistan `SMST` fallback. |
| `32c0e4a` | Reset YÖKSİS tab for repeated searches | Superseded by current repeated-search state handling and fresh-form guards. |
| `3a72c93` | Reset YÖKSİS with the site's Clear button | Superseded by Phase 8F clear/reset behavior. |
| `bbd9978` | Change the version badge | Superseded by the Phase 8F branch's version/configuration baseline. |
| `b63a555` | Add Belgeler workspace and five office PDFs | **Selected.** Restore the staff-only workspace in `/yetkili/` and render with safe DOM APIs. The general office PDF assets remain public, as on `main`; they are not applicant documents. |
| `b54f774` | Remove obsolete YÖKSİS buttons | Already absent from the Phase 8F UI. |
| `f82ad83` | Automatically switch to YÖKSİS after transfer | Excluded: changes existing staff workflow navigation beyond the required reset fix. |
| `77935bf` | Address consecutive-student reset race | Superseded by the maintained transfer orchestration and repeated-student contracts. |
| `56b4492` | Add the residence/identity application checklist PDF | **Selected.** Restore the exact existing PDF as a static office document; do not revise its policy content. |
| `722acf2` | Add a live clock to the header | Excluded as unrelated UI scope. |
| `aa00503` | Refine Belgeler titles and preview cards | **Selected.** Restore the searchable, responsive document-card experience with local preview and download links. |
| `bbe6b2e` | Fix second-student clipboard and form transitions | Superseded by the current repeated-search and correlation-ID tests. |
| `44e35c7` | Add two office documents and ordering | **Selected.** Restore both original static PDFs and catalog entries. |
| `5ed8930` | Add the ninth office document | **Selected.** Restore the original PDF and catalog entry, preserving all nine source files. |
| `14f4d36` | Let browser call Apps Script directly for mark/unmark | Excluded: bypasses the maintained server-side credential boundary. |
| `4c11dda` | Add optimistic mark/unmark UI around direct calls | Excluded: depends on the excluded direct-mutation path and legacy client. |
| `1e4b5ee` | Change legacy Vercel password/JWT configuration | Excluded: unrelated to the Cloudflare Worker auth model. No secret values are copied or repeated. |
| `0f14bbb` | Change legacy Vercel password environment precedence | Superseded by current Worker-backed staff authentication. |
| `1477940` | Fix legacy Vercel mark/unmark rollback and auth precedence | Superseded by the current server-side tebligat proxy and safe rendering. |
| `9d055bf` | Add spreadsheet row filling and weekly trigger | Excluded as an unrelated external Apps Script/sheet automation. |

## Reconciliation decisions

- Keep the Phase 8F YKN extension, parser, Apps Script proxy, public application portal, staff application review, and migration history as the source of truth.
- Restore the missing YKN cache reset narrowly, with no parser, selector, marital-status, or background polling changes.
- Restore the staff-only Belgeler workspace and nine public static office PDFs without importing the legacy HTML-string renderer. The PDFs remain public as they are on `main`; they are general office forms, not applicant files.
- Use one configured shared staff username. Reject other usernames and old individual sessions; remove individual user-management endpoints and runtime assignment reads. Leave the old `assignments` migration/table intact because changing an already-applied schema requires a separate authorized migration.
- No production deployment, remote migration, R2 mutation, public OCR route, or merge into `main` is part of Phase 8G.

## Vercel status diagnosis

The failing GitHub Vercel status belongs to the legacy `/ikamet/` Vercel project. The status pointed to deployment `dpl_6RnppzP1NqD7juEe4ryCAjwaqDJz` (branch `codex/phase8f-shared-staff-domain-prep`, commit `ecb018b`). Authenticated `vercel inspect --logs` confirmed that the remote build reached `npm run build`, then `prebuild` called `scripts/package-extension.mjs` and stopped because `PORTAL_PRODUCTION_ORIGIN` was not configured. This is the exact failure cause; it is not a Worker build error. No Vercel environment setting was changed. The current repository's deployment target remains the Cloudflare Worker configured in `wrangler.jsonc`.
