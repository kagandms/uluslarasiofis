# Student print usability — local evidence, 13 October 2026

## Delivered

- `output/pdf/student-print-guide-a4.pdf`: one A4 page, university logo, four numbered steps in Turkish, Turkmen, Russian, English and Arabic; high-contrast QR with four-module quiet zone.
- Standalone HTML source and PDF-rendered PNG are alongside the PDF. Fonts and logo are embedded from the repository; no remote font request.
- Visible native-language selector in `/yazdir/`. Explicit choices are remembered using `print.locale.v2`; browser detection is the fallback. The retired `v1` choice remains untouched.
- Language switching translates the current page, file cards, validation messages and submission status without recreating cards or starting requests. Arabic uses RTL; copies and page ranges remain LTR.
- Staff labels and explanations use plain Turkish. Operational detail and Agent identifiers are in a collapsed disclosure. Grouped status/count fields keep labels beside their values.
- Fixed the existing `.btn { display: inline-flex }` override of native `[hidden]` inside the print panel. Only the applicable queue action is visible, including for read-only roles.

## Evidence

| Check | Result |
| --- | --- |
| `npm test` | 919 tests: 918 pass, 1 existing skip, 0 failures |
| `npm run build:production` | Passed; existing OCR dynamic-import/large-chunk warnings remain |
| `npm run deploy:dry-run:production` | Passed, no deployment |
| Browser checks | Chrome, synthetic APIs only; 320/390/1280 px × five languages, no horizontal overflow or page errors |
| State preservation | Same PDF card, selected pages `1,3`, 2 copies, landscape and enabled submit button survive every language change |
| In-flight switching | Unit/browser-flow test changes English to Arabic during an upload; controls stay disabled and original settings reach the mocked API |
| Remembered preference | Arabic remains selected after reload; unsupported/blocked storage tested separately |
| Staff view | Ready, paused, offline states checked; only applicable pause/resume button visible; reviewer controls stay hidden and unsafe cancellation remains disabled |
| PDF | `%PDF-`, one A4 page (594.96 × 841.92 pt), 446,381 bytes, logo/fonts loaded; actual PDF raster inspected |
| QR | Decoded from actual PDF raster using macOS Vision; exact result `https://goc.topkapiuni.workers.dev/yazdir/` |
| Existing production route | Read-only `/yazdir/` HTTP 200; this is not proof of deploying these changes |
| Whitespace | `git diff --check` passed |

`browser-results.json` records the 15 language/width combinations. `student-*-mobile.png`, `staff-ready.png` and `staff-paused.png` show the final local UI. Staff screenshots use a synthetic HTML harness with the real print panel, styles and module; they are not authenticated production screenshots.

## Reproduction

The scripts require Playwright, Chrome and Poppler (`pdftoppm`). When Playwright is supplied by the bundled Codex runtime, set `PRINT_GUIDE_PLAYWRIGHT_MODULE` to its absolute `playwright/index.mjs` path. Otherwise the scripts resolve the installed `playwright` package.

```sh
node scripts/create-student-print-guide.mjs
node scripts/verify-student-print-guide.mjs
```

The generator obtains `PUBLIC_PORTAL_ORIGIN` using Wrangler's production configuration reader. `PRINT_GUIDE_ORIGIN` can explicitly override it for a future hosting change. `PRINT_GUIDE_OUTPUT`, `PRINT_GUIDE_QA_OUTPUT` and `PRINT_GUIDE_BROWSER` customize output and browser selection. Regeneration replaces the artifact validation report; the independent QR decode above is a separate check.

## Boundaries

No deployment, commit, push, D1/R2 mutation, print submission, Agent update or feature-flag change. Existing unrelated working changes were preserved. Physical printer output, a real phone scan and native-speaker review of the Turkmen/Arabic text were not performed.
