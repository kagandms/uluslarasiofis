import assert from 'node:assert/strict';
import test from 'node:test';
import { foldText, fastLevenshtein } from '../src/ui/tebligatSearch.js';

test('foldText strips Turkish accents, punctuation, and trims text', () => {
    assert.equal(foldText('MOHAMED ALI'), 'MOHAMED ALI');
    assert.equal(foldText('İSMAİL ÇAĞLAR ŞENTÜRK'), 'ISMAIL CAGLAR SENTURK');
    assert.equal(foldText('AL-HASSAN ÖZDEMİR'), 'AL HASSAN OZDEMIR');
    assert.equal(foldText('  dmitrii   ivanov  '), 'DMITRII IVANOV');
});

test('fastLevenshtein calculates exact edit distance within maxDist', () => {
    assert.equal(fastLevenshtein('MOHAMED', 'MOHAMMED', 2), 1);
    assert.equal(fastLevenshtein('DMITRY', 'DMITRIY', 2), 1);
    assert.equal(fastLevenshtein('DMITRY', 'DMITRII', 2), 2);
    assert.equal(fastLevenshtein('ALEXANDER', 'ALEKSANDR', 2), 2);
    assert.equal(fastLevenshtein('AHMET', 'MEHMET', 1), 2);
});
