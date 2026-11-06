# Documentation index

## Start here

| Need | Source |
| --- | --- |
| Development and workspace rules | [AGENTS.md](../AGENTS.md), [README.md](../README.md) |
| Current production release procedure | [Manual production release](manual-production-release.md) |
| Release preparation history, not a runnable procedure | [Cloud CI/release preparation](deployment/cloud-ci-release.md), [cloud CI validation](deployment/cloud-ci-validation.md) |

## Components

| Area | Edit and test | Guide/status |
| --- | --- | --- |
| Worker and web portal | [`src/`](../src/), [`test/`](../test/) | Root README and current release procedure above. |
| YKN extension | [`ykn_eklenti-main/`](../ykn_eklenti-main/), [`test/`](../test/); package with `npm run package:extension` from [`scripts/package-extension.mjs`](../scripts/package-extension.mjs). | [`2026-09-07-ykn-extension-distribution.md`](2026-09-07-ykn-extension-distribution.md) describes packaging behavior; current source and generator define the package. The generated [`public/downloads/`](../public/downloads/) contents are ignored outputs, not source. |
| Apps Script and spreadsheet proxy | [`apps_script.txt`](../apps_script.txt), [`src/server/services/appsScriptProxy.js`](../src/server/services/appsScriptProxy.js); see [`test/appsScriptDailySheets.test.js`](../test/appsScriptDailySheets.test.js) and [`test/applicationSpreadsheet.test.js`](../test/applicationSpreadsheet.test.js). | The root README describes the proxy contract. [`phase8g-integration-reconciliation.md`](phase8g-integration-reconciliation.md) is historical; the external Apps Script deployment identity is not verified here. |
| Scanner | [`scripts/scanner/`](../scripts/scanner/), [`test/scanner/`](../test/scanner/), plus [`test/scannerApi.test.js`](../test/scannerApi.test.js) and [`test/scannerQueue.test.js`](../test/scannerQueue.test.js). | [`phase8h-scanner-design.md`](phase8h-scanner-design.md) is design material; [`pilot-local-clamav-runbook.md`](pilot-local-clamav-runbook.md) is pilot-only, not current production setup. |
| Windows Print Agent | [`scripts/print_agent/`](../scripts/print_agent/) and its [README](../scripts/print_agent/README.md); run the documented Python unit-test command there. | [`print-agent-orientation-v7/`](print-agent-orientation-v7/) records the v7 package and tests. The root [`print-agent-windows-v7.zip`](../print-agent-windows-v7.zip) SHA matches that report, but two packaged Python files differ from current source; this is a historical deliverable, not a package proven reproducible from today's tree. No current physical-device or installed-agent state is established by these files. |

## Plans, evidence, and drafts

- [`superpowers/plans/`](superpowers/plans/) and [`superpowers/specs/`](superpowers/specs/) contain scoped plans/specifications; their presence does not mean implementation or external activation occurred.
- Dated root documents, [`notes/`](notes/), and [`audits/`](audits/) are historical or point-in-time analysis. Check their stated date, source SHA and validation status against current code before treating a claim as current. [`notes/2026-11-05-application-document-requirements-draft.md`](notes/2026-11-05-application-document-requirements-draft.md) is explicitly a draft.
- [`evidence/`](evidence/), [`validation/`](validation/), and the dated `*-evidence/` directories retain test, release, and operational records. They prove only the checks and versions recorded in each artifact; they do not establish current live state.
- [`production-v7-readiness/`](production-v7-readiness/), [`production-go-live-v7/`](production-go-live-v7/), and [`production-only-evidence/`](production-only-evidence/) describe past readiness, release, or recovery states, not the current Worker version.
- [`deployment/`](deployment/) contains both historical records and release material; use [Manual production release](manual-production-release.md) for the current procedure.

## Packages and prototype outputs

| Area | Where to edit | How it is produced | Why it remains / status |
| --- | --- | --- | --- |
| Print Agent v7 | [`scripts/print_agent/`](../scripts/print_agent/) | The v7 ZIP is documented in [`print-agent-orientation-v7/report.md`](print-agent-orientation-v7/report.md) and its [package manifest](print-agent-orientation-v7/package-manifest.json); no current reproducible packager was identified. | Versioned historical handoff with a recorded hash. Its package source snapshot differs from today's two Python files; inspect source and package provenance before redistributing. |
| YKN download | [`ykn_eklenti-main/`](../ykn_eklenti-main/) | `npm run package:extension` generates versioned ZIP, latest ZIP, and metadata under [`public/downloads/`](../public/downloads/). | Generated delivery files are ignored; edit extension source, not generated downloads. |
| Student print guide | [`scripts/create-student-print-guide.mjs`](../scripts/create-student-print-guide.mjs), [`scripts/lib/student-print-guide.mjs`](../scripts/lib/student-print-guide.mjs), and [`scripts/templates/student-print-guide.html`](../scripts/templates/student-print-guide.html) | `node scripts/create-student-print-guide.mjs`; [`docs/student-print-guide-evidence/README.md`](student-print-guide-evidence/README.md) records validation and reproduction. | Tracked `output/pdf/student-print-guide-a4.*` files are office deliverables and validation artifacts, not scratch build output. Regeneration overwrites them; use `PRINT_GUIDE_OUTPUT` for a separate destination. |
| `test-homepage/` | [`test-homepage/`](../test-homepage/) | Local prototype files; no production build or automated test reference was found. | [`navigation-design.md`](../test-homepage/navigation-design.md) describes the prototype scope. Its current product status is unverified; it is not the production portal source. |

Temporary logs, screenshots, and build outputs are not retained by default. Keep durable fixtures, evidence, or delivery files only with their purpose, producing source/version, and reproduction method recorded. Do not infer that an old package or evidence folder is current because of its name or date.
