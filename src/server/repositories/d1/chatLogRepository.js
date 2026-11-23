/**
 * Ana sayfa sohbet günlüğü (`chat_sessions`, `chat_turns`) için D1 yazma işlemlerini oluşturur.
 * Yalnız yazma tarafını içerir: oturum oluşturma, tur ekleme ve geri bildirim kaydetme.
 * @param {D1Database} database Cloudflare D1 bağlamı.
 * @returns {object} Sohbet günlüğü yazma deposu.
 */
export function createChatLogRepository(database) {
    if (!database) throw new TypeError('A D1 database binding is required.');

    return Object.freeze({
        /**
         * Yeni bir boş sohbet oturumu kaydı oluşturur.
         * @param {{id?: string, language: string, nowIso?: string}} input Oturum girdileri.
         * @returns {Promise<{id: string, language: string, created_at: string, last_at: string, turn_count: number}>} Oluşturulan oturum.
         */
        async createSession({
            id = crypto.randomUUID(),
            language,
            nowIso = new Date().toISOString()
        }) {
            await database.prepare(`
                INSERT INTO chat_sessions (id, language, created_at, last_at, turn_count)
                VALUES (?, ?, ?, ?, 0)
            `).bind(id, language, nowIso, nowIso).run();
            return {
                id,
                language,
                created_at: nowIso,
                last_at: nowIso,
                turn_count: 0
            };
        },

        /**
         * Sohbet turunu tek bir D1 toplu işleminde kaydeder; oturum yoksa (veya silinmişse) verilen kimlikle yeniden oluşturur, kimlik verilmediyse yeni kimlik kullanır.
         * @param {{sessionId?: string|null, newSessionId?: string, turnId?: string, language: string, userText: string, assistantText: string, outcome: string, tools?: string, latencyMs?: number, nowIso?: string}} input Tur girdileri.
         * @returns {Promise<{sessionId: string, turnId: string}>} Kullanılan oturum ve tur kimlikleri.
         */
        async appendTurn({
            sessionId = null,
            newSessionId = crypto.randomUUID(),
            turnId = crypto.randomUUID(),
            language,
            userText,
            assistantText,
            outcome,
            tools = '[]',
            latencyMs = 0,
            nowIso = new Date().toISOString()
        }) {
            const trimmedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
            const resolvedSessionId = trimmedSessionId || newSessionId || crypto.randomUUID();

            await database.batch([
                database.prepare(`
                    INSERT INTO chat_sessions (id, language, created_at, last_at, turn_count)
                    VALUES (?, ?, ?, ?, 0)
                    ON CONFLICT(id) DO NOTHING
                `).bind(resolvedSessionId, language, nowIso, nowIso),
                database.prepare(`
                    UPDATE chat_sessions
                    SET turn_count = turn_count + 1,
                        last_at = ?
                    WHERE id = ?
                `).bind(nowIso, resolvedSessionId),
                database.prepare(`
                    INSERT INTO chat_turns (
                        id, session_id, seq, user_text, assistant_text,
                        outcome, tools, latency_ms, created_at
                    ) VALUES (
                        ?, ?, (SELECT turn_count FROM chat_sessions WHERE id = ?),
                        ?, ?, ?, ?, ?, ?
                    )
                `).bind(
                    turnId,
                    resolvedSessionId,
                    resolvedSessionId,
                    userText,
                    assistantText,
                    outcome,
                    tools,
                    latencyMs,
                    nowIso
                )
            ]);
            return { sessionId: resolvedSessionId, turnId };
        },

        /**
         * Belirli bir sohbet turu için Evet/Hayır oyunu kaydeder (ikinci oy ilkinin üzerine yazar).
         * @param {{turnId: string, value: 'up'|'down', nowIso?: string}} input Geri bildirim girdileri.
         * @returns {Promise<boolean>} Tur bulunup güncellendiyse true, aksi halde false.
         */
        async setFeedback({
            turnId,
            value,
            nowIso = new Date().toISOString()
        }) {
            const result = await database.prepare(`
                UPDATE chat_turns
                SET feedback = ?,
                    feedback_at = ?
                WHERE id = ?
            `).bind(value, nowIso, turnId).run();
            return result?.meta?.changes === 1;
        }
    });
}
