/**
 * Shared request, action, and response contract for the staff Topi assistant.
 * Both server routes and staff UI validate against these schemas before acting.
 */

/** @type {readonly string[]} */
export const STAFF_ASSISTANT_VIEWS = Object.freeze([
    'applications',
    'archive',
    'cover',
    'documents',
    'inquiries',
    'physical',
    'print',
    'teblig',
    'work-hours',
    'ykn',
    'yoksis-audit'
]);

/** @type {readonly string[]} */
export const STAFF_ASSISTANT_PEOPLE = Object.freeze([
    'kagan_samet',
    'asaf',
    'eyup',
    'oguz',
    'eray'
]);

/**
 * Mirrors `TOPI_STATES` in `src/public/topiMascot.js` without importing browser-only SVG/DOM helpers.
 * @type {readonly string[]}
 */
export const STAFF_ASSISTANT_STATES = Object.freeze([
    'idle',
    'thinking',
    'understood',
    'checking',
    'handoff',
    'confused',
    'sleepy',
    'hello'
]);

/** @type {number} */
export const STAFF_ASSISTANT_MAX_COPIES = 50;

const MAX_MESSAGE_LENGTH = 300;
const MAX_HISTORY_ITEMS = 6;
const MAX_RESULTS_ITEMS = 5;
const PASSPORT_NO_PATTERN = /^[A-Z0-9]{5,20}$/;
const DOCUMENT_ID_PATTERN = /^[a-z0-9-]{1,80}$/;

const VIEW_SET = new Set(STAFF_ASSISTANT_VIEWS);
const PEOPLE_SET = new Set(STAFF_ASSISTANT_PEOPLE);
const STATE_SET = new Set(STAFF_ASSISTANT_STATES);

const REQUEST_KEYS = new Set(['message', 'history']);
const HISTORY_ITEM_KEYS = new Set(['role', 'content']);
const RESPONSE_KEYS = new Set(['reply', 'state', 'action', 'results']);
const APPLICATION_RESULT_KEYS = new Set(['kind', 'total', 'items']);
const APPLICATION_ITEM_KEYS = new Set([
    'id',
    'referenceNumber',
    'studentNumber',
    'firstName',
    'lastName',
    'passportNumber',
    'status',
    'submittedAt'
]);
const YOKSIS_RESULT_KEYS = new Set(['kind', 'total', 'lastImportAt', 'items']);
const YOKSIS_ITEM_KEYS = new Set([
    'applicationNumber',
    'studentNumber',
    'fullName',
    'applicationStatus',
    'statusCategory',
    'missingDocuments',
    'missingDeadline',
    'unit',
    'scannedAt',
    'isStale'
]);
const MISSING_DOC_KEYS = new Set(['name', 'required', 'note']);

const ACTION_KEYS_BY_TYPE = Object.freeze({
    navigate: new Set(['type', 'view']),
    'ykn.run': new Set(['type', 'passportNo']),
    'documents.print': new Set(['type', 'documentId', 'copies']),
    'workHours.propose': new Set(['type', 'person', 'minutes', 'label']),
    'tebligat.search': new Set(['type', 'query'])
});

function isPlainObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function assertAllowedKeys(value, allowedKeys, errorMessage) {
    if (!isPlainObject(value)) throw new Error(errorMessage);
    for (const key of Object.keys(value)) {
        if (!allowedKeys.has(key)) throw new Error(errorMessage);
    }
}

function isString(value) {
    return typeof value === 'string';
}

function isNullableString(value) {
    return value === null || typeof value === 'string';
}

function validateApplicationItem(item) {
    assertAllowedKeys(item, APPLICATION_ITEM_KEYS, 'invalid-response');
    if (
        !isString(item.id)
        || !isString(item.referenceNumber)
        || !isString(item.studentNumber)
        || !isString(item.firstName)
        || !isString(item.lastName)
        || !isString(item.passportNumber)
        || !isString(item.status)
        || !isNullableString(item.submittedAt)
    ) {
        throw new Error('invalid-response');
    }
    return {
        id: item.id,
        referenceNumber: item.referenceNumber,
        studentNumber: item.studentNumber,
        firstName: item.firstName,
        lastName: item.lastName,
        passportNumber: item.passportNumber,
        status: item.status,
        submittedAt: item.submittedAt
    };
}

function validateMissingDocument(doc) {
    assertAllowedKeys(doc, MISSING_DOC_KEYS, 'invalid-response');
    if (!isString(doc.name) || typeof doc.required !== 'boolean' || !isString(doc.note)) {
        throw new Error('invalid-response');
    }
    return {
        name: doc.name,
        required: doc.required,
        note: doc.note
    };
}

function validateYoksisAuditItem(item) {
    assertAllowedKeys(item, YOKSIS_ITEM_KEYS, 'invalid-response');
    if (
        !isString(item.applicationNumber)
        || !isString(item.studentNumber)
        || !isString(item.fullName)
        || !isString(item.applicationStatus)
        || !isString(item.statusCategory)
        || !Array.isArray(item.missingDocuments)
        || !isNullableString(item.missingDeadline)
        || !isString(item.unit)
        || !isNullableString(item.scannedAt)
        || typeof item.isStale !== 'boolean'
    ) {
        throw new Error('invalid-response');
    }
    return {
        applicationNumber: item.applicationNumber,
        studentNumber: item.studentNumber,
        fullName: item.fullName,
        applicationStatus: item.applicationStatus,
        statusCategory: item.statusCategory,
        missingDocuments: item.missingDocuments.map(validateMissingDocument),
        missingDeadline: item.missingDeadline,
        unit: item.unit,
        scannedAt: item.scannedAt,
        isStale: item.isStale
    };
}

function validateResultBlock(results) {
    if (!isPlainObject(results) || !isString(results.kind)) {
        throw new Error('invalid-response');
    }

    if (results.kind === 'applications') {
        assertAllowedKeys(results, APPLICATION_RESULT_KEYS, 'invalid-response');
        if (
            !Number.isInteger(results.total)
            || results.total < 0
            || !Array.isArray(results.items)
            || results.items.length > MAX_RESULTS_ITEMS
        ) {
            throw new Error('invalid-response');
        }
        return {
            kind: 'applications',
            total: results.total,
            items: results.items.map(validateApplicationItem)
        };
    }

    if (results.kind === 'yoksisAudit') {
        assertAllowedKeys(results, YOKSIS_RESULT_KEYS, 'invalid-response');
        if (
            !Number.isInteger(results.total)
            || results.total < 0
            || !isNullableString(results.lastImportAt)
            || !Array.isArray(results.items)
            || results.items.length > MAX_RESULTS_ITEMS
        ) {
            throw new Error('invalid-response');
        }
        return {
            kind: 'yoksisAudit',
            total: results.total,
            lastImportAt: results.lastImportAt,
            items: results.items.map(validateYoksisAuditItem)
        };
    }

    throw new Error('invalid-response');
}

/**
 * Validates and normalizes an incoming `POST /api/staff/assistant` request payload.
 * @param {unknown} value Raw parsed JSON body.
 * @returns {{ message: string, history: Array<{ role: 'user'|'assistant', content: string }> }}
 */
export function validateStaffAssistantRequest(value) {
    assertAllowedKeys(value, REQUEST_KEYS, 'invalid-request');

    if (!isString(value.message)) {
        throw new Error('invalid-request');
    }
    const message = value.message.trim();
    if (message.length < 1 || message.length > MAX_MESSAGE_LENGTH) {
        throw new Error('invalid-request');
    }

    let history = [];
    if (value.history !== undefined) {
        if (!Array.isArray(value.history) || value.history.length > MAX_HISTORY_ITEMS) {
            throw new Error('invalid-request');
        }
        history = value.history.map((item) => {
            assertAllowedKeys(item, HISTORY_ITEM_KEYS, 'invalid-request');
            if (
                (item.role !== 'user' && item.role !== 'assistant')
                || !isString(item.content)
                || item.content.length > MAX_MESSAGE_LENGTH
            ) {
                throw new Error('invalid-request');
            }
            return {
                role: item.role,
                content: item.content
            };
        });
    }

    return { message, history };
}

/**
 * Validates a staff assistant client action against the closed action union.
 * @param {unknown} value Candidate action object.
 * @returns {object} Normalized action object.
 */
export function validateStaffAssistantAction(value) {
    if (!isPlainObject(value) || !isString(value.type)) {
        throw new Error('invalid-action');
    }
    const allowedKeys = ACTION_KEYS_BY_TYPE[value.type];
    if (!allowedKeys) {
        throw new Error('invalid-action');
    }
    assertAllowedKeys(value, allowedKeys, 'invalid-action');

    switch (value.type) {
    case 'navigate': {
        if (!isString(value.view) || !VIEW_SET.has(value.view)) {
            throw new Error('invalid-action');
        }
        return { type: 'navigate', view: value.view };
    }
    case 'ykn.run': {
        if (!isString(value.passportNo) || !PASSPORT_NO_PATTERN.test(value.passportNo)) {
            throw new Error('invalid-action');
        }
        return { type: 'ykn.run', passportNo: value.passportNo };
    }
    case 'documents.print': {
        if (
            !isString(value.documentId)
            || !DOCUMENT_ID_PATTERN.test(value.documentId)
            || !Number.isInteger(value.copies)
            || value.copies < 1
            || value.copies > STAFF_ASSISTANT_MAX_COPIES
        ) {
            throw new Error('invalid-action');
        }
        return {
            type: 'documents.print',
            documentId: value.documentId,
            copies: value.copies
        };
    }
    case 'workHours.propose': {
        if (
            !isString(value.person)
            || !PEOPLE_SET.has(value.person)
            || !Number.isInteger(value.minutes)
            || value.minutes < 0
            || value.minutes > 1440
            || value.minutes % 30 !== 0
            || !isString(value.label)
            || value.label.trim().length < 1
            || value.label.length > 200
        ) {
            throw new Error('invalid-action');
        }
        return {
            type: 'workHours.propose',
            person: value.person,
            minutes: value.minutes,
            label: value.label
        };
    }
    case 'tebligat.search': {
        if (!isString(value.query)) {
            throw new Error('invalid-action');
        }
        const query = value.query.trim();
        if (query.length < 2 || query.length > 80) {
            throw new Error('invalid-action');
        }
        return { type: 'tebligat.search', query };
    }
    default:
        throw new Error('invalid-action');
    }
}

/**
 * Validates a staff assistant response payload before sending from server or applying on client.
 * @param {unknown} value Candidate response object.
 * @returns {object} Validated response object.
 */
export function validateStaffAssistantResponse(value) {
    assertAllowedKeys(value, RESPONSE_KEYS, 'invalid-response');

    if (
        !isString(value.reply)
        || value.reply.trim().length < 1
        || !isString(value.state)
        || !STATE_SET.has(value.state)
    ) {
        throw new Error('invalid-response');
    }

    const response = {
        reply: value.reply,
        state: value.state
    };

    if (value.action !== undefined) {
        try {
            response.action = validateStaffAssistantAction(value.action);
        } catch {
            throw new Error('invalid-response');
        }
    }

    if (value.results !== undefined) {
        response.results = validateResultBlock(value.results);
    }

    return response;
}
