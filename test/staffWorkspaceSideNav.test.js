/**
 * Yetkili çalışma alanı dikey yan menüsü kaynak sözleşmesi testi.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import test from 'node:test';

const STAFF_HTML_URL = new URL('../yetkili/index.html', import.meta.url);
const SIDE_NAV_CSS_URL = new URL('../src/staff/workspaceSideNav.css', import.meta.url);

const STAFF_HTML = readFileSync(STAFF_HTML_URL, 'utf8');
const SIDE_NAV_CSS = readFileSync(SIDE_NAV_CSS_URL, 'utf8');

const EXPECTED_NAV_BUTTONS = [
    { view: 'applications', controls: 'view-applications', intakeEntry: true, label: 'İkamet Başvuruları' },
    { view: 'ykn', controls: 'view-ykn', intakeEntry: false, label: 'YKN' },
    { view: 'cover', controls: 'view-cover', intakeEntry: false, label: 'Kapak Hazırla' },
    { view: 'teblig', controls: 'view-teblig', intakeEntry: false, label: 'Tebliğ Bul' },
    { view: 'documents', controls: 'view-documents', intakeEntry: false, label: 'Belgeler' },
    { view: 'print', controls: 'view-print', intakeEntry: false, label: 'Yazdırma' },
    { view: 'work-hours', controls: 'view-work-hours', intakeEntry: false, label: 'Çalışma Saatleri' },
    { view: 'yoksis-audit', controls: 'view-yoksis-audit', intakeEntry: false, label: 'YÖKSİS Eksik Evrak' },
    { view: 'inquiries', controls: 'view-inquiries', intakeEntry: false, label: 'Gelen Sorular' }
];

test('workspaceSideNav.css dosyası mevcuttur ve yetkili/index.html içinde diğer tüm staff CSS dosyalarından sonra bağlanır', () => {
    assert.ok(existsSync(SIDE_NAV_CSS_URL), 'src/staff/workspaceSideNav.css dosyası bulunmalıdır');

    const dom = new JSDOM(STAFF_HTML);
    const stylesheetHrefs = [...dom.window.document.querySelectorAll('link[rel="stylesheet"]')]
        .map((link) => link.getAttribute('href') || '');

    const sideNavIndex = stylesheetHrefs.indexOf('/src/staff/workspaceSideNav.css');
    assert.notEqual(sideNavIndex, -1, 'yetkili/index.html /src/staff/workspaceSideNav.css bağlantısını içermelidir');

    const otherStaffIndices = stylesheetHrefs
        .map((href, index) => ({ href, index }))
        .filter(({ href }) => href.startsWith('/src/staff/') && href !== '/src/staff/workspaceSideNav.css');

    assert.ok(otherStaffIndices.length > 0, 'Diğer /src/staff/*.css dosyaları bulunmalıdır');
    for (const { href, index } of otherStaffIndices) {
        assert.ok(
            sideNavIndex > index,
            `/src/staff/workspaceSideNav.css (${sideNavIndex}), ${href} (${index}) dosyasından sonra yüklenmelidir`
        );
    }
});

test('workspaceSideNav.css masaüstü dikey ızgara alanlarını, min-width: 901px kırılımını ve sağ menü özel özelliklerini tanımlar', () => {
    assert.match(SIDE_NAV_CSS, /@media\s*\(\s*min-width:\s*901px\s*\)/);
    assert.match(SIDE_NAV_CSS, /--workspace-nav-columns:/);
    assert.match(SIDE_NAV_CSS, /--workspace-nav-areas:/);
    assert.match(SIDE_NAV_CSS, /"nav toolbar"/);
    assert.match(SIDE_NAV_CSS, /"nav hint"/);
    assert.match(SIDE_NAV_CSS, /"nav views"/);
    assert.match(SIDE_NAV_CSS, /grid-template-columns:\s*var\(--workspace-nav-columns\)/);
    assert.match(SIDE_NAV_CSS, /grid-template-areas:\s*var\(--workspace-nav-areas\)/);
    assert.match(SIDE_NAV_CSS, /"toolbar nav"/, 'Sağ tarafta menü için yorum satırı örneği bulunmalıdır');
    assert.match(SIDE_NAV_CSS, /\.workspace-content\[hidden\]\s*\{[^}]*display:\s*none;/);
});

test('workspaceSideNav.css yapışkan dikey liste, satır kaydırma, karanlık mod ve focus-visible kurallarını içerir', () => {
    assert.match(SIDE_NAV_CSS, /position:\s*sticky;/);
    assert.match(SIDE_NAV_CSS, /flex-direction:\s*column;/);
    assert.match(SIDE_NAV_CSS, /min-height:\s*44px;/);
    assert.doesNotMatch(
        SIDE_NAV_CSS,
        /text-overflow:\s*ellipsis/,
        '.workspace-nav button metinleri üç nokta ile kesilmemelidir'
    );
    assert.match(SIDE_NAV_CSS, /body\.dark-mode\s+\.workspace-content\s+\.workspace-nav/);
    assert.match(SIDE_NAV_CSS, /\.workspace-nav\s+button:focus-visible/);
    assert.match(SIDE_NAV_CSS, /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)/);
    assert.match(SIDE_NAV_CSS, /@media\s*\(\s*max-width:\s*900px\s*\)/);
});

test('yetkili/index.html içindeki nav.workspace-nav hâlâ değişmemiş niteliklerle tam olarak 9 düğme içerir', () => {
    const dom = new JSDOM(STAFF_HTML);
    const navButtons = [...dom.window.document.querySelectorAll('#workspace-content nav.workspace-nav button')];

    assert.equal(navButtons.length, EXPECTED_NAV_BUTTONS.length, 'nav.workspace-nav tam olarak 9 düğme içermelidir');

    navButtons.forEach((button, index) => {
        const expected = EXPECTED_NAV_BUTTONS[index];
        assert.equal(button.getAttribute('type'), 'button');
        assert.equal(button.getAttribute('data-workspace-view'), expected.view);
        assert.equal(button.getAttribute('aria-controls'), expected.controls);
        assert.equal(button.hasAttribute('data-intake-entry'), expected.intakeEntry);
        assert.equal(button.textContent.trim(), expected.label);
    });
});
