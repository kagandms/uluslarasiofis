# YKN and mobile UX improvements

## Confirmed behavior

- `Kabul Mektup Kodunu YÖKSİS'e Aktar` uses an already open YÖKSİS tab.
- It fills the acceptance-letter ID field and triggers the matching search button without activating the tab.
- If no YÖKSİS tab is open, the portal reports that the user must open one; this action does not create a new tab.
- `Bilgileri YÖKSİS'e Yapıştır` is the action that may create or activate the YÖKSİS tab and then fill the remaining student data.
- The long mobile success state for `E-Tabloya Ekle` is replaced with a compact, responsive status layout.

## Non-goals

- No changes to Apply search, OCR, or the existing YÖKSİS form-field mapping.
- No automatic final submission of the YÖKSİS form.
- No production deployment as part of the local implementation step.

## Decision log

1. Preserve the existing `TRANSFER_TO_YOKSIS` bridge action for compatibility, but make its background operation require an existing YÖKSİS tab.
2. Activate/create the YÖKSİS tab only in the existing remaining-data transfer flow.
3. Keep dynamic spreadsheet values out of `innerHTML`; render them as text nodes so the mobile presentation change does not introduce an injection path.
