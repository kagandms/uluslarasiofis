
const PENDING_REGISTRATION_KEY='physical-receipt-pending-registration';

export function buildReceiptSnapshotKey(data) {
    if (!data) return null;
    return [
        (data.first_name || '').trim(),
        (data.last_name || '').trim(),
        (data.passport_number || '').trim().toUpperCase(),
        (data.application_date || '').trim(),
        (data.tracking_reference || '').trim(),
        (data.portal_origin || '').trim()
    ].join('::');
}

export function startPreloadingReceiptPdf(context) {
    const doc = context.root?.ownerDocument || globalThis.document;
    if (!doc) return;
    const draft = context.state.draft;
    const trackingReference = context.state.reservation?.tracking_reference;
    const portalOrigin = context.state.receiptConfig?.portal_origin;
    if (!draft || !trackingReference || !portalOrigin || !draft.first_name || !draft.last_name || !draft.passport_number || !draft.application_date) {
        return;
    }
    const draftSnapshot = {
        first_name: draft.first_name.trim(),
        last_name: draft.last_name.trim(),
        passport_number: draft.passport_number.trim().toUpperCase(),
        application_date: draft.application_date.trim(),
        tracking_reference: trackingReference.trim(),
        portal_origin: portalOrigin.trim(),
        created_at: new Date().toISOString()
    };
    const key = buildReceiptSnapshotKey(draftSnapshot);
    if (context.state.preloadedReceiptKey === key && context.state.preloadedReceiptPromise) {
        return;
    }
    context.state.preloadedReceiptKey = key;
    context.state.preloadedReceiptPromise = import('../services/physical-receipt-pdf.js')
        .then(({ renderPhysicalReceiptPdf }) => renderPhysicalReceiptPdf(draftSnapshot, doc))
        .catch(error => {
            console.error('Receipt PDF pre-rendering failed.', { errorName: error.name });
            return null;
        });
}

/** Starts a metadata-first draft without touching PDF/QR state. @param {object} context Workspace. @returns {void} Draft initialized. */
export function startPhysicalReceiptDraft(context) {
    context.state.registrationId=crypto.randomUUID();
    context.state.savedIntakeId=null; context.state.receipt=null; context.state.documentCreationId=null;
    context.state.printCreationId=null; context.state.printOperationKey=null; context.state.receiptDelivery=null;
    context.state.reservation=null; context.state.registrationBody=null; context.state.duplicateMatches=[];
    context.state.preloadedReceiptKey=null; context.state.preloadedReceiptPromise=null;
    context.state.isMetadataFirst=true; context.state.view='create';
    context.state.draft={application_date:context.state.receiptConfig.today,first_name:'',last_name:'',passport_number:'',student_number:'',application_type:''};
    context.state.message='Öğrenci bilgilerini girin, Başvuru No Ata ardından Oluştur ve Yazdır’a basın.';
    context.state.receiptAssetsReady=import('../services/physical-receipt-pdf.js')
        .then(({preloadPhysicalReceiptAssets})=>preloadPhysicalReceiptAssets())
        .catch(error=>{
            context.state.receiptAssetsReady=null;
            console.error('A4 assets could not be preloaded.',{errorName:error.name});
        });
}

/** Reserves the same draft reference on retries. @param {object} context Workspace. @returns {Promise<void>} Assigned number. @throws {Error} Allocation failure. */
export async function assignPhysicalReference(context) {
    if (context.state.reservation || context.state.isAssigningReference) return;
    context.state.isAssigningReference=true;
    try {
        context.state.reservation=await context.api.reserve({draft_id:context.state.registrationId,application_date:context.state.draft.application_date});
        startPreloadingReceiptPdf(context);
    } finally { context.state.isAssigningReference=false; }
}

/** Saves the student first, keeping identifiers stable after a lost response. @param {object} context Workspace. @returns {Promise<object>} Durable intake. @throws {Error} Invalid/failed registration. */
export async function savePhysicalReceiptDraft(context) {
    const state=context.state;
    if (!state.reservation) throw new Error('Önce Başvuru No Ata’ya basın.');
    if (state.draft.application_date.slice(0,4)!==state.reservation.application_date.slice(0,4)) throw new Error('Tarih yılı değişti. Formu kapatıp yeniden açın.');
    state.registrationBody ||= {registration_id:state.registrationId,reservation_id:state.reservation.id,...state.draft};
    sessionStorage.setItem(PENDING_REGISTRATION_KEY,state.registrationId);
    try {
        const result=await context.api.registerMetadata(state.registrationBody);
        sessionStorage.removeItem(PENDING_REGISTRATION_KEY);
        return result;
    } catch (error) {
        if (error.status===400 || ['RESERVATION_EXPIRED','RECEIPTS_CREATE_DISABLED'].includes(error.code)) {
            state.registrationBody=null;
            sessionStorage.removeItem(PENDING_REGISTRATION_KEY);
            if (error.code==='RESERVATION_EXPIRED') state.reservation=null;
        }
        throw error;
    }
}

/** Recovers only the operation UUID after a browser reload. @param {object} context Workspace. @returns {Promise<object|null>} Durable existing record. @throws {Error} Unavailable service. */
export async function recoverPhysicalReceiptRegistration(context) {
    const id=sessionStorage.getItem(PENDING_REGISTRATION_KEY);
    if (!id) return null;
    try {
        const detail=await context.api.detail(id);
        sessionStorage.removeItem(PENDING_REGISTRATION_KEY);
        return detail;
    } catch (error) {
        if (error.status===404) { sessionStorage.removeItem(PENDING_REGISTRATION_KEY); return null; }
        throw error;
    }
}

/** Prepares/resumes a stored snapshot; renderer failure never removes the student. @param {object} context Workspace. @param {object} [options] Hooks. @returns {Promise<object>} Ready immutable A4. @throws {Error} Render/storage failure. */
export async function preparePhysicalReceiptDocument(context, options = {}) {
    const intake=context.state.detail.intake;
    const documents=context.state.detail.receipts || [];
    const readSnapshot = receipt => receipt.snapshot || (receipt.snapshot_json ? JSON.parse(receipt.snapshot_json) : null);
    const current=documents.find(receipt=>receipt.metadata_version===intake.metadata_version && receipt.state!=='purged' && Boolean(readSnapshot(receipt)?.portal_origin));
    let receipt=current ? (current.snapshot ? current : await context.api.document(intake.id,current.id)) : null;
    if (receipt?.is_expired) receipt=null;
    if (!receipt) {
        context.state.documentCreationId ||= crypto.randomUUID();
        receipt=await context.api.createDocument(intake.id,{creation_id:context.state.documentCreationId,lock_version:intake.lock_version});
    }
    context.state.receipt=receipt;
    if (receipt.state==='ready') { context.state.documentCreationId=null; return receipt; }
    if (!receipt.snapshot.portal_origin) throw new Error('Portal adresi yapılandırılmalı. Öğrenci kaydı korunuyor; adres hazır olunca yeni A4 hazırlayın.');
    let bytes = null;
    const snapshotKey = buildReceiptSnapshotKey(receipt.snapshot);
    if (context.state.preloadedReceiptKey === snapshotKey && context.state.preloadedReceiptPromise) {
        try {
            bytes = await context.state.preloadedReceiptPromise;
        } catch {
            bytes = null;
        }
    }
    if (!bytes) {
        const { renderPhysicalReceiptPdf }=await import('../services/physical-receipt-pdf.js');
        bytes = await renderPhysicalReceiptPdf(receipt.snapshot, context.root?.ownerDocument || globalThis.document);
    }
    if (typeof options.onBytesReady === 'function') {
        options.onBytesReady(bytes);
    }
    context.state.receipt=await context.api.uploadDocument(intake.id,receipt.id,bytes);
    context.state.documentCreationId=null;
    context.state.preloadedReceiptKey=null;
    context.state.preloadedReceiptPromise=null;
    return context.state.receipt;
}

/** Sends one explicit first/reprint/manual decision. @param {object} context Workspace. @param {object} decision Risk/decision fields.
 * @returns {Promise<object>} Confirmed server attempt. @throws {Error} Blocked/failed send. */
export async function sendPhysicalReceiptPrint(context,decision={decision:'print'}) {
    const receipt=await preparePhysicalReceiptDocument(context);
    const operationKey=`${receipt.id}:${decision.decision}`;
    if (context.state.printOperationKey!==operationKey) {
        context.state.printOperationKey=operationKey; context.state.printCreationId=crypto.randomUUID();
    }
    const result=await context.api.printDocument(context.state.detail.intake.id,receipt.id,{creation_id:context.state.printCreationId,...decision});
    context.state.printCreationId=null; context.state.printOperationKey=null;
    return result;
}

/** Saves and prepares the A4 without switching to the intake detail view or printing.
 * @param {object} context Workspace state and API.
 * @param {object} [options] Hooks.
 * @returns {Promise<object>} Ready receipt. @throws {Error} Registration or document preparation failure.
 */
export async function saveAndPreparePhysicalReceipt(context, options = {}) {
    if (!context.state.savedIntakeId) {
        const registered = await savePhysicalReceiptDraft(context);
        context.state.savedIntakeId = registered.intake.id;
        if (registered.receipts?.length) {
            context.state.detail = registered;
        } else {
            context.state.detail = await context.api.detail(context.state.savedIntakeId);
        }
    } else {
        context.state.detail = await context.api.detail(context.state.savedIntakeId);
    }
    return preparePhysicalReceiptDocument(context, options);
}
