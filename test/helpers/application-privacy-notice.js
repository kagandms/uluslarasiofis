export const TEST_APPLICATION_PRIVACY_NOTICE_VERSION = 'test-approved-v1';

export const TEST_APPLICATION_PRIVACY_NOTICE = JSON.stringify({
    version: TEST_APPLICATION_PRIVACY_NOTICE_VERSION,
    content_by_locale: { tr: 'test', en: 'test', ru: 'test', tk: 'test', ar: 'test' }
});

export function withTestApplicationPrivacyNotice(environment) {
    environment.PUBLIC_APPLICATION_PRIVACY_NOTICE = TEST_APPLICATION_PRIVACY_NOTICE;
    return environment;
}

export function withTestApplicationPrivacyNoticeVersion(body) {
    return {
        ...body,
        privacy_notice_version: body.privacy_notice_version ?? TEST_APPLICATION_PRIVACY_NOTICE_VERSION
    };
}
