-- Gelen ziyaretçi sorularına personel içi not ekleme alanlarını ekler.
ALTER TABLE office_inquiries ADD COLUMN staff_note TEXT CHECK (staff_note IS NULL OR length(trim(staff_note)) BETWEEN 1 AND 1000);
ALTER TABLE office_inquiries ADD COLUMN staff_note_updated_by_staff_id TEXT REFERENCES staff_users(id);
ALTER TABLE office_inquiries ADD COLUMN staff_note_updated_at TEXT;
