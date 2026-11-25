import { MAX_SEARCH_TOKENS } from '../../../shared/searchFold.js';

/**
 * SQLite's built-in `LOWER()` only folds ASCII A-Z.
 * These nested `REPLACE(...)` pairs fold common Turkish, Turkmen, and accented Latin
 * letters (both uppercase and lowercase) plus `w`/`W` -> `v` to match `foldSearchText`.
 *
 * Limit: non-Latin scripts (e.g. Cyrillic, Arabic) and unlisted Unicode characters are
 * not folded in SQL.
 */
const FOLD_REPLACEMENTS = Object.freeze([
    ['Ç', 'c'], ['ç', 'c'],
    ['Ğ', 'g'], ['ğ', 'g'],
    ['İ', 'i'], ['I', 'i'], ['ı', 'i'],
    ['Ö', 'o'], ['ö', 'o'],
    ['Ş', 's'], ['ş', 's'],
    ['Ü', 'u'], ['ü', 'u'],
    ['Â', 'a'], ['â', 'a'],
    ['Î', 'i'], ['î', 'i'],
    ['Û', 'u'], ['û', 'u'],
    ['Ä', 'a'], ['ä', 'a'],
    ['Ý', 'y'], ['ý', 'y'],
    ['Ň', 'n'], ['ň', 'n'],
    ['Ž', 'z'], ['ž', 'z'],
    ['W', 'v'], ['w', 'v']
]);

/**
 * Wraps a SQLite column expression in `LOWER(COALESCE(..., ''))` and nested `REPLACE`
 * calls so Turkish/accented Latin letters and `w`/`W` fold consistently with `foldSearchText`.
 *
 * Limit: non-Latin scripts (e.g. Cyrillic, Arabic) are left as-is.
 *
 * @param {string} columnExpression Trusted SQL column or concatenation expression.
 * @returns {string} SQLite expression yielding folded lowercase text.
 */
export function foldedSqlExpression(columnExpression) {
    if (typeof columnExpression !== 'string' || !columnExpression.trim()) {
        throw new TypeError('columnExpression must be a non-empty SQL expression.');
    }
    let expression = `LOWER(COALESCE(${columnExpression}, ''))`;
    for (const [source, target] of FOLD_REPLACEMENTS) {
        expression = `REPLACE(${expression}, '${source}', '${target}')`;
    }
    return expression;
}

/**
 * Escapes LIKE wildcards (`\`, `%`, `_`) with `\` and wraps the term in `%...%`.
 * @param {string} value Raw or folded search term.
 * @returns {string} Escaped LIKE pattern for `ESCAPE '\'`.
 */
export function escapeLikeTerm(value) {
    return `%${String(value).replace(/[\\%_]/g, '\\$&')}%`;
}

/**
 * Builds the folded SQLite WHERE fragment and bound LIKE parameters for first/last name matching.
 * - 0 tokens: returns `null` (no name clause added; literal code columns still run).
 * - 1 token: matches folded first name, folded last name, or folded full name in either order.
 * - 2..6 tokens: requires every token in `folded(first || ' ' || last)` via `AND`.
 *
 * Bound parameter budget: 4 bindings for 1 token, or 2..6 bindings for multi-token.
 * Combined with the 3 literal code columns, total search bindings never exceed 9 (D1 limit is 100).
 *
 * @param {{ firstNameColumn: string, lastNameColumn: string, tokens: string[] }} options Column names and folded tokens.
 * @returns {{ sql: string, bindings: string[] } | null} SQL fragment and bound parameters, or `null` when empty.
 */
export function buildNameSearchClause({ firstNameColumn, lastNameColumn, tokens }) {
    const boundedTokens = Array.isArray(tokens)
        ? tokens.filter((token) => typeof token === 'string' && token.length > 0).slice(0, MAX_SEARCH_TOKENS)
        : [];
    if (boundedTokens.length === 0) return null;

    const fullForwardColumn = `COALESCE(${firstNameColumn}, '') || ' ' || COALESCE(${lastNameColumn}, '')`;
    const foldedFullForward = foldedSqlExpression(fullForwardColumn);

    if (boundedTokens.length === 1) {
        const pattern = escapeLikeTerm(boundedTokens[0]);
        const foldedFirst = foldedSqlExpression(firstNameColumn);
        const foldedLast = foldedSqlExpression(lastNameColumn);
        const foldedFullReverse = foldedSqlExpression(`COALESCE(${lastNameColumn}, '') || ' ' || COALESCE(${firstNameColumn}, '')`);
        return {
            sql: `${foldedFirst} LIKE ? ESCAPE '\\' OR ${foldedLast} LIKE ? ESCAPE '\\' OR ${foldedFullForward} LIKE ? ESCAPE '\\' OR ${foldedFullReverse} LIKE ? ESCAPE '\\'`,
            bindings: [pattern, pattern, pattern, pattern]
        };
    }

    return {
        sql: boundedTokens.map(() => `${foldedFullForward} LIKE ? ESCAPE '\\'`).join(' AND '),
        bindings: boundedTokens.map((token) => escapeLikeTerm(token))
    };
}
