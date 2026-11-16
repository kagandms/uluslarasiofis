# Başvuru numarası e-postası: kurulum rehberi

Durum: taslak ve kurtarma e-postaları tek dilli gönderim, gönderici kimliği (`name`/`REPLY_TO`) ve 70/30 kota ayrımı için güncellendi (2026-11-16). Canlı Apps Script dağıtımı, Worker secret'ları ve teslim edilebilirlik testleri kullanıcı tarafından yapılacaktır.

## Ne yapar

Sistem iki tür başvuru e-postası gönderir:

1. **Taslak / ilk başvuru e-postası:** Öğrenci ilk adımdaki iletişim sorumluluğu onayını işaretleyip "Devam et" dediğinde kayıtlı e-posta adresine başvuru numarası, öğrenci numarası, başvuru türü ve kanonik portal bağlantısı gönderilir. Erişim kodu içermez.
2. **Erişim kodu kurtarma e-postası ("Başvuru kodumu unuttum"):** Öğrenci ana sayfadan kurtarma istediğinde, aktif başvurusu ve kayıtlı e-postası varsa başvuru numarası, öğrenci numarası ve **yeni** erişim kodu gönderilir. Eski erişim kodu hemen geçersiz olur; e-postada "siz istemediyseniz yok sayın" uyarısı yer alır.

**Tek dilli gönderim:** Her iki e-posta da öğrencinin istek anındaki arayüz dilinde (`tr`, `en`, `ru`, `tk`, `ar`) tek dilli konu ve tek dilli düz metin gövdeyle gönderilir. Geçerli bir dil bilgisi gelmezse mevcut beş dilli birleşik gövdeye geri dönülür.

Taslak otomatik kaydedildiğinde mail gönderilmez, çünkü öğrenci henüz e-postayı düzeltebilir ve onay vermemiş olabilir. Gönderim yalnızca onay adımında veya kurtarma isteğinde yapılır. Mail Google Apps Script üzerinden ofis Google hesabından çıkar. Gönderim başarısız olursa taslak e-postaları `application_reference_mails` tablosunda kalır ve sonraki başvuru gönderimlerinde yeniden denenir. Taslak oluşturma işlemi hiçbir durumda mail hatası yüzünden başarısız olmaz.

## Gönderici ayarları

[`scripts/apps-script/reference-mailer.gs`](../scripts/apps-script/reference-mailer.gs) betiği aşağıdaki gönderici ayarlarını kullanır:

- **Görünen ad (`name`):** `"İstanbul Topkapı Üniversitesi Uluslararası Öğrenci Ofisi"`
- **Yanıt adresi (`replyTo`):** Apps Script **Komut dosyası özellikleri** içindeki `REPLY_TO` özelliğinden okunur (ör. `ofis@example.org`). Koda sabitlenmez ve `noReply` kesinlikle kullanılmaz.
- **Biçim ve kodlama:** Gövde yalnızca düz metin (`text/plain`, UTF-8) olarak gönderilir; HTML gövde, ek dosya veya URL kısaltıcı kullanılmaz. Kiril (`ru`), Arapça (`ar`, RTL) ve Türkmence (`tk`) özel karakterleri korunur.

## Kotalar

- Ücretsiz Gmail hesabında günde 100 alıcı sınırı varsayılır (**doğrulanmamış; Google'ın güncel belgesinden ve Google Workspace seçeneğinin sınırlarından teyit edilmeli**: [Apps Script kotaları](https://developers.google.com/apps-script/quotas)).
- **70/30 kota bölüşümü:** Kayan 24 saatlik pencerede günlük 100 gönderimlik bütçenin en fazla **70** adedi ilk kayıt (taslak) e-postalarına, **30** adedi erişim kodu kurtarma e-postalarına ayrılır.
- Taslak e-postalarında günlük limit aşılırsa kayıt `quota_deferred` olarak işaretlenir ve sonraki gönderimde yeniden denenir.

## Kurulum adımları

1. Ofis Google hesabında 2 adımlı doğrulamayı açın.
2. Aynı hesapla yeni bir Apps Script projesi oluşturun. Kod olarak [`scripts/apps-script/reference-mailer.gs`](../scripts/apps-script/reference-mailer.gs) dosyasının içeriğini yapıştırın.
3. Proje ayarları > Komut dosyası özellikleri bölümüne şu iki özelliği ekleyin:
   - `REFERENCE_MAIL_TOKEN`: en az 32 karakterlik rastgele bir değer.
   - `REPLY_TO`: öğrenci yanıtlarının geleceği izlenen ofis e-posta adresi (ör. `ofis@example.org`).
4. Dağıt > Yeni dağıtım > Web uygulaması: "Şu şekilde çalıştır: Ben", "Erişim: Herkes". Oluşan `/exec` adresini kopyalayın.
5. Worker secret'larını ayarlayın (değerleri repoya veya sohbete yazmayın):
   - `REFERENCE_MAIL_ENDPOINT`: `/exec` adresi
   - `REFERENCE_MAIL_TOKEN`: adım 3'teki değerin aynısı
6. Production migration'ı uygulayın: `npm run db:migrate:production` (migration `0042_application_reference_mails.sql`).
7. Kodu canlıya almadan önce test adresleriyle uçtan uca deneyin ve teslim edilebilirlik matrisini doldurun.

Secret'lar tanımlı değilse mail sessizce atlanır ve başvuru normal şekilde tamamlanır.

## Teslim edilebilirlik ve spam kontrolü

Canlıya geçiş öncesinde Gmail, Outlook/Hotmail, Yandex, Mail.ru, iCloud ve bir Türk e-posta sağlayıcısında `tr`, `ru` ve `ar` dilleri için gelen kutusu / spam / SPF / DKIM / DMARC sonuçları ölçülmelidir. Tam kontrol listesi, içerik kuralları, `topkapiunigoc.com` DNS önerileri ve boş sonuç tablosu için bkz.:

- [E-posta teslim edilebilirlik ve spam kontrol listesi](2026-11-16-reference-mail-deliverability-checklist.md)

## Güvenlik notları

- Taslak e-postası yalnızca başvuru numarası, öğrenci numarası, başvuru türü ve kanonik portal bağlantısını içerir; erişim kodu ve pasaport bilgisi içermez.
- Kurtarma e-postası yalnızca yeni üretilen erişim kodunu (eski kodu geçersiz kılar), başvuru numarasını, öğrenci numarasını ve kanonik portal bağlantısını içerir; pasaport bilgisi içermez.
- Mail adresi ve mail gövdesi veritabanına kaydedilmez. Tabloda yalnızca durum, deneme sayısı ve hata kodu tutulur.
- Apps Script URL'si, token ve `REPLY_TO` değeri repoya yazılmaz. Token sızarsa Apps Script'te yeni bir token üretin ve iki tarafı da güncelleyin.

## Bilinen sınırlar

- Hatırlatma maili (taslak tamamlanmadıysa) henüz yok. Zamanlı görev için cron ayarı gerekir ve ayrı onay ister.
- Mail adresini öğrenci yanlış yazarsa mail ulaşmaz. Bu öğrencinin sorumluluğundadır.

- Aynı başvuru için birden fazla gönderim aynı anda çalışırsa çift mail gönderilebilir. Başvuru tek seferlik gönderildiği için bu pratikte beklenmez.
- Kota aşımı ya da hata durumunda tekrar deneme yalnızca sonraki başvuru gönderimlerinde yapılır. Hiç başvuru gelmezse bekleyen mailler gönderilmez. Zamanlı bir yeniden deneme eklenebilir, ama `wrangler.jsonc` cron ayarına dokunulması gerekir.
