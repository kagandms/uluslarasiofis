import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { TestD1Database } from './helpers/d1-test-binding.js';
import {
    RATING_FEEDBACK_MAX_LENGTH,
    createApplicationRatingDto,
    roundAverageRating,
    validateApplicationRatingBody
} from '../src/server/domain/applicationRating.js';
import { createApplicationRatingRepository } from '../src/server/repositories/d1/applicationRatingRepository.js';

function expectValidationError(body, code) {
    assert.throws(() => validateApplicationRatingBody(body), (error) => error.code === code);
}

test('rating accepts whole and half stars from 1 to 5 and trims optional feedback', () => {
    assert.deepEqual(validateApplicationRatingBody({ rating: 1 }), { ratingHalfStars: 2, feedback: '' });
    assert.deepEqual(validateApplicationRatingBody({ rating: 4.5, feedback: '  Daha hızlı dönüş lütfen.  ' }), {
        ratingHalfStars: 9, feedback: 'Daha hızlı dönüş lütfen.'
    });
    assert.deepEqual(validateApplicationRatingBody({ rating: 5, feedback: null }), { ratingHalfStars: 10, feedback: '' });
    assert.equal(validateApplicationRatingBody({ rating: 3.5 }).ratingHalfStars, 7);
});

test('rating rejects values outside half-star steps and range', () => {
    for (const rating of [0, 0.5, 0.7, 3.25, 5.5, 6, -1, NaN, Infinity, '4', null, undefined]) {
        expectValidationError({ rating }, 'RATING_INVALID');
    }
});

test('rating rejects unknown fields, non-object bodies, and oversized feedback', () => {
    expectValidationError(null, 'VALIDATION_ERROR');
    expectValidationError([], 'VALIDATION_ERROR');
    expectValidationError({ rating: 4, score: 5 }, 'VALIDATION_ERROR');
    expectValidationError({ rating: 4, feedback: 12 }, 'VALIDATION_ERROR');
    expectValidationError({ rating: 4, feedback: 'a'.repeat(RATING_FEEDBACK_MAX_LENGTH + 1) }, 'FEEDBACK_TOO_LONG');
    assert.equal(validateApplicationRatingBody({ rating: 4, feedback: 'a'.repeat(RATING_FEEDBACK_MAX_LENGTH) }).feedback.length, RATING_FEEDBACK_MAX_LENGTH);
});

test('average rounds to one decimal in stars and stays null without ratings', () => {
    assert.equal(roundAverageRating(null), null);
    assert.equal(roundAverageRating(8), 4);
    assert.equal(roundAverageRating((9 + 8 + 7) / 3), 4);
    assert.equal(roundAverageRating((9 + 9 + 10) / 3), 4.7);
    assert.deepEqual(createApplicationRatingDto({ rating_half_stars: 7, feedback: 'x', updated_at: 't' }), { rating: 3.5, feedback: 'x', updated_at: 't' });
});

function createMigratedDatabase() {
    const DB = new TestD1Database();
    const directory = new URL('../migrations/', import.meta.url);
    for (const file of readdirSync(directory).filter((name) => name.endsWith('.sql')).sort()) {
        DB.exec(readFileSync(new URL(file, directory), 'utf8'));
    }
    DB.exec("INSERT INTO students (id, student_number, normalized_student_number) VALUES ('s1', 'S-100', 'S100'), ('s2', 'S-200', 'S200'), ('s3', 'S-300', 'S300')");
    DB.exec(`INSERT INTO applications (id, student_id, application_type, status, first_name, last_name, reference_number)
             VALUES ('a1', 's1', 'initial', 'submitted', 'Ayşe', 'Yılmaz', 'ITU-A1'),
                    ('a2', 's2', 'initial', 'under_review', 'Ali', 'Demir', 'ITU-A2'),
                    ('a3', 's3', 'initial', 'draft', 'Taslak', 'Kişi', 'ITU-A3')`);
    return DB;
}

test('repository stores one rating per application, updates it, and keeps the first submission time', async () => {
    const DB = createMigratedDatabase();
    const repository = createApplicationRatingRepository(DB);
    assert.equal(await repository.readByApplicationId('a1'), null);

    await repository.upsert({ applicationId: 'a1', ratingHalfStars: 9, feedback: 'İlk görüş', now: '2026-11-10T09:00:00.000Z' });
    await repository.upsert({ applicationId: 'a1', ratingHalfStars: 7, feedback: 'Güncel görüş', now: '2026-11-10T10:00:00.000Z' });

    const row = await repository.readByApplicationId('a1');
    assert.equal(row.rating_half_stars, 7);
    assert.equal(row.feedback, 'Güncel görüş');
    assert.equal(row.created_at, '2026-11-10T09:00:00.000Z');
    assert.equal(row.updated_at, '2026-11-10T10:00:00.000Z');
    assert.equal(DB.prepare('SELECT COUNT(*) AS n FROM application_ratings').first().n, 1);
});

test('summary excludes drafts and soft-deleted applications, and staff list shows identifiers newest first', async () => {
    const DB = createMigratedDatabase();
    const repository = createApplicationRatingRepository(DB);
    await repository.upsert({ applicationId: 'a1', ratingHalfStars: 10, feedback: '', now: '2026-11-10T09:00:00.000Z' });
    await repository.upsert({ applicationId: 'a2', ratingHalfStars: 7, feedback: 'Belge bilgisi net değil.', now: '2026-11-10T11:00:00.000Z' });

    // A draft cannot be rated through the route, but the summary must still ignore one if a row ever exists.
    DB.exec('PRAGMA foreign_keys = OFF');
    await repository.upsert({ applicationId: 'a3', ratingHalfStars: 2, feedback: '', now: '2026-11-10T12:00:00.000Z' });
    DB.exec("INSERT INTO application_deletions (application_id, previous_status, state, deleted_by_staff_id, deleted_at) VALUES ('a1', 'submitted', 'soft_deleted', 'missing-staff', '2026-11-10T08:00:00.000Z')");
    DB.exec('PRAGMA foreign_keys = ON');

    const summary = await repository.summarize();
    assert.equal(summary.count, 1);
    assert.equal(roundAverageRating(summary.averageHalfStars), 3.5);

    const listed = await repository.listForStaff({ limit: 10 });
    assert.deepEqual(listed.map((row) => row.application_id), ['a2']);
    assert.equal(listed[0].student_number, 'S-200');
    assert.equal(listed[0].reference_number, 'ITU-A2');
    assert.equal(listed[0].first_name, 'Ali');
    assert.equal(listed[0].feedback, 'Belge bilgisi net değil.');
});

test('database constraints reject non-half-star values and oversized feedback', async () => {
    const DB = createMigratedDatabase();
    assert.throws(() => DB.exec("INSERT INTO application_ratings (application_id, rating_half_stars, feedback, created_at, updated_at) VALUES ('a1', 11, '', 't', 't')"));
    assert.throws(() => DB.exec("INSERT INTO application_ratings (application_id, rating_half_stars, feedback, created_at, updated_at) VALUES ('a1', 1, '', 't', 't')"));
    assert.throws(() => DB.exec(`INSERT INTO application_ratings (application_id, rating_half_stars, feedback, created_at, updated_at) VALUES ('a1', 6, '${'x'.repeat(1001)}', 't', 't')`));
});
