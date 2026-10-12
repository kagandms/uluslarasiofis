
const PENDING_REGISTRATION_KEY='physical-receipt-pending-registration';

/** Starts a metadata-first draft without touching PDF/QR state. @param {object} context Workspace. @returns {void} Draft initialized. */
export function startPhysicalReceiptDraft(context) {
    context.state.registrationId=crypto.randomUUID();
    context.state.savedIntakeId=null; context.state.receipt=null; context.state.documentCreationId=null;
    context.state.printCreationId=null; context.state.printOperationKey=null; context.state.receiptDelivery=null;
    context.state.reservation=null; context.state.registrationBody=null; context.state.duplicateMatches=[];
    context.state.isMetadataFirst=true; context.state.view='create';
    context.state.draft={application_date:context.state.receiptConfig.today,first_name:'',last_name:'',passport_number:'',student_number:'',application_type:''};
    context.state.message='Öğrenci bilgilerini girin, Başvuru No Ata ardından Oluştur ve Yazdır’a basın.';
}

/** Reserves the same draft reference on retries. @param {object} context Workspace. @returns {Promise<void>} Assigned number. @throws {Error} Allocation failure. */
export async function assignPhysicalReference(context) {
    context.state.reservation=await context.api.reserve({draft_id:context.state.registrationId,application_date:context.state.draft.application_date});
}

/** Saves the student first, keeping identifiers stable after a lost response. @param {object} context Workspace. @returns {Promise<object>} Durable intake. @throws {Error} Invalid/failed registration. */
export async function savePhysicalReceiptDraft(context) {
    const state=context.state;
    if (!state.reservation) throw new Error('Önce Başvuru No Ata’ya basın.');
    if (state.draft.application_date.slice(0,4)!==state.reservation.application_date.slice(0,4)) throw new Error('Tarih yılı değişti. Yeni başvuru numarası ayırın.');
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

/** Prepares/resumes a stored snapshot; renderer failure never removes the student. @param {object} context Workspace. @returns {Promise<object>} Ready immutable A4. @throws {Error} Render/storage failure. */
export async function preparePhysicalReceiptDocument(context) {
    const intake=context.state.detail.intake;
    const documents=context.state.detail.receipts || [];
    const current=documents.find(receipt=>receipt.metadata_version===intake.metadata_version && receipt.state!=='purged' && Boolean(JSON.parse(receipt.snapshot_json).portal_origin));
    let receipt=current ? await context.api.document(intake.id,current.id) : null;
    if (receipt?.is_expired) receipt=null;
    if (!receipt) {
        context.state.documentCreationId ||= crypto.randomUUID();
        receipt=await context.api.createDocument(intake.id,{creation_id:context.state.documentCreationId,lock_version:intake.lock_version});
    }
    context.state.receipt=receipt;
    if (receipt.state==='ready') { context.state.documentCreationId=null; return receipt; }
    if (!receipt.snapshot.portal_origin) throw new Error('Portal adresi yapılandırılmalı. Öğrenci kaydı korunuyor; adres hazır olunca yeni A4 hazırlayın.');
    const { renderPhysicalReceiptPdf }=await import('../services/physical-receipt-pdf.js');
    const bytes=await renderPhysicalReceiptPdf(receipt.snapshot);
    context.state.receipt=await context.api.uploadDocument(intake.id,receipt.id,bytes);
    context.state.documentCreationId=null;
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
 * @returns {Promise<object>} Ready receipt. @throws {Error} Registration or document preparation failure.
 */
export async function saveAndPreparePhysicalReceipt(context) {
    if (!context.state.savedIntakeId) {
        const registered = await savePhysicalReceiptDraft(context);
        context.state.savedIntakeId = registered.intake.id;
    }
    context.state.detail = await context.api.detail(context.state.savedIntakeId);
    return preparePhysicalReceiptDocument(context);
}
