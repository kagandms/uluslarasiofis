CREATE TABLE printer_heartbeats_0013 (
    printer_id TEXT PRIMARY KEY NOT NULL,
    runner_id TEXT NOT NULL,
    health TEXT NOT NULL CHECK (health IN ('ready', 'unavailable')),
    printer_name TEXT NOT NULL CHECK (length(printer_name) BETWEEN 1 AND 128),
    seen_at TEXT NOT NULL,
    settings_protocol INTEGER NOT NULL DEFAULT 0 CHECK (settings_protocol IN (0, 1, 2, 3))
);

INSERT INTO printer_heartbeats_0013(printer_id,runner_id,health,printer_name,seen_at,settings_protocol)
SELECT printer_id,runner_id,health,printer_name,seen_at,settings_protocol FROM printer_heartbeats;

DROP TABLE printer_heartbeats;
ALTER TABLE printer_heartbeats_0013 RENAME TO printer_heartbeats;
