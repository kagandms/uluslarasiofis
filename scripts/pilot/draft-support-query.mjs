import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeStudentNumber } from '../../src/server/repositories/d1/studentRepository.js';
import { normalizeApplicationReference, isValidApplicationReference } from '../../src/server/auth/applicationAccessCode.js';

function readLookupIdentity(input) {
    if (!input || Object.keys(input).some((key) => !['kind', 'value'].includes(key))
        || typeof input.value !== 'string' || /[\u0000-\u001f\u007f]/u.test(input.value)) {
        throw new TypeError('Invalid support lookup input.');
    }
    if (input.kind === 'reference' && isValidApplicationReference(input.value)) {
        return { column: 'applications.reference_number', value: normalizeApplicationReference(input.value) };
    }
    if (input.kind === 'student-number') {
        return { column: 'students.normalized_student_number', value: normalizeStudentNumber(input.value) };
    }
    throw new TypeError('Unsupported support lookup identity.');
}

/**
 * Builds a read-only operator lookup, never recovery authority or credentials.
 * @param {{kind: 'reference'|'student-number', value: string}} input Institution-verified identifier.
 * @returns {string} Single SELECT limited to two active application identities.
 * @throws {TypeError} When the identifier or lookup kind is invalid.
 */
export function buildDraftSupportQuery(input) {
    const identity = readLookupIdentity(input);
    const literal = identity.value.replaceAll("'", "''");
    return `SELECT applications.id AS application_id, applications.reference_number, applications.status
FROM applications JOIN students ON students.id = applications.student_id
WHERE ${identity.column} = '${literal}'
  AND applications.status NOT IN ('completed', 'cancelled', 'rejected')
LIMIT 2;\n`;
}

function preparePrivateQuery(outputPath) {
    if (!outputPath || (statSync(dirname(resolve(outputPath))).mode & 0o077) !== 0) {
        throw new TypeError('Private output directory required.');
    }
    const encoded = readFileSync(0, 'utf8');
    if (Buffer.byteLength(encoded) > 4096) throw new TypeError('Support lookup input too large.');
    const query = buildDraftSupportQuery(JSON.parse(encoded));
    writeFileSync(resolve(outputPath), query, { flag: 'wx', mode: 0o600 });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        if (process.argv.length !== 3) throw new TypeError('One private output path required.');
        preparePrivateQuery(process.argv[2]);
        process.stderr.write('draft_support_query_prepared; SELECT only; no database operation\n');
    } catch (error) {
        process.stderr.write(`draft_support_query_failed type=${error.name}\n`);
        process.exitCode = 1;
    }
}
