import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('print management display rule does not override the hidden view state', async () => {
    const stylesheet = await readFile(new URL('../src/staff/print-management.css', import.meta.url), 'utf8');
    const gridRule = stylesheet.match(/([^{}]+)\{([^{}]*)\}/g)
        ?.find((rule) => rule.includes('.print-management') && /display:\s*grid/.test(rule));

    assert.ok(gridRule, 'print management panel keeps its grid layout');
    assert.match(gridRule, /\.print-management:not\(\[hidden\]\)/,
        'grid layout only applies while the print view is active');
});
