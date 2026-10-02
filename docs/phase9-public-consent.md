# Phase 9: Public Öğrenci Portalı WhatsApp Bildirim İzni ve Doğrulama Raporu (Harden & Opt-Out Robustness)

## 1. Kapsam ve Başlangıç İzolasyonu

- **Entegrasyon Tabanı Commit:** `fba153c1f34d76555b76bdef920fc9ce26a07f46` (`codex/phase9-10-integration-hardening`)
- **Önceki Hardening Commit:** `095647de8c8993a0fb1b6bd86bf0b47180aec71b` (`antigravity/phase9-public-consent-hardening`)
- **İzole Worktree:** `/Users/kagansmtdms/Downloads/Проекты/uluslarasiofis-phase9-public-consent-hardening`
- **Hedef Çalışma Dalı:** `antigravity/phase9-public-consent-hardening`
- **Görev Amacı:** Public WhatsApp izin arayüzünde opt-out (izin geri çekme) akışındaki iki temel kusuru gidermek:
  1. Daha önce kayıtlı izni olan sahibin `requires_reconsent: true`, `can_opt_in: false` veya bilinmeyen `current_consent_version` durumlarında dahi iznini her koşulda geri çekebilmesini sağlamak (takip ekranında ve sihirbazda açık opt-out eylemi).
  2. Opt-out isteğinin yalnızca sunucudan doğrulanan `whatsapp_opt_in: false` ve `effective_whatsapp_opt_in: false` yanıtı geldiğinde başarı ("kaydedildi") sayılması; bozuk/mismatch yanıtlarda güvenli hata durumunun gösterilmesi; opt-out doğrulamasının sunucunun sürümünden bağımsız çalışması.
- **İzolasyon Kuralları:**
  - Başlangıç dizini ve untracked `docs/phase8h-scanner-design.md` dosyası korunmuştur.
  - Codex'in `codex/phase9-10-integration-hardening` worktree'sine ve backend dosyalarına dokunulmamıştır.
  - `src/server/**`, `migrations/**`, `src/staff/**`, `yetkili/**`, `package.json`, `package-lock.json`, Vite ve Wrangler yapılandırmalarına müdahale edilmemiştir.
  - Bağımlılıklar izole ortamda `npm ci` ile korunmuş, `package.json` değiştirilmemiştir.

---

## 2. API Sözleşmesi ve Opt-Out Doğrulama Kuralları

`src/server/routes/applicantNotificationPreferenceRoutes.js` kaynak kodundaki gerçek sözleşmeyle uyumlu kurallar:

### Endpoint ve Yük Sözleşmesi
- `GET /api/public/applications/current/notification-preferences`
- `PUT /api/public/applications/current/notification-preferences`
- **Opt-in Yükü:** `{ "whatsapp_opt_in": true, "consent_version": "whatsapp-consent-v1", "language": "tr|en|ru|tk|ar" }`
- **Opt-out Yükü:** Kesinlikle ve yalnızca `{ "whatsapp_opt_in": false }` (başka hiçbir alan gönderilmez).

### Opt-Out Doğrulama Semantiği (`isVerifiedOptOut`):
1. **Zorunlu Alan Tipleri:** `application_id`, `current_consent_version`, `effective_whatsapp_opt_in`, `requires_reconsent`, `can_opt_in`, `whatsapp_opt_in` alanları doğru veri tipinde sunucudan dönmelidir.
2. **Kimlik Eşleşmesi:** Yanıttaki `application_id` aktif sahip oturumundaki başvuru kimliğiyle birebir eşleşmelidir; uyuşmazlık veya eksiklik durumunda başarı asla kabul edilmez.
3. **Açık İptal Teyidi:** Yanıt açıkça `whatsapp_opt_in: false` VE `effective_whatsapp_opt_in: false` dönmelidir. Yanıt izin durumunu hâlâ etkin gösteriyorsa `isVerifiedOptOut: false` kabul edilir ve kullanıcıya hata uyarısı verilir.
4. **Sürüm Bağımsızlığı:** Opt-out işlemi yeni bir onay metnine rıza gösterme eylemi değil, mevcut izni geri çekme eylemidir. Bu nedenle sunucu arayüzün bilmediği bir `current_consent_version` (örn. `whatsapp-consent-v2`) dönse dahi opt-out doğrulanır ve başarıyla kaydedilir (`isVersionSupported` şartı aranmaz).

---

## 3. Mimari İyileştirmeler ve Opt-Out Sağlamlaştırması

### A. Takip Ekranında Koşulsuz Opt-Out Eylemi (`mountTrackingNotificationPreferences`)
- **Durum 1 (Etkin İzin):** Tek bir butonla `whatsappOptOutAction` ("WhatsApp Bildirimlerini Kapat") gösterilir.
- **Durum 2 (`requires_reconsent: true`):** Yeniden izin metni (`whatsappReconsentRequired`) gösterilirken;
  - Öğrenci şartları sağlıyorsa (`canOptIn && isVersionSupported`) "WhatsApp Bildirimlerini Aç" birincil butonu;
  - Mevcut kayıtlı izni varsa (`whatsappOptIn: true`) **aynı anda** "WhatsApp Bildirimlerini Kapat" ikincil butonu gösterilir. Yeniden izin metni ile opt-out birbirini dışlamaz.
- **Durum 3 (`!isVersionSupported` veya `canOptIn: false`):** Yeni opt-in butonları gizlenir; ancak sistemde kayıtlı izin bulunuyorsa (`whatsappOptIn: true`) opt-out butonu görünür kalır ve öğrenci iznini kapatabilir.

### B. Başvuru Sihirbazında Opt-Out Butonu (`createNotificationPreferenceField`)
- Öğrencinin daha önce kayıtlı izni varsa (`currentPreference.whatsappOptIn === true`), onay kutusu telefon değişikliği veya sürüm nedeniyle işaretsiz/devre dışı kalsa dahi altında açık bir "WhatsApp Bildirimlerini Kapat" (`data-action="preference-opt-out"`) butonu sunulur.
- Butona tıklandığında `{ whatsapp_opt_in: false }` gönderilir; doğrulama sağlandığında buton gizlenir ve "kaydedildi" durumu gösterilir.

### C. Yanıt Doğrulama ve Güvenli Hata Bildirimi
- Gelen PUT yanıtı `isVerifiedOptOut` kriterini sağlamazsa:
  - Asla `whatsappPreferenceSaved` ("kaydedildi") gösterilmez.
  - Arayüzde `role="alert"` ile güvenli bir hata mesajı (`whatsappPreferenceFailed`) verilir.
  - İzin durumu güncellenmiş varsayılmaz.

---

## 4. Test ve Doğrulama Kanıtları

### 1. Odaklı UI Test Paketi (`test/notificationPreferencesUi.test.js`)
Entegrasyon dalında toplam **27 test senaryosu** başarıyla çalıştırıldı (0 hata):
1. `parseNotificationPreferences`: Eksik veya eski API yanıtlarında iznin doğrulanmış sayılmaması.
2. `application_id`: Eksik veya farklı kimlikte takip ekranında ve sihirbazda kontrollerin engellenmesi.
3. Bilinmeyen izin sürümünde opt-in işleminin engellenmesi.
4. İletişim adımı: Varsayılan işaretsiz durum ve devam butonunun bloklanmaması.
5. Oturumsuz ziyaretçi: Tıklamada erken PUT atılmaması; Adım 0 kaydedilince opt-in PUT gönderimi.
6. Oturumsuz ziyaretçi: İşaretlenmediğinde taslak kaydında PUT isteği atılmaması.
7. Bekleyen telefon kaydı: Mevcut taslakta önce telefonun sunucuya kaydedilmesi, sonra tercih PUT atılması.
8. Başarısız telefon kaydı: Tercih PUT'un durdurulması, kullanıcının seçiminin korunması ve tekrar deneme imkanı.
9. Ağda PUT varken telefon değişimi: Eski yanıtın yeni telefona izin olarak yansıtılmaması.
10. Telefon kaydı sonrası açık yeniden onay verilmesi ve doğrulanmış durumun korunması.
11. İlk taslak oluşturma hatası: Akışın bloke edilmemesi, kalıcı uyarı kutusu ve taslak yaratmadan tekrar deneme.
12. Dil değişimi: 5 dilde UI güncellemesi yapılması ve gereksiz PUT atılmaması.
13. Takip ekranı: Oturum sahibi tarafından opt-out ve opt-in geçişleri.
14. Genel sorgulama izolasyonu: Öğrenci numarası sorgulamasında tercih UI'ının ve API çağrısının engellenmesi.
15. Eksik telefon (`can_opt_in: false`): Butonların gizlenmesi ve bilgilendirme metni.
16. API hata yönetimi: 401 oturum sonlanması, 400 sürüm hatası ve 409 alıcı hatası.
17. Hızlı ardışık tıklamalar: Buton kilitleme ile yarış ve sıra dışı durum oluşumunun engellenmesi.
18. **(Yeni)** `requires_reconsent: true` ve eski kayıtlı izin varken opt-out mümkün (takip ve sihirbaz).
19. **(Yeni)** `can_opt_in: false` iken kayıtlı izni opt-out etmek mümkün (takip ve sihirbaz).
20. **(Yeni)** Bilinmeyen izin sürümünde yeni opt-in engellenirken opt-out mümkün.
21. **(Yeni)** Bozuk/eksik yanıt veya başka `application_id` için “kaydedildi” gösterilmiyor.
22. **(Yeni)** Opt-out PUT yanıtı izin durumunu hâlâ etkin gösterirse başarı gösterilmiyor.
23. **(Yeni)** Opt-out payload’ı yalnızca `{ "whatsapp_opt_in": false }` olarak kalıyor.
24. **(Yeni)** Consent PUT sırasında telefon alanı kilitli (`disabled`, `aria-disabled="true"`); başarılı yanıtla tekrar düzenlenebilir.
25. **(Yeni)** Autosave sırasında telefon değişirse consent PUT hiç gönderilmiyor.
26. **(Entegrasyon)** Consent PUT reddedilince telefon alanı açılıyor ve hata görünür kalıyor.
27. **(Entegrasyon)** Opt-out PUT telefon alanını kilitlemiyor.

### 2. Yerel Mock Sunuculu Başsız Tarayıcı Kontrolü (`scripts/check-public-consent-browser.mjs`)
- **Çalıştırma:**
  ```bash
  node scripts/check-public-consent-browser.mjs
  # veya
  npx --yes puppeteer@24.4.0 node scripts/check-public-consent-browser.mjs
  ```
- **Sonuçlar:** 4 ekran genişliği (320px, 390px, 768px, 1440px) ve 5 dilde (TR, EN, RU, TK, AR) 20 kombinasyon 0px yatay taşma ile başarılı oldu; etkileşimli opt-in, opt-out, telefon değişikliği uyarısı, owner tracking ve public lookup izolasyonu yerel mock API ile doğrulandı.
- Bu kontrol yerel Puppeteer/Chromium ve mock API kullanır; canlı Cloudflare staging UAT'si değildir.
- *Not:* Otomatik kontroller WCAG 2.1 AA manuel denetim yerine geçmez.

### 3. Entegrasyon Test Paketi ve Derleme Doğrulaması
- `node --test test/notificationPreferencesUi.test.js`: **27/27 başarılı** (yalnız consent UI testleri).
- `npm run test:backend`: **162/162 başarılı** (backend test dosyaları; consent API sözleşme testleri dahil, public UI dosyası dahil değil).
- `npm test`: **464/464 başarılı** (tam repo test glob'u; focused UI testleri bu paketin içinde).
- `npm run build:staging`: başarılı; mevcut `INEFFECTIVE_DYNAMIC_IMPORT` uyarısı `src/staff/main.js` ve `src/managers/yknManager.js` import yapısından geliyor.
- `node scripts/check-public-consent-browser.mjs`: başarılı; yalnızca yerel mock-sunucu headless tarayıcı kanıtı.
- `git diff --check`: **PASS**; entegrasyon commit'i `b29f1d5a6fb848912decf3b5f3d9fe3fae1c911c` sonrasında yeniden çalıştırıldığı bildirildi.

---

## 5. Telefon Kilidi Koruma Kapsamı ve Sınırları

### Korunan Senaryo
Başvuru sihirbazında öğrenci "WhatsApp bildirimi al" onay kutusunu işaretlediğinde:
1. Önce telefon otomatik kaydı (`persistPhone` / autosave) çalışır.
2. Autosave sırasında telefon değişirse nesil denetimi (`saveGeneration`) consent PUT'u engeller ve kilit hiç etkinleşmez.
3. Autosave başarıyla tamamlandıktan sonra telefon alanı `disabled` + `aria-disabled="true"` ile kilitlenir.
4. Consent PUT yanıtı gelene kadar (başarı, doğrulama hatası, ağ hatası) alan kilitli kalır.
5. `try/finally` bloğu sayesinde her çıkış yolunda alan güvenli biçimde açılır.
6. Opt-out akışında telefon kilidi **uygulanmaz**; yalnızca opt-in PUT'unda etkindir.

### Sınırlar
- Bu koruma **istemci tarafı form sıralaması** güvencesidir; Cloudflare Workers, D1 veya dağıtık eşzamanlılık katmanında yarış testi yapmaz.
- Telefon alanının `disabled` durumda tarayıcı `input` olayı üretmemesine dayanır; özel/programatik müdahale (devtools konsolundan `.value` yazma) dışarıda bırakılır.
- Ağ yanıtı belirsiz kalırsa consent "kaydedildi" mesajı gösterilmez; kullanıcıya güvenli bir hata durumu sunulur.

---

## 6. Canlı Staging ve Entegrasyon Bekleyen Kontroller

1. Gerçek Cloudflare D1 üzerinde `GET /api/public/applications/current/notification-preferences` endpoint'inden dönen metadata'nın canlı staging ortamında uçtan uca doğrulanması.
2. WhatsApp Business API / Meta Cloud API kimlik bilgileri (`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`) sağlandığında gerçek şablon dağıtımı.
3. Personel panelindeki bildirim geçmişi ve loglarının canlı staging ortamında izlenmesi.

## 7. Codex Phase 9–10 Entegrasyon İncelemesi — 2026-10-02

- Entegrasyon tabanı `fba153c1f34d76555b76bdef920fc9ce26a07f46`; Antigravity consent commit'i `3ffb734ee9387601a34cf26b5a6f2b18948cecf3` bu tabandan türemiştir ve yeni izole entegrasyon dalına birleştirilmiştir.
- `applicantNotificationPreferenceRoutes.js` GET/PUT sözleşmesi arayüzün beklediği `application_id`, `current_consent_version`, `effective_whatsapp_opt_in`, `requires_reconsent` ve `can_opt_in` alanlarını döndürür. İstek başvuru kimliğini istemciden almaz; `requireApplicationSession` ile sahip oturumunun `application_id` değerine bağlanır.
- Opt-out `{ "whatsapp_opt_in": false }` gönderir; yalnızca zorunlu alan tipleri, aynı başvuru kimliği ve iki açık `false` durumunu doğrulayan yanıt başarı sayılır. Sürümü bilinmeyen yanıt yeni opt-in'i engellerken kayıtlı izin geri çekilebilir.
- Eksik metadata doğrulanmış izin veya başarıya dönüştürülmez. İlk taslak opt-in PUT hatası görünür uyarı ve aynı taslak üzerinde tekrar deneme sağlar. Öğrenci numarasıyla public lookup tercih API'sini çağırmaz.
- Telefon autosave'i PUT öncesinde tamamlanır; autosave sürerken değişiklik algılanırsa PUT gönderilmez. Telefon kilidi yalnızca consent opt-in PUT süresince çalışan istemci tarafı sıralama korumasıdır; Worker/D1 dağıtık eşzamanlılık garantisi değildir. Opt-out kilit uygulamaz.
- Bağımsız kaynak incelemesinde uygulama kodu düzeltmesi gerektiren somut kusur bulunmadı; entegrasyonun doğrulanabilirlik açığı için iki UI regresyon testi eklendi (PUT reddinde unlock ve opt-out sırasında unlocked).
