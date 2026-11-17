-- Personel içi kayıt notları: her online başvuru veya fiziksel teslim kaydı için en fazla bir kısa not saklar.
-- Öğrencilere hiçbir zaman döndürülmez; iki farklı hedef tablo olduğu için kayıt varlığı uygulama katmanında doğrulanır.
CREATE TABLE staff_record_notes (
    record_kind TEXT NOT NULL CHECK(record_kind IN ('online','physical')),
    record_id TEXT NOT NULL,
    body TEXT NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 500),
    created_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
    created_at TEXT NOT NULL,
    updated_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (record_kind, record_id)
);
