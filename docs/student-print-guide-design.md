# Student printing guide — approved 13 October 2026

## Understanding and assumptions

- Students need to print their own documents using the QR displayed on the office desk.
- Deliver one university-branded A4 PDF with a large QR and four short steps in Turkish, Turkmen, Russian, English and Arabic.
- Add a visible language selector to the existing student printing screen, remembering an explicit choice on the device.
- Preserve selected files, copies, page ranges, submission tracking and server-controlled capabilities during language changes.
- Simplify the Turkish staff management screen; keep operational details available in a collapsed disclosure.
- Use the existing university logo and configured production portal origin. No new service or remote font dependency.
- Validate locally; deployment and physical printer/phone UAT remain separate.

## Decision log

| Decision | Alternative | Reason |
| --- | --- | --- |
| Extend the existing five dictionaries | Add another translation library | Existing dictionary and RTL support already cover the print flow. |
| Translate current DOM nodes in place | Reload the page on selection | Keeps files, settings and in-flight requests intact. |
| Remember explicit choices under `print.locale.v2` | Reuse retired `v1` preferences or rely only on browser language | Starts from browser language unless the user actively chooses a language in the new UI. |
| Four numbered actions in each poster language | Five separate posters or a dense paragraph | One shared QR fits on the desk; numbered actions are easy to follow. |
| Generate the poster from configured origin with local assets | Manual QR and hardcoded hosting URL | Reproducible and preserves Arabic shaping without external dependencies. |
| Plain Turkish status labels and collapsed technical details | Remove operational explanations | Staff retain the information needed for uncertain print outcomes. |

## Reliability, privacy and maintenance

No print API, retry, authentication, D1/R2, Agent or feature flag changes. The new preference contains only a supported language code. Storage failures fall back to browser detection and keep in-page switching usable. Existing server checks remain authoritative for availability and limits. Reuse static translations and one event handler; no additional API traffic per language change. The poster generation script reads public configuration only and performs no print submissions.

## Validation

Unit/browser flow coverage: valid/invalid preferences, blocked storage, all five languages, RTL, selected files and settings, switching during an upload, staff permissions and safe cancellation. Visual checks: mobile LTR/RTL without horizontal overflow; staff normal/paused/offline states; actual rendered A4 PDF, logo, fonts and decoded QR. Required repository checks: `npm test`, `npm run build:production`, `npm run deploy:dry-run:production`.
