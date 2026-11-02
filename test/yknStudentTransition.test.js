import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
    hasYknStudentContextChanged,
    isCurrentYknWorkflowResponse,
    isCurrentYknTransferResponse
} from '../src/utils/ykn-student-transition.js';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

test('same Apply request and passport keep the current student context for the documents event', () => {
    const hasChanged = hasYknStudentContextChanged({
        currentStudent: { passportNo: ' ab 123 ' },
        incomingStudent: { pasaportNo: 'AB123' },
        currentRequestId: 'student-request-1',
        incomingRequestId: 'student-request-1'
    });

    assert.equal(hasChanged, false);
});

test('a new Apply request resets context even when the passport number is unchanged', () => {
    const hasChanged = hasYknStudentContextChanged({
        currentStudent: { passportNo: 'AB123' },
        incomingStudent: { passportNo: 'AB123' },
        currentRequestId: 'student-request-1',
        incomingRequestId: 'student-request-2'
    });

    assert.equal(hasChanged, true);
});

test('a different passport resets context even when Apply reuses the request id', () => {
    const hasChanged = hasYknStudentContextChanged({
        currentStudent: { passportNo: 'AB123' },
        incomingStudent: { passportNo: 'CD456' },
        currentRequestId: 'student-request-1',
        incomingRequestId: 'student-request-1'
    });

    assert.equal(hasChanged, true);
});

test('one-click responses are rejected after the active student request changes', () => {
    const isCurrent = isCurrentYknWorkflowResponse({
        responseRequestId: 'workflow-1',
        workflow: { workflowId: 'workflow-1', studentRequestId: 'student-request-1' },
        currentStudentRequestId: 'student-request-2'
    });

    assert.equal(isCurrent, false);
});

test('manual YÖKSİS search response must match the active operation request', () => {
    const isCurrent = isCurrentYknTransferResponse({
        responseRequestId: 'old-transfer',
        activeRequestId: 'new-transfer',
        workflow: null,
        currentStudentRequestId: 'student-request-2'
    });

    assert.equal(isCurrent, false);
});

test('current manual YÖKSİS search response is accepted', () => {
    const isCurrent = isCurrentYknTransferResponse({
        responseRequestId: 'transfer-2',
        activeRequestId: 'transfer-2',
        workflow: null,
        currentStudentRequestId: 'student-request-2'
    });

    assert.equal(isCurrent, true);
});

test('current manual YÖKSİS search response is accepted even when activeRequestId moved to a later step', () => {
    const isCurrent = isCurrentYknTransferResponse({
        responseRequestId: 'transfer-2',
        activeRequestId: 'copy-3',
        activeTransferRequestId: 'transfer-2',
        workflow: null,
        currentStudentRequestId: 'student-request-2'
    });

    assert.equal(isCurrent, true);
});

test('student event handlers reset context on transition and preserve it for the same request', async () => {
    const manager = await readFile(resolve(projectRoot, 'src/managers/yknManager.js'), 'utf8');
    const studentFoundStart = manager.indexOf("event.data.action === 'STUDENT_FOUND'");
    const documentsFoundStart = manager.indexOf("event.data.action === 'STUDENT_DOCUMENTS_FOUND'");
    const documentsNotFoundStart = manager.indexOf("event.data.action === 'DOCUMENTS_NOT_FOUND'");
    const studentFoundBody = manager.slice(studentFoundStart, documentsFoundStart);
    const documentsFoundBody = manager.slice(documentsFoundStart, documentsNotFoundStart);

    assert.match(studentFoundBody, /prepareStudentContextForUpdate\(incoming, requestId\)/);
    assert.match(documentsFoundBody, /prepareStudentContextForUpdate\(incoming, requestId\)/);
    assert.match(manager, /isCurrentYknWorkflowResponse\(/);
    assert.match(manager, /isCurrentYknTransferResponse\(/);
});
