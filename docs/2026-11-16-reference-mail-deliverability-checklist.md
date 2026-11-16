# E-posta teslim edilebilirlik ve spam kontrol listesi

- **Tarih:** 2026-11-16
- **Kapsam:** Başvuru taslak e-postaları ve erişim kodu kurtarma e-postalarının gönderici kimliği, içerik/kodlama kuralları, `topkapiunigoc.com` alan adı itibarı ve sağlayıcı test matrisi (`scripts/apps-script/reference-mailer.gs`, `docs/reference-mail-setup.md`).
- **Kaynak:** `docs/2026-11-16-ykn-side-by-side-window-plan.md` (Bölüm 2, Görev C) ve `docs/reference-mail-setup.md`.
- **Durum:** Plan, not yet tested (Plan, henüz test edilmedi). Testler kullanıcı tarafından kendi test hesaplarıyla çalıştırılacaktır.

---

## 1. Gönderici kimliği

- **Görünen ad (`name`):** `"İstanbul Topkapı Üniversitesi Uluslararası Öğrenci Ofisi"`
- **Yanıt adresi (`replyTo`):** Apps Script **Komut dosyası özellikleri** içindeki `REPLY_TO` özelliğinden okunur (ör. `ofis@example.org`). Koda sabitlenmez.
- **`noReply` kullanımı:** Kesinlikle kullanılmaz. Öğrencinin yanıt verebileceği, izlenen bir ofis adresi kullanılır.
- **Sözleşme:** Worker ile Apps Script arasındaki mevcut `{ token, to, subject, text }` istek ve `{ ok, error }` yanıt sözleşmesi değişmeden korunur.

## 2. İçerik ve kodlama kuralları

- **Tek dilli gönderim:** Konu ve gövde, öğrencinin sistemde seçtiği arayüz dilinde (`tr`, `en`, `ru`, `tk`, `ar`) tek dilli gönderilir. Dil bilgisi geçersiz veya eksikse mevcut beş dilli birleşik gövdeye geri dönülür.
- **Biçim:** Yalnızca düz metin (`text/plain`, UTF-8). HTML gövde ve dosya eki kullanılmaz.
- **Bağlantılar:** Yalnızca kanonik alan adı bağlantısı (`PORTAL_CANONICAL_ORIGIN`) kullanılır; URL kısaltıcı kesinlikle kullanılmaz.
- **Karakter seti ve yön (RTL) kontrolü:**
  - **Rusça (`ru`):** Kiril alfabesi karakterlerinin konu ve gövdede bozulmadan (mojibake olmadan) görüntülendiği doğrulanır.
  - **Arapça (`ar`):** Sağdan sola (RTL) metin akışının ve satır sonlarının düz metin istemcilerde bozulmadığı doğrulanır.
  - **Türkmence (`tk`):** Özel harflerin (`ä`, `ç`, `ğ`, `j`, `ň`, `ö`, `ş`, `ü`, `ý`, `ž`) doğru iletildiği doğrulanır.

## 3. Alan adı itibarı (`topkapiunigoc.com`)

- `topkapiunigoc.com` yeni bir alan adıdır ve bu alan adı üzerinden e-posta gönderimi yapılmamaktadır (gönderim Apps Script üzerinden ofis Google hesabıyla yapılır).
- Cloudflare panelinde görülen uyarı: `"Email cannot reach @topkapiunigoc.com addresses and could be spoofed"`.
- **Öneri (alan adı sahibinin açık onayı gerekir; DNS değişikliği kalıcıdır):**
  - E-posta göndermeyen alan adı için kök (`@`) SPF TXT kaydı: `v=spf1 -all`
  - DMARC TXT kaydı (`_dmarc.topkapiunigoc.com`): `v=DMARC1; p=reject`
  - İleride ofis adresi `@topkapiunigoc.com` üzerinde kullanılmak istenirse, yukarıdaki kısıtlayıcı kayıtlar yerine **Cloudflare Email Routing** seçeneği ayrıca değerlendirilmelidir.

## 4. Kota notu

- Ücretsiz Gmail hesabında günlük 100 alıcı sınırı varsayılır ve kayan 24 saatlik pencerede **70 taslak / 30 kurtarma** olarak bölüştürülür.
- **Önemli uyarı:** Bu kota sınırı **doğrulanmamış; Google'ın güncel belgesinden teyit edilmeli**. Hem ücretsiz Gmail hesabının hem de olası bir Google Workspace hesabı seçeneğinin günlük alıcı sınırları yayına geçmeden önce Google'ın resmi Apps Script dokümantasyonundan doğrulanmalıdır.

## 5. Öğrenciye gösterilen spam klasörü uyarısı (gözden geçirme)

- Başvuru taslağı kaydedildi ekranında ve "Başvuru kodumu unuttum" onay ekranında 5 dilde (`tr`, `en`, `ru`, `tk`, `ar`) *"E-posta birkaç dakika içinde gelmezse gereksiz (spam) klasörünü kontrol edin"* uyarısının yer alması Görev A kapsamındadır.
- Bu kontrol listesi kapsamında, metnin tüm dillerde açık, anlaşılır ve erişilebilir olduğu gözden geçirilir; arayüz kodu bu görevde değiştirilmez.

## 6. Sağlayıcı test matrisi ve sonuç tablosu

Kullanıcı kendi test hesaplarıyla (gerçek öğrenci verisi veya gerçek ofis adresi paylaşmadan, ör. `test-alici@example.org` mantığıyla) aşağıdaki matrisi çalıştırır. Her sağlayıcıda en az `tr`, `ru` ve `ar` dilleri ayrı ayrı denenir. Gmail testlerinde **"Orijinali göster" (Show original)** ekranından **SPF**, **DKIM** ve **DMARC** sonuçları not edilir.

**Yineleme kuralı:** Sonuç `Gelen Kutusu` değilse (`Spam` veya `Hiç Gelmedi` ise) uygulanan düzeltme kaydedilir ve sonuç `Gelen Kutusu` olana kadar yeni deneme yapılır.

| Test Tarihi | Sağlayıcı | Dil | E-posta Türü (Taslak / Kurtarma) | Sonuç (Gelen Kutusu / Spam / Hiç Gelmedi) | SPF (Gmail "Orijinali göster") | DKIM (Gmail "Orijinali göster") | DMARC (Gmail "Orijinali göster") | Uygulanan Düzeltme / Notlar |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| | Gmail | tr | | | | | | |
| | Gmail | ru | | | | | | |
| | Gmail | ar | | | | | | |
| | Outlook / Hotmail | tr | | | — | — | — | |
| | Outlook / Hotmail | ru | | | — | — | — | |
| | Outlook / Hotmail | ar | | | — | — | — | |
| | Yandex | tr | | | — | — | — | |
| | Yandex | ru | | | — | — | — | |
| | Yandex | ar | | | — | — | — | |
| | Mail.ru | tr | | | — | — | — | |
| | Mail.ru | ru | | | — | — | — | |
| | Mail.ru | ar | | | — | — | — | |
| | iCloud | tr | | | — | — | — | |
| | iCloud | ru | | | — | — | — | |
| | iCloud | ar | | | — | — | — | |
| | Türk e-posta sağlayıcısı (ör. YaaniMail) | tr | | | — | — | — | |
| | Türk e-posta sağlayıcısı (ör. YaaniMail) | ru | | | — | — | — | |
| | Türk e-posta sağlayıcısı (ör. YaaniMail) | ar | | | — | — | — | |
