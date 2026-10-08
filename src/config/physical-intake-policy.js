export const IS_PHYSICAL_INTAKE_ENABLED = Boolean(typeof import.meta !== 'undefined' && import.meta.env?.PHYSICAL_INTAKES_ENABLED === true);
export { MAX_PHYSICAL_PDF_BYTES } from './physical-document-limits.js';
