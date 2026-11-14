const LEGACY_HOST = 'goc.topkapiuni.workers.dev';
const CANONICAL_HOME_ORIGIN = 'https://topkapiunigoc.com';

/**
 * Returns the canonical home URL when on the legacy workers.dev home page,
 * preserving query string and hash, or null for any other host or path.
 *
 * @param {Partial<Location> | null | undefined} locationLike
 * @returns {string | null}
 */
export function legacyHostRedirectTarget(locationLike) {
    if (!locationLike) return null;
    if (locationLike.hostname !== LEGACY_HOST || locationLike.pathname !== '/') {
        return null;
    }
    const search = typeof locationLike.search === 'string' ? locationLike.search : '';
    const hash = typeof locationLike.hash === 'string' ? locationLike.hash : '';
    return `${CANONICAL_HOME_ORIGIN}/${search}${hash}`;
}

/**
 * Redirects the legacy workers.dev home page to the canonical domain.
 *
 * @param {{ location?: Partial<Location> & { replace?: (url: string) => void } } | null | undefined} [win=globalThis]
 */
export function redirectLegacyHome(win = globalThis) {
    const location = win?.location;
    if (!location || typeof location.replace !== 'function') return;
    const target = legacyHostRedirectTarget(location);
    if (target !== null) {
        location.replace(target);
    }
}
