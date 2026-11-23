/**
 * Yetkili ana ekran kartları sırayla giriş animasyonu kaynak sözleşmesi testi.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import test from 'node:test';

const STAFF_HTML = readFileSync(new URL('../yetkili/index.html', import.meta.url), 'utf8');
const HOME_CSS = readFileSync(new URL('../src/staff/home.css', import.meta.url), 'utf8');

test('yetkili/index.html #home-screen içindeki her .home-action kartı için home.css giriş animasyonu kuralı vardır', () => {
    const dom = new JSDOM(STAFF_HTML);
    const cards = dom.window.document.querySelectorAll('#home-screen .home-action');
    assert.ok(cards.length > 0, '#home-screen içinde en az bir .home-action kartı bulunmalıdır');

    for (let index = 1; index <= cards.length; index += 1) {
        const pattern = new RegExp(
            `#home-screen\\.is-entering\\s+\\.home-action:nth-child\\(${index}\\)\\s*\\{[^}]*animation:\\s*staff-home-card-enter\\s+460ms\\s+cubic-bezier\\(0\\.18,\\s*0\\.8,\\s*0\\.25,\\s*1\\)\\s+\\d+ms\\s+both;`
        );
        assert.match(
            HOME_CSS,
            pattern,
            `home.css içinde #home-screen.is-entering .home-action:nth-child(${index}) giriş animasyonu kuralı eksik`
        );
    }
});
