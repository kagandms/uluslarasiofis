# Chatbot Mascot Concept Drafts

- **Date:** 2026-11-20
- **Scope:** Standalone concept exploration for the Istanbul Topkapı University International Student Office chat assistant (`design/mascot/` only; nothing wired into product code).
- **Status:** Draft concepts pending owner review. Open `preview.html` directly in any browser (offline, no network needed) to inspect all three concepts at 28 / 36 / 56 / 120 px across idle, thinking, handoff, light/dark, reduced-motion, and Arabic RTL views.

---

## Concept 1 — Puhu (`concept-1-lanyard-owl.svg`)

- **Idea:** A compact, warm dove-and-ivory desk owl wearing a burgundy office lanyard and a blank ID badge (intentionally avoiding a graduation cap or official seal).
- **Why it fits:** Feels immediately welcoming to stressed international students navigating residence-permit paperwork, while the lanyard clearly signals an office helper rather than a human advisor or legal authority.
- **Risks:** Owls are a familiar education motif (mild cliché risk even without a cap); the small ID badge details soften at 28 px (though the silhouette, eyes, and burgundy lanyard stay readable); while owls avoid common food/religious taboos (no dogs/pigs, no religious or national symbols), a few South Asian and Middle Eastern folk traditions associate owls with superstition—worth checking with student-facing staff.

## Concept 2 — Dosya (`concept-2-doc-folder.svg`)

- **Idea:** A tidy burgundy-and-ivory residence-permit document folder with a peeking checklist sheet, slim round glasses, and a calm expression that points downward during form handoff.
- **Why it fits:** Directly mirrors the assistant's core job—helping students organize required residence-permit documents—without implying a human identity or decision-making authority, and naturally anchors the burgundy brand palette.
- **Risks:** Object mascots can evoke dated office assistants ("Clippy" cliché) if over-animated, so motion is restricted to subtle thinking dots; at 28 px the peeking sheet lines and thin glasses frames compress slightly (the folder tab and lenses remain legible); culturally neutral across international cohorts with zero animal, religious, or national associations.

## Concept 3 — Nokta (`concept-3-geo-guide.svg`)

- **Idea:** A symmetric, minimal helper badge built from simple rounded-square and circle geometry, with pill eyes, an internal 3-dot thinking display, and a centered downward chevron tab for handoff.
- **Why it fits:** Scales cleanly down to 24–28 px with maximum contrast on light, dark, and burgundy surfaces, and its full symmetry behaves identically in LTR (Turkish/English/Russian/Turkmen) and RTL (Arabic) layouts.
- **Risks:** More restrained and less memorable as a "character" than an owl or folder, and minimal rounded-square faces can drift toward generic chatbot clichés if paired with heavy bounce animations; virtually zero readability loss at 28 px and completely neutral culturally across all international student backgrounds.

---

## Technical Notes

- **Standalone inline-ready SVGs:** Each file uses `viewBox="0 0 64 64"`, `xmlns="http://www.w3.org/2000/svg"`, `<title>`, `aria-hidden="true"`, no external URLs, no raster images, no fonts, and stays under 6 KB.
- **States:** `#state-idle` is visible by default; adding `.is-thinking` or `.is-handoff` to the root `<svg>` switches to `#state-thinking` or `#state-handoff` via inline `<style>`.
- **Theming & accessibility:** Colors read `--public-burgundy`, `--public-burgundy-light`, `--public-burgundy-hover`, `--public-burgundy-soft`, `--public-burgundy-border`, and optional `--mascot-*` custom properties with light-mode fallbacks. Thinking-dot animations disable under `@media (prefers-reduced-motion: reduce)`.
