/**
 * Yetkili çalışma alanı masaüstü yatay taşma önleme kuralları kaynak sözleşmesi testi.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const HOME_CSS_URL = new URL('../src/staff/home.css', import.meta.url);
const SIDE_NAV_CSS_URL = new URL('../src/staff/workspaceSideNav.css', import.meta.url);
const APPLICATIONS_MANAGER_URL = new URL('../src/staff/applicationsManager.js', import.meta.url);

const HOME_CSS = readFileSync(HOME_CSS_URL, 'utf8');
const SIDE_NAV_CSS = readFileSync(SIDE_NAV_CSS_URL, 'utf8');
const APPLICATIONS_MANAGER_JS = readFileSync(APPLICATIONS_MANAGER_URL, 'utf8');

test('İkamet Başvuruları kuyruk tablosu yatay kaydırılabilir kapsayıcı içinde oluşturulur', () => {
    assert.match(
        APPLICATIONS_MANAGER_JS,
        /tableWrap\.className\s*=\s*'staff-applications-table-wrap'/,
        'renderQueue tabloyu .staff-applications-table-wrap kapsayıcısına sarmalıdır'
    );
    assert.match(
        APPLICATIONS_MANAGER_JS,
        /tableWrap\.append\(createQueueTable\(/,
        'createQueueTable sonucu tableWrap içine eklenmelidir'
    );
    assert.match(
        APPLICATIONS_MANAGER_JS,
        /panel\.append\(tableWrap\)/,
        'tableWrap kuyruk paneline eklenmelidir'
    );
});

test('home.css kuyruk tablosu kapsayıcısına overflow-x: auto ve işlem hücresi çocuklarına satır içi sarmalama tanımlar', () => {
    const wrapRule = HOME_CSS.match(/\.staff-applications-table-wrap\s*\{[^}]*\}/);
    assert.ok(wrapRule, '.staff-applications-table-wrap kuralı tanımlı olmalıdır');
    assert.match(wrapRule[0], /overflow-x:\s*auto;/);
    assert.match(wrapRule[0], /max-width:\s*100%;/);
    assert.match(wrapRule[0], /min-width:\s*0;/);

    const actionCellRule = HOME_CSS.match(
        /\.staff-applications-table\s+td\.staff-queue-actions-cell,\s*\.staff-applications-table\s+td\[data-label="Detay"\]\s*\{[^}]*\}/
    );
    assert.ok(actionCellRule, 'Satır işlem hücresi kuralı tanımlı olmalıdır');
    assert.match(actionCellRule[0], /white-space:\s*normal;/);
    assert.match(actionCellRule[0], /max-width:\s*100%;/);
    assert.doesNotMatch(actionCellRule[0], /display:\s*flex\b/, 'td hücresi table-cell olarak kalmalıdır');

    const actionChildrenRule = HOME_CSS.match(
        /\.staff-applications-table\s+td\.staff-queue-actions-cell\s*>\s*\*,\s*\.staff-applications-table\s+td\[data-label="Detay"\]\s*>\s*\*\s*\{[^}]*\}/
    );
    assert.ok(actionChildrenRule, 'Satır işlem hücresi doğrudan çocukları için inline-block kuralı tanımlı olmalıdır');
    assert.match(actionChildrenRule[0], /display:\s*inline-block;/);
    assert.match(actionChildrenRule[0], /vertical-align:\s*middle;/);
    assert.match(actionChildrenRule[0], /max-width:\s*100%;/);

    const statusRule = HOME_CSS.match(
        /\.staff-applications-table\s+td\.staff-queue-actions-cell\s+\.staff-gocnet-transfer-status,\s*\.staff-applications-table\s+td\.staff-queue-actions-cell\s+\.staff-spreadsheet-transfer-error,\s*\.staff-applications-table\s+td\[data-label="Detay"\]\s+\.staff-gocnet-transfer-status,\s*\.staff-applications-table\s+td\[data-label="Detay"\]\s+\.staff-spreadsheet-transfer-error\s*\{[^}]*\}/
    );
    assert.ok(statusRule, 'İşlem hücresi durum mesajları için blok kuralı tanımlı olmalıdır');
    assert.match(statusRule[0], /display:\s*block;/);
    assert.match(statusRule[0], /width:\s*100%;/);
});

test('home.css YÖKSİS panelini ızgara sütununa sınırlar ve arama satırının sarılmasını sağlar', () => {
    const workspaceRule = HOME_CSS.match(/\.yoksis-audit-workspace\s*\{[^}]*\}/);
    assert.ok(workspaceRule, '.yoksis-audit-workspace kuralı tanımlı olmalıdır');
    assert.match(workspaceRule[0], /grid-template-columns:\s*minmax\(0,\s*1fr\);/);
    assert.match(workspaceRule[0], /min-width:\s*0;/);
    assert.match(workspaceRule[0], /max-width:\s*100%;/);

    const panelRule = HOME_CSS.match(/\.yoksis-audit-heading,\s*\.yoksis-audit-panel\s*\{[^}]*\}/);
    assert.ok(panelRule, '.yoksis-audit-heading, .yoksis-audit-panel kuralı tanımlı olmalıdır');
    assert.match(panelRule[0], /min-width:\s*0;/);
    assert.match(panelRule[0], /max-width:\s*100%;/);

    const searchRule = HOME_CSS.match(/\.yoksis-audit-search\s*\{[^}]*\}/);
    assert.ok(searchRule, '.yoksis-audit-search kuralı tanımlı olmalıdır');
    assert.match(searchRule[0], /display:\s*flex;/);
    assert.match(searchRule[0], /flex-wrap:\s*wrap;/);
    assert.match(searchRule[0], /min-width:\s*0;/);
    assert.doesNotMatch(
        HOME_CSS,
        /minmax\(16rem,\s*1fr\)\s+auto\s+minmax\(11rem,\s*auto\)\s+auto/,
        'Sabit 4 sütunlu taşan YÖKSİS arama ızgarası kaldırılmış olmalıdır'
    );

    const searchLabelRule = HOME_CSS.match(/\.yoksis-audit-search\s+label\s*\{[^}]*\}/);
    assert.ok(searchLabelRule, '.yoksis-audit-search label kuralı tanımlı olmalıdır');
    assert.match(searchLabelRule[0], /overflow-wrap:\s*anywhere;/);

    const searchControlRule = HOME_CSS.match(/\.yoksis-audit-search\s+input,\s*\.yoksis-audit-search\s+select\s*\{[^}]*\}/);
    assert.ok(searchControlRule, '.yoksis-audit-search input, select kuralı tanımlı olmalıdır');
    assert.match(searchControlRule[0], /width:\s*100%;/);
    assert.match(searchControlRule[0], /min-width:\s*0;/);
    assert.match(searchControlRule[0], /max-width:\s*100%;/);

    const tableWrapRule = HOME_CSS.match(/\.yoksis-audit-table-wrap\s*\{[^}]*\}/);
    assert.ok(tableWrapRule, '.yoksis-audit-table-wrap kuralı tanımlı olmalıdır');
    assert.match(tableWrapRule[0], /overflow-x:\s*auto;/);
    assert.match(tableWrapRule[0], /max-width:\s*100%;/);
});

test('workspaceSideNav.css ızgara alanlarını, view-panel min-width: 0 sınırını ve mobil sekme şeridini korur', () => {
    assert.match(SIDE_NAV_CSS, /--workspace-nav-columns:/);
    assert.match(SIDE_NAV_CSS, /--workspace-nav-areas:/);
    assert.match(SIDE_NAV_CSS, /"nav toolbar"/);
    assert.match(SIDE_NAV_CSS, /"nav hint"/);
    assert.match(SIDE_NAV_CSS, /"nav views"/);

    const viewPanelRule = SIDE_NAV_CSS.match(/\.workspace-content\s+\.view-panel\s*\{[^}]*\}/);
    assert.ok(viewPanelRule, '.workspace-content .view-panel kuralı tanımlı olmalıdır');
    assert.match(viewPanelRule[0], /grid-area:\s*views;/);
    assert.match(viewPanelRule[0], /min-width:\s*0;/);
    assert.match(viewPanelRule[0], /max-width:\s*100%;/);

    assert.match(SIDE_NAV_CSS, /@media\s*\(\s*max-width:\s*900px\s*\)/);
});
