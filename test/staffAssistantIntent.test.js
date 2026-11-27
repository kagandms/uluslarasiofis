import assert from 'node:assert/strict';
import test from 'node:test';
import {
    cleanDocumentPrintQuery,
    isRedLineStaffMessage,
    parseCount,
    parseHoursText,
    parseStaffIntent,
    resolvePerson
} from '../src/server/domain/staffAssistantIntent.js';

test('parseHoursText parses decimals, Turkish words, mixed hours/minutes, and raw out-of-range numbers', () => {
    assert.equal(parseHoursText('6,5'), 6.5);
    assert.equal(parseHoursText('6.5 saat'), 6.5);
    assert.equal(parseHoursText('altı buçuk'), 6.5);
    assert.equal(parseHoursText('6 buçuk saat'), 6.5);
    assert.equal(parseHoursText('6 saat 30 dk'), 6.5);
    assert.equal(parseHoursText('6 saat 30 dakika'), 6.5);
    assert.equal(parseHoursText('6.25'), 6.25);
    assert.equal(parseHoursText('25'), 25);
    assert.equal(parseHoursText('yarım saat'), 0.5);
    assert.equal(parseHoursText('45 dk'), 0.75);
    assert.equal(parseHoursText('0 saat'), 0);
    assert.equal(parseHoursText('merhaba'), null);
});

test('parseCount parses digits, negative/large numbers, and Turkish number words', () => {
    assert.equal(parseCount('10 tane'), 10);
    assert.equal(parseCount('10 tane taksit dilekçesi'), 10);
    assert.equal(parseCount('on tane taksit dilekçesi'), 10);
    assert.equal(parseCount('on beş adet'), 15);
    assert.equal(parseCount('10000 tane taksit dilekçesi'), 10000);
    assert.equal(parseCount('-3 tane taksit dilekçesi'), -3);
    assert.equal(parseCount('0 tane taksit dilekçesi'), 0);
    assert.equal(parseCount('taksit dilekçesi çıkar'), null);
});

test('resolvePerson resolves known staff names with Turkish suffixes and handles unknown or ambiguous input', () => {
    assert.equal(resolvePerson('Kağan için'), 'kagan_samet');
    assert.equal(resolvePerson('Kağan Samet için bugüne 6,5 saat'), 'kagan_samet');
    assert.equal(resolvePerson('Samet 4 saat'), 'kagan_samet');
    assert.equal(resolvePerson("Asaf'a 5 saat"), 'asaf');
    assert.equal(resolvePerson('Eyüp için 3 saat'), 'eyup');
    assert.equal(resolvePerson("Oğuz'a 7 saat"), 'oguz');
    assert.equal(resolvePerson('Eray bugün 8 saat'), 'eray');
    assert.equal(resolvePerson('Ali'), null);
    assert.equal(resolvePerson('Ali için 5 saat'), null);

    const ambiguous = resolvePerson('Kağan ve Asaf için 5 saat');
    assert.equal(typeof ambiguous, 'object');
    assert.ok(ambiguous && typeof ambiguous.ask === 'string' && ambiguous.ask.length > 0);
});

test('parseStaffIntent matches deterministic Turkish commands for supported tools', () => {
    assert.deepEqual(
        parseStaffIntent("AB123456 pasaportunu ykn'ye ver"),
        { tool: 'run_ykn_flow', args: { passportNo: 'AB123456' } }
    );

    const printIntent = parseStaffIntent('10 tane taksit dilekçesi çıkar');
    assert.equal(printIntent?.tool, 'propose_documents_print');
    assert.equal(printIntent?.args.copies, 10);

    const workHoursIntent = parseStaffIntent('Kağan için bugüne 6,5 saat');
    assert.equal(workHoursIntent?.tool, 'propose_work_hours');
    assert.equal(workHoursIntent?.args.person, 'kagan_samet');
    assert.equal(workHoursIntent?.args.hours, 6.5);
    assert.equal(workHoursIntent?.args.dateText, undefined);

    const workHoursDotIntent = parseStaffIntent('Kağan için bugüne 6.5 saat');
    assert.equal(workHoursDotIntent?.tool, 'propose_work_hours');
    assert.equal(workHoursDotIntent?.args.hours, 6.5);
    assert.equal(workHoursDotIntent?.args.dateText, undefined);

    const yesterdayWorkHours = parseStaffIntent('Kağan için düne 6,5 saat');
    assert.equal(yesterdayWorkHours?.tool, 'propose_work_hours');
    assert.ok(yesterdayWorkHours?.args.dateText);

    const tebligatIntent = parseStaffIntent('Ahmet Demir tebligat bul');
    assert.equal(tebligatIntent?.tool, 'search_tebligat');
    assert.equal(tebligatIntent?.args.query, 'Ahmet Demir');

    const tebligatLookIntent = parseStaffIntent("Kagan'ın tebliğine bak");
    assert.deepEqual(tebligatLookIntent, { tool: 'search_tebligat', args: { query: 'Kagan' } });

    const tebligatShowIntent = parseStaffIntent('Mehmet Kaya tebligatını göster');
    assert.deepEqual(tebligatShowIntent, { tool: 'search_tebligat', args: { query: 'Mehmet Kaya' } });

    assert.deepEqual(
        parseStaffIntent('ILBEK MUHAMMADOV tebliğine bakar mısın'),
        { tool: 'search_tebligat', args: { query: 'ILBEK MUHAMMADOV' } }
    );
    assert.deepEqual(
        parseStaffIntent('ilbek muhammadov tebliğine bakar mısın?'),
        { tool: 'search_tebligat', args: { query: 'ilbek muhammadov' } }
    );
    assert.deepEqual(
        parseStaffIntent("Ali Veli'nin tebliğine bakar mısınız"),
        { tool: 'search_tebligat', args: { query: 'Ali Veli' } }
    );
    assert.deepEqual(
        parseStaffIntent('tebliğine bakabilir misiniz Ayşe Yılmaz'),
        { tool: 'search_tebligat', args: { query: 'Ayşe Yılmaz' } }
    );
    assert.deepEqual(
        parseStaffIntent('Mustafa Musa tebliğ var mı'),
        { tool: 'search_tebligat', args: { query: 'Mustafa Musa' } }
    );
    assert.deepEqual(
        parseStaffIntent('Naing Min Khant tebliğine bak lütfen'),
        { tool: 'search_tebligat', args: { query: 'Naing Min Khant' } }
    );
    assert.deepEqual(
        parseStaffIntent('Mi Chen tebliğine bak'),
        { tool: 'search_tebligat', args: { query: 'Mi Chen' } }
    );
    assert.deepEqual(
        parseStaffIntent('Eder Silva tebliğine bakar mısın'),
        { tool: 'search_tebligat', args: { query: 'Eder Silva' } }
    );
    assert.deepEqual(
        parseStaffIntent('tebliğine bakar mısın'),
        { tool: 'search_tebligat', args: { query: '' } }
    );

    assert.deepEqual(parseStaffIntent('Tebliğ Bul ekranını aç'), { tool: 'navigate', args: { view: 'teblig' } });
    assert.deepEqual(parseStaffIntent('Tebliğ ekranını aç'), { tool: 'navigate', args: { view: 'teblig' } });

    const yoksisIntent = parseStaffIntent('20260000001 eksik evrak durumu');
    assert.equal(yoksisIntent?.tool, 'lookup_yoksis_audit');
    assert.ok(yoksisIntent?.args.query.includes('20260000001'));

    const appIntent = parseStaffIntent('20260000001 başvurusunu sorgula');
    assert.equal(appIntent?.tool, 'search_applications');
    assert.ok(appIntent?.args.query.includes('20260000001'));

    assert.deepEqual(
        parseStaffIntent('Ahmet Demir başvurusuna bakar mısınız'),
        { tool: 'search_applications', args: { query: 'Ahmet Demir' } }
    );
    assert.deepEqual(
        parseStaffIntent('20260000001 eksik evrak durumuna bakar mısınız'),
        { tool: 'lookup_yoksis_audit', args: { query: '20260000001' } }
    );

    const navIntent = parseStaffIntent('Başvurular ekranını aç');
    assert.deepEqual(navIntent, { tool: 'navigate', args: { view: 'applications' } });

    const disenrollmentForm = parseStaffIntent('2 tane kayıt silme formu çıkar');
    assert.equal(disenrollmentForm?.tool, 'propose_documents_print');
    assert.equal(disenrollmentForm?.args.copies, 2);

    const workHoursSaveIntent = parseStaffIntent("Asaf'a bugün 6 saat kaydet");
    assert.equal(workHoursSaveIntent?.tool, 'propose_work_hours');
    assert.equal(workHoursSaveIntent?.args.person, 'asaf');
    assert.equal(workHoursSaveIntent?.args.hours, 6);
    assert.equal(workHoursSaveIntent?.args.dateText, undefined);

    const workHoursShortSave = parseStaffIntent("Asaf'a 6 saat kaydet");
    assert.equal(workHoursShortSave?.tool, 'propose_work_hours');
    assert.equal(workHoursShortSave?.args.person, 'asaf');
    assert.equal(workHoursShortSave?.args.hours, 6);

    const archiveNav = parseStaffIntent('Arşive git');
    assert.equal(archiveNav, null);

    assert.equal(isRedLineStaffMessage('silinmiş evrak var mı'), false);
    assert.equal(isRedLineStaffMessage("Asaf'a bugün 6 saat kaydet"), false);
    assert.equal(isRedLineStaffMessage('Kağan için bugüne 6,5 saat'), false);
    assert.equal(isRedLineStaffMessage("AB123456 pasaportunu ykn'ye ver"), false);
    assert.equal(isRedLineStaffMessage('A S diye bir öğrenci bize hiç onlineden başvuru yapmış mı'), false);
    assert.equal(isRedLineStaffMessage('göçe iletilen başvuruları göster'), false);
    assert.equal(isRedLineStaffMessage('göçe iletilmiş başvuru var mı'), false);
    assert.equal(isRedLineStaffMessage('reddedilen başvuruları listele'), false);
    assert.equal(isRedLineStaffMessage('Ahmet Demir başvuru durumu nedir'), false);

    assert.deepEqual(
        parseStaffIntent('göçe iletilen başvuruları göster'),
        { tool: 'navigate', args: { view: 'applications' } }
    );
    const readQuestionIntent = parseStaffIntent('A S diye bir öğrenci bize hiç onlineden başvuru yapmış mı');
    assert.equal(readQuestionIntent?.tool, 'search_applications');
});

test('isRedLineStaffMessage and parseStaffIntent refuse Turkish inflected red-line and destructive requests', () => {
    for (const redLineMessage of [
        'sil',
        'başvuruyu sil',
        'bu öğrenciyi siler misin',
        'bu kaydı silsene',
        'bu başvuruyu silebilir misin',
        'bu kayıt silinsin',
        'bu öğrenciyi silin',
        'bu kaydı silmeyi dene',
        'bu öğrenciyi sildir',
        'bu öğrenciyi kaldır',
        'bu başvuruyu kaldırır mısın',
        'belgeyi kaldırabilir misin',
        'bu kaydı arşivle',
        'başvuruyu arşivler misin',
        'başvuruyu arşive al',
        'başvuruyu arşive taşır mısın',
        'başvuruyu iptal et',
        'başvuruyu iptal eder misin',
        'durumu onayla',
        'durumu onaylar mısın',
        'başvuruyu onayla',
        'başvuru onaylansın',
        'başvuruyu reddet',
        'başvuruyu reddeder misin',
        'talep gönder',
        'talep gönderir misin',
        "Apply'a talep gönder",
        "apply'a talep gönderebilir misin",
        "Apply'a gönder",
        "YÖKSİS'e kaydet",
        "YÖKSİS'e kaydeder misin",
        'yöksiste kaydet',
        'durumu kaydet',
        'AB123456 ykn ver ve talep gönder',
        "AB123456 için YKN çalıştırıp YÖKSİS'e kaydet",
        'pekki onu göçe iletildi olarak işaretler misin',
        'başvurusunu reddedildi olarak işaretle',
        'bu başvuruyu tamamlandı olarak işaretlesene',
        'başvuru inceleniyor olarak işaretlensin',
        'bunu eksik evrak olarak işaretleyebilir misin',
        'durumunu tamamlandı yap',
        'başvuruyu reddedildi yap',
        'bunu göçe iletildi yap',
        'başvurunun durumunu değiştirir misin',
        'başvurunun durumunu güncelle',
        'tamamlandı olarak kaydet',
        'göçe iletildi olarak güncelle',
        'bu başvuruyu göçe ilet',
        'başvuruyu göçe gönder',
        'son işlemi geri al',
        'kaydı arşive taşı',
        'başvuruyu başka listeye taşı',
        'öğrencinin adını değiştir',
        'öğrencinin soyadını düzenle',
        'başvuru numarasını değiştirir misin',
        'belgeyi düzenle'
    ]) {
        assert.equal(
            isRedLineStaffMessage(redLineMessage),
            true,
            `Expected red-line true for message: ${redLineMessage}`
        );
        assert.equal(
            parseStaffIntent(redLineMessage),
            null,
            `Expected null for red-line message: ${redLineMessage}`
        );
    }
});

test('parseCount and cleanDocumentPrintQuery handle attached counts, x-formats, fillers, and preserve on lisans', () => {
    assert.equal(parseCount('başvuru formu cıkarır mısın 10tane'), 10);
    assert.equal(parseCount('lisans checklist çıkar 10tane'), 10);
    assert.equal(parseCount('10 adet taksit dilekçesi'), 10);
    assert.equal(parseCount('10x indirim dilekçesi'), 10);
    assert.equal(parseCount('x10 taahhütname'), 10);
    assert.equal(parseCount('10 boş dilekçe'), 10);
    assert.equal(parseCount('on tane ikamet listesi'), 10);
    assert.equal(parseCount('ön lisans checklist çıkar'), null);
    assert.equal(parseCount('bir de on tane taksit dilekçesi'), 10);

    assert.equal(cleanDocumentPrintQuery('başvuru formu cıkarır mısın 10tane'), 'basvuru formu');
    assert.equal(cleanDocumentPrintQuery('lisans checklist çıkar 10tane'), 'lisans checklist');
    assert.equal(cleanDocumentPrintQuery('bana şu taksit dilekçesinden 10x bas lütfen'), 'taksit dilekcesinden');
    assert.equal(cleanDocumentPrintQuery('bir de 5 adet taahütname rica etsem'), 'taahutname');
    assert.equal(cleanDocumentPrintQuery('on tane ön lisans checklist verir misin'), 'on lisans checklist');
    assert.equal(cleanDocumentPrintQuery('ikamet listesi lazım yazdır'), 'ikamet listesi');
});

test('non-print requests (tebligat, work hours, YKN, YÖKSİS, application search, inquiries, red-line) are not routed to document print', () => {
    assert.equal(parseStaffIntent('Ahmet Demir tebligat bul')?.tool, 'search_tebligat');
    assert.equal(parseStaffIntent('Kağan için bugün 6 saat')?.tool, 'propose_work_hours');
    assert.equal(parseStaffIntent("AB123456 pasaportunu ykn'ye ver")?.tool, 'run_ykn_flow');
    assert.equal(parseStaffIntent('20260000001 eksik evrak durumu')?.tool, 'lookup_yoksis_audit');
    assert.equal(parseStaffIntent('Ahmet Demir başvurusuna bakar mısınız')?.tool, 'search_applications');

    for (const msg of [
        'formdan gelen soruları göster',
        'gelen sorular formu',
        'öğrencinin kayıt silme durumunu değiştir',
        'indirimli öğrenciyi sorgula'
    ]) {
        const parsed = parseStaffIntent(msg);
        assert.notEqual(
            parsed?.tool,
            'propose_documents_print',
            `Expected "${msg}" NOT to route to propose_documents_print`
        );
    }
    assert.equal(parseStaffIntent('formdan gelen soruları göster')?.tool, 'navigate');
    assert.equal(parseStaffIntent('öğrencinin kayıt silme durumunu değiştir'), null);
    assert.equal(parseStaffIntent('indirimli öğrenciyi sorgula')?.tool, 'search_applications');
});
