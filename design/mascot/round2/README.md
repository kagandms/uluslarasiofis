# Chatbot Mascot Concept Drafts — Round 2

- **Date:** 2026-11-20
- **Scope:** Second-round standalone mascot exploration for the Istanbul Topkapı University International Student Office chat assistant (`design/mascot/round2/` only; Round-1 files in `design/mascot/` remain untouched; nothing wired into product code).
- **Status:** Draft concepts pending owner review (unverified in a live browser from this headless run). Open `preview.html` directly in any browser (offline, no network needed) to compare Concepts 4–6 side by side with the Round-1 owl across 28 / 36 / 56 / 120 px, idle/thinking/handoff states, light/dark/burgundy surfaces, reduced-motion, and Arabic RTL views.

---

## Concept 4 — Kırlangıç / Topi (`concept-4-migratory-swallow.svg`)

- **Idea:** A plump, rounded barn swallow (*kırlangıç*) with slate-blue plumage, a subtle symmetric forked tail, a bright cream face/breast, and a tiny burgundy office lanyard badge (chosen over a white stork because storks lose silhouette clarity at 28 px and evoke "baby delivery" clichés globally).
- **Why it fits "göç" / Topkapı:** Swallows are the classic emblem of seasonal migration (*göç*), safe arrival, and welcoming shelter under friendly eaves (*kırlangıç yuvası*), while the burgundy lanyard anchors it cleanly to the International Office helper role.
- **Risks (incl. cultural):** Universally positive across Turkey, Central Asia, Middle East, Africa, Europe, and East Asia (spring, good luck, safe return) with zero omen baggage; visually, the forked tail and small lanyard lines soften slightly at 28 px, and its cool slate-blue cap introduces a secondary hue alongside burgundy.

## Concept 5 — Topi (`concept-5-istanbul-cat.svg`)

- **Idea:** A calm, round cream-and-soft-grey Istanbul street cat (*tekir* forehead stripes) wearing a bold burgundy collar and a small blank office ID tag, with gentle whiskers and symmetrical tucked paws.
- **Why it fits "göç" / Topkapı:** Istanbul's beloved street and campus cats are the very first warm welcome international students remember upon arriving in the city, and the friendly, unhurried character pairs effortlessly with the candidate name "Topi".
- **Risks (incl. cultural):** Virtually zero cultural or religious friction—cats are cherished in Turkey, regarded as clean (*tahir*) and warmly respected across Middle Eastern/Islamic traditions, and read as friendly or lucky across Europe, Africa, Central Asia, and Asia; minor design risk is keeping the whiskers and small collar tag from looking noisy at 28 px, and cats are common enough that the burgundy collar badge is essential to signal an office assistant.

## Concept 6 — Kapı (`concept-6-kapi-gate.svg`)

- **Idea:** A friendly, secular semicircular arched gateway in warm ivory stone with pillar impost caps, a burgundy keystone, and double burgundy doors that stay welcomingly ajar in idle and swing wide open in handoff to reveal a downward chevron toward the question form.
- **Why it fits "göç" / Topkapı:** Plays directly on *Topkapı* ("gate", strictly without cannons or weapons) and on the International Office's role as an open doorway into university life and residence-permit guidance.
- **Risks (incl. cultural):** Completely symmetric in all three states (strongest RTL behavior) and avoids animal, religious, or national symbols by using a classic civic semicircular arch (not a pointed mosque dome); main risks are that an architectural object feels slightly less emotionally cuddly than a pet/bird and must preserve its threshold step and keystone so the arch never reads as a gravestone at 28 px.

---

## Final Ranking (All 4 Options for This Audience)

1. **Istanbul Cat (`concept-5-istanbul-cat.svg`)** — Universally loved across Turkey, Islamic/Middle Eastern, Central Asian, African, European, and Asian student cohorts with zero superstition risk, instantly evokes Istanbul's warm welcome, and fits the short name "Topi" best.
2. **Migratory Swallow (`concept-4-migratory-swallow.svg`)** — Carries the strongest thematic link to *göç* (migration and safe arrival) with universally positive cultural associations, trailing the cat only slightly in instant 28 px silhouette recognizability.
3. **Arched Gate "Kapı" (`concept-6-kapi-gate.svg`)** — Delivers the sharpest Topkapı wordplay (cannon-free), best RTL symmetry, and clearest open-door handoff gesture, though an object character feels slightly less warm as an everyday chat companion.
4. **Lanyard Owl (`../concept-1-lanyard-owl.svg`, Round 1)** — Visually crisp and charming as a desk helper, but Turkish folk belief (and parts of South Asian/Middle Eastern tradition) links owls (*baykuş*) with bad omens and ruins, making it the riskiest choice for a public-facing migration office.

---

## Technical Notes

- **Standalone inline-ready SVGs:** Every Round-2 SVG uses `viewBox="0 0 64 64"`, `xmlns="http://www.w3.org/2000/svg"`, `<title>`, `aria-hidden="true"`, zero external URLs or raster assets, and stays well under 6 KB (each ~4.5–4.9 KB, strictly below 6144 bytes).
- **States & motion:** `#state-idle` is default; `.is-thinking` and `.is-handoff` on the root `<svg>` switch states via inline `<style>`, with subtle thinking-dot animations disabled under `@media (prefers-reduced-motion: reduce)`.
- **Theming:** Uses `--public-burgundy` (`#7e1830`), `--public-burgundy-light` (`#9a203d`), `--public-burgundy-hover` (`#641126`), `--public-burgundy-soft` (`#fbf2f4`), `--public-burgundy-border` (`#e2c0c8`), and optional `--mascot-*` tokens with safe light/dark fallbacks.
