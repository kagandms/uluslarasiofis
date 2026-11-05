import { createImmigrationFileCoverPage } from '../shared/applicationDocumentPdf.js';

/** Creates the shared single-page A4 cover and preserves the physical tracking reference. */
export function createPhysicalReceiptTemplate(document, snapshot, logos) {
    if (!snapshot.portal_origin || !snapshot.tracking_reference) throw new Error('Takip numarası ve doğrulanmış portal adresi gerekli.');
    return createImmigrationFileCoverPage(document, {
        studentCode: snapshot.tracking_reference,
        firstName: snapshot.first_name,
        lastName: snapshot.last_name,
        deliveryMethod: 'physical',
        deliveryDate: snapshot.application_date,
        trackingReference: snapshot.tracking_reference,
        portalOrigin: snapshot.portal_origin
    }, logos, logos.trackingQr);
}
