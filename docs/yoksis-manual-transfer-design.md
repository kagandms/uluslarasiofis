# YÖKSİS manual transfer override

## Understanding

- Let staff continue transferring applicant data when the automatic YÖKSİS readiness check is uncertain.
- Keep the existing automatic readiness check as the normal path.
- Require a deliberate staff confirmation before any unverified transfer.
- Refuse the override when the search was not sent, YÖKSİS explicitly rejected the request, or known identity fields conflict.
- Preserve field verification, photo handling, and the user's final review/save responsibility.

## Assumptions and constraints

- The override applies only to the currently bound YÖKSİS tab and the current acceptance-code search request.
- A visible, editable student form is required; the search-only page is not a valid transfer target.
- If identity comparison is inconclusive, the staff member visually checks the YÖKSİS record against the portal before confirming.
- Student and passport values remain out of extension diagnostics and console logs.
- Override work adds no repeated polling beyond the current readiness timeout and retains post-write field verification.

## Decision log

### Chosen: explicit, one-operation manual override

- **Decision:** Offer “Yine de aktar” only after a search was dispatched and an editable student form is present, when readiness is uncertain but no identity mismatch or explicit YÖKSİS rejection was detected. Require the staff member to confirm the record visually. Revalidate the bound tab, search identity, form controls, and mismatch state immediately before writing.
- **Alternative:** Always transfer after a search click. Rejected because it could write into a stale or unrelated student record without staff confirmation.
- **Alternative:** Copy values to the clipboard only. Rejected because it cannot reliably populate structured YÖKSİS controls such as country selectors and gender.
- **Verification:** Keep existing post-write field verification and report partial/unverified results as warnings.
