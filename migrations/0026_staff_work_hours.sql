CREATE TABLE staff_work_hours (
    id TEXT PRIMARY KEY,
    staff_key TEXT NOT NULL CHECK (staff_key IN ('kagan_samet', 'asaf', 'eyup', 'oguz', 'eray')),
    work_date TEXT NOT NULL CHECK (length(work_date) = 10),
    minutes INTEGER NOT NULL CHECK (minutes BETWEEN 0 AND 1440 AND minutes % 30 = 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (staff_key, work_date)
);

CREATE INDEX idx_staff_work_hours_date ON staff_work_hours(work_date, staff_key);
