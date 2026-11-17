/**
 * Personel içi kayıt notları için D1 kalıcılık işlemlerini oluşturur.
 * Yazma ve silme işlemleri atomik D1 batch ile audit_events kaydını birlikte işler;
 * not metni hiçbir zaman denetim meta verisine veya günlüklere yazılmaz.
 * @param {D1Database} database Cloudflare D1 bağlamı.
 * @returns {object} Not listeleme, kaydetme ve silme işlemleri.
 */
export function createStaffRecordNoteRepository(database) {
    return Object.freeze({
        /**
         * Verilen tür ve kimlik listesi için mevcut notları tek bir IN (...) sorgusuyla okur.
         * @param {{kind: 'online'|'physical', ids: string[]}} input Doğrulanmış tür ve kimlik listesi.
         * @returns {Promise<Array<object>>} Not satırları.
         */
        async listByIds({ kind, ids }) {
            if (!Array.isArray(ids) || ids.length === 0) return [];
            // D1 tek sorguda en fazla 100 bağlı parametre kabul ettiği için doğrulanmış sabit tür metni doğrudan seçilir.
            const kindLiteral = kind === 'online' ? "'online'" : "'physical'";
            const placeholders = ids.map(() => '?').join(', ');
            const result = await database.prepare(`
                SELECT notes.record_id, notes.record_kind, notes.body, notes.updated_at,
                       staff.display_name AS updated_by_name
                FROM staff_record_notes AS notes
                LEFT JOIN staff_users AS staff ON staff.id = notes.updated_by_staff_id
                WHERE notes.record_kind = ${kindLiteral} AND notes.record_id IN (${placeholders})
            `).bind(...ids).all();
            return result.results ?? [];
        },
        /**
         * Tek bir kayda ait personel notunu okur.
         * @param {{kind: 'online'|'physical', recordId: string}} input Kayıt türü ve kimliği.
         * @returns {Promise<object|null>} Not satırı veya null.
         */
        async findByRecord({ kind, recordId }) {
            return database.prepare(`
                SELECT notes.record_id, notes.record_kind, notes.body, notes.updated_at,
                       staff.display_name AS updated_by_name
                FROM staff_record_notes AS notes
                LEFT JOIN staff_users AS staff ON staff.id = notes.updated_by_staff_id
                WHERE notes.record_kind = ? AND notes.record_id = ?
                LIMIT 1
            `).bind(kind, recordId).first();
        },
        /**
         * Hedef kayıt mevcutsa (fiziksel kayıtta silinmemişse) notu atomik olarak oluşturur veya günceller.
         * Güncellemede created_at ve created_by_staff_id korunur.
         * @param {{kind: 'online'|'physical', recordId: string, body: string, staffId: string, now: string, requestId: string, auditId: string}} input Kaydetme girdileri.
         * @returns {Promise<object|null>} Kaydedilen not satırı; hedef kayıt yoksa null.
         */
        async upsert({ kind, recordId, body, staffId, now, requestId, auditId }) {
            const sourceSql = kind === 'online'
                ? 'FROM applications WHERE id = ?'
                : 'FROM physical_intakes WHERE id = ? AND deleted_at IS NULL';
            const auditApplicationId = kind === 'online' ? recordId : null;
            const safeMetadataJson = JSON.stringify({ kind, result: 'success' });

            const results = await database.batch([
                database.prepare(`
                    INSERT INTO staff_record_notes (
                        record_kind, record_id, body,
                        created_by_staff_id, created_at,
                        updated_by_staff_id, updated_at
                    )
                    SELECT ?, id, ?, ?, ?, ?, ?
                    ${sourceSql}
                    ON CONFLICT(record_kind, record_id) DO UPDATE SET
                        body = excluded.body,
                        updated_by_staff_id = excluded.updated_by_staff_id,
                        updated_at = excluded.updated_at
                `).bind(kind, body, staffId, now, staffId, now, recordId),
                database.prepare(`
                    INSERT INTO audit_events (
                        id, event_type, actor_type, actor_staff_id, application_id,
                        request_id, safe_metadata_json, created_at
                    )
                    SELECT ?, 'staff.record_note_saved', 'staff', ?, ?, ?, ?, ?
                    WHERE changes() = 1
                `).bind(auditId, staffId, auditApplicationId, requestId, safeMetadataJson, now)
            ]);

            if (results[0]?.meta?.changes !== 1) return null;
            if (results[1]?.meta?.changes !== 1) {
                throw new Error('Staff record note audit did not complete.');
            }
            return this.findByRecord({ kind, recordId });
        },
        /**
         * Kayda ait personel notunu atomik olarak siler (not yoksa değişiklik yapmadan başarılı döner).
         * @param {{kind: 'online'|'physical', recordId: string, staffId: string, now: string, requestId: string, auditId: string}} input Silme girdileri.
         * @returns {Promise<boolean>} Gerçekten bir not silindiyse true.
         */
        async remove({ kind, recordId, staffId, now, requestId, auditId }) {
            const safeMetadataJson = JSON.stringify({ kind, result: 'success' });
            const results = await database.batch([
                database.prepare(`
                    DELETE FROM staff_record_notes
                    WHERE record_kind = ? AND record_id = ?
                `).bind(kind, recordId),
                database.prepare(`
                    INSERT INTO audit_events (
                        id, event_type, actor_type, actor_staff_id, application_id,
                        request_id, safe_metadata_json, created_at
                    )
                    SELECT ?, 'staff.record_note_deleted', 'staff', ?,
                           CASE WHEN ? = 'online' AND EXISTS (SELECT 1 FROM applications WHERE id = ?) THEN ? ELSE NULL END,
                           ?, ?, ?
                    WHERE changes() = 1
                `).bind(auditId, staffId, kind, recordId, recordId, requestId, safeMetadataJson, now)
            ]);
            return results[0]?.meta?.changes === 1;
        }
    });
}
