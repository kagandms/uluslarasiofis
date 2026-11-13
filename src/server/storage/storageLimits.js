/**
 * Largest object the Worker encrypts and writes to the remote store in one piece. AES-GCM here is single-shot,
 * so memory use grows with several copies of the object; physical intake PDFs can reach 50 MB and student
 * documents 10 MB, which would exceed the Worker's memory limit. Larger objects stay in R2 only (dual mode
 * reads them from there) and the migration reports them as skipped, not failed.
 */
export const REMOTE_MAX_OBJECT_BYTES = 8 * 1024 * 1024;
