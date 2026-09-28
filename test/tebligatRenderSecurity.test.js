import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import test from 'node:test';
import { createTebligatResultCard } from '../src/ui/tebligatResultRenderer.js';

test('untrusted tebligat fields render as text and never create executable markup', () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    const record = {
        sayfa: '01.01.2026" onmouseover="window.__xss = true',
        isim: '<img src=x onerror="window.__xss = true"> Ayşe',
        no: '7" data-owned="true',
        _isFuzzy: true
    };

    const card = createTebligatResultCard({
        document: dom.window.document,
        record,
        query: 'Ayşe',
        isMarked: false
    });

    dom.window.document.body.append(card);

    assert.equal(card.querySelector('img'), null);
    assert.equal(card.querySelector('[onerror], [onmouseover], [data-owned]'), null);
    assert.equal(card.dataset.sayfa, record.sayfa);
    assert.equal(card.dataset.isim, record.isim);
    assert.equal(card.dataset.no, record.no);
    assert.equal(card.querySelector('.tebligat-result-name').textContent, `${record.isim}`);
    assert.equal(card.querySelector('.tebligat-result-name mark')?.textContent, 'Ayşe');
    assert.equal(card.querySelector('.tebligat-fuzzy-badge')?.textContent.trim(), '~ Benzer');
    assert.equal(dom.window.__xss, undefined);
});

test('tebligat result renderer preserves mark and unmark control state', () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    const card = createTebligatResultCard({
        document: dom.window.document,
        record: { sayfa: '10.09.2026', isim: 'Öğrenci Adı', no: 12, isaretli: true },
        query: 'Öğrenci',
        isMarked: true
    });

    assert.equal(card.querySelector('.btn-mark-tebligat').disabled, true);
    assert.equal(card.querySelector('.btn-mark-tebligat').classList.contains('marked'), true);
    assert.notEqual(card.querySelector('.btn-unmark-tebligat').style.display, 'none');
    assert.equal(card.querySelector('.tebligat-result-page').textContent.trim(), 'Sayfa: 10.09.2026');
    assert.equal(card.querySelector('.tebligat-result-number').textContent, 'No: 12');
});
