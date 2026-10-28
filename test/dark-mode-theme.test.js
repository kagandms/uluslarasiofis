import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const indexCss = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
const staffHomeCss = readFileSync(new URL('../src/staff/home.css', import.meta.url), 'utf8');

test('dark mode exposes Trabzonspor blue-to-burgundy accent colors', () => {
    const darkTheme = indexCss.match(/body\.dark-mode\s*\{([^}]+)\}/)?.[1] ?? '';

    assert.match(darkTheme, /--accent:\s*#75b7e5/i);
    assert.match(darkTheme, /--accent-gradient:\s*linear-gradient\([^;]*#75b7e5[^;]*#5a0e27/i);
});

test('dark mode uses the shared accent gradient for selected, hovered, and focused workspace controls', () => {
    assert.match(indexCss, /body\.dark-mode \.workspace-toolbar \.btn,\s*body\.dark-mode \.workspace-nav button\.is-active,\s*body\.dark-mode \.workspace-nav button:hover,\s*body\.dark-mode \.workspace-nav button:focus-visible,[\s\S]*?\{[^}]*background:\s*var\(--accent-gradient\)/);
    assert.match(staffHomeCss, /body\.dark-mode #home-screen \.home-action:hover,\s*body\.dark-mode #home-screen \.home-action:focus-visible\s*\{[^}]*background:\s*var\(--accent-gradient\)/);
});

test('workspace buttons use compact right padding and paint their full background area', () => {
    assert.match(indexCss, /\.workspace-nav button\s*\{[^}]*background-clip:\s*border-box;[^}]*padding:\s*0\.5rem 0\.7rem;/);
    assert.match(indexCss, /\.workspace-toolbar h2\s*\{[^}]*padding:\s*0\.55rem 0\.7rem;/);
});

test('dark mode animates the header title colors only on the letters and respects reduced motion', () => {
    assert.match(indexCss, /body\.dark-mode \.app-header h1\s*\{[^}]*animation:[^}]*background-clip:\s*text;[^}]*-webkit-text-fill-color:\s*transparent;/);
    assert.match(indexCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?body\.dark-mode \.app-header h1\s*\{[^}]*animation:\s*none;/);
});

test('header title and version badge use RGB brand colors in light and dark modes', () => {
    assert.match(indexCss, /\.app-header h1\s*\{[^}]*color:\s*rgb\(var\(--accent-rgb\)\)/);
    assert.match(indexCss, /\.version-badge\s*\{[^}]*color:\s*rgb\(255 255 255\)/);
    assert.match(indexCss, /body\.dark-mode \.version-badge\s*\{[^}]*background-image:\s*linear-gradient\(105deg,\s*rgb\(117 183 229\) 0%,\s*rgb\(90 14 39\) 50%,\s*rgb\(117 183 229\) 100%\)/);
    assert.match(indexCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?body\.dark-mode \.version-badge\s*\{[^}]*animation:\s*none;/);
});

test('dark mode prevents transparent nav edges from exposing slivers beside the gradient', () => {
    assert.match(indexCss, /body\.dark-mode \.workspace-nav button\.is-active,[\s\S]*?\{[^}]*border-color:\s*color-mix\(in srgb, #75b7e5 45%, #5a0e27\);/);
});

test('home card lasers follow both rounded card edges from top center to bottom center', () => {
    const presentationJs = readFileSync(new URL('../src/ui/staff-home-presentation.js', import.meta.url), 'utf8');

    assert.match(presentationJs, /createElementNS\(SVG_NAMESPACE, 'path'\)/);
    assert.match(presentationJs, /laser\.children\[0\]\.setAttribute\('d'/);
    assert.match(presentationJs, /laser\.children\[1\]\.setAttribute\('d'/);
    assert.match(staffHomeCss, /\.home-action-laser path\s*\{[^}]*stroke-dasharray:\s*28 1000/);
    assert.match(staffHomeCss, /\.home-action:hover \.home-action-laser path\s*\{\s*animation:\s*staff-home-laser-travel/);
    assert.match(staffHomeCss, /@keyframes staff-home-laser-travel\s*\{\s*to\s*\{\s*stroke-dashoffset:\s*-972/);
    assert.doesNotMatch(presentationJs, /home-action-laser-beam|offsetPath/);
});

test('header title uses a high-contrast, faster Trabzonspor color cycle', () => {
    assert.match(indexCss, /animation:\s*trabzonspor-title-colorflow\s+3\.2s\s+linear\s+infinite\s+alternate/);
    assert.match(indexCss, /background-image:\s*linear-gradient\(105deg,\s*rgb\(117 183 229\) 0%,\s*rgb\(90 14 39\) 50%,\s*rgb\(117 183 229\) 100%\)/);
});
