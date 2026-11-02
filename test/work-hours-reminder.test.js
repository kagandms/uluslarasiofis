import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { initWorkHours } from '../src/staff/work-hours.js';

const html = readFileSync(new URL('../yetkili/index.html', import.meta.url), 'utf8');

test('reminder stays visible until all five people have saved, including zero hours', async (context) => {
    const dom = new JSDOM(html, { url: 'https://portal.test/yetkili/' });
    const previousDocument = globalThis.document;
    const previousFetch = globalThis.fetch;
    globalThis.document = dom.window.document;
    const people = ['kagan_samet', 'asaf', 'eyup', 'oguz', 'eray'];
    const records = new Map(people.slice(0, 4).map(key => [key, 60]));
    globalThis.fetch = async (url, options) => {
        const today = dom.window.document.querySelector('[data-work-hours-date]').value;
        if (options?.method === 'POST') {
            const body = JSON.parse(options.body);
            records.set(body.person, body.minutes);
            return { ok: true, json: async () => ({}) };
        }
        return { ok: true, json: async () => ({ today, selectedDate: today, people: people.map(key => ({ key })), records: [...records].map(([staff_key, minutes]) => ({ staff_key, minutes, work_date: today })) }) };
    };
    context.after(() => { globalThis.document = previousDocument; globalThis.fetch = previousFetch; dom.window.close(); });
    initWorkHours();
    await new Promise(resolve => setImmediate(resolve));
    const reminder = dom.window.document.querySelector('[data-work-hours-reminder]');
    assert.equal(reminder.hidden, false);
    const select = dom.window.document.querySelector('[data-person="eray"]');
    select.value = '0';
    dom.window.document.querySelector('[data-save="eray"]').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(records.get('eray'), 0);
    assert.equal(reminder.hidden, true);
});
