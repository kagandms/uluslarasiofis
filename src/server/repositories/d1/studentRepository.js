/**
 * Normalizes a student number for case-insensitive identity checks.
 * @param {string} studentNumber Student number supplied at the API boundary.
 * @returns {string} Trimmed uppercase student number.
 * @throws {TypeError} When the student number is empty or too long.
 */
export function normalizeStudentNumber(studentNumber) {
    if (typeof studentNumber !== 'string') throw new TypeError('Student number must be text.');
    const normalizedStudentNumber = studentNumber.trim().toLocaleUpperCase('en-US');
    if (normalizedStudentNumber.length === 0 || normalizedStudentNumber.length > 64) {
        throw new TypeError('Student number must contain between 1 and 64 characters.');
    }
    return normalizedStudentNumber;
}

/**
 * Creates the student identity repository for one D1 binding.
 * @param {D1Database} database Cloudflare D1 binding.
 * @returns {{findById(id: string): Promise<object|null>, findByStudentNumber(studentNumber: string): Promise<object|null>}}
 */
export function createStudentRepository(database) {
    return Object.freeze({
        async findById(id) {
            return database.prepare('SELECT * FROM students WHERE id = ?')
                .bind(id).first();
        },
        async findByStudentNumber(studentNumber) {
            const normalizedStudentNumber = normalizeStudentNumber(studentNumber);
            return database.prepare('SELECT * FROM students WHERE normalized_student_number = ?')
                .bind(normalizedStudentNumber).first();
        }
    });
}
