# Physical receipt usability — 2026-10-12

Local changes on production; no deployment, commit, push or branch deletion performed.
Remote heads freshly read using git ls-remote: production and codex/qr-print-ux.

- Compact two-column desktop draft, single column below 480px. Overflow fallback remains for smaller viewports and enlarged text.
- Green accessible success notification after reference reservation. Allocation is disabled once reserved, with a workflow guard against repeated/concurrent allocation. Failed allocation remains retryable. Year changes require reopening the form.
- Name/surname uppercase in Turkish locale; passport uppercase in English locale. Actual draft values are normalized; caret and IME composition are preserved. Applies to receipt creation/edit and legacy physical creation.
- Queue A4 ready state displays Hazır; stale metadata still displays A4 güncel değil.
- New metadata-first intake stays under_review on creation and detail retrieval, and detail marks İncelemede as the current status. Existing status persistence is retained without resetting previously processed records.
- PDF portal address is bold, underlined, 15pt and enclosed in a bordered bilingual panel. QR encodes only the configured portal origin. A true PDF URI link annotation makes the digital address clickable.
- PDF merger uses separate document and QR columns on desktop. Header/footer stay visible and only the file list scrolls when needed. Phone instructions are collapsible. Small screens retain accessible scrolling.

## Verification

npm test: 907 tests, 906 passed, 1 skipped, 0 failures.
npm run build:production: passed.
npm run deploy:dry-run:production: passed. No live deployment.
After adding explicit API detail status assertions, physical-receipts.test.js passed 44/44.

Chrome synthetic browser checks confirmed no draft overflow and visible submit at 1470×725, 1280×720, 1024×600, 390×844, including the assigned reference. Computed success text color was rgb(22, 101, 52).
Merger checks at 1470×725 and 1024×600, with 0 and 30 files and an active synthetic QR, confirmed no body/card overflow and visible QR/footer. The API was mocked; no live pairing session was created.

Normal and maximum-length multilingual receipt variants passed one-page A4 render checks, actual raster logo checks and Arabic direction checks. Missing asset rejection uses a fresh browser document to avoid the successful-render logo cache masking the failure. Cover rendering and print readiness checks also passed. receipt-render-results.json contains the raw results.

The usability harness imports actual styles and components. PDF timing uses the actual receipt renderer and PDF.js first-page rasterization at scale 1.25. A first render and five subsequent renders were measured without network throttling:

- First generation: 336 ms; first page: 333 ms; total: 669 ms.
- Subsequent generation: 92–107 ms; first page: 169–181 ms; total: 264–281 ms; total median: 265 ms.
- PDF size: 176,355 bytes.
- PDF.js verified the first-page URI annotation resolves to the configured portal URL.

This is a local rendering benchmark, not production click-to-open timing. It excludes registration, server snapshot creation, upload, storage, network latency and the user's native PDF viewer. Existing saved PDF snapshots remain unchanged; the new design applies to PDFs generated after this code is released.

Run with RECEIPT_QA_PLAYWRIGHT_MODULE pointing to an available Playwright module:
node scripts/verify-physical-receipt-usability.mjs

Screenshots, PDF preview and raw browser results are in this folder. No physical printing, phone QR scan or authenticated live UAT was performed.
