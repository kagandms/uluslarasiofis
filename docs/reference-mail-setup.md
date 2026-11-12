# Başvuru numarası e-postası: kurulum rehberi

Durum: kod hazır ve yerel testlerden geçti (2026-11-11). Canlıya alınmadı. Canlı Apps Script dağıtımı, Worker secret'ları ve production migration'ı henüz yapılmadı.

## Ne yapar

Öğrenci ilk adımdaki iletişim sorumluluğu onayını işaretleyip "Devam et" dediğinde kayıtlı e-posta adresine başvuru numarası, öğrenci numarası, başvuru türü ve portal bağlantısı gönderilir. Mail beş dilde (Türkçe, İngilizce, Rusça, Türkmence, Arapça) gider. Taslak otomatik kaydedildiğinde mail gönderilmez, çünkü öğrenci henüz e-postayı düzeltebilir ve onay vermemiş olabilir. Gönderim yalnızca onay adımında yapılır. Mail Google Apps Script üzerinden ofis Gmail hesabından (`goc.topkapiuni@gmail.com`) çıkar. Gönderim başarısız olursa kayıt `application_reference_mails` tablosunda kalır ve sonraki başvuru gönderimlerinde yeniden denenir. Taslak oluşturma işlemi hiçbir durumda mail hatası yüzünden başarısız olmaz.

## Kotalar

- Ücretsiz Gmail hesabında günde 100 alıcı ([Apps Script kotaları](https://developers.google.com/apps-script/quotas)). Kota dolunca mailler ertesi gün gider. Kotanın güncel değeri Google tarafından değişebilir.
- Günlük limit aşılırsa `quota_deferred` olarak işaretlenir ve sonraki gönderimde tekrar denenir.

## Kurulum adımları

1. Ofis Gmail hesabında 2 adımlı doğrulamayı açın.
2. Aynı hesapla yeni bir Apps Script projesi oluşturun. Kod olarak [`scripts/apps-script/reference-mailer.gs`](../scripts/apps-script/reference-mailer.gs) dosyasının içeriğini yapıştırın.
3. Proje ayarları > Komut dosyası özellikleri bölümüne `REFERENCE_MAIL_TOKEN` adıyla, en az 32 karakterlik rastgele bir değer ekleyin.
4. Dağıt > Yeni dağıtım > Web uygulaması: "Şu şekilde çalıştır: Ben", "Erişim: Herkes". Oluşan `/exec` adresini kopyalayın.
5. Worker secret'larını ayarlayın (değerleri repoya veya sohbete yazmayın):
   - `REFERENCE_MAIL_ENDPOINT`: `/exec` adresi
   - `REFERENCE_MAIL_TOKEN`: adım 3'teki değerin aynısı
6. Production migration'ı uygulayın: `npm run db:migrate:production` (migration `0042_application_reference_mails.sql`).
7. Kodu canlıya almadan önce staging veya test adresleriyle uçtan uca deneyin. İlk denemede bir test başvurusu gönderin ve mailin geldiğini doğrulayın.

Secret'lar tanımlı değilse mail sessizce atlanır ve başvuru normal şekilde tamamlanır.

## Güvenlik notları

- Mail yalnızca başvuru numarası, öğrenci numarası, başvuru türü ve portal bağlantısını içerir. Erişim kodu ve pasaport bilgisi içermez.
- Mail adresi ve mail gövdesi veritabanına kaydedilmez. Tabloda yalnızca durum, deneme sayısı ve hata kodu tutulur.
- Apps Script URL'si ve token, Worker secret'larında tutulur ve repoya girmez. Token sızarsa Apps Script'te yeni bir token üretin ve iki tarafı da güncelleyin.

## Bilinen sınırlar

- Hatırlatma maili (taslak tamamlanmadıysa) henüz yok. Zamanlı görev için cron ayarı gerekir ve ayrı onay ister.
- Mail adresini öğrenci yanlış yazarsa mail ulaşmaz. Bu öğrencinin sorumluluğundadır.

- Aynı başvuru için birden fazla gönderim aynı anda çalışırsa çift mail gönderilebilir. Başvuru tek seferlik gönderildiği için bu pratikte beklenmez.
- Kota aşımı ya da hata durumunda tekrar deneme yalnızca sonraki başvuru gönderimlerinde yapılır. Hiç başvuru gelmezse bekleyen mailler gönderilmez. Zamanlı bir yeniden deneme eklenebilir, ama `wrangler.jsonc` cron ayarına dokunulması gerekir.
