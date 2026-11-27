import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { test } from 'node:test';
import { renderStudentDocumentRequirements } from '../src/public/applicationWizard.js';
import { createDocumentCard } from '../src/public/documentUploadCard.js';
import { initializeResubmissionUpload } from '../src/public/resubmissionUpload.js';
import { PUBLIC_MESSAGES, SESSION3_MESSAGES } from '../src/public/i18n/messages.js';

test('wizard still renders document cards with title, description, badge, status, preview, and delete', () => {
    const dom = new JSDOM('<!doctype html><html lang="tr" dir="ltr"><body><div id="root"></div></body></html>');
    const { document } = dom.window;
    const root = document.querySelector('#root');

    const requirement = {
        code: 'passport',
        label_key: 'documentPassport',
        description_key: 'documentPassportHelp',
        required: true,
        accepted_media_types: ['application/pdf'],
        max_byte_size: 5 * 1024 * 1024,
        filename: 'passport.pdf',
        upload_status: 'finalized',
        scan_status: 'pending'
    };

    renderStudentDocumentRequirements(root, [requirement]);
    const readonlyCard = root.querySelector('.application-document-card');
    assert.ok(readonlyCard);
    assert.equal(readonlyCard.tagName, 'ARTICLE');
    assert.equal(readonlyCard.dataset.documentCode, 'passport');
    assert.equal(readonlyCard.querySelector('h3').textContent, PUBLIC_MESSAGES.tr.documentPassport);
    assert.equal(readonlyCard.querySelector('p').textContent, SESSION3_MESSAGES.tr.documentPassportHelp);
    assert.equal(readonlyCard.querySelector('.requirement-badge.is-required').textContent, PUBLIC_MESSAGES.tr.required);
    assert.equal(readonlyCard.querySelector('.document-preview-link').getAttribute('href'), '/api/public/applications/current/documents/passport/preview');
    assert.equal(readonlyCard.querySelector('.application-upload-control'), null);

    const editableCard = createDocumentCard(document, requirement, {
        uploads: {},
        deleting: {}
    }, { allowUpload: true });
    assert.ok(editableCard.querySelector('.application-upload-control button[data-action="document-compose"]'));
    assert.ok(editableCard.querySelector('button[data-action="document-delete"]'));
    dom.window.close();
});

test('eligible resubmission card reuses shared upload card structure without duplicating fields', () => {
    const dom = new JSDOM('<!doctype html><html lang="tr" dir="ltr"><body><ul><li></li></ul></body></html>');
    const { document } = dom.window;
    const card = document.querySelector('li');

    initializeResubmissionUpload(card, {
        code: 'passport',
        label_key: 'documentPassport',
        description_key: 'documentPassportHelp',
        required: true,
        status: 'resubmission_required',
        filename: 'old-passport.pdf',
        student_message: 'Lütfen net fotoğraf yükleyin.',
        accepted_media_types: ['application/pdf'],
        max_byte_size: 5 * 1024 * 1024
    }, {});

    assert.equal(card.tagName, 'LI');
    assert.ok(card.classList.contains('tracking-document-card'));
    assert.ok(card.classList.contains('application-document-card'));
    assert.equal(card.querySelectorAll('h3').length, 1);
    assert.equal(card.querySelectorAll('.requirement-badge').length, 1);
    assert.equal(card.querySelectorAll('.document-upload-status').length, 1);
    assert.equal(card.querySelectorAll('.application-document-filename').length, 1);
    assert.equal(card.querySelectorAll('.document-preview-link').length, 1);
    assert.equal(card.querySelector('.tracking-document-message').textContent, 'Lütfen net fotoğraf yükleyin.');
    assert.ok(card.querySelector('.application-upload-control button[data-action="document-compose"]'));
    assert.equal(card.querySelector('button[data-action="document-delete"]'), null);
    dom.window.close();
});
