import { requireApplicationSession } from '../auth/applicationAuth.js';
import { requireStaff } from '../auth/staffAuth.js';
import { ApiError } from '../domain/errors.js';
import {
    createApplicationRatingDto,
    roundAverageRating,
    validateApplicationRatingBody
} from '../domain/applicationRating.js';
import { readJsonBody } from '../http/requestBody.js';
import { createD1Repositories } from '../repositories/d1/index.js';
import { requireMethod, requireSameOrigin } from './shared.js';

const STAFF_ROLES = Object.freeze(['reviewer', 'admin']);
const STAFF_LIST_DEFAULT_LIMIT = 100;
const STAFF_LIST_MAX_LIMIT = 200;

/**
 * Reads the rating left by the current owner's application, or null when none exists yet.
 * @param {Request} request Worker request.
 * @param {object} environment Worker bindings.
 * @returns {Promise<{rating: object|null}>} Student-safe rating.
 * @throws {ApiError} When the owner session is missing or invalid.
 */
export async function readCurrentApplicationRating(request, environment) {
    requireMethod(request, 'GET');
    const session = await requireApplicationSession(request, environment);
    const row = await createD1Repositories(environment.DB).applicationRatings.readByApplicationId(session.application_id);
    return { rating: row ? createApplicationRatingDto(row) : null };
}

/**
 * Saves or updates the current owner's rating. Ratings are accepted only after the application is submitted.
 * @param {Request} request Worker request.
 * @param {object} environment Worker bindings.
 * @returns {Promise<{rating: object}>} Saved student-safe rating.
 * @throws {ApiError} When origin, session, body, or application state validation fails.
 */
export async function saveCurrentApplicationRating(request, environment) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    const session = await requireApplicationSession(request, environment);
    const input = validateApplicationRatingBody(await readJsonBody(request));
    const repositories = createD1Repositories(environment.DB);
    const application = await repositories.applications.findCurrentStatusById(session.application_id);
    if (!application) throw new ApiError(404, 'APPLICATION_NOT_FOUND', 'Başvuru bulunamadı.');
    if (application.status === 'draft') {
        throw new ApiError(409, 'APPLICATION_NOT_SUBMITTED', 'Değerlendirme, başvurunuzu gönderdikten sonra yapılabilir.');
    }
    await repositories.applicationRatings.upsert({
        applicationId: session.application_id,
        ratingHalfStars: input.ratingHalfStars,
        feedback: input.feedback,
        now: new Date().toISOString()
    });
    const row = await repositories.applicationRatings.readByApplicationId(session.application_id);
    return { rating: createApplicationRatingDto(row) };
}

/**
 * Lists student ratings for staff with a summary. Staff see the reference and student identifiers needed to match
 * each rating to an application.
 * @param {Request} request Worker request.
 * @param {object} environment Worker bindings.
 * @returns {Promise<{summary: object, items: Array<object>}>} Summary and recent ratings.
 * @throws {ApiError} When the staff session or limit is invalid.
 */
export async function readStaffApplicationRatings(request, environment) {
    requireMethod(request, 'GET');
    await requireStaff(request, environment, STAFF_ROLES);
    const limit = readStaffListLimit(new URL(request.url).searchParams.get('limit'));
    const repositories = createD1Repositories(environment.DB);
    const [summary, rows] = await Promise.all([
        repositories.applicationRatings.summarize(),
        repositories.applicationRatings.listForStaff({ limit })
    ]);
    return {
        summary: {
            count: summary.count,
            average: roundAverageRating(summary.averageHalfStars)
        },
        items: rows.map((row) => ({
            application_id: row.application_id,
            reference_number: row.reference_number ?? null,
            student_number: row.student_number,
            student_name: [row.first_name, row.last_name].filter(Boolean).join(' ') || null,
            status: row.status,
            rating: row.rating_half_stars / 2,
            feedback: row.feedback,
            created_at: row.created_at,
            updated_at: row.updated_at
        }))
    };
}

function readStaffListLimit(rawLimit) {
    if (rawLimit === null || rawLimit === '') return STAFF_LIST_DEFAULT_LIMIT;
    const limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > STAFF_LIST_MAX_LIMIT) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Liste sınırı 1 ile 200 arasında olmalıdır.');
    }
    return limit;
}
