import { searchTokens } from '../../shared/searchFold.js';

const MAX_JOINED_EDIT_DISTANCE = 2;
const MIN_JOINED_SIMILAR_LENGTH = 10;
const MAX_TOTAL_TOKEN_EDITS = 3;

/**
 * Computes the Levenshtein edit distance between two strings.
 * @param {string} left First string.
 * @param {string} right Second string.
 * @returns {number} Minimum single-character edit operations.
 */
export function levenshteinDistance(left, right) {
    if (left === right) return 0;
    const leftLen = left.length;
    const rightLen = right.length;
    if (leftLen === 0) return rightLen;
    if (rightLen === 0) return leftLen;

    let prev = new Array(rightLen + 1);
    let curr = new Array(rightLen + 1);
    for (let j = 0; j <= rightLen; j += 1) prev[j] = j;

    for (let i = 1; i <= leftLen; i += 1) {
        curr[0] = i;
        const leftChar = left.charCodeAt(i - 1);
        for (let j = 1; j <= rightLen; j += 1) {
            const cost = leftChar === right.charCodeAt(j - 1) ? 0 : 1;
            curr[j] = Math.min(
                prev[j] + 1,
                curr[j - 1] + 1,
                prev[j - 1] + cost
            );
        }
        const swap = prev;
        prev = curr;
        curr = swap;
    }
    return prev[rightLen];
}

function maxTokenEditDistance(leftToken, rightToken) {
    const minLen = Math.min(leftToken.length, rightToken.length);
    if (minLen >= 5) return 2;
    if (minLen >= 3) return 1;
    return 0;
}

function areTokensCompatible(auditTokens, portalTokens) {
    const shorter = auditTokens.length <= portalTokens.length ? auditTokens : portalTokens;
    const longer = auditTokens.length <= portalTokens.length ? portalTokens : auditTokens;

    if (shorter.length === longer.length) {
        const sortedShorter = [...shorter].sort();
        const sortedLonger = [...longer].sort();
        if (sortedShorter.every((token, index) => token === sortedLonger[index])) {
            return true;
        }
    }

    if (shorter.length >= 2) {
        const remaining = new Map();
        for (const token of longer) {
            remaining.set(token, (remaining.get(token) || 0) + 1);
        }
        let allContained = true;
        for (const token of shorter) {
            const count = remaining.get(token) || 0;
            if (count === 0) {
                allContained = false;
                break;
            }
            remaining.set(token, count - 1);
        }
        if (allContained) return true;
    }

    if (auditTokens.join('') === portalTokens.join('')) return true;
    return [...auditTokens].sort().join('') === [...portalTokens].sort().join('');
}

function areTokensSimilar(auditTokens, portalTokens) {
    if (auditTokens.length === portalTokens.length) {
        const count = auditTokens.length;
        const edges = auditTokens.map((leftToken) =>
            portalTokens.map((rightToken) => {
                const dist = levenshteinDistance(leftToken, rightToken);
                return dist <= maxTokenEditDistance(leftToken, rightToken) ? dist : -1;
            })
        );

        const used = new Array(count).fill(false);
        let found = false;

        function search(index, totalEdits) {
            if (totalEdits > MAX_TOTAL_TOKEN_EDITS) return;
            if (index === count) {
                found = true;
                return;
            }
            for (let j = 0; j < count; j += 1) {
                if (used[j]) continue;
                const dist = edges[index][j];
                if (dist < 0) continue;
                used[j] = true;
                search(index + 1, totalEdits + dist);
                used[j] = false;
                if (found) return;
            }
        }

        search(0, 0);
        if (found) return true;
    }

    const joinedAudit = auditTokens.join('');
    const joinedPortal = portalTokens.join('');
    if (Math.min(joinedAudit.length, joinedPortal.length) >= MIN_JOINED_SIMILAR_LENGTH) {
        return levenshteinDistance(joinedAudit, joinedPortal) <= MAX_JOINED_EDIT_DISTANCE;
    }

    return false;
}

/**
 * Classifies an Excel audit row's name against a portal record's name into three levels:
 * - `'compatible'`: exact/contained token match or identical folded letters without spaces/punctuation
 * - `'similar'`: small spelling or transliteration variant within edit-distance bounds
 * - `'different'`: everything else (partial single-word matches, different alphabets, unrelated names)
 *
 * @param {object} auditRow Excel audit row.
 * @param {object} portalRecord Online application or physical intake record.
 * @returns {'compatible'|'similar'|'different'} Classification level.
 */
export function classifyNameMatch(auditRow, portalRecord) {
    const auditTokens = searchTokens(`${auditRow?.first_name || ''} ${auditRow?.last_name || ''}`);
    const portalTokens = searchTokens(`${portalRecord?.first_name || ''} ${portalRecord?.last_name || ''}`);
    if (auditTokens.length === 0 || portalTokens.length === 0) return 'different';

    if (areTokensCompatible(auditTokens, portalTokens)) return 'compatible';
    if (areTokensSimilar(auditTokens, portalTokens)) return 'similar';
    return 'different';
}
