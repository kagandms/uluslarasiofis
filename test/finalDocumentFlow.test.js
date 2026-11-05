import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { TestD1Database } from './helpers/d1-test-binding.js';
import { ACCOMMODATION_TYPES, listRequiredDocumentAnswers } from '../src/shared/document-conditions.js';

test('final address choices and host facts do not require obsolete insurance or family questions', () => {
    assert.ok(ACCOMMODATION_TYPES.includes('residence_certificate'));
    assert.deepEqual(listRequiredDocumentAnswers({ is_under_18: 1, final_document_policy: 1 }), []);
    assert.deepEqual(listRequiredDocumentAnswers({ accommodation_type: 'undertaking', final_document_policy: 1 }), ['host_is_married', 'host_is_turkish']);
    assert.ok(listRequiredDocumentAnswers({ is_under_18: 1, final_document_policy: 0 }).includes('minor_family_status'));
});

test('final migration preserves submitted snapshots and upgrades drafts without deleting applications', () => {
    const DB = new TestD1Database();
    const directory = new URL('../migrations/', import.meta.url);
    const files = readdirSync(directory).filter(file => file.endsWith('.sql')).sort();
    for (const file of files.filter(file => file < '0038')) DB.exec(readFileSync(new URL(file, directory), 'utf8'));
    DB.exec("INSERT INTO students (id,student_number,normalized_student_number) VALUES ('s1','S1','S1'),('s2','S2','S2')");
    DB.exec("INSERT INTO applications (id,student_id,application_type,status) VALUES ('submitted','s1','initial','submitted'),('draft','s2','initial','draft')");
    DB.exec(readFileSync(new URL('0038_final_application_documents.sql', directory), 'utf8'));
    assert.equal(DB.prepare("SELECT final_document_policy FROM applications WHERE id='submitted'").first().final_document_policy, 0);
    assert.equal(DB.prepare("SELECT final_document_policy FROM applications WHERE id='draft'").first().final_document_policy, 1);
    assert.equal(DB.prepare('SELECT COUNT(*) AS n FROM applications').first().n, 2);
    assert.equal(DB.prepare('PRAGMA foreign_key_check').all().results.length, 0);
    for (const code of ['address_dask', 'dormitory_tax_certificate', 'dormitory_signature_circular', 'host_population_record']) {
        assert.equal(DB.prepare('SELECT COUNT(*) AS n FROM document_requirements WHERE code=? AND is_active=1').bind(code).first().n, 2);
    }
});
