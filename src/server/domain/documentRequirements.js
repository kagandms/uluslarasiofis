const UNDER_18_BIRTH_CERTIFICATE_CODES = new Set(['birth_certificate_under18', 'birth_certificate']);

function isUnder18(application) {
    return application.is_under_18 === 1 || application.is_under_18 === true;
}

/**
 * Calculates the current student's residence-document set from active database requirements.
 * @param {Array<object>} requirements Active requirements for the application's type.
 * @param {object} application Server-loaded application fields.
 * @returns {Array<object>} Student-eligible requirement rows with under-18 rules applied.
 * @throws {TypeError} When the requirement source or application is invalid.
 */
export function calculateStudentDocumentRequirements(requirements, application) {
    if (!Array.isArray(requirements) || !application || typeof application !== 'object') {
        throw new TypeError('Application and document requirements are required.');
    }

    let hasBirthCertificate = false;
    return requirements.filter((requirement) => {
        if (!UNDER_18_BIRTH_CERTIFICATE_CODES.has(requirement.code)) return true;
        if (!isUnder18(application) || hasBirthCertificate) return false;
        hasBirthCertificate = true;
        return true;
    }).map((requirement) => UNDER_18_BIRTH_CERTIFICATE_CODES.has(requirement.code)
        ? { ...requirement, is_required: 1 }
        : { ...requirement });
}
