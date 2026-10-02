/** Campus pilot assumes up to 120 students creating drafts through one NAT in 15 minutes. */
export const APPLICATION_CREATE_RATE_LIMIT = Object.freeze({
    endpoint: 'application-create', maxRequests: 120, windowSeconds: 900
});

/** Public status remains manual: 120 students can perform two lookups each, with 60 slots of margin. */
export const APPLICATION_TRACKING_RATE_LIMIT = Object.freeze({
    endpoint: 'application-tracking-lookup', maxRequests: 300, windowSeconds: 900
});
