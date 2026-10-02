# Phase 9: Public Öğrenci Portalı WhatsApp Bildirim İzni ve UX Doğrulama Raporu

## 1. Kapsam ve Başlangıç İzolasyonu

- **Temel Backend Commit:** `c59e56ccc68cb9680fa764b0213b83703bb4aac8` (`codex/phase9-notifications-core`)
- **Birleştirilen Public UX Commit:** `617e4f0281c0ee2b6b4d177631fc921ecd083c4d` (`antigravity/phase10-public-ux-i18n`)
- **İzole Worktree:** `/Users/kagansmtdms/Downloads/Проекты/uluslarasiofis-phase9-public-consent`
- **Hedef Çalışma Dalı:** `antigravity/phase9-public-consent`
- **Kapsam:** `/`, `/basvuru` (İletişim Adımı 0) ve `/basvurum` (Başvuru Sahibi Oturumu) sayfalarında WhatsApp bildirim izni tercihi arayüzü; 5 dil (`tr`, `en`, `ru`, `tk`, `ar` RTL), responsive (320px, 390px, 768px, 1440px), WCAG 2.1 AA erişilebilirlik ve entegrasyon testleri.
- **İzolasyon Kuralları:**
  - Başlangıç dizini ve untracked `docs/phase8h-scanner-design.md` dosyası korunmuştur.
  - Codex'in `codex/phase9-notifications-core` worktree'sine veya dallarına müdahale edilmemiştir.
  - `src/server/**`, `migrations/**`, `src/staff/**`, `yetkili/**`, `package.json`, `package-lock.json`, Vite ve Wrangler yapılandırmaları değiştirilmemiştir.
  - Bağımlılıklar izole `npm ci` ile kurulmuş, başka klasörden `node_modules` kopyalanmamıştır.

---

## 2. API Sözleşmesi ve Güvenlik Sınırları

### Sabit Endpoint Sözleşmesi
- `GET /api/public/applications/current/notification-preferences`
- `PUT /api/public/applications/current/notification-preferences`

### İstek Yükü (Payload) Sınırları
- **Opt-in PUT:**
  ```json
  {
    "whatsapp_opt_in": true,
    "consent_version": "whatsapp-consent-v1",
    "language": "tr|en|ru|tk|ar"
  }
  ```
- **Opt-out PUT:**
  ```json
  {
    "whatsapp_opt_in": false
  }
  ```

### Güvenlik ve Kimlik Doğrulama Semantiği
1. **İstemci Tarafından Gönderilmeyen Alanlar:** İstemci kesinlikle `application_id`, telefon numarası, zaman damgası veya hash göndermez. Başvuru sahibi kimliği sunucu tarafında HTTP-only `applicant_session` çerezi üzerinden doğrulanır.
2. **Fazla Alan Engeli:** PUT isteklerine fazladan alan eklenmesi sunucu tarafında 400 `VALIDATION_ERROR` döndüreceği için yük kesin sınırlarla korunur.
3. **Geriye Dönük Uyumluluk (Contract Normalization):**
   - Mevcut `c59e56c` backend şeması (`whatsapp_opt_in`, `consent_version`, `language`, `opted_in_at`, `opted_out_at`) ile Codex'in ekleyeceği yeni alanlar (`effective_whatsapp_opt_in`, `requires_reconsent`, `can_opt_in`, `application_id`, `current_consent_version`) `src/public/notificationPreferences.js` içindeki `parseNotificationPreferences` fonksiyonu ile normalleştirilmiştir.
   - Yeni alanlar gelmediğinde bile `c59e56c` verisiyle tutarlı çalışır; başarı varsayımı yapılmaz.
4. **Uyuşmazlık Koruması (Application ID Mismatch Guard):** Takip ekranında GET ile dönen `application_id` mevcut görüntülenen başvuru ID'si ile eşleşmezse tercih kontrolleri gizlenir ve güvenli hata uyarısı verilir.

---

## 3. Mimari ve Uygulama Detayları

### A. Modüler Tercih Yönetimi (`src/public/notificationPreferences.js`)
- `applicationWizard.js` içine büyük bir state machine yığmak yerine, bağımsız ve odaklanmış bir `notificationPreferences.js` modülü geliştirildi.
- **İçerik:**
  - `parseNotificationPreferences`: Gelen API yanıtını güvenle ayrıştırır, boolean ve string dönüşümlerini doğrular.
  - `createNotificationPreferenceField`: Adım 0 formuna monte edilen onay kutusu bileşeni.
    - Başlangıçta varsayılan olarak **işaretsizdir**.
    - Seçim yapılmaması başvuru akışını, devam butonunu veya submit işlemini **kesinlikle engellemez**.
    - Henüz taslak oturumu oluşmamış ziyaretçilerde erken PUT isteği atmaz; yerel durumu günceller.
    - Taslak oluşturulduğunda (`saveStep`), kullanıcı işaretlemişse PUT isteği tetiklenir; işaretlememişse hiçbir istek atılmaz.
    - Mevcut taslak oturumu olan başvurularda işaretleme/kaldırma anında `AbortController` ve debounce ile API'ye kaydedilir.
    - Telefon numarası değiştiğinde `syncPhone` ile durum sıfırlanır, `requires_reconsent` uyarısı gösterilir.
  - `mountTrackingNotificationPreferences`: Takip ekranı kartı (`/basvurum`).
    - Yalnızca doğrulanmış başvuru sahibi oturumunda (`state.kind === 'ready'`) görünür.
    - Öğrenci numarasıyla genel sorgulamada (`state.kind === 'publicReady'`) **kesinlikle gösterilmez**; API çağrısı yapılmaz ve veri sızdırılmaz.
    - Açık "Bildirimleri Kapat" ve "Bildirimleri Aç" butonları sunar.
    - Telefon numarası kayıtlı değilse (`can_opt_in: false`), butonu gizler ve iletişim bilgilerini güncelleme rehberi sunar.

### B. Başvuru Sihirbazı Entegrasyonu (`src/public/applicationWizard.js`)
- Tercih alanı Adım 0'da zorunlu iletişim sorumluluğu onay kutusunun (`contact_acknowledgement_accepted`) hemen altına yerleştirildi.
- Zorunlu iletişim onayı ile isteğe bağlı WhatsApp bildirimi açıkça birbirinden ayrıldı.
- Telefon alanındaki canlı girişler `prefField.syncPhone(value)` ile dinlendi.
- Adım kaydetme sürecinde (`saveStep`) draft id alındıktan sonra opt-in kaydı tamamlandı.

### C. Takip Sayfası Entegrasyonu (`src/public/applicationTracking.js`)
- `renderTracking` içinde başvuru durum özetinin altına özel bir `tracking-notification-preferences` kartı eklendi.
- Başvuru kimliği uyuşmazlığı, 401 oturum sonlanması, 400 sürüm uyuşmazlığı ve 409 alıcı uyumsuzluğu durumları kullanıcı dostu yerelleştirilmiş mesajlarla ele alındı.

### D. 5 Dilde Mesaj Anahtarları (`src/public/i18n/messages.js`)
Her dilde 15 yeni anahtar eksiksiz eklendi (toplam 196 anahtar / dil simetrisi korundu):
- `whatsappPreferencesHeading`
- `whatsappConsentLabel`
- `whatsappConsentExplanation`
- `whatsappOptInActive`
- `whatsappOptOutActive`
- `whatsappReconsentRequired`
- `whatsappOptOutAction`
- `whatsappOptInAction`
- `whatsappPhoneRequired`
- `whatsappPreferenceSaving`
- `whatsappPreferenceSaved`
- `whatsappPreferenceFailed`
- `whatsappPreferenceSessionExpired`
- `whatsappPreferenceVersionInvalid`

### E. Responsive ve RTL Tasarım (`src/public/public.css`)
- Onay kutusu ve butonlar 44px+ dokunma hedefi standartlarına uygun hale getirildi.
- `.notification-preference-group` ve `.tracking-notification-preferences` bileşenleri için `html[dir="rtl"]` altında sağa hizalama ve kenarlık kuralları uygulandı.

---

## 4. Test ve Doğrulama Kanıtları

### 1. Hedefli Birim ve UI Testleri (`test/notificationPreferencesUi.test.js`)
Toplam 13 test senaryosu çalıştırıldı ve tamamı başarıyla geçti:
1. `parseNotificationPreferences`: Temel ve genişletilmiş şema ayrıştırma.
2. İletişim adımı: Varsayılan işaretsiz durum ve devam butonunun bloklanmaması.
3. Oturumu olmayan ziyaretçi: Tıklamada erken PUT atılmaması; Adım 0 kaydedilince opt-in PUT gönderimi.
4. Oturumu olmayan ziyaretçi: İşaretlenmediğinde taslak kaydında PUT isteği atılmaması.
5. Taslak kaydı başarısız olduğunda PUT atılmaması.
6. Mevcut taslak oturumu: Onay kutusu değişiminde anında PUT ve durum mesajı.
7. Telefon numarası değişimi: Onay kutusunun sıfırlanması ve yeniden onay uyarısı gösterimi.
8. Dil değişimi: 5 dilde UI güncellemesi yapılması ve gereksiz PUT atılmaması.
9. Takip ekranı: Oturum sahibi tarafından opt-out ve opt-in geçişleri.
10. Genel sorgulama izolasyonu: Öğrenci numarası sorgulamasında tercih UI'ının ve API çağrısının engellenmesi.
11. Güvenlik: Başvuru ID uyuşmazlığında butonların gizlenmesi ve hata uyarısı.
12. Eksik telefon (`can_opt_in: false`): Butonların gizlenmesi ve bilgilendirme metni.
13. API hata yönetimi: 401 oturum sonlanması, 400 sürüm hatası ve 409 alıcı hatası.

### 2. Gerçek Başsız Tarayıcı Kontrolleri (`scripts/check-public-consent-browser.mjs`)
Puppeteer (Headless Chromium) ile yerel izole sunucu üzerinde test yapılmıştır:
- **Genişlikler:** 320px, 390px, 768px, 1440px.
- **Diller:** `tr`, `en`, `ru`, `tk`, `ar` (toplam 20 responsive kombinasyon).
- **Sonuçlar:**
  - 320px mobil ekran dahil hiçbir dilde yatay taşma (0px overflow) oluşmamıştır.
  - Arapça dilinde `dir="rtl"` kuralı ve tipografi doğrulanmıştır.
  - Onay kutusu ve buton dokunma hedefleri minimum 44px kuralını sağlamıştır.
  - İletişim adımında etkileşimli opt-in ve opt-out kaydı canlı DOM'da doğrulanmıştır.
  - Telefon değişikliğinde yeniden onay uyarısı tetiklenmesi canlı DOM'da doğrulanmıştır.
  - Takip ekranında oturum sahibi kontrolleri ve genel sorgulama izolasyonu doğrulanmıştır.
  - Ana sayfa (`/`) duyarlı düzeni tüm genişliklerde doğrulanmıştır.

### 3. Mevcut Test Paketi ve Derleme Doğrulaması
- `npm test`: 417 testin tamamı başarılı (0 hata).
- `npm run build:staging`: Temiz Vite derlemesi (~350ms).
- `git diff --check`: 0 biçimlendirme / boşluk hatası.

---

## 5. Kapsam Dışı ve Bilinen Sınırlar

1. **Canlı WhatsApp Gönderimi:** Bu aşama yalnızca onay/red tercihinin alınması ve API ile senkronizasyonunu kapsar. Canlı Meta/WhatsApp Business API çağrısı veya arka plan bildirim dağıtımı bu çalışmanın kapsamında değildir (mock/contract ile doğrulanmıştır).
2. **Bildirim Teslim Güvencesi:** Bildirim tercihi ekranı yalnızca öğrencinin iletişim tercihini kaydeder; mesajın ulaştığı veya iletileceği yönünde kesin garanti sunmaz.
3. **Proje Durumu:** Phase 9 veya projenin bütünü tamamlandı olarak işaretlenmemiştir.
