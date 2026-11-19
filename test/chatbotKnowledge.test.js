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

test('office_hours states confirmed 09:00-18:00 hours and draft contact does not invent phone numbers or staff credentials', () => {
    const trOfficeHours = readKnowledge('office_hours', 'tr');
    assert.equal(
        trOfficeHours.text,
        'Uluslararası Öğrenci Ofisi hafta içi 09:00–18:00 saatleri arasında açıktır. Sorularınızı ana sayfadaki soru formundan da iletebilirsiniz.'
    );

    for (const language of CHATBOT_LANGUAGES) {
        const officeHours = readKnowledge('office_hours', language);
        assert.ok(officeHours.text.includes('09:00–18:00'), `${language} office_hours must include 09:00–18:00`);
        assert.deepEqual(
            officeHours.text.match(/\b\d{1,2}[:.]\d{2}\b/g),
            ['09:00', '18:00'],
            `${language} office_hours must contain only 09:00 and 18:00`
        );

        const contact = readKnowledge('contact', language);
        assert.equal(/(\+90|0\s*5\d{2}|\d{3}[-\s]\d{3})/.test(contact.text), false, `${language} contact must not invent phone numbers`);
        assert.equal(contact.text.includes('international.office.topkapi@topkapi.edu.tr'), false);
    }
});

test('every remaining draft topic entry in chatbotKnowledge.js carries the office-approval DRAFT comment and office_hours does not', () => {
    const source = fs.readFileSync(
        new URL('../src/server/domain/chatbotKnowledge.js', import.meta.url),
        'utf8'
    );
    const draftTopics = CHATBOT_TOPICS.filter((topic) => topic !== 'office_hours');
    const draftCommentCount = source.match(/\/\/ DRAFT: needs office approval/g)?.length || 0;
    assert.ok(
        draftCommentCount >= draftTopics.length * CHATBOT_LANGUAGES.length,
        'Expected every remaining draft topic and language entry to carry // DRAFT: needs office approval'
    );

    const officeHoursBlock = source.match(/office_hours:\s*Object\.freeze\(\{[\s\S]*?\n\s*\}\),/)?.[0] || '';
    assert.ok(officeHoursBlock.length > 0, 'Expected to locate office_hours block in chatbotKnowledge.js');
    assert.equal(officeHoursBlock.includes('DRAFT: needs office approval'), false);
});
