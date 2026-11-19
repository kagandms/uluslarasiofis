import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { ApiError } from '../src/server/domain/errors.js';
import {
    CHATBOT_LANGUAGES,
    CHATBOT_TOPICS,
    readKnowledge
} from '../src/server/domain/chatbotKnowledge.js';

test('CHATBOT_TOPICS exposes the fixed five-topic enum and all five portal languages', () => {
    assert.deepEqual(CHATBOT_TOPICS, [
        'application_steps',
        'residence_permit_basics',
        'office_hours',
        'student_card',
        'contact'
    ]);
    assert.deepEqual(CHATBOT_LANGUAGES, ['tr', 'en', 'ru', 'tk', 'ar']);
});

test('readKnowledge returns non-empty curated text and sources for every topic in all five languages', () => {
    for (const topic of CHATBOT_TOPICS) {
        for (const language of CHATBOT_LANGUAGES) {
            const entry = readKnowledge(topic, language);
            assert.equal(typeof entry.text, 'string', `${topic}/${language} must return string text`);
            assert.ok(entry.text.trim().length > 20, `${topic}/${language} text must not be empty`);
            assert.ok(Array.isArray(entry.sources) && entry.sources.length > 0, `${topic}/${language} must cite sources`);
            for (const source of entry.sources) {
                assert.equal(typeof source, 'string');
                assert.ok(source.length > 0);
            }
        }
    }
});

test('readKnowledge rejects unknown or non-string topics', () => {
    for (const invalidTopic of ['unknown_topic', '', '   ', '__proto__', 'constructor', null, undefined, 42]) {
        assert.throws(
            () => readKnowledge(invalidTopic, 'tr'),
            (error) => error instanceof ApiError && error.status === 400 && error.code === 'VALIDATION_ERROR'
        );
    }
});

test('readKnowledge falls back to Turkish when language is omitted or unsupported', () => {
    const turkish = readKnowledge('application_steps', 'tr');
    assert.deepEqual(readKnowledge('application_steps'), turkish);
    assert.deepEqual(readKnowledge('application_steps', 'de'), turkish);
    assert.deepEqual(readKnowledge('application_steps', null), turkish);
});

test('draft knowledge texts do not invent office hours, phone numbers, or staff credentials', () => {
    for (const language of CHATBOT_LANGUAGES) {
        const officeHours = readKnowledge('office_hours', language);
        assert.equal(/\b\d{1,2}[:.]\d{2}\b/.test(officeHours.text), false, `${language} office_hours must not invent clock hours`);

        const contact = readKnowledge('contact', language);
        assert.equal(/(\+90|0\s*5\d{2}|\d{3}[-\s]\d{3})/.test(contact.text), false, `${language} contact must not invent phone numbers`);
        assert.equal(contact.text.includes('international.office.topkapi@topkapi.edu.tr'), false);
    }
});

test('every draft topic entry in chatbotKnowledge.js carries the office-approval DRAFT comment', () => {
    const source = fs.readFileSync(
        new URL('../src/server/domain/chatbotKnowledge.js', import.meta.url),
        'utf8'
    );
    const draftCommentCount = source.match(/\/\/ DRAFT: needs office approval/g)?.length || 0;
    assert.ok(
        draftCommentCount >= CHATBOT_TOPICS.length * CHATBOT_LANGUAGES.length,
        'Expected every topic and language draft entry to carry // DRAFT: needs office approval'
    );
});
