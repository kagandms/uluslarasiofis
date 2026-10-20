import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import test from 'node:test';

const resolverSource = await readFile(new URL('../ykn_eklenti-main/yoksis-field-targets.js', import.meta.url), 'utf8');

function createResolver(markup) {
    const dom = new JSDOM(markup, { runScripts: 'outside-only' });
    dom.window.eval(resolverSource);
    return { dom, find: (labels, kind = 'text') => dom.window.YknFieldTargets.find({ root: dom.window.document, labels, kind }) };
}

test('ARIA associations constrain both input and textarea selectors', () => {
    const { dom, find } = createResolver('<input id="search" placeholder="Pasaport/Belge No"><span id="surname">Soyadı</span><input id="target" aria-labelledby="surname">');
    try {
        const selected = find(['Soyadı']);

        assert.equal(selected?.id, 'target');
    } finally { dom.window.close(); }
});

test('nested layout containers never become field labels and four-cell rows stay distinct', () => {
    const { dom, find } = createResolver(`<table><tr><td id="layout"><input id="search" placeholder="Pasaport/Belge No">
        <fieldset><legend>Öğrenci Bilgileri</legend><table><tr><td><span id="given-label">Adı</span></td><td><input id="given"></td>
        <td><span id="family-label">Soyadı</span></td><td><input id="family"></td></tr>
        <tr><td>Belge Düzenleme Tarihi</td><td><input id="issue"></td><td>Belge Geçerlilik Tarihi</td><td><input id="expiry"></td></tr></table></fieldset></td></tr></table>`);
    try {
        const selected = ['Adı', 'Soyadı', 'Belge Düzenleme Tarihi', 'Belge Geçerlilik Tarihi'].map(label => find([label])?.id);

        assert.deepEqual(selected, ['given', 'family', 'issue', 'expiry']);
    } finally { dom.window.close(); }
});

test('ambiguous editable fields fail closed instead of picking the first', () => {
    const { dom, find } = createResolver('<table><tr><td>Soyadı</td><td><input></td></tr><tr><td>Soyadı</td><td><input></td></tr></table>');
    try {
        const selected = find(['Soyadı']);

        assert.equal(selected, null);
    } finally { dom.window.close(); }
});

test('editable student fields inside a ZK grid remain eligible', () => {
    const { dom, find } = createResolver('<input placeholder="Pasaport/Belge No"><div class="z-grid-body"><fieldset><legend>Öğrenci Bilgileri</legend><table><tr><td>Adı</td><td><input id="first"></td><td>Soyadı</td><td><input id="last"></td></tr></table></fieldset></div>');
    try {
        const selected = find(['Soyadı']);

        assert.equal(selected?.id, 'last');
    } finally { dom.window.close(); }
});

test('student document lookup excludes the passport search and national identity fields', () => {
    const { dom, find } = createResolver('<table><tr><td>Belge No</td><td><input id="search" placeholder="Pasaport/Belge No"></td></tr><tr><td>Uyruk Kimlik No</td><td><input id="identity"></td><td>Belge No</td><td><input id="document"></td></tr></table>');
    try {
        const selected = find(['Belge No']);

        assert.equal(selected?.id, 'document');
    } finally { dom.window.close(); }
});
