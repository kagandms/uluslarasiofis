# Kodu ve owner oturumu kayıp taslağa pilot desteği

Taslaklar mevcut staff list/detail ekranında görünmez. Aynı öğrencinin yeniden create denemesi 409 `APPLICATION_ALREADY_ACTIVE` verir. Bilinen doğru application ID ile mevcut reviewer/admin reset API'si taslağı destekler. Bu geçici prosedür ürün UI/API'sini genişletmez; öğrenci numarası public recovery yetkisine dönüşmez.

## Kimlik ve yetki

1. Destek kaydı açın. Görevli reviewer/admin öğrenciyi fiziksel kimlik ve yetkili kurum öğrenci kaydıyla doğrular; öğrenci numarasını bu güvenilir kaynaktan alır. Taslak ad/pasaport henüz boş olabilir. Taslak e-posta/telefon, numara bilgisi veya checkbox tek başına kimlik kanıtı değildir. Doğrulama yetersizse reset yapmayın.
2. Tercihen öğrencinin başvuru numarasını alın. D1 lookup için ayrıca yetkili Cloudflare operatörü gerekir; staff oturumu D1 yetkisi sağlamaz. Operatör sadece doğru ortamda aşağıdaki SELECT'i çalıştırır. Sonuç en fazla iki satır ve yalnız application ID/ref/status içerir; kod/hash/session, iletişim, pasaport/ad veya belge içeriği okunmaz.
3. Referans mevcutsa referans lookup ve kurumdan doğrulanmış öğrenci numarası lookup aynı **tek aktif application ID** ile eşleşmeli. Referans yoksa doğrulanmış öğrenci numarasıyla lookup yapın. Sıfır/çoklu sonuç, terminal veya draft dışı durum, kimlik/eşleşme şüphesi varsa bu prosedürü durdurun ve kayıtlı destek değerlendirmesine taşıyın. Aktif kayıt sayısını düşürmek için kayıt/durum silmeyin.

## Özel SELECT dosyasını hazırlama

Operatörün erişim kontrollü 0700 dizininde 0600 özel bir JSON girdisi hazırlayın. Gerçek öğrenci numarasını komut satırına, shell history'ye, paylaşılan terminale, issue/chat'e koymayın. Girdi yalnız bir lookup seçer:

```json
{"kind":"reference","value":"ITU-2345-6789"}
```

Referans yoksa veya eşleşme kontrolü için `{"kind":"student-number","value":"KURUMDAN-DOGRULANMIS-NUMARA"}` kullanın. `scripts/pilot/draft-support-query.mjs` yalnız SELECT hazırlar; ağ/DB çağrısı yapmaz. Referans biçimini ve öğrenci numarasını doğrular, API ile aynı normalizasyonu kullanır, SQL literal tırnaklarını escape eder, kontrol karakterlerini reddeder. Output özel dizinde 0600 ve yeni dosya olmalıdır; mevcut dosyayı ezmez. Query'nin kendisi kişisel tanımlayıcı içerir, paylaşılmamalıdır.

```sh
node scripts/pilot/draft-support-query.mjs /ozel/operator-dizini/lookup.sql < /ozel/operator-dizini/lookup-input.json
```

Bu teslimde yalnız izole yerel D1 için komut çalıştırıldı:

```sh
npx wrangler d1 execute uluslarasiofis-local --local --config /yerel/proof/wrangler.json --persist-to /yerel/proof-state --file /ozel/operator-dizini/lookup.sql --json > /ozel/operator-dizini/lookup-result.json
```

Yerel komut staging erişimi sayılmaz. Gerçek pilotta ayrıca yetkilendirilmiş D1 salt okunur operatör/console oturumu kullanılmalı, doğru Worker/D1 ortamı kontrol edilmeli ve yalnız üretilen SELECT çalıştırılmalıdır. D1 ayrı salt okunur izinle sınırlandırılamıyorsa daha geniş kimlik bilgisinin kontrolü kurumun yetkili operatöründe kalır; öğrenciye/staff tarayıcısına verilmez. Bu turda uzak lookup dahil hiçbir uzak işlem yapılmadı.

## Mevcut reset API'sini kullanma

Fiziksel/kurumsal kimlik ve tek kayıt eşleşmesi tamamlandıktan sonra reviewer/admin mevcut staff oturumuyla, aynı origin'den `POST /api/staff/applications/<doğrulanmış-application-id>/reset-access-code`, JSON `{}` çağrısını yapar. Yetkili oturum normal staff login ile alınır; SQL ile hash/kod/session oluşturulmaz. Worker kodu kendisi üretir ve atomik version guard, audit, bütün eski owner oturumlarını iptal etme işlemlerini uygular. Endpoint referansı değiştirmez.

Draft detail modalı bu işlem için açılamaz. Geçici operatör yolu, kurumun kontrollü API istemcisi veya mevcut staff origin'inde authenticated browser DevTools'tur. Örnek aşağıdaki snippet yalnız API'yi çağırıp kodu geçici dialogda gösterir; console'a response/kod basmaz, storage/URL'ye veya panoya otomatik yazmaz. Application ID dışında gerçek kimlik/kod snippet'e eklenmez. Kimlik doğrulamadan çalıştırılmamalıdır:

```js
void (async () => {
    const applicationId = 'D1-LOOKUP-ILE-DOGRULANMIS-ID';
    const response = await fetch(`/api/staff/applications/${encodeURIComponent(applicationId)}/reset-access-code`, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: '{}'
    });
    if (!response.ok) { window.alert(`Reset tamamlanmadı: HTTP ${response.status}. Güncel kaydı kontrol edin.`); return; }
    const credentials = await response.json();
    window.prompt(`Doğrulanan öğrenciye özel iletin. Başvuru: ${credentials.reference_number}`, credentials.access_code);
})().catch(() => window.alert('Reset sonucu alınamadı. Aynı işlemi körlemesine tekrarlamayın; yetkili destek kaydından kontrol edin.'));
```

Öğrenciye yeni referans/kod çiftini yalnız doğrulanmış özel kanaldan verin; dialogu ve DevTools'u kapatın. Network response içeriğini ekran görüntüsü/rapor olarak saklamayın. 409/401/403 veya response kaybında işlemin tamamlandığını varsaymayın; yetkili yeniden kontrol gerekir. Response kaybında doğrudan SQL kod üretme yok; yeniden doğrulanmış kontrollü reset mevcut bütün kodları tekrar döndürebilir.

Öğrenci yeni kodla `/basvuru/` üzerinden oturum açar; eski kod ve bütün eski owner cookie'leri 401, yeni kod 200 olmalıdır. Başvuru referansı, taslak ve diğer başvurular korunur. Destek kaydında kimlik doğrulama yöntemi, görevli, zaman ve güvenli işlem sonucu tutulur; plaintext kod/hash/cookie veya kimlik belgesi kopyası tutulmaz. Özel lookup input/query/result dosyaları kurumun erişim ve saklama politikasına göre kaldırılır.

## Kanıtın sınırı

Worker/SQLite regresyonları referans ve öğrenci numarası lookup, draft'ın list/detail'de gizliliği, duplicate 409, yalnız mevcut reset API'si, eski kod/iki owner cookie reddi, yeni kod erişimi ve sabit referansı doğrular. CLI testleri tırnak/enjeksiyon literal güvenliği, minimum sonuç alanları, özel output ve overwrite reddini kapsar.

Native workerd/local D1/R2 koşusu bu prosedürü aynı SELECT üreteci ve API'lerle ayrıca uygular; kurum kimlik doğrulaması sentetik olarak temsil edilir. Gerçek fiziksel/kurumsal kimlik kontrolü, gerçek kurum operatörünün D1 yetkisi ve uzak reset UAT'si **NOT EXECUTED**. Bu prosedür gerçek staff ekranında taslak bulunabildiği iddiası değildir.
