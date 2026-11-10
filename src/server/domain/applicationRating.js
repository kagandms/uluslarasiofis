import { ApiError } from './errors.js';

export const RATING_FEEDBACK_MAX_LENGTH = 1000;
const RATING_ALLOWED_KEYS = Object.freeze(['rating', 'feedback']);

/**
 * Validates the student's satisfaction rating. Stars run from 1 to 5 in half-star steps.
 * @param {unknown} body Parsed JSON request body.
 * @returns {{ratingHalfStars: number, feedback: string}} Integer half-star value and trimmed feedback.
 * @throws {ApiError} When a field is unknown or the rating or feedback is invalid.
 */
export function validateApplicationRatingBody(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Değerlendirmenizi kontrol edip tekrar deneyin.');
    }
    if (Object.keys(body).some((key) => !RATING_ALLOWED_KEYS.includes(key))) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Değerlendirmenizi kontrol edip tekrar deneyin.');
    }
    const rating = body.rating;
    const isHalfStep = typeof rating === 'number' && Number.isFinite(rating) && Number.isInteger(rating * 2);
    if (!isHalfStep || rating < 1 || rating > 5) {
        throw new ApiError(400, 'RATING_INVALID', 'Lütfen 1 ile 5 yıldız arasında bir puan seçin.');
    }
    const feedback = body.feedback === undefined || body.feedback === null ? '' : body.feedback;
    if (typeof feedback !== 'string') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Geri dönüş metnini kontrol edip tekrar deneyin.');
    }
    const trimmed = feedback.trim();
    if (trimmed.length > RATING_FEEDBACK_MAX_LENGTH) {
        throw new ApiError(400, 'FEEDBACK_TOO_LONG', `Geri dönüş en fazla ${RATING_FEEDBACK_MAX_LENGTH} karakter olabilir.`);
    }
    return { ratingHalfStars: rating * 2, feedback: trimmed };
}

/**
 * Converts a stored rating row into the student-facing shape.
 * @param {{rating_half_stars: number, feedback: string, updated_at: string}} row Stored rating row.
 * @returns {{rating: number, feedback: string, updated_at: string}} Star value in half-star steps.
 */
export function createApplicationRatingDto(row) {
    return { rating: row.rating_half_stars / 2, feedback: row.feedback, updated_at: row.updated_at };
}

/**
 * Rounds an average half-star sum to one decimal place of stars, or null when nothing is rated.
 * @param {number|null} averageHalfStars Average of stored half-star values.
 * @returns {number|null} Average star value such as 4.3.
 */
export function roundAverageRating(averageHalfStars) {
    if (averageHalfStars === null || averageHalfStars === undefined || !Number.isFinite(averageHalfStars)) return null;
    return Math.round((averageHalfStars / 2) * 10) / 10;
}
