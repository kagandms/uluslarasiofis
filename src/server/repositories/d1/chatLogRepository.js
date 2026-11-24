const CHAT_SESSION_PAGE_SIZE = 25;
const CHAT_SESSION_PREVIEW_MAX_CHARS = 120;

/**
 * SQLite LIKE kalıbı için özel karakterleri (`\`, `%`, `_`) ters eğik çizgiyle kaçırır.
 * @param {string} value Ham arama metni.
 * @returns {string} `%...%` biçiminde güvenli LIKE kalıbı (`ESCAPE '\'` ile kullanılır).
 */
function escapeLikePattern(value) {
    return `%${value.replace(/[\\%_]/g, '\\$&')}%`;
}

/**
 * SQLite'ın yerleşik LIKE işleci yalnızca ASCII harflerde büyük/küçük harf duyarsızdır.
 * Türkçe büyük harfleri (`İ`, `I`, `Ş`, `Ğ`, `Ü`, `Ö`, `Ç`) sütun tarafında küçük karşılıklarına
 * indirgeyerek `toLocaleLowerCase('tr-TR')` kalıbıyla eşleşmesini sağlar.
 * @param {'t.user_text'|'t.assistant_text'} columnSql Sabit sütun ifadesi.
 * @returns {string} Türkçe büyük harfleri küçültülmüş SQL ifadesi.
 */
function buildTurkishFoldedColumnSql(columnSql) {
    return `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(${columnSql}, 'İ', 'i'), 'I', 'ı'), 'Ş', 'ş'), 'Ğ', 'ğ'), 'Ü', 'ü'), 'Ö', 'ö'), 'Ç', 'ç')`;
}

function truncatePreview(text) {
    if (typeof text !== 'string' || !text) return '';
    const chars = [...text];
    if (chars.length <= CHAT_SESSION_PREVIEW_MAX_CHARS) return text;
    return `${chars.slice(0, CHAT_SESSION_PREVIEW_MAX_CHARS - 1).join('')}…`;
}

function parseToolsJson(raw) {
    if (typeof raw !== 'string' || !raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
    } catch {
        return [];
    }
}

/**
 * Oturum listesi sayfalama imlecini `(last_at, id)` çiftinden kodlar.
 * @param {string} lastAt Son etkinlik zaman damgası.
 * @param {string} id Oturum kimliği.
 * @returns {string} URL-güvenli taban-64 imleç.
 */
export function encodeChatSessionCursor(lastAt, id) {
    return btoa(`${encodeURIComponent(lastAt)}|${encodeURIComponent(id)}`)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

/**
 * Oturum listesi sayfalama imlecini doğrular ve çözer.
 * @param {unknown} cursor Ham imleç dizesi.
 * @returns {{lastAt: string, id: string}|null} Geçerliyse `{ lastAt, id }`, aksi halde null.
 */
export function decodeChatSessionCursor(cursor) {
    if (typeof cursor !== 'string') return null;
    const trimmed = cursor.trim();
    if (!trimmed || trimmed.length > 256 || !/^[A-Za-z0-9_-]+$/.test(trimmed)) return null;
    try {
        const base64 = trimmed.replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
        const decoded = atob(padded);
        const parts = decoded.split('|');
        if (parts.length !== 2) return null;
        const lastAt = decodeURIComponent(parts[0]);
        const id = decodeURIComponent(parts[1]);
        if (!lastAt || !id || lastAt.length > 64 || id.length > 64) return null;
        return { lastAt, id };
    } catch {
        return null;
    }
}

/**
 * Ana sayfa sohbet günlüğü (`chat_sessions`, `chat_turns`) için D1 kalıcılık işlemlerini oluşturur.
 * Yazma (oturum, tur, geri bildirim) ve yetkili okuma/silme işlemlerini içerir.
 * @param {D1Database} database Cloudflare D1 bağlamı.
 * @returns {object} Sohbet günlüğü deposu.
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
        },

        /**
         * Sohbet oturumlarını en yeniden eskiye imleçli sayfalama ve süzgeçlerle listeler.
         * Metin araması (`query`) `user_text` ve `assistant_text` üzerinde `ESCAPE '\'` ile
         * parametreli `LIKE` uygular. SQLite `LIKE` yalnızca ASCII için büyük/küçük harf
         * duyarsız olduğundan, ham terimin yanında JS tarafında `toLocaleLowerCase('tr-TR')`
         * ve `toLowerCase()` ile üretilen çeşitlemeler `OR` ile eşleştirilir ve sütun tarafında
         * Türkçe büyük harf katlaması uygulanarak `İ`/`ı` aramalarının iki yönde de çalışması sağlanır.
         * `total` alanı tüm etkin süzgeçlere uyan toplam oturum sayısını döndürür ve imleci yok sayar.
         * @param {{filter?: 'all'|'down'|'handoff'|'refused'|'fallback', lang?: 'tr'|'en'|'ru'|'tk'|'ar'|null, sinceIso?: string|null, query?: string|null, cursor?: {lastAt: string, id: string}|null, limit?: number}} [options] Liste seçenekleri.
         * @returns {Promise<{items: Array<{id: string, language: string, created_at: string, last_at: string, turn_count: number, has_down_vote: boolean, first_user_text: string}>, nextCursor: string|null, total: number}>} Sayfa sonucu ve toplam eşleşme sayısı.
         */
        async listSessions({
            filter = 'all',
            lang = null,
            sinceIso = null,
            query = null,
            cursor = null,
            limit = CHAT_SESSION_PAGE_SIZE
        } = {}) {
            const safeLimit = Math.max(
                1,
                Math.min(CHAT_SESSION_PAGE_SIZE, Number.isSafeInteger(limit) ? limit : CHAT_SESSION_PAGE_SIZE)
            );
            const filterClauses = [];
            const filterBindings = [];

            if (filter === 'down') {
                filterClauses.push("EXISTS (SELECT 1 FROM chat_turns t WHERE t.session_id = s.id AND t.feedback = 'down')");
            } else if (filter === 'handoff') {
                filterClauses.push(`EXISTS (SELECT 1 FROM chat_turns t WHERE t.session_id = s.id AND (t.outcome = 'handoff' OR t.tools LIKE '%"handoff_to_office"%'))`);
            } else if (filter === 'refused') {
                filterClauses.push("EXISTS (SELECT 1 FROM chat_turns t WHERE t.session_id = s.id AND t.outcome = 'refusal')");
            } else if (filter === 'fallback') {
                filterClauses.push("EXISTS (SELECT 1 FROM chat_turns t WHERE t.session_id = s.id AND t.outcome = 'fallback')");
            }

            if (typeof lang === 'string' && lang) {
                filterClauses.push('s.language = ?');
                filterBindings.push(lang);
            }

            if (typeof sinceIso === 'string' && sinceIso) {
                filterClauses.push('datetime(s.last_at) >= datetime(?)');
                filterBindings.push(sinceIso);
            }

            if (typeof query === 'string' && query) {
                const trLower = query.toLocaleLowerCase('tr-TR');
                const plainLower = query.toLowerCase();
                const rawPatterns = [...new Set([query, trLower, plainLower])].map(escapeLikePattern);
                const trFoldedPattern = escapeLikePattern(trLower);
                const textMatchClauses = [];
                const textBindings = [];

                for (const pattern of rawPatterns) {
                    textMatchClauses.push(`t.user_text LIKE ? ESCAPE '\\'`);
                    textBindings.push(pattern);
                    textMatchClauses.push(`t.assistant_text LIKE ? ESCAPE '\\'`);
                    textBindings.push(pattern);
                }
                textMatchClauses.push(`${buildTurkishFoldedColumnSql('t.user_text')} LIKE ? ESCAPE '\\'`);
                textBindings.push(trFoldedPattern);
                textMatchClauses.push(`${buildTurkishFoldedColumnSql('t.assistant_text')} LIKE ? ESCAPE '\\'`);
                textBindings.push(trFoldedPattern);

                filterClauses.push(`EXISTS (SELECT 1 FROM chat_turns t WHERE t.session_id = s.id AND (${textMatchClauses.join(' OR ')}))`);
                filterBindings.push(...textBindings);
            }

            const filterWhereSql = filterClauses.length > 0 ? `WHERE ${filterClauses.join(' AND ')}` : '';
            const pageClauses = [...filterClauses];
            const pageBindings = [...filterBindings];

            if (cursor && typeof cursor.lastAt === 'string' && typeof cursor.id === 'string') {
                pageClauses.push('(s.last_at < ? OR (s.last_at = ? AND s.id < ?))');
                pageBindings.push(cursor.lastAt, cursor.lastAt, cursor.id);
            }

            const pageWhereSql = pageClauses.length > 0 ? `WHERE ${pageClauses.join(' AND ')}` : '';
            pageBindings.push(safeLimit + 1);

            const [countRow, result] = await Promise.all([
                database.prepare(`
                    SELECT COUNT(*) AS total
                    FROM chat_sessions AS s
                    ${filterWhereSql}
                `).bind(...filterBindings).first(),
                database.prepare(`
                    SELECT
                        s.id,
                        s.language,
                        s.created_at,
                        s.last_at,
                        s.turn_count,
                        EXISTS (
                            SELECT 1 FROM chat_turns td
                            WHERE td.session_id = s.id AND td.feedback = 'down'
                        ) AS has_down_vote,
                        (
                            SELECT tf.user_text FROM chat_turns tf
                            WHERE tf.session_id = s.id
                            ORDER BY tf.seq ASC
                            LIMIT 1
                        ) AS first_user_text
                    FROM chat_sessions AS s
                    ${pageWhereSql}
                    ORDER BY s.last_at DESC, s.id DESC
                    LIMIT ?
                `).bind(...pageBindings).all()
            ]);

            const rows = result.results ?? [];
            const hasMore = rows.length > safeLimit;
            const pageRows = hasMore ? rows.slice(0, safeLimit) : rows;
            const items = pageRows.map((row) => ({
                id: row.id,
                language: row.language,
                created_at: row.created_at,
                last_at: row.last_at,
                turn_count: Number(row.turn_count) || 0,
                has_down_vote: Boolean(row.has_down_vote),
                first_user_text: truncatePreview(row.first_user_text)
            }));
            const lastItem = items[items.length - 1];
            const nextCursor = hasMore && lastItem ? encodeChatSessionCursor(lastItem.last_at, lastItem.id) : null;
            const total = Number(countRow?.total) || 0;
            return { items, nextCursor, total };
        },

        /**
         * Tek bir sohbet oturumunu ve sıraya dizilmiş tüm turlarını okur.
         * @param {string} sessionId Oturum kimliği.
         * @returns {Promise<{session: {id: string, language: string, created_at: string, last_at: string, turn_count: number}, turns: Array<{id: string, seq: number, user_text: string, assistant_text: string, outcome: string, tools: string[], feedback: string|null, created_at: string}>}|null>} Oturum ve turlar veya null.
         */
        async getSessionWithTurns(sessionId) {
            const session = await database.prepare(`
                SELECT id, language, created_at, last_at, turn_count
                FROM chat_sessions
                WHERE id = ?
                LIMIT 1
            `).bind(sessionId).first();
            if (!session) return null;

            const turnsResult = await database.prepare(`
                SELECT id, seq, user_text, assistant_text, outcome, tools, feedback, created_at
                FROM chat_turns
                WHERE session_id = ?
                ORDER BY seq ASC
            `).bind(sessionId).all();

            return {
                session: {
                    id: session.id,
                    language: session.language,
                    created_at: session.created_at,
                    last_at: session.last_at,
                    turn_count: Number(session.turn_count) || 0
                },
                turns: (turnsResult.results ?? []).map((row) => ({
                    id: row.id,
                    seq: Number(row.seq) || 0,
                    user_text: row.user_text,
                    assistant_text: row.assistant_text,
                    outcome: row.outcome,
                    tools: parseToolsJson(row.tools),
                    feedback: row.feedback ?? null,
                    created_at: row.created_at
                }))
            };
        },

        /**
         * Tek bir sohbet oturumunu (turları CASCADE ile birlikte) kalıcı olarak siler.
         * Personel kimliği verildiyse sohbet metni içermeyen denetim kaydı da yazar.
         * @param {{id: string, staffId?: string|null, nowIso?: string, requestId?: string, auditId?: string}} input Silme girdileri.
         * @returns {Promise<boolean>} Oturum silindiyse true, bulunamadıysa false.
         */
        async deleteSessionById({
            id,
            staffId = null,
            nowIso = new Date().toISOString(),
            requestId = `req_${crypto.randomUUID()}`,
            auditId = crypto.randomUUID()
        }) {
            if (!staffId) {
                const result = await database.prepare(`
                    DELETE FROM chat_sessions
                    WHERE id = ?
                `).bind(id).run();
                return result?.meta?.changes === 1;
            }
            const safeMetadataJson = JSON.stringify({ sessionId: id, result: 'success' });
            const results = await database.batch([
                database.prepare(`
                    DELETE FROM chat_sessions
                    WHERE id = ?
                `).bind(id),
                database.prepare(`
                    INSERT INTO audit_events (
                        id, event_type, actor_type, actor_staff_id, application_id,
                        request_id, safe_metadata_json, created_at
                    )
                    SELECT ?, 'staff.chat_session_deleted', 'staff', ?, NULL, ?, ?, ?
                    WHERE changes() = 1
                `).bind(auditId, staffId, requestId, safeMetadataJson, nowIso)
            ]);
            return results[0]?.meta?.changes === 1;
        },

        /**
         * Belirtilen kesim zamanından daha eski tüm sohbet oturumlarını (turlarıyla birlikte) siler.
         * @param {{cutoffIso: string, olderThanDays?: number|null, staffId?: string|null, nowIso?: string, requestId?: string, auditId?: string}} input Toplu silme girdileri.
         * @returns {Promise<number>} Silinen oturum sayısı.
         */
        async deleteSessionsOlderThan({
            cutoffIso,
            olderThanDays = null,
            staffId = null,
            nowIso = new Date().toISOString(),
            requestId = `req_${crypto.randomUUID()}`,
            auditId = crypto.randomUUID()
        }) {
            const result = await database.prepare(`
                DELETE FROM chat_sessions
                WHERE datetime(last_at) < datetime(?)
            `).bind(cutoffIso).run();
            const deleted = Number(result?.meta?.changes) || 0;
            if (staffId && deleted > 0) {
                const safeMetadataJson = JSON.stringify({
                    olderThanDays,
                    deletedCount: deleted,
                    result: 'success'
                });
                await database.prepare(`
                    INSERT INTO audit_events (
                        id, event_type, actor_type, actor_staff_id, application_id,
                        request_id, safe_metadata_json, created_at
                    ) VALUES (?, 'staff.chat_sessions_purged', 'staff', ?, NULL, ?, ?, ?)
                `).bind(auditId, staffId, requestId, safeMetadataJson, nowIso).run();
            }
            return deleted;
        },

        /**
         * Verilen bugün ve son 7 gün başlangıç sınırlarına göre yanıt ve oy sayılarını hesaplar.
         * @param {{todayStartIso: string, last7StartIso: string}} input UTC ISO zaman sınırları.
         * @returns {Promise<{today: {answers: number, up: number, down: number}, last7: {answers: number, up: number, down: number}}>} İstatistik sayıları.
         */
        async getStats({ todayStartIso, last7StartIso }) {
            const row = await database.prepare(`
                SELECT
                    SUM(CASE WHEN datetime(created_at) >= datetime(?) THEN 1 ELSE 0 END) AS today_answers,
                    SUM(CASE WHEN datetime(created_at) >= datetime(?) AND feedback = 'up' THEN 1 ELSE 0 END) AS today_up,
                    SUM(CASE WHEN datetime(created_at) >= datetime(?) AND feedback = 'down' THEN 1 ELSE 0 END) AS today_down,
                    COUNT(*) AS last7_answers,
                    SUM(CASE WHEN feedback = 'up' THEN 1 ELSE 0 END) AS last7_up,
                    SUM(CASE WHEN feedback = 'down' THEN 1 ELSE 0 END) AS last7_down
                FROM chat_turns
                WHERE datetime(created_at) >= datetime(?)
            `).bind(todayStartIso, todayStartIso, todayStartIso, last7StartIso).first();

            return {
                today: {
                    answers: Number(row?.today_answers) || 0,
                    up: Number(row?.today_up) || 0,
                    down: Number(row?.today_down) || 0
                },
                last7: {
                    answers: Number(row?.last7_answers) || 0,
                    up: Number(row?.last7_up) || 0,
                    down: Number(row?.last7_down) || 0
                }
            };
        }
    });
}
