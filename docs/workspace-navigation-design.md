# Workspace Navigation Design

## Scope

The portal keeps its existing login, OCR, form, PDF, history, tebligat API, theme, and PWA behavior. This delivery only adds a navigation shell that separates YKN, cover preparation, and tebligat search.

## Decisions

- `src/ui/workspaceNavigation.js` owns view visibility, active navigation state, and focus only.
- Existing element IDs remain unchanged to preserve module event bindings.
- YKN is an explicit unavailable state until the browser-extension contract is implemented.
- Navigation-specific styles use dedicated class names and never reuse the existing `.hidden` state class.
- A URL router is intentionally deferred because menu navigation is sufficient for this delivery.

## Verification

Run the production build and manually verify authenticated entry, all three workspace transitions, Tebligat input focus, OCR/manual/PDF/history continuity, dark mode, and narrow mobile layouts.
