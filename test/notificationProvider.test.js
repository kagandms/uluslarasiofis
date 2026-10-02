import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMetaWhatsAppProvider } from '../src/server/services/metaWhatsAppProvider.js';

const environment = {
    WHATSAPP_ACCESS_TOKEN: 'test-access-token',
    WHATSAPP_PHONE_NUMBER_ID: '1234567890123',
    WHATSAPP_CLOUD_API_VERSION: 'v24.0',
    WHATSAPP_APPROVED_TEMPLATES: {
        status_updated: { tr: { name: 'application_status_tr', languageCode: 'tr' } }
    }
};

test('Meta adapter sends only the configured approved template to the fixed Graph API endpoint', async () => {
    let capturedRequest;
    const provider = createMetaWhatsAppProvider(environment, async (url, options) => {
        capturedRequest = { url, options };
        return Response.json({ messages: [{ id: 'wamid.test-123' }] });
    });

    const result = await provider.dispatch({ recipient: '+905551112233', templateKey: 'status_updated',
        language: 'tr', message: 'client supplied content must not be sent' });
    const body = JSON.parse(capturedRequest.options.body);
    assert.equal(provider.isConfigured, true);
    assert.deepEqual(result, { status: 'accepted', messageId: 'wamid.test-123' });
    assert.equal(capturedRequest.url, 'https://graph.facebook.com/v24.0/1234567890123/messages');
    assert.equal(capturedRequest.options.headers.Authorization, 'Bearer test-access-token');
    assert.deepEqual(body, { messaging_product: 'whatsapp', to: '905551112233', type: 'template',
        template: { name: 'application_status_tr', language: { code: 'tr' } } });
});

test('Meta adapter stays unavailable until credentials and approved template map exist', async () => {
    const provider = createMetaWhatsAppProvider({ ...environment, WHATSAPP_APPROVED_TEMPLATES: {} },
        async () => assert.fail('unconfigured provider must not call fetch'));
    assert.equal(provider.isConfigured, false);
});

test('Meta adapter classifies explicit rejection separately from an uncertain server outcome', async () => {
    for (const [status, classification] of [[429, 'transient'], [400, 'permanent'], [500, 'unknown']]) {
        const provider = createMetaWhatsAppProvider(environment,
            async () => new Response('{}', { status }));
        await assert.rejects(provider.dispatch({ recipient: '+905551112233', templateKey: 'status_updated', language: 'tr' }),
            (error) => error.classification === classification);
    }
});

test('Meta adapter fails closed when the selected template is not institutionally mapped', async () => {
    const provider = createMetaWhatsAppProvider(environment, async () => assert.fail('unmapped template must not call fetch'));
    await assert.rejects(provider.dispatch({ recipient: '+905551112233', templateKey: 'status_updated', language: 'en' }),
        (error) => error.classification === 'permanent');
});
