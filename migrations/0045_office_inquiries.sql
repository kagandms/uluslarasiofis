-- Ana sayfa "Sorunuz mu var?" formundan gelen ziyaretçi sorularını saklar.
-- Personel silene kadar saklanır; doğrulama kısıtlamaları API sözleşmesiyle eşleşir.
CREATE TABLE office_inquiries (
    id TEXT PRIMARY KEY NOT NULL,
    first_name TEXT NOT NULL CHECK (length(trim(first_name)) BETWEEN 1 AND 60),
    last_name TEXT NOT NULL CHECK (length(trim(last_name)) BETWEEN 1 AND 60),
    phone TEXT NOT NULL CHECK (length(trim(phone)) BETWEEN 7 AND 40),
    email TEXT CHECK (email IS NULL OR (length(trim(email)) BETWEEN 5 AND 254 AND email LIKE '%_@_%._%')),
    message TEXT NOT NULL CHECK (length(trim(message)) BETWEEN 5 AND 1000),
    language TEXT NOT NULL CHECK (language IN ('tr', 'en', 'ru', 'tk', 'ar')),
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'answered')),
    handled_by_staff_id TEXT REFERENCES staff_users(id) ON DELETE RESTRICT,
    handled_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_office_inquiries_status_created ON office_inquiries(status, created_at DESC);
CREATE INDEX idx_office_inquiries_created ON office_inquiries(created_at DESC);
