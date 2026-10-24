import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_APPLICATION_PRIVACY_NOTICE } from '../src/server/domain/applicationPrivacyNotice.js';

const REQUIRED_LOCALES = Object.freeze(['tr', 'en', 'ru', 'tk', 'ar']);

test('default application privacy notice includes the five supported locales', () => {
    assert.match(DEFAULT_APPLICATION_PRIVACY_NOTICE.version, /^[A-Za-z0-9._-]{1,80}$/u);
    assert.deepEqual(Object.keys(DEFAULT_APPLICATION_PRIVACY_NOTICE.content_by_locale).sort(), [...REQUIRED_LOCALES].sort());
    for (const locale of REQUIRED_LOCALES) {
        assert.ok(DEFAULT_APPLICATION_PRIVACY_NOTICE.content_by_locale[locale].trim().length > 0, `${locale} notice must not be empty`);
        assert.ok(DEFAULT_APPLICATION_PRIVACY_NOTICE.content_by_locale[locale].length <= 20000, `${locale} notice exceeds the API limit`);
    }
});
