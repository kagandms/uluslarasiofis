# PDF Compression and Reusable Phone Transfer Design

Date: 2026-10-13
Status: Approved for implementation by the user

## Understanding summary

- Compress PDFs produced by the staff photo/PDF merger to approximately 40% of the combined selected-file size.
- Rasterization is allowed. Keep student files in the browser and prioritize readable text, QR codes, and barcodes.
- Show progress, resulting size, and actual compression ratio. If the quality floor prevents the 40% target, explain that and allow the staff member to inspect/save the result.
- Reuse the same paired phone and QR transfer for new student records while its existing one-hour deadline remains valid.
- Assign a separate server-side batch to each student modal. Never import files from a previous batch into the next student's list.
- Retain one-time phone claiming, staff-session ownership, expiry, same-origin checks, and existing transfer security boundaries.
- Apply the existing 30-photo and 120-MB limits per student batch; remove temporary batch files as they are consumed or a batch is retired.

## Assumptions

- The 40% figure is a best-effort target relative to the total bytes of all selected source PDFs and images, not a guaranteed hard cap.
- If compression cannot reach the target without dropping below the readability floor, saving remains available with a clear warning and preview.
- The same phone browser tab remains paired during the one-hour session. A different phone must use a new QR.
- The active staff modal represents the student who owns the current batch. The transfer service stores no student name or student identifier.
- Existing 50-MB physical PDF acceptance limits and the one-hour transfer TTL do not change.

## Decision log

| Decision | Alternatives considered | Reason |
| --- | --- | --- |
| Render PDF pages locally with the existing PDF.js worker, then rebuild with pdf-lib. | Preserve vectors and optimize embedded streams; upload to a server compressor. | Vector copying cannot reliably reach the requested reduction. Local processing avoids sending student documents to a new service. |
| Use adaptive render resolution/JPEG quality with a readability floor and report the actual result. | Force exactly 40% at any quality; silently accept a larger result. | Exact size is input-dependent; a stated floor prevents unreadable output and makes the limitation visible. |
| Keep one server transfer and one paired phone for its existing TTL, with a new batch ID per student modal. | Create one transfer per student; allow the claim token to pair multiple phones. | This removes repeat scanning while keeping phone pairing single-use and separating student documents. |
| Tag uploads with the active batch and reject stale batch IDs on the server. | Filter only in the browser; keep one lifetime quota. | Server validation prevents stale or racing uploads crossing into the next student's record; per-batch quotas preserve normal capacity for each student. |
| Store no student identity in transfer batches. | Put student identifiers on phone uploads. | A batch is scoped to the currently open staff modal, so no personal data needs to be copied to the phone or transfer service. |

## Final design

### PDF processing

`mergeDocumentsToPdf` will render each selected PDF page sequentially through PDF.js, using its configured worker, and rebuild the document with pdf-lib. Existing images continue through the current image optimizer. Processing will preserve selected-file/page order and page geometry, release each page's canvas and render resources before continuing, and report progress through the existing modal status element.

The compressor will measure the combined input bytes and generated PDF bytes. It will use bounded resolution and JPEG-quality adjustments to approach 40% while retaining a minimum render resolution/quality chosen to keep ordinary document text and machine-readable marks legible. The result UI will show both sizes and the achieved ratio. If the floor is reached first, it will show a warning, keep the preview available, and allow the existing save/download action. PDF parse/render failures abort the whole build rather than silently dropping pages.

### Reusable phone transfer

The browser session will retain the transfer ID, claim token, and server expiry in a module-level coordinator while the staff application page remains open. Closing a PDF modal deactivates its student batch and releases modal timers/listeners but does not delete the unexpired transfer. Opening the next modal activates a fresh opaque batch ID. The same QR and countdown are reused until the original expiry; if no live transfer exists, the current create-and-claim flow remains available.

On the phone, a newly captured camera photo is optimized and uploaded immediately without a second send action. Gallery selections remain reviewable and use an explicit send button. Each photo keeps its own visible state. An upload response means only that the temporary transfer accepted the file; the phone shows “Gönderildi” only after the staff PC imports the photo into its active list and the server records it as consumed. The phone reads those per-batch acknowledgements through its existing authenticated transfer session. Failed camera uploads stay available for retry, and stale-batch photos are visibly marked and can be removed.

An additive D1 migration will add the active batch identity to transfers and the batch identity to temporary files. Staff activation atomically replaces the prior batch. Phone photo selection records the currently active batch; uploads include that ID. The server accepts an upload only when its batch matches the active batch and transfer/staff/phone sessions are valid. Staff polling lists only files in the current batch. A phone page holding photos selected under an older batch must not upload them after a student change; it will show a clear stale-selection message and require those photos to be removed before selecting documents for the new student.

Batch quotas will be enforced against files for the active batch (30 photos and 120 MB), with reservations updated atomically so concurrent uploads cannot exceed them. Files are deleted from private object storage after staff import. If finalized or in-progress photos remain when staff tries to move to another student, the server refuses batch replacement and the UI requires explicit discard before proceeding; it never silently drops photos or makes them visible to the next student. In-flight uploads re-check the active batch before finalization and remove their temporary object if the batch changed. Expiry, staff logout/revocation, and existing cleanup continue to invalidate the transfer. No transfer or batch stores student names or identifiers.

### Errors, edge cases, and validation

- Reject stale-batch uploads, expired transfers, revoked staff sessions, and second-phone claims with existing safe API error handling.
- Test that camera capture begins upload immediately and the phone reports “Gönderildi” only after the PC import acknowledgement.
- Make activation and batch replacement idempotent where retries can occur; do not expose a new batch until its database state is committed.
- Test concurrent old-batch uploads against activation, duplicate photo retries, quota boundaries, batch replacement cleanup, transfer expiry, and staff revocation.
- Test PDF page count/order/rotation, parse failures, quality-floor warning, target achievement on representative fixtures, and memory cleanup between pages.
- Show before saving that rasterized output no longer has selectable text or editable form/vector content, and keep the rendered preview available for visual review.
- Run `npm test`, `npm run build:production`, and `npm run deploy:dry-run:production` before delivery. Deployment remains governed by the production consolidation policy and requires an explicit deployment request for this new change.

## Implementation scope

- `src/services/pdfMergerService.js` and a focused PDF compression helper.
- `src/ui/pdfMergerModal.js` and its styles/progress copy.
- `src/ui/mobile-transfer-panel.js`, a shared transfer-session coordinator, and the phone upload page.
- Mobile transfer route/upload logic and one additive D1 migration.
- Focused PDF compression, transfer lifecycle, batch isolation, and quota tests.

