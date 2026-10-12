import { hasPhysicalReceiptSchema } from '../config/physical-receipt-config.js';

/** Cleans bounded receipt artefacts independently of scanner/print maintenance. @param {object} environment Bindings. @param {string} now UTC time.
 * @returns {Promise<void>} Cleanup pass. @throws {Error} Failed database operation. */
export async function cleanupPhysicalReceipts(environment,now=new Date().toISOString()) {
    if (!environment.DB || !environment.DOCUMENTS) return;
    if (!await hasPhysicalReceiptSchema(environment)) return;
    const candidates=(await environment.DB.prepare(`SELECT * FROM physical_intake_receipts WHERE state='ready' AND expires_at<=?
        AND (download_lease_until IS NULL OR download_lease_until<=?) AND (purge_claim_until IS NULL OR purge_claim_until<=?)
        AND NOT EXISTS(SELECT 1 FROM physical_receipt_print_attempts WHERE receipt_id=physical_intake_receipts.id AND (blocks_new_attempt=1 OR status IN ('uploading','queued','leased','ready','submission_started','unknown')
        OR (status IN ('failed','expired') AND submission_started_at IS NOT NULL)))
        ORDER BY expires_at LIMIT 25`).bind(now,now,now).all()).results;
    for (const receipt of candidates) await purgeReceipt(environment,receipt,now);
    await cleanupOrphanReceipts(environment,now);
}

async function purgeReceipt(environment,receipt,now) {
    const claimed=await environment.DB.prepare(`UPDATE physical_intake_receipts SET purge_claim_until=? WHERE id=? AND state='ready'
        AND (purge_claim_until IS NULL OR purge_claim_until<=?) AND (download_lease_until IS NULL OR download_lease_until<=?)
        AND NOT EXISTS(SELECT 1 FROM physical_receipt_print_attempts WHERE receipt_id=physical_intake_receipts.id AND (blocks_new_attempt=1 OR status IN ('uploading','queued','leased','ready','submission_started','unknown')
        OR (status IN ('failed','expired') AND submission_started_at IS NOT NULL)))`)
        .bind(new Date(Date.parse(now)+300_000).toISOString(),receipt.id,now,now).run();
    if (!claimed.meta.changes) return;
    try {
        await environment.DOCUMENTS.delete(receipt.artefact_key);
        await environment.DB.prepare(`UPDATE physical_intake_receipts SET state='purged',purge_claim_until=NULL WHERE id=? AND state='ready'`).bind(receipt.id).run();
    } catch (error) {
        console.error('Receipt artefact cleanup failed.',{errorName:error.name});
        await environment.DB.prepare('UPDATE physical_intake_receipts SET purge_claim_until=NULL WHERE id=?').bind(receipt.id).run();
    }
}

async function cleanupOrphanReceipts(environment,now) {
    if (typeof environment.DOCUMENTS.list!=='function') return;
    const state=await environment.DB.prepare("SELECT listing_cursor FROM physical_receipt_cleanup_cursor WHERE id='global'").first();
    const listing=await environment.DOCUMENTS.list({prefix:'receipts/',limit:100,...(state?.listing_cursor?{cursor:state.listing_cursor}:{})});
    for (const object of listing.objects) {
        if (!object.uploaded || new Date(object.uploaded).valueOf()>Date.parse(now)-86400_000) continue;
        const referenced=await environment.DB.prepare('SELECT id FROM physical_intake_receipts WHERE artefact_key=?').bind(object.key).first();
        if (referenced) continue;
        try { await environment.DOCUMENTS.delete(object.key); }
        catch (error) { console.error('Orphan receipt cleanup failed.',{errorName:error.name}); }
    }
    await environment.DB.prepare("UPDATE physical_receipt_cleanup_cursor SET listing_cursor=? WHERE id='global'").bind(listing.truncated?listing.cursor:null).run();
}
