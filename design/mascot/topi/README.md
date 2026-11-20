# Topi — Final Chatbot Mascot Asset (Round 3)

- **Date:** 2026-11-20
- **Scope / Source:** Final character package for **Topi**, the Istanbul cat assistant chosen by the owner for the Istanbul Topkapı University International Student Office chat widget. Built in `design/mascot/topi/` from the approved Round-2 character (`design/mascot/round2/concept-5-istanbul-cat.svg`) and the university symbol (`public/topkapi_logo.png`). Round-1 and Round-2 files remain untouched; nothing is wired into product code yet.
- **Validation Status:** Design asset and offline preview authored without running shell commands or live browser inspection in this headless run. Open `preview.html` directly in a browser (offline, no network needed) to verify all seven states across 28 / 36 / 56 / 120 px, light/dark/burgundy surfaces, RTL Arabic layout, and reduced motion.

---

## Files

- `topi-cat.svg` — Single standalone inline-ready SVG (`viewBox="0 0 64 64"`, `<title>Topi</title>`, `aria-hidden="true"`, no external URLs, no raster data, no fonts) containing all seven states and the traced Topkapı University symbol on Topi's chest card.
- `preview.html` — Standalone offline review page (inline CSS/JS, responsive down to 360 px) showing all seven states across 28 / 36 / 56 / 120 px on light, dark, and burgundy surfaces, live launcher (`Asistan`), panel header (`Topi · Uluslararası Ofis Asistanı`), 28 px assistant bubbles for every state, Arabic RTL sample (`توبي · مساعد المكتب الدولي`), dark mode & reduced-motion toggles, and the trigger mapping table.

---

## Seven States & Trigger Mapping

Switch states by toggling a single modifier class on the root `<svg class="mascot-svg mascot-cat">` element (`#state-idle` is visible by default). Shared geometry (tail, torso, collar, chest card, emblem, head, ears, whiskers, paws, smile, and eyes) is defined once inside `<defs>` and instantiated via `<use>`.

| State | Root class | Visual expression & props | Motion & reduced-motion fallback | Triggered by |
| --- | --- | --- | --- | --- |
| **idle** | *(default)* | Calm greeting face, resting tail and tucked paws | Gentle slow blink (`5.4s` cycle); static open eyes under `prefers-reduced-motion: reduce` | Default / welcome message |
| **thinking** | `.is-thinking` | Upward-right gaze, lifted paw, three-dot pill at top-right, gently swaying tail | Tail sways slowly (`2.2s`) and three dots pulse (`1.35s`); under `prefers-reduced-motion: reduce`, tail stops and all three dots stay solid | Request in flight |
| **understood** | `.is-understood` | Content closed-eye happy smile (`^ ^`), soft cheek blush, raised right paw ("tamam / got it"), gold 4-point sparkle | Static (no animation) | Deterministic document list or knowledge answer |
| **handoff** | `.is-handoff` | Friendly downward gaze, right paw pointing down toward a downward chevron badge | Static (no animation) | Reply with the inquiry action or fingerprint redirect |
| **checking** | `.is-checking` | Focused gaze toward right, paw holding a magnifying glass over a small document/file | Static (no animation) | Application status summary |
| **confused** | `.is-confused` | Polite `-7°` head tilt, soft raised brows, kind expression, crisp `?` bubble at top-right | Static (no animation) | Refusal or fallback menu |
| **sleepy** | `.is-sleepy` | Lowered head (`+2.4` units), peacefully closed downward eyes (`U U`), low tucked tail, `z z` pill at top-right | Static (no animation) | HTTP 503 / daily limit reached |

---

## University Emblem Tracing Notes

- **Source file:** `public/topkapi_logo.png` (500 × 500 px raster symbol — icon only, no university text).
- **What was traced:** Two mirrored flat burgundy "T" blocks (`#8b1328`) with a thin central vertical gap and two flat dark-grey horizontal bars (`#444444`) aligned flush above the stems. No rounded corners, no outlines, no gradients, and no restyling were applied.
- **Definition & placement:** Defined once inside `<defs>` as `<g id="emblem">` in the original 500 × 500 coordinate system and placed **only** on Topi's light neutral chest card (`#ffffff` / `var(--m-card)`) via `<use href="#emblem" transform="translate(25.4 46.1) scale(.0265)"/>`.
  - Scaled footprint: `500 × 0.0265 = 13.25` viewBox units (drawn bounds `11.26 × 12.38` units, centered cleanly inside the `16 × 15.4` card with white padding on all four sides).
  - The character's head was shifted `2.2` units higher and the torso extended `2.7` units lower relative to Round 2 so the larger chest card accommodates the 13-unit emblem without overlapping the paws or collar.
- **Exact coordinates & minor optical hinting deviation:**
  - Prompt reference coordinates (from the 500 × 500 PNG): left block `(35,37)–(253,37)–(253,475)–(118,475)–(118,255)–(35,255)`, right block `(264,37)–(460,37)–(460,255)–(401,255)–(401,475)–(264,475)` (11 px center gap), grey bars `x=118 y=10 w=135 h=16` and `x=264 y=10 w=136 h=16`.
  - Traced `<g id="emblem">` coordinates:
    - Left block: `(35,37)–(247,37)–(247,475)–(118,475)–(118,255)–(35,255)`
    - Right block: `(269,37)–(460,37)–(460,255)–(401,255)–(401,475)–(269,475)`
    - Grey bars: `x=118 y=8 w=129 h=18` and `x=269 y=8 w=132 h=18` (flush with the left/right stems, preserving the 11-unit vertical gap to `y=37`).
  - **Reason for deviation:** At `scale(0.0265)` rendered at 56 px (`0.875 px/unit`), an 11-unit center gap would be `0.25 px` wide and blur closed under subpixel anti-aliasing. Widening the center gap slightly from 11 to 22 units (`0.51 px` at 56 px, `1.1 px` at 120 px) and nudging the grey bar thickness from 16 to 18 units keeps the exact silhouette, slight left/right wing proportion, sharp 90° corners, and brand colors intact while keeping the two T-blocks and central gap legible at 56 px and above. At 28 px, the emblem naturally simplifies into a crisp small burgundy mark on the white card.

---

## Size, Theming & Technical Notes

- **File size:** Estimated **~7,870 bytes (~7.7 KB)** by manual line-by-line ASCII character count — well under the **9,216-byte (9 KB)** budget (~1.3 KB headroom). Exact on-disk byte count was not measured with a shell command in this headless run and should be verified by the orchestrator (`wc -c design/mascot/topi/topi-cat.svg`).
- **Color tokens:** Uses `--public-burgundy` (`#7e1830`), `--public-burgundy-light` (`#9a203d`), `--public-burgundy-hover` (`#641126`), `--public-burgundy-soft` (`#fbf2f4`), `--public-burgundy-border` (`#e2c0c8`), and optional `--mascot-*` overrides (`--mascot-outline`, `--mascot-coat`, `--mascot-mark`, `--mascot-surface`, `--mascot-card`, `--mascot-ink`, `--mascot-accent`).
- **Dark mode:** Keep `--mascot-coat` warm light cream (`#f4ece5`), `--mascot-card` pure light neutral (`#ffffff` so the fixed `#8b1328`/`#444444` emblem stays legible), and `--mascot-outline` a visible wine-burgundy (`#8d2a44` or dark-mode `--public-burgundy-hover` `#9f2745`) so whiskers and outer contours never vanish black-on-black.

---

## Risks & Integration Considerations

1. **Duplicate `<defs>` IDs when inlined multiple times:** If the chat widget renders multiple inline `<svg>` copies of `topi-cat.svg` in the same DOM (e.g., launcher + header + message avatars), `<defs>` IDs (`emblem`, `t-body`, `t-head`, etc.) should be either mounted once in a shared hidden `<svg>` sprite or suffixed per clone (as demonstrated in `preview.html`) so browsers never cross-reference a hidden/removed instance's `<defs>`. Do **not** rename `#state-*` IDs when suffixing `<defs>` because the inline `<style>` rules target `#state-idle` through `#state-sleepy`.
2. **Small-size (28 px) detail density:** At 28 px, the Topkapı emblem on the chest card intentionally resolves as a small burgundy mark, and the document lines inside `checking` soften; however, the magnifying glass rim, `?` bubble, `z z` pill, downward handoff badge, raised `understood` paw + gold sparkle, and 3-dot `thinking` pill are sized to stay distinct at 28 px. Verify visually in a real browser across 1x and 2x DPI displays.
3. **Emblem optical gap vs. brand strictness:** If the brand review prefers the literal 11-unit gap over 56 px subpixel legibility, revert `247`/`269` to `253`/`264` and grey bars to `y=10 h=16 w=135/136` inside `<g id="emblem">` in one line.
4. **RTL asymmetry:** Props (`thinking` pill, `understood` raised paw/sparkle, `handoff` badge, `checking` document, `confused` `?`, `sleepy` `z z`) sit on the right side of the 64 × 64 canvas while the tail sits on the left. Because the emblem is symmetric-looking and the `?`/`z z` glyphs must **not** be horizontally mirrored (`scaleX(-1)`), render Topi un-flipped in RTL (as shown in `preview.html`).
