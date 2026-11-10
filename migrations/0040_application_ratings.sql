-- Student satisfaction rating for the application system, one row per application.
-- rating_half_stars stores the star value doubled (2 = 1 star, 9 = 4.5 stars, 10 = 5 stars) so half-star
-- values stay exact integers. The student may update the rating; created_at keeps the first submission time.
CREATE TABLE application_ratings (
    application_id TEXT PRIMARY KEY NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    rating_half_stars INTEGER NOT NULL CHECK (rating_half_stars BETWEEN 2 AND 10),
    feedback TEXT NOT NULL DEFAULT '' CHECK (length(feedback) <= 1000),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_application_ratings_updated ON application_ratings(updated_at DESC, application_id DESC);
