/** Staff-entered office/migration stages; approval refers to the office file review. */
export const PHYSICAL_STATUS_LABELS = Object.freeze({
    under_review: 'İncelemede',
    approved_for_processing: 'Onaylandı',
    sent_to_migration: 'Göç İdaresi inceliyor',
    migration_approved: 'Göç İdaresi tarafından onaylandı',
    completed: 'Tamamlandı',
    rejected: 'Reddedildi'
});

/** PDF work can continue after the office checks the physical paperwork. */
export const PHYSICAL_PDF_EDIT_STATUSES = Object.freeze(['under_review', 'approved_for_processing']);
