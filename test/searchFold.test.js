import assert from 'node:assert/strict';
import test from 'node:test';
import { foldSearchText, MAX_SEARCH_TOKENS, searchTokens } from '../src/shared/searchFold.js';

test('foldSearchText folds Turkish casing, combining accents, w->v, and non-alphanumeric separators', () => {
    const cases = [
        ['ILBEK', 'ilbek'],
        ['ilbek', 'ilbek'],
        ['Ibrahim', 'ibrahim'],
        ['İbrahim', 'ibrahim'],
        ['ılgın', 'ilgin'],
        ['Şahin', 'sahin'],
        ['Sahin', 'sahin'],
        ['Çağlar', 'caglar'],
        ['Caglar', 'caglar'],
        ['Wasim', 'vasim'],
        ['Vasim', 'vasim'],
        ['WASIM', 'vasim'],
        ['Müller', 'muller'],
        ['Muller', 'muller'],
        ['Muhammad  Saad-Naeem', 'muhammad saad naeem'],
        ['Ömer Ünal', 'omer unal'],
        ['Âdem Îsâ Ûmit', 'adem isa umit'],
        ['Änä Ýazmyradow Ňury Žanna', 'ana yazmyradov nury zanna'],
        ['  ---Ayşe   Demir___  ', 'ayse demir'],
        ['50%', '50'],
        ['a_b', 'a b'],
        [null, ''],
        [undefined, ''],
        ['   ---   ', '']
    ];

    for (const [input, expected] of cases) {
        assert.equal(foldSearchText(input), expected, `foldSearchText(${JSON.stringify(input)})`);
    }
});

test('foldSearchText preserves non-Latin letters while collapsing punctuation', () => {
    assert.equal(foldSearchText('  Ахмед - Иванов  '), 'ахмед иванов');
    assert.equal(foldSearchText('محمد  سعد'), 'محمد سعد');
});

test('searchTokens splits folded text, drops empty tokens, and caps at 6 tokens', () => {
    assert.deepEqual(searchTokens(''), []);
    assert.deepEqual(searchTokens('   %%% ___ ---   '), []);
    assert.deepEqual(searchTokens('ŞAHİN Çağlar'), ['sahin', 'caglar']);
    assert.deepEqual(searchTokens('Muhammad  Saad-Naeem'), ['muhammad', 'saad', 'naeem']);
    assert.deepEqual(
        searchTokens('One Two Three Four Five Six Seven Eight'),
        ['one', 'tvo', 'three', 'four', 'five', 'six']
    );
    assert.equal(MAX_SEARCH_TOKENS, 6);
});
