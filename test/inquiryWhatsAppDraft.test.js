import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInquiryDraft, buildWhatsAppHref } from '../src/staff/inquiryWhatsAppDraft.js';

test('buildInquiryDraft formats all 5 supported languages with the exact template', () => {
    const cases = [
        {
            language: 'TR',
            expected: "Merhaba, İstanbul Topkapı Üniversitesi Uluslararası Ofisi'nden yazıyorum. Gördüğümüz üzere portalımız üzerinden bize şu mesajı göndermişsiniz:\n«Öğrenci belgesi gerekli mi?»\n\n\n\nAnlayışınız için teşekkür ederiz."
        },
        {
            language: 'EN',
            expected: 'Hello, I am writing from the International Office of Istanbul Topkapı University. As we can see, you sent us the following message through our portal:\n“Öğrenci belgesi gerekli mi?”\n\n\n\nThank you for your understanding.'
        },
        {
            language: 'RU',
            expected: 'Здравствуйте! Пишу вам из Международного офиса Стамбульского университета Топкапы. Как мы видим, вы отправили нам через наш портал следующее сообщение:\n«Öğrenci belgesi gerekli mi?»\n\n\n\nБлагодарим за понимание.'
        },
        {
            language: 'TK',
            expected: 'Salam, Stambul Topkapy uniwersitetiniň Halkara ofisinden ýazýaryn. Görşümiz ýaly, siz portalymyz arkaly bize şu habary iberipsiňiz:\n«Öğrenci belgesi gerekli mi?»\n\n\n\nDüşünişiňiz üçin sag boluň.'
        },
        {
            language: 'AR',
            expected: 'مرحباً، أكتب إليكم من المكتب الدولي في جامعة إسطنبول توبكابي. كما نرى، لقد أرسلتم إلينا عبر بوابتنا الرسالة التالية:\n«Öğrenci belgesi gerekli mi?»\n\n\n\nشكراً لتفهمكم.'
        }
    ];

    for (const entry of cases) {
        assert.equal(
            buildInquiryDraft({
                language: entry.language,
                message: 'Öğrenci belgesi gerekli mi?'
            }),
            entry.expected,
            `${entry.language} uppercase`
        );

        assert.equal(
            buildInquiryDraft({
                language: entry.language.toLowerCase(),
                message: 'Öğrenci belgesi gerekli mi?'
            }),
            entry.expected,
            `${entry.language} lowercase`
        );
    }
});

test('buildInquiryDraft falls back to EN for unknown or empty language', () => {
    const expected = 'Hello, I am writing from the International Office of Istanbul Topkapı University. As we can see, you sent us the following message through our portal:\n“Hello”\n\n\n\nThank you for your understanding.';
    assert.equal(buildInquiryDraft({ language: 'de', message: 'Hello' }), expected);
    assert.equal(buildInquiryDraft({ language: '', message: 'Hello' }), expected);
    assert.equal(buildInquiryDraft({ language: null, message: 'Hello' }), expected);
    assert.equal(buildInquiryDraft({ message: 'Hello' }), expected);
});

test('buildInquiryDraft normalizes whitespace, strips control characters, preserves HTML as plain text, and truncates 600 chars at 400 word boundary', () => {
    const dirty = buildInquiryDraft({
        language: 'en',
        message: '  <b>x</b>\u0007\n\nline   two\t\tthree  '
    });
    assert.equal(
        dirty,
        'Hello, I am writing from the International Office of Istanbul Topkapı University. As we can see, you sent us the following message through our portal:\n“<b>x</b> line two three”\n\n\n\nThank you for your understanding.'
    );

    const longMessage = Array.from({ length: 60 }, (_, idx) => `word${String(idx).padStart(5, '0')}`).join(' ');
    assert.ok(longMessage.length > 550);
    const draft = buildInquiryDraft({
        language: 'en',
        message: longMessage
    });
    const match = draft.match(/“([^”]+)”/u);
    assert.ok(match);
    const quoted = match[1];
    assert.ok(quoted.endsWith('…'));
    assert.ok(quoted.length <= 401);
    assert.equal(quoted.slice(0, -1).endsWith(' '), false);
    assert.ok(longMessage.startsWith(quoted.slice(0, -1)));
});

test('buildWhatsAppHref encodes draft text and handles empty drafts or missing digits', () => {
    const draft = buildInquiryDraft({
        language: 'tr',
        message: 'Merhaba & soru?'
    });
    const href = buildWhatsAppHref('+90 (505) 123-45 67', draft);
    assert.ok(href.startsWith('https://wa.me/905051234567?text='));
    const encoded = href.slice('https://wa.me/905051234567?text='.length);
    assert.equal(decodeURIComponent(encoded), draft);

    assert.equal(buildWhatsAppHref('+90 505 123 45 67', ''), 'https://wa.me/905051234567');
    assert.equal(buildWhatsAppHref('+90 505 123 45 67'), 'https://wa.me/905051234567');
    assert.equal(buildWhatsAppHref('---', draft), '');
    assert.equal(buildWhatsAppHref('', draft), '');
});

test('buildInquiryDraft treats replacement patterns and literal {message} in message as literal text', () => {
    const specialMessage = "price is $& and $$ and $1 and $' with {message}";
    assert.equal(
        buildInquiryDraft({
            language: 'en',
            message: specialMessage
        }),
        `Hello, I am writing from the International Office of Istanbul Topkapı University. As we can see, you sent us the following message through our portal:\n“${specialMessage}”\n\n\n\nThank you for your understanding.`
    );
});
