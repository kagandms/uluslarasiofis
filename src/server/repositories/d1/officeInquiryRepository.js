/**
 * Ana sayfa soru kayıtları (`office_inquiries`) için D1 kalıcılık işlemlerini oluşturur.
 * Durum güncelleme ve silme işlemleri atomik D1 batch ile audit_events kaydını birlikte işler;
 * mesaj, telefon, e-posta ve isim bilgileri hiçbir zaman denetim meta verisine yazılmaz.
 * @param {D1Database} database Cloudflare D1 bağlamı.
 * @returns {object} Soru oluşturma, listeleme, sayma, durum güncelleme ve silme işlemleri.
 */
export function createOfficeInquiryRepository(database) {
    /**
     * Tek bir soru satırını sorumlu personel adıyla birlikte okur.
     * @param {string} id Soru kimliği.
     * @returns {Promise<object|null>} Soru satırı veya null.
     */
    async function findById(id) {
        return database.prepare(`
            SELECT inquiries.id, inquiries.first_name, inquiries.last_name, inquiries.phone,
                   inquiries.email, inquiries.message, inquiries.language, inquiries.status,
                   staff.display_name AS handled_by_name, inquiries.handled_at, inquiries.created_at
            FROM office_inquiries AS inquiries
            LEFT JOIN staff_users AS staff ON staff.id = inquiries.handled_by_staff_id
            WHERE inquiries.id = ?
            LIMIT 1
        `).bind(id).first();
    }

    return Object.freeze({
        /**
         * Yeni bir ziyaretçi sorusunu `new` durumunda kaydeder.
         * @param {{id?: string, firstName: string, lastName: string, phone: string, email?: string|null, message: string, language: string, nowIso?: string}} input Doğrulanmış soru girdileri.
         * @returns {Promise<object>} Oluşturulan soru satırı.
         */
        async create({
            id = crypto.randomUUID(),
            firstName,
            lastName,
            phone,
            email = null,
            message,
            language,
            nowIso = new Date().toISOString()
        }) {
            await database.prepare(`
                INSERT INTO office_inquiries (
                    id, first_name, last_name, phone, email, message, language,
                    status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)
            `).bind(id, firstName, lastName, phone, email ?? null, message, language, nowIso, nowIso).run();
            return findById(id);
        },

        /**
         * Soruları en yeniden eskiye sıralayarak listeler.
         * @param {{status?: 'new'|'answered'|'all', limit?: number}} [options] Durum filtresi ve sınır.
         * @returns {Promise<Array<object>>} Soru satırları.
         */
        async list({ status = 'all', limit = 100 } = {}) {
            const safeLimit = Math.max(1, Math.min(100, Number.isSafeInteger(limit) ? limit : 100));
            const isFiltered = status === 'new' || status === 'answered';
            const whereClause = isFiltered ? 'WHERE inquiries.status = ?' : '';
            const bindings = isFiltered ? [status, safeLimit] : [safeLimit];
            const result = await database.prepare(`
                SELECT inquiries.id, inquiries.first_name, inquiries.last_name, inquiries.phone,
                       inquiries.email, inquiries.message, inquiries.language, inquiries.status,
                       staff.display_name AS handled_by_name, inquiries.handled_at, inquiries.created_at
                FROM office_inquiries AS inquiries
                LEFT JOIN staff_users AS staff ON staff.id = inquiries.handled_by_staff_id
                ${whereClause}
                ORDER BY inquiries.created_at DESC, inquiries.id DESC
                LIMIT ?
            `).bind(...bindings).all();
            return result.results ?? [];
        },

        /**
         * Duruma göre toplam soru sayılarını döndürür.
         * @returns {Promise<{new: number, answered: number}>} Durum sayıları.
         */
        async countByStatus() {
            const result = await database.prepare(`
                SELECT status, COUNT(*) AS total
                FROM office_inquiries
                GROUP BY status
            `).all();
            const counts = { new: 0, answered: 0 };
            for (const row of result.results ?? []) {
                if (row.status === 'new' || row.status === 'answered') {
                    counts[row.status] = Number(row.total) || 0;
                }
            }
            return counts;
        },

        /**
         * Soru durumunu günceller ve aynı D1 batch içinde kişisel veri içermeyen denetim kaydı yazar.
         * @param {{id: string, status: 'new'|'answered', staffId: string, nowIso?: string, requestId?: string, auditId?: string}} input Güncelleme girdileri.
         * @returns {Promise<object|null>} Güncellenen soru satırı; kayıt yoksa null.
         */
        async updateStatus({
            id,
            status,
            staffId,
            nowIso = new Date().toISOString(),
            requestId = `req_${crypto.randomUUID()}`,
            auditId = crypto.randomUUID()
        }) {
            const safeMetadataJson = JSON.stringify({ inquiryId: id, status, result: 'success' });
            const results = await database.batch([
                database.prepare(`
                    UPDATE office_inquiries
                    SET status = ?,
                        handled_by_staff_id = CASE WHEN ? = 'answered' THEN ? ELSE NULL END,
                        handled_at = CASE WHEN ? = 'answered' THEN ? ELSE NULL END,
                        updated_at = ?
                    WHERE id = ?
                `).bind(status, status, staffId, status, nowIso, nowIso, id),
                database.prepare(`
                    INSERT INTO audit_events (
                        id, event_type, actor_type, actor_staff_id, application_id,
                        request_id, safe_metadata_json, created_at
                    )
                    SELECT ?, 'staff.office_inquiry_status_updated', 'staff', ?, NULL, ?, ?, ?
                    WHERE changes() = 1
                `).bind(auditId, staffId, requestId, safeMetadataJson, nowIso)
            ]);
            if (results[0]?.meta?.changes !== 1) return null;
            if (results[1]?.meta?.changes !== 1) {
                throw new Error('Office inquiry status audit did not complete.');
            }
            return findById(id);
        },

        /**
         * Soruyu kalıcı olarak siler ve aynı D1 batch içinde kişisel veri içermeyen denetim kaydı yazar.
         * @param {{id: string, staffId: string, nowIso?: string, requestId?: string, auditId?: string}} input Silme girdileri.
         * @returns {Promise<boolean>} Kayıt silindiyse true, bulunamadıysa false.
         */
        async deleteById({
            id,
            staffId,
            nowIso = new Date().toISOString(),
            requestId = `req_${crypto.randomUUID()}`,
            auditId = crypto.randomUUID()
        }) {
            const safeMetadataJson = JSON.stringify({ inquiryId: id, result: 'success' });
            const results = await database.batch([
                database.prepare(`
                    DELETE FROM office_inquiries
                    WHERE id = ?
                `).bind(id),
                database.prepare(`
                    INSERT INTO audit_events (
                        id, event_type, actor_type, actor_staff_id, application_id,
                        request_id, safe_metadata_json, created_at
                    )
                    SELECT ?, 'staff.office_inquiry_deleted', 'staff', ?, NULL, ?, ?, ?
                    WHERE changes() = 1
                `).bind(auditId, staffId, requestId, safeMetadataJson, nowIso)
            ]);
            if (results[0]?.meta?.changes !== 1) return false;
            if (results[1]?.meta?.changes !== 1) {
                throw new Error('Office inquiry delete audit did not complete.');
            }
            return true;
        }
    });
}
