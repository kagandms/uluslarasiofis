/**
 * Creates persistence operations for the student's application-system rating.
 * Soft-deleted applications are excluded from staff reads; drafts are excluded by the route.
 * @param {D1Database} database Cloudflare D1 binding.
 * @returns {object} Narrow read, upsert, summary, and staff listing operations.
 */
export function createApplicationRatingRepository(database) {
    return Object.freeze({
        async readByApplicationId(applicationId) {
            return database.prepare(`
                SELECT rating_half_stars, feedback, created_at, updated_at
                FROM application_ratings WHERE application_id = ?
            `).bind(applicationId).first();
        },
        async upsert({ applicationId, ratingHalfStars, feedback, now }) {
            await database.prepare(`
                INSERT INTO application_ratings (application_id, rating_half_stars, feedback, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(application_id) DO UPDATE SET
                    rating_half_stars = excluded.rating_half_stars,
                    feedback = excluded.feedback,
                    updated_at = excluded.updated_at
            `).bind(applicationId, ratingHalfStars, feedback, now, now).run();
        },
        async summarize() {
            const row = await database.prepare(`
                SELECT COUNT(*) AS rating_count, AVG(ratings.rating_half_stars) AS average_half_stars
                FROM application_ratings AS ratings
                JOIN applications ON applications.id = ratings.application_id
                LEFT JOIN application_deletions AS deletions ON deletions.application_id = applications.id
                WHERE deletions.application_id IS NULL AND applications.status <> 'draft'
            `).first();
            return {
                count: row?.rating_count ?? 0,
                averageHalfStars: row?.average_half_stars ?? null
            };
        },
        async listForStaff({ limit }) {
            const result = await database.prepare(`
                SELECT ratings.application_id, ratings.rating_half_stars, ratings.feedback, ratings.updated_at,
                       ratings.created_at, applications.status, applications.reference_number,
                       applications.first_name, applications.last_name, students.student_number
                FROM application_ratings AS ratings
                JOIN applications ON applications.id = ratings.application_id
                JOIN students ON students.id = applications.student_id
                LEFT JOIN application_deletions AS deletions ON deletions.application_id = applications.id
                WHERE deletions.application_id IS NULL AND applications.status <> 'draft'
                ORDER BY ratings.updated_at DESC, ratings.application_id DESC
                LIMIT ?
            `).bind(limit).all();
            return result.results ?? [];
        }
    });
}
