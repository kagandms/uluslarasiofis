-- Ana sayfa halka açık sohbet oturumlarını, turlarını ve Evet/Hayır oylarını saklar.
-- IP adresi, tarayıcı bilgisi veya başvuru kimliği tutulmaz; personel silene kadar saklanır.
CREATE TABLE chat_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    language TEXT NOT NULL CHECK (language IN ('tr', 'en', 'ru', 'tk', 'ar')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    turn_count INTEGER NOT NULL DEFAULT 0 CHECK (turn_count >= 0)
);

CREATE TABLE chat_turns (
    id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL CHECK (seq >= 1),
    user_text TEXT NOT NULL CHECK (length(user_text) BETWEEN 1 AND 500),
    assistant_text TEXT NOT NULL CHECK (length(assistant_text) BETWEEN 1 AND 4000),
    outcome TEXT NOT NULL CHECK (length(trim(outcome)) BETWEEN 1 AND 64),
    tools TEXT NOT NULL DEFAULT '[]',
    latency_ms INTEGER NOT NULL DEFAULT 0 CHECK (latency_ms >= 0),
    feedback TEXT DEFAULT NULL CHECK (feedback IS NULL OR feedback IN ('up', 'down')),
    feedback_at TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (session_id, seq)
);

CREATE INDEX idx_chat_sessions_last_at ON chat_sessions(last_at DESC);
CREATE INDEX idx_chat_turns_created ON chat_turns(created_at DESC);
CREATE INDEX idx_chat_turns_feedback_created ON chat_turns(feedback, created_at DESC);
CREATE INDEX idx_chat_turns_outcome_created ON chat_turns(outcome, created_at DESC);
