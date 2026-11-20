# Topi — Animated Chatbot Mascot Asset (Round 4)

- **Date:** 2026-11-20
- **Scope / Source:** Round 4 motion upgrade for **Topi**, the Istanbul cat assistant for the Istanbul Topkapı University International Student Office chat widget (`design/mascot/topi/`). Built directly on the owner-approved Round 3 static character, proportions, color tokens, chest card, and traced Topkapı University emblem (`public/topkapi_logo.png`), adding lively, playful CSS-only animations, the new one-shot `.is-hello` greeting state, and `.is-calm` avatar mode. Round-1 and Round-2 files remain untouched; nothing is wired into product code yet.
- **Validation Status:** Authored and byte-checked via file reads without running shell commands or live browser rendering in this headless run. Open `preview.html` directly in a browser (offline, no network required) to visually inspect all 8 states, play/pause, `--mascot-speed` (0.5×–2.0×), the `.is-hello` replay button, the 28 px `.is-calm` avatar row, dark mode, RTL Arabic layout, and reduced-motion static fallbacks.

---

## Files

- `topi-cat.svg` — Standalone minified inline-ready SVG (`viewBox="0 0 64 64"`, `xmlns="http://www.w3.org/2000/svg"`, `<title>Topi</title>`, `aria-hidden="true"`, valid XML with `/*<![CDATA[*/` around `<style>`, zero external URLs, zero raster data, zero JS, zero SMIL) containing all 8 states, `.is-calm`, `--mascot-speed` duration scaling, and `prefers-reduced-motion: reduce`.
- `preview.html` — Standalone offline review page (inline CSS/JS, responsive down to 360 px) rendering live inline `<svg>` clones (never `<img>`) across 28 / 36 / 56 / 120 px on light, dark, and burgundy surfaces, plus play/pause all, `--mascot-speed` slider (0.5×–2.0×), `.is-hello` spotlight + replay buttons, a 28 px `.is-calm` avatar row, LTR Turkish and RTL Arabic widget mockups, dark mode, reduced-motion toggle, and integration mapping table.

---

## Motion Architecture & Principles

All motion is pure CSS `@keyframes` inside `topi-cat.svg`'s `<style>`, animating **only `transform` and `opacity`** with `transform-box: fill-box` and anatomical `transform-origin` pivots (rig floor `50% 98%`, torso base `50% 95%`, neck `50% 92%`, ear bases `55% 68%` / `45% 68%`, tail root `100% 98%`, sleepy tail root `100% 8%`, paw shoulders/wrists).

- **Playful feel without fatigue:** Squash-and-stretch anticipation/landing (`cubic-bezier(.34,1.56,.64,1)` overshoot easing), staggered follow-through delays (`0.08s–0.15s`), and non-synchronised loop durations (`1.05s–8.2s`) so parts never lock into a robotic cadence. Loops stay gentle enough to remain on screen while a student reads; higher-energy moves (hops, ear twitches, startled sleep jerks, 3-pulse handoff taps) include calm rest intervals.
- **Keyframe reuse & speed scaling:** A compact set of 15 CSS keyframes (`bk`, `br`, `kt`, `kr`, `kp`, `km`, `k3`, `et`, `dt`, `hp`, `sp`, `nd`, `zz`, `hw`, `hr`) is reused across all 8 states via per-part CSS custom properties. Every duration and delay scales via `calc(var(--d) / var(--mascot-speed, 1))` so hosts or previews can tune speed from `0.5` to `2` with a single CSS variable.
- **Character integrity:** Static silhouette, colors, proportions, chest card, and the traced Topkapı University emblem are unchanged from Round 3. Ears are separated behind the cranium fill with hidden stroke extensions so they twitch, perk, and flop seamlessly with zero gaps while matching Round 3 pixel-for-pixel at rest. Only minimal motion props were added (a third gold sparkle in `understood`, a flapping document corner in `checking`, and separated `z z` paths in `sleepy`).

---

## Eight States, Timings & Widget Integration Contract

Set **at most one state modifier class** on the root `<svg class="mascot-svg mascot-cat">` element (`idle` is the default with no modifier class). Add `.is-calm` alongside any state class on 28 px chat-history message avatars.

| State | Root class | Motion & timings (at `--mascot-speed: 1`) | Reduced-motion static fallback | When the widget should set it |
| --- | --- | --- | --- | --- |
| **idle** | *(default)* | Body breathing `1→1.03` (`2.8s`), lazy S-curve tail wag (`3.1s`), gentle head bob/tilt (`3.7s`), right ear twitch (`5.1s`), single blink + occasional quick double blink (`8.2s` cycle, ~4s avg) | Static open-eyed neutral greeting pose | Default resting state (launcher, header after greeting, welcome state) |
| **thinking** | `.is-thinking` | Bouncy body bob (`1.9s`, overshoot), faster tail swish (`1.55s`), head bob (`2.5s`, `+0.15s` lag), perked ears (`2.8s`), eyes glancing up-left & up-right (`3.4s`), rhythmic paw tap (`2.1s`), 3 dots bubbling upward in wave (`1.5s`, delays `0 / 0.22s / 0.44s`) | Static upward-right gaze, lifted paw, all 3 dots solid (`opacity: 1`) | While an assistant request is in flight |
| **understood** | `.is-understood` | Happy hop with anticipation squat, lift & landing squash (`2.6s`, overshoot), raised paw waving "tamam" (`1.05s`), 3 gold sparkles twinkling & scaling in turn (`2.1s`, staggered `0 / -0.7s / -1.4s`), perked ears (`2.6s`), happy tail wag (`1.85s`) | Static happy `^ ^` smile, raised paw, all 3 sparkles solid (`opacity: 1`) | Deterministic document list or knowledge answer |
| **checking** | `.is-checking` | Magnifier + paw sweeping left-right over document with tilt (`2.9s`), head following (`2.9s`, `+0.14s` lag) & eyes tracking (`2.9s`), document corner flapping (`2.3s`), alert perked ears (`2.8s`), calm tail sway (`3.6s`) | Static focused gaze, magnifier centered over document, flat corner | Application status summary reply |
| **handoff** | `.is-handoff` | Pointing paw bounces down 3 pulses + rest (`2.8s`, overshoot), chevron pulsing in sync (`2.8s`, `+0.08s` lag), body leaning toward badge (`2.8s`), tail lifted & flicking (`1.9s`), natural blinking | Static downward gaze, pointing paw, static chevron badge | Reply containing the inquiry form action or fingerprint redirect |
| **confused** | `.is-confused` | Head tilt wobble `±8°` (`3.2s`), `?` bubble bobbing & wobbling (`2.3s`, overshoot), right ear flopping (`14°↔22°`, `3.2s`) while left ear perks, slow tail question-mark curl (`4.1s`), natural blinking | Static polite `-7°` head tilt, static `?` bubble | Refusal or fallback menu reply |
| **sleepy** | `.is-sleepy` | Slow deep breathing (`4.4s`), head slowly nodding off then startling back up (`4.8s`), `z z` floating up & fading in sequence (`2.8s`, staggered `0 / -1.4s`), tucked tail curling (`4.4s`) | Static lowered head (`+2.4` units), closed `U U` eyes, tucked tail, `z z` solid (`opacity: 1`) | HTTP 503 or daily limit reached |
| **hello** *(new)* | `.is-hello` | **One-shot (`1.6s`, `iteration-count: 1`, `fill-mode: forwards`)**: 3-wave raised paw, small squash-and-stretch hop, perked ears, head nod, and friendly tail flick; lowers paw and holds the exact resting idle pose (blinking continues) | Static friendly raised-paw greeting pose (no motion) | Set once when the chat panel first opens; remove (or replace on first request) after ~1.8s |
| **calm** *(modifier)* | `.is-calm` *(combine with any state)* | Disables **all** body/tail/ear/prop loops and holds each state's static pose while keeping only natural eye blinking (`8.2s` cycle) on open-eye states | No animation at all (blinking also disabled under `prefers-reduced-motion: reduce`) | Always add on 28 px chat-history message avatars so stacked bubbles never distract readers |

---

## Size, Performance & Technical Notes

- **Measured file size (`topi-cat.svg`):** **12,150 bytes (11.87 KB)** — strictly within the **12,288-byte (12 KB)** cap (138 bytes headroom). Measured directly from file byte range during headless editing; orchestrator can confirm exact on-disk size with `wc -c design/mascot/topi/topi-cat.svg`.
- **Mobile & battery performance:**
  - Every keyframe animates only compositor-friendly `transform` and `opacity` (zero layout/paint thrashing, zero SVG path morphing, zero CSS filters or drop-shadows).
  - Use **`.is-calm`** on 28 px message avatars in scrollable chat logs so only the active launcher/header mascot runs full multi-part loops.
  - When rendering multiple inline `<svg>` copies in one document (launcher + header + message avatars), keep the `<style>` tag on the first mounted instance (or hoist it once) and suffix `<defs>` IDs (`emblem`, `t1`, `t2`, `ck`, `pw`, `sm`, `ey`) per clone — as demonstrated in `preview.html` — so the browser parses the stylesheet once and never collides `<defs>` IDs.
  - Modern browser requirement: uses standard CSS Nesting (`&` inside `.mascot-cat`) and `transform-box: fill-box` (supported across Chrome 112+, Safari 16.5+, Firefox 117+, Edge 112+, and current iOS/Android WebViews).
- **Reduced motion (`prefers-reduced-motion: reduce`):** Stops every animation unconditionally (`animation: none !important`), falling back automatically to each state's static final pose with all dots, sparkles, and `z z` visible at full opacity.
- **Color tokens & dark mode:** Preserves all Round 3 `--public-burgundy*` and `--mascot-*` custom properties. In dark mode, keep `--mascot-coat` warm light cream (`#f4ece5`), `--mascot-card` pure `#ffffff` (so the fixed `#8b1328` / `#444444` Topkapı emblem stays crisp), and `--mascot-outline` wine-burgundy (`#8d2a44` or dark-mode `--public-burgundy-hover`).
- **RTL layout:** Props sit on the right side of the `64 × 64` viewBox and `?` / `z z` glyphs must not be mirrored; render Topi un-flipped in RTL (`dir="rtl"`), as verified in `preview.html`.

---

## University Emblem Tracing Notes (Unchanged from Round 3)

- **Source file:** `public/topkapi_logo.png` (500 × 500 px raster symbol — icon only, no university text).
- **Geometry:** `<g id="emblem">` inside `<defs>`, placed exclusively on the chest card via `<use href="#emblem" transform="translate(25.4 46.1) scale(.0265)"/>` — two mirrored flat `#8b1328` "T" blocks with a 22-unit optically hinted central gap (0.51 px at 56 px, 1.1 px at 120 px so subpixel anti-aliasing never blurs the gap shut) and two `#444444` horizontal bars flush above the stems.
