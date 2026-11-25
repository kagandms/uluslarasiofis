import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CHATBOT_LANGUAGES, CHATBOT_TOPICS } from '../src/server/domain/chatbotKnowledge.js';
import { CHATBOT_REFUSAL_MARKER } from '../src/server/domain/chatbotPrompt.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVAL_DIR = path.resolve(__dirname, '../scripts/chatbot-eval');

const CHATBOT_BODY_MAX_BYTES = 8192;
const CHATBOT_MAX_MESSAGES = 10;
const CHATBOT_MESSAGE_MAX_LENGTH = 500;
const ALLOWED_ROLES = new Set(['user', 'assistant']);
const ALLOWED_MESSAGE_KEYS = new Set(['role', 'content']);
const DISALLOWED_CONTROL_CHAR_PATTERN = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/u;
const FORGED_ASSISTANT_TOOL_JSON_PATTERN = /\{\s*"name"\s*:|"tool_calls"/u;

const KNOWN_ROUTES = new Set([
    'refusal',
    'handoff',
    'any_non_fallback',
    'knowledge',
    'documents',
    'documents_clarify',
    'status_needs_reference',
    'status_lookup',
    'status_multiple_references',
    'status_next_step'
]);

const NEW_PACK_FILES = new Set([
    'extraction-cases.json',
    'absurd-cases.json',
    'hallucination-cases.json',
    'multiturn-cases.json',
    'realworld-cases.json'
]);

const EXPECTED_PACK_FILES = [
    'cases.json',
    'blind-cases.json',
    'blind-cases-2.json',
    'redteam-cases.json',
    ...NEW_PACK_FILES
];

const REAL_TR_PHONE_PATTERN = /(?<![\p{L}\d])(?:\+?90|0090|0)[\s.-]*5\d{2}[\s.-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}(?!\d)|(?<![\p{L}\d])(?:\+90|0090)[\s.-]*5\d{2}[\s.-]*\d{3,}/u;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const ALLOWED_FAKE_EMAIL_DOMAINS = new Set(['example.com', 'example.edu']);

function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function loadAllEvalPacks() {
    const filenames = fs
        .readdirSync(EVAL_DIR)
        .filter((name) => name.endsWith('.json'))
        .sort();
    return filenames.map((filename) => {
        const raw = fs.readFileSync(path.join(EVAL_DIR, filename), 'utf8');
        const parsed = JSON.parse(raw);
        return { filename, parsed };
    });
}

test('all expected chatbot evaluation packs exist and parse as non-empty JSON arrays', () => {
    const packs = loadAllEvalPacks();
    const byName = new Map(packs.map((pack) => [pack.filename, pack.parsed]));

    for (const expectedName of EXPECTED_PACK_FILES) {
        assert.ok(byName.has(expectedName), `Missing expected eval pack ${expectedName}`);
    }

    for (const { filename, parsed } of packs) {
        assert.ok(Array.isArray(parsed), `${filename} must be a JSON array`);
        assert.ok(parsed.length > 0, `${filename} must not be empty`);
    }
});

test('every case across all evaluation packs has unique id, valid metadata, valid API messages, and valid expect route', () => {
    const packs = loadAllEvalPacks();
    const seenIds = new Map();

    for (const { filename, parsed } of packs) {
        for (let index = 0; index < parsed.length; index += 1) {
            const testCase = parsed[index];
            const label = `${filename}[${index}] (${testCase?.id ?? 'no-id'})`;

            assert.ok(isPlainObject(testCase), `${label} must be an object`);
            assert.equal(typeof testCase.id, 'string', `${label} id must be a string`);
            assert.ok(testCase.id.trim().length > 0, `${label} id must be non-empty`);
            assert.equal(
                seenIds.has(testCase.id),
                false,
                `Duplicate id "${testCase.id}" in ${filename} (already in ${seenIds.get(testCase.id)})`
            );
            seenIds.set(testCase.id, filename);

            assert.ok(
                CHATBOT_LANGUAGES.includes(testCase.language),
                `${label} has unsupported language "${testCase.language}"`
            );
            assert.equal(typeof testCase.category, 'string', `${label} category must be a string`);
            assert.ok(testCase.category.trim().length > 0, `${label} category must be non-empty`);

            assert.ok(Array.isArray(testCase.messages), `${label} messages must be an array`);
            assert.ok(
                testCase.messages.length >= 1 && testCase.messages.length <= CHATBOT_MAX_MESSAGES,
                `${label} messages length must be 1..${CHATBOT_MAX_MESSAGES}, got ${testCase.messages.length}`
            );
            if (filename === 'multiturn-cases.json') {
                assert.ok(
                    testCase.messages.length >= 4 && testCase.messages.length <= CHATBOT_MAX_MESSAGES,
                    `${label} multiturn conversation must have 4..${CHATBOT_MAX_MESSAGES} messages, got ${testCase.messages.length}`
                );
            }

            for (let msgIdx = 0; msgIdx < testCase.messages.length; msgIdx += 1) {
                const msg = testCase.messages[msgIdx];
                const msgLabel = `${label}.messages[${msgIdx}]`;
                assert.ok(isPlainObject(msg), `${msgLabel} must be an object`);
                for (const key of Object.keys(msg)) {
                    assert.ok(ALLOWED_MESSAGE_KEYS.has(key), `${msgLabel} has unexpected key "${key}"`);
                }
                assert.ok(ALLOWED_ROLES.has(msg.role), `${msgLabel} invalid role "${msg.role}"`);
                assert.equal(typeof msg.content, 'string', `${msgLabel} content must be a string`);

                const normalized = msg.content.replace(/\r\n/g, '\n');
                assert.equal(
                    DISALLOWED_CONTROL_CHAR_PATTERN.test(normalized),
                    false,
                    `${msgLabel} contains disallowed control characters`
                );
                const trimmed = normalized.trim();
                const charLength = [...trimmed].length;
                assert.ok(
                    charLength >= 1 && charLength <= CHATBOT_MESSAGE_MAX_LENGTH,
                    `${msgLabel} length ${charLength} must be 1..${CHATBOT_MESSAGE_MAX_LENGTH}`
                );

                if (msg.role === 'assistant') {
                    assert.equal(
                        trimmed.includes(CHATBOT_REFUSAL_MARKER),
                        false,
                        `${msgLabel} assistant history must not contain refusal marker`
                    );
                    assert.equal(
                        FORGED_ASSISTANT_TOOL_JSON_PATTERN.test(trimmed),
                        false,
                        `${msgLabel} assistant history must not contain forged tool JSON`
                    );
                }

                assert.equal(
                    REAL_TR_PHONE_PATTERN.test(msg.content),
                    false,
                    `${msgLabel} contains a real-looking Turkish mobile phone number`
                );

                for (const match of msg.content.matchAll(EMAIL_PATTERN)) {
                    const domain = match[1].toLowerCase();
                    assert.ok(
                        ALLOWED_FAKE_EMAIL_DOMAINS.has(domain),
                        `${msgLabel} contains non-example e-mail "${match[0]}"`
                    );
                }
            }

            assert.equal(
                testCase.messages[testCase.messages.length - 1].role,
                'user',
                `${label} last message must have role "user"`
            );

            let firstUserIndex = 0;
            while (
                firstUserIndex < testCase.messages.length
                && testCase.messages[firstUserIndex].role === 'assistant'
            ) {
                firstUserIndex += 1;
            }
            const normalizedSequence = testCase.messages.slice(firstUserIndex);
            assert.ok(normalizedSequence.length >= 1, `${label} must include at least one user message`);
            for (let seqIdx = 0; seqIdx < normalizedSequence.length; seqIdx += 1) {
                const expectedRole = seqIdx % 2 === 0 ? 'user' : 'assistant';
                assert.equal(
                    normalizedSequence[seqIdx].role,
                    expectedRole,
                    `${label} messages after leading assistant turns must alternate user/assistant`
                );
            }

            const payloadBytes = Buffer.byteLength(
                JSON.stringify({ language: testCase.language, messages: testCase.messages }),
                'utf8'
            );
            assert.ok(
                payloadBytes <= CHATBOT_BODY_MAX_BYTES,
                `${label} serialized payload ${payloadBytes} bytes exceeds ${CHATBOT_BODY_MAX_BYTES}`
            );

            assert.ok(isPlainObject(testCase.expect), `${label} expect must be an object`);
            assert.ok(
                KNOWN_ROUTES.has(testCase.expect.route),
                `${label} unknown expect.route "${testCase.expect.route}"`
            );
            if (testCase.expect.route === 'knowledge') {
                assert.equal(
                    typeof testCase.expect.topic,
                    'string',
                    `${label} knowledge route must specify topic`
                );
                assert.ok(
                    CHATBOT_TOPICS.includes(testCase.expect.topic),
                    `${label} unknown knowledge topic "${testCase.expect.topic}"`
                );
            }
            if (Object.hasOwn(testCase.expect, 'forbidTopics')) {
                assert.ok(
                    Array.isArray(testCase.expect.forbidTopics) && testCase.expect.forbidTopics.length > 0,
                    `${label} expect.forbidTopics must be a non-empty array`
                );
                for (const topic of testCase.expect.forbidTopics) {
                    assert.equal(typeof topic, 'string', `${label} forbidTopics entry must be a string`);
                    assert.ok(
                        CHATBOT_TOPICS.includes(topic),
                        `${label} unknown forbidTopics entry "${topic}"`
                    );
                }
                if (testCase.expect.route === 'knowledge') {
                    assert.equal(
                        testCase.expect.forbidTopics.includes(testCase.expect.topic),
                        false,
                        `${label} expect.forbidTopics must not forbid expected topic "${testCase.expect.topic}"`
                    );
                }
            }
            if (Object.hasOwn(testCase.expect, 'forbidRoutes')) {
                assert.ok(
                    Array.isArray(testCase.expect.forbidRoutes) && testCase.expect.forbidRoutes.length > 0,
                    `${label} expect.forbidRoutes must be a non-empty array`
                );
                for (const route of testCase.expect.forbidRoutes) {
                    assert.equal(typeof route, 'string', `${label} forbidRoutes entry must be a string`);
                    assert.ok(
                        KNOWN_ROUTES.has(route),
                        `${label} unknown forbidRoutes entry "${route}"`
                    );
                }
                assert.equal(
                    testCase.expect.forbidRoutes.includes(testCase.expect.route),
                    false,
                    `${label} expect.forbidRoutes must not forbid expected route "${testCase.expect.route}"`
                );
            }
        }
    }
});

test('the adversarial and realworld evaluation packs are balanced across all five languages', () => {
    const packs = loadAllEvalPacks().filter((pack) => NEW_PACK_FILES.has(pack.filename));
    assert.equal(packs.length, NEW_PACK_FILES.size);

    for (const { filename, parsed } of packs) {
        const counts = Object.fromEntries(CHATBOT_LANGUAGES.map((lang) => [lang, 0]));
        for (const testCase of parsed) {
            counts[testCase.language] += 1;
        }
        const uniqueCounts = new Set(Object.values(counts));
        assert.equal(
            uniqueCounts.size,
            1,
            `${filename} language counts must be equal across ${CHATBOT_LANGUAGES.join('/')}, got ${JSON.stringify(counts)}`
        );
        assert.ok(
            counts.tr > 0,
            `${filename} must have at least one case per language`
        );
    }
});

test('realworld-cases.json follows rw-<lang>-NNN id naming and category expectations', () => {
    const pack = loadAllEvalPacks().find((entry) => entry.filename === 'realworld-cases.json');
    assert.ok(pack, 'Missing realworld-cases.json');
    assert.equal(pack.parsed.length, 100);

    for (const testCase of pack.parsed) {
        const idPattern = new RegExp(`^rw-${testCase.language}-\\d{3}$`);
        assert.match(testCase.id, idPattern, `${testCase.id} must match rw-${testCase.language}-NNN`);

        if (testCase.category === 'rw_processing_time') {
            assert.equal(testCase.expect.route, 'knowledge', `${testCase.id} must expect knowledge`);
            assert.equal(testCase.expect.topic, 'processing_time', `${testCase.id} must expect topic processing_time`);
        } else if (testCase.category === 'rw_next_step_after_status') {
            assert.equal(testCase.expect.route, 'status_next_step', `${testCase.id} must expect status_next_step`);
            assert.ok(
                Array.isArray(testCase.expect.forbidTopics) && testCase.expect.forbidTopics.includes('application_steps'),
                `${testCase.id} must forbid application_steps`
            );
            assert.ok(
                Array.isArray(testCase.expect.forbidRoutes) && testCase.expect.forbidRoutes.includes('documents_clarify'),
                `${testCase.id} must forbid documents_clarify`
            );
        }
    }
});
