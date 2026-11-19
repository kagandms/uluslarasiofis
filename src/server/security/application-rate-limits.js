/** Campus pilot assumes up to 120 students creating drafts through one NAT in 15 minutes. */
export const APPLICATION_CREATE_RATE_LIMIT = Object.freeze({
    endpoint: 'application-create', maxRequests: 120, windowSeconds: 900
});

/** Public status remains manual: 120 students can perform two lookups each, with 60 slots of margin. */
export const APPLICATION_TRACKING_RATE_LIMIT = Object.freeze({
    endpoint: 'application-tracking-lookup', maxRequests: 300, windowSeconds: 900
});

/** Campus NAT shares one IP; allow up to 30 home inquiry submissions per IP in 15 minutes. */
export const INQUIRY_CREATE_RATE_LIMIT = Object.freeze({
    endpoint: 'office-inquiry-create', maxRequests: 30, windowSeconds: 900
});

/** Bounds repeated submissions from the same normalized phone number to 3 per day. */
export const INQUIRY_PER_PHONE_LIMIT = Object.freeze({
    endpoint: 'office-inquiry-phone', maxRequests: 3, windowSeconds: 86400
});

/** Global daily cap across all inquiry submissions to bound D1 writes. */
export const INQUIRY_GLOBAL_DAILY_LIMIT = Object.freeze({
    endpoint: 'office-inquiry-global-daily', identity: 'global', maxRequests: 300, windowSeconds: 86400
});
