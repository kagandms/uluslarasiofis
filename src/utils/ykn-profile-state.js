/**
 * Normalizes semantic Apply labels without interpreting undocumented codes.
 * @param {unknown} value Selected visible label.
 * @returns {string} Canonical gender or an empty unknown value.
 */
export function normalizeProfileGender(value) {
    const label = String(value || '').trim().toLocaleLowerCase('tr-TR').replace(/ı/g, 'i');
    if (['erkek', 'male', 'мужской', 'мужчина'].includes(label)) return 'Erkek';
    if (['kadin', 'female', 'женский', 'женщина'].includes(label)) return 'Kadın';
    return '';
}

/**
 * Normalizes source or explicitly selected staff marital labels.
 * @param {unknown} value Selected visible label.
 * @returns {string} Canonical marital status or an empty unknown value.
 */
export function normalizeProfileMaritalStatus(value) {
    const label = String(value || '').trim().toLocaleLowerCase('tr-TR');
    if (['bekar', 'bekâr', 'single'].includes(label)) return 'Bekar';
    if (['evli', 'married'].includes(label)) return 'Evli';
    return '';
}

/**
 * Replaces old demographic state using the current Apply profile.
 * @param {object|null} currentStudent Prior profile state.
 * @param {object} profile Authoritative current profile.
 * @returns {object} New profile with explicit demographic provenance.
 */
export function mergeApplyProfile(currentStudent, profile) {
    const cinsiyet = normalizeProfileGender(profile?.cinsiyet);
    const medeniHali = normalizeProfileMaritalStatus(profile?.medeniHali || profile?.medeniHal);
    return { ...currentStudent, ...profile, cinsiyet, genderSource: cinsiyet ? 'apply' : 'unverified',
        medeniHali, medeniHal: medeniHali, maritalSource: medeniHali ? 'apply' : 'unverified' };
}

/**
 * Preserves Apply authority while accepting explicit manual choices.
 * @param {object} student Current profile with provenance.
 * @param {object} choices Staff-selected demographic values.
 * @returns {object} New profile with authoritative or manual values.
 */
export function applyManualProfileChoices(student, choices) {
    const gender = student.genderSource === 'apply' ? student.cinsiyet : normalizeProfileGender(choices.cinsiyet);
    const marital = student.maritalSource === 'apply' ? student.medeniHali
        : normalizeProfileMaritalStatus(choices.medeniHali);
    return { ...student, cinsiyet: gender, genderSource: student.genderSource === 'apply' ? 'apply' : gender ? 'manual' : 'unverified',
        medeniHali: marital, medeniHal: marital,
        maritalSource: student.maritalSource === 'apply' ? 'apply' : marital ? 'manual' : 'unverified' };
}
