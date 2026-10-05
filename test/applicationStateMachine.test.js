import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateApplicationTransition } from '../src/server/domain/applicationStateMachine.js';

test('application state machine accepts only the specified forward transitions', () => {
    const allowedTransitions = [
        ['submitted', 'under_review'],
        ['resubmission_required', 'under_review'],
        ['under_review', 'approved_for_processing'],
        ['approved_for_processing', 'sent_to_migration'],
        ['sent_to_migration', 'migration_approved'],
        ['migration_approved', 'completed']
    ];

    for (const [currentStatus, targetStatus] of allowedTransitions) {
        assert.deepEqual(evaluateApplicationTransition(currentStatus, targetStatus, {
            allRequiredDocumentsApproved: true
        }), { allowed: true, code: null });
    }
});

test('application state machine accepts single-step rollback transitions for active processing states', () => {
    const allowedRollbacks = [
        ['approved_for_processing', 'under_review'],
        ['sent_to_migration', 'approved_for_processing'],
        ['migration_approved', 'sent_to_migration'],
        ['completed', 'migration_approved']
    ];

    for (const [currentStatus, targetStatus] of allowedRollbacks) {
        assert.deepEqual(evaluateApplicationTransition(currentStatus, targetStatus, {
            allRequiredDocumentsApproved: true
        }), { allowed: true, code: null }, `${currentStatus} -> ${targetStatus} rollback must be allowed`);
    }
});

test('application state machine rejects invalid reverse, skipped, terminal, and arbitrary transitions', () => {
    const deniedTransitions = [
        ['draft', 'completed'], ['submitted', 'completed'], ['submitted', 'approved_for_processing'],
        ['under_review', 'sent_to_migration'], ['under_review', 'submitted'],
        ['completed', 'under_review'], ['completed', 'sent_to_migration'], ['completed', 'approved_for_processing'],
        ['sent_to_migration', 'submitted'], ['sent_to_migration', 'under_review'],
        ['migration_approved', 'under_review'], ['migration_approved', 'approved_for_processing'],
        ['cancelled', 'under_review'], ['submitted', 'made_up']
    ];

    for (const [currentStatus, targetStatus] of deniedTransitions) {
        assert.deepEqual(evaluateApplicationTransition(currentStatus, targetStatus), {
            allowed: false, code: 'INVALID_APPLICATION_TRANSITION'
        });
    }
});

test('application state machine guards review completion against unresolved document state', () => {
    assert.deepEqual(evaluateApplicationTransition('resubmission_required', 'under_review', {
        hasResubmissionRequiredDocuments: true
    }), { allowed: false, code: 'RESUBMISSION_DOCUMENTS_REMAIN' });
    assert.deepEqual(evaluateApplicationTransition('under_review', 'approved_for_processing', {
        allRequiredDocumentsApproved: false
    }), { allowed: false, code: 'APPLICATION_NOT_READY_FOR_APPROVAL' });
    assert.deepEqual(evaluateApplicationTransition('under_review', 'approved_for_processing', {
        allRequiredDocumentsApproved: true
    }), { allowed: true, code: null });
});
