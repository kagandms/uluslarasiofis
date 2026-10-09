import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeApplyProfile, applyManualProfileChoices, normalizeProfileGender, normalizeProfileMaritalStatus } from '../src/utils/ykn-profile-state.js';

for (const gender of ['Erkek', 'Kadın']) {
    test(`Apply ${gender} survives conflicting OCR/manual state in preview and payload`, () => {
        const oldStudent = { cinsiyet: gender === 'Erkek' ? 'Kadın' : 'Erkek', medeniHali: 'Evli', croppedPhotoBase64: 'fake' };

        const profile = mergeApplyProfile(oldStudent, { cinsiyet: gender, medeniHali: 'Bekar' });
        const payload = applyManualProfileChoices(profile, { cinsiyet: oldStudent.cinsiyet, medeniHali: 'Evli' });

        assert.equal(profile.cinsiyet, gender);
        assert.equal(payload.cinsiyet, gender);
        assert.equal(payload.medeniHali, 'Bekar');
        assert.equal(payload.genderSource, 'apply');
    });
}

test('unknown demographic fields clear old selections and require an explicit manual choice', () => {
    const oldStudent = { cinsiyet: 'Kadın', medeniHali: 'Bekar' };

    const profile = mergeApplyProfile(oldStudent, { fullName: 'SYNTHETIC TESTOVA', cinsiyet: '1', medeniHali: '2' });
    const noChoice = applyManualProfileChoices(profile, {});
    const selected = applyManualProfileChoices(profile, { cinsiyet: 'Erkek', medeniHali: 'Evli' });

    assert.equal(profile.cinsiyet, '');
    assert.equal(profile.medeniHali, '');
    assert.equal(noChoice.medeniHali, '');
    assert.equal(selected.cinsiyet, 'Erkek');
    assert.equal(selected.medeniHal, 'Evli');
    assert.equal(selected.maritalSource, 'manual');
});

test('only semantic labels are normalized without country/name/code guesses', () => {
    for (const unknown of ['', null, '1', '2', 'M', 'F', 'E', 'K', 'unknown']) assert.equal(normalizeProfileGender(unknown), '');
    assert.equal(normalizeProfileGender('Female'), 'Kadın');
    assert.equal(normalizeProfileGender('Male'), 'Erkek');
    assert.equal(normalizeProfileMaritalStatus('Single'), 'Bekar');
    assert.equal(normalizeProfileMaritalStatus('Married'), 'Evli');
    assert.equal(normalizeProfileMaritalStatus('1'), '');
});
