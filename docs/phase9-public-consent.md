# Phase 9: Public Öğrenci Portalı WhatsApp Bildirim İzni ve Doğrulama Raporu (Harden & Contract Alignment)

## 1. Kapsam ve Başlangıç İzolasyonu

- **Başlangıç Commit:** `469fe1b94cfe8f687cf74beff9098c138f2e86f4` (`antigravity/phase9-public-consent`)
- **Temel Backend Commit:** `c59e56ccc68cb9680fa764b0213b83703bb4aac8` (`codex/phase9-notifications-core`)
- **İzole Worktree:** `/Users/kagansmtdms/Downloads/Проекты/uluslarasiofis-phase9-public-consent`
- **Hedef Çalışma Dalı:** `antigravity/phase9-public-consent`
- **Görev Amacı:** Yeni özellik ekleme değil; API sözleşmesi, telefon kaydı sırası, yarış koşulu (race condition) koruması, ilk taslak hata görünürlüğü ve kullanıcıya sunulan kayıt sonucunun sıkılaştırılması.
- **İzolasyon Kuralları:**
  - Başlangıç dizini ve untracked `docs/phase8h-scanner-design.md` dosyası korunmuştur.
  - Codex'in `codex/phase9-notifications-core` veya diğer worktree/dallarına müdahale edilmemiştir.
  - `src/server/**`, `migrations/**`, `src/staff/**`, `yetkili/**`, `package.json`, `package-lock.json`, Vite ve Wrangler yapılandırmalarına dokunulmamıştır.
  - Bağımlılıklar izole ortamda kullanılmış, `package.json` değiştirilmemiştir.

---

## 2. API Sözleşmesi ve Sıkı Doğrulama Kuralları

### Sabit Endpoint Sözleşmesi
- `GET /api/public/applications/current/notification-preferences`
- `PUT /api/public/applications/current/notification-preferences`

### Backend Alanları ve Doğrulama Politikası
Mevcut Alanlar:
- `whatsapp_opt_in`: boolean
- `consent_version`: string
- `language`: 'tr' | 'en' | 'ru' | 'tk' | 'ar'
- `opted_in_at`: ISO string | null
- `opted_out_at`: ISO string | null

Genişletilmiş Sözleşme Alanları (Codex backend entegrasyonu ile):
- `application_id`: string
- `current_consent_version`: string ("whatsapp-consent-v1")
- `effective_whatsapp_opt_in`: boolean
- `requires_reconsent`: boolean
- `can_opt_in`: boolean

### Sıkı Ayrıştırma (`parseNotificationPreferences`) Kuralları:
1. **Eksik veya Eski API Verisinde İzin Varsaymama:**
   - `current_consent_version` eksikse kesinlikle varsayılan `"whatsapp-consent-v1"` atanmaz.
   - `effective_whatsapp_opt_in` eksikse eski `whatsapp_opt_in` alanından etkin izin çıkarılmaz.
   - `can_opt_in` eksikse `true` varsayılmaz.
   - Sözleşme eksik veya geçersizse `isVerified = false` ve `effectiveWhatsappOptIn = false` döndürülür.
2. **Kimlik Doğrulama (`application_id` Kontrolü):**
   - Hem takip ekranında hem de sihirbazda dönen `application_id` mevcut aktif başvuru kimliğiyle birebir eşleşmelidir.
   - Eksik kimlik bir doğrulama başarısızlığıdır (`isApplicationIdMatch: false`).
   - Kimlik uyuşmazlığında veya eksikliğinde yönetim kontrolleri gizlenir ve güvenli hata mesajı verilir.
3. **Sürüm Uyum Kontrolü:**
   - İstemci yalnızca gösterdiği metin sürümü olan `"whatsapp-consent-v1"` için açık rıza toplayabilir.
   - Sunucunun `current_consent_version` değeri bu sürümle eşleşmezse veya bilinmeyen bir sürüm dönerse, otomatik onaylama engellenir ve opt-in butonları devre dışı bırakılır.
4. **Oturumsuz Ziyaretçi:**
   - Taslağı henüz oluşmamış ziyaretçi onay kutusunu seçebilir; erken PUT isteği gönderilmez. Niyet yerel durumda tutulur.

---

## 3. Mimari Düzeltmeler ve Güvenlik Mekanizmaları

### A. Telefon Kaydı Sırası (Phone Persistence Sequencing)
- Kullanıcı onay kutusunu işaretlediğinde:
  1. Önce telefon alanındaki değişiklik sunucuya kaydedilir (`persistPhone` -> `state.autosave.flush()` veya `updateCurrentApplication`).
  2. Başvuru ve telefon kaydının başarıyla sunucuya ulaştığı doğrulanır.
  3. Ardından tercih PUT isteği gönderilir.
  4. Sunucu yanıtı doğrulanmadan arayüzde "Kaydedildi" bilgisi verilmez.
- Telefon kaydı başarısız olursa:
  - Opt-in PUT isteği durdurulur.
  - Kullanıcının formdaki seçimi ve girdiği telefon değeri silinmez, korunur.
  - Kullanıcıya tekrar deneme yolu ve hata mesajı gösterilir.

### B. Yarış Koşulu (Race Condition) ve İstek Üretim Sayacı (`saveGeneration`)
- Tercih PUT isteği ağda ilerlerken kullanıcının telefon numarasını değiştirmesi durumunda:
  - `saveGeneration` sayacı hem `savePreference` hem de `syncPhone` çağrılarında artırılır.
  - Dönen yanıtın nesil numarası mevcut nesil numarasıyla eşleşmiyorsa eski yanıt çöpe atılır.
  - Eski telefona ait onay yeni yazılan telefona asla geçerli izin olarak uygulanmaz.
- `syncPhone`, onay kutusunu yalnızca telefon değeri sunucuda doğrulanmış numaradan farklı bir değere değiştiğinde sıfırlar. Aynı telefon üzerinde gerçekleşen sonraki `input` veya `change` olaylarında kullanıcının verdiği açık yeniden onay silinmez.

### C. İlk Taslak Kaydı Hata Görünürlüğü ve Yeniden Deneme (Draft Preference Warning Banner)
- Adım 0'dan Adım 1'e geçerken ilk taslak oluşturulması sırasında:
  - Boş `catch` bloğu kaldırılmıştır.
  - Taslak oluşturma başarılı olup tercih PUT isteği başarısız olursa başvuru akışı bloke edilmez (öğrencinin taslağı kaybolmaz).
  - Ancak bu hata gizlenmez; formun üstünde kalıcı bir uyarı kutusu (`.application-notification-preference-banner`) gösterilir.
  - Uyarı kutusu içinde "Tekrar dene" (`data-action="preference-retry"`) butonu sunulur.
  - Tekrar dene butonu yeni bir taslak oluşturmaz; yalnızca mevcut taslak üzerinde tercih PUT isteğini tekrarlar.
  - Doğrulanmış başarılı yanıt alındığında uyarı kutusu yeşil başarı mesajına dönüşür ve temizlenir.

### D. 5 Dilde Mesaj Bütünlüğü (`src/public/i18n/messages.js`)
Tüm dillerde (`tr`, `en`, `ru`, `tk`, `ar`) 204 anahtarın tamamı simetrik olarak yer alır:
- `whatsappDraftSavedPreferenceFailed`
- `whatsappRetryPreferenceAction`
(Önceki 15 WhatsApp anahtarına ek olarak).

---

## 4. Test ve Doğrulama Kanıtları

### 1. Odaklı UI Test Paketi (`test/notificationPreferencesUi.test.js`)
Toplam **17 test senaryosu** başarıyla çalıştırıldı (0 hata):
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

### 2. Başsız Tarayıcı Doğrulaması (`scripts/check-public-consent-browser.mjs`)
- **Bağımlılık Yöntemi:** `package.json` ve `package-lock.json` dosyalarına dokunulmadan, izole `npx --yes puppeteer@24.4.0` veya yerel kurulum desteğiyle çalıştırılabilir.
- **Mock Sözleşmesi:** Mock sunucu eksiksiz sözleşme alanlarıyla (`application_id`, `current_consent_version: "whatsapp-consent-v1"`, `effective_whatsapp_opt_in`, `can_opt_in`, `requires_reconsent`) yapılandırılmıştır.
- **Sonuçlar:**
  - 320px, 390px, 768px, 1440px ve 5 dilde (`tr`, `en`, `ru`, `tk`, `ar`) 20 kombinasyonun tamamında 0px taşma.
  - Canlı DOM üzerinde opt-in/opt-out, telefon değişikliğinde yeniden onay bildirimi ve takip ekranı kontrolleri doğrulandı.
  - *Uyarı / Not:* Otomatik tarayıcı kontrolleri duyarlı düzen, dokunma hedefi boyutu (44px+) ve RTL semantiğini doğrular; tam insan destekli teknoloji (WCAG 2.1 AA manuel denetim) sertifikasyonu yerine geçmez.

### 3. Genel Paket ve Derleme Doğrulaması
- `npm test`: **434 testin tamamı başarılı** (0 hata).
- `npm run build:staging`: Temiz Vite derlemesi (345ms).
- `git diff --check`: 0 boşluk / biçimlendirme hatası.

---

## 5. Codex Backend Birleşimi Bekleyen Maddeler

Aşağıdaki unsurlar public arayüz tarafında kontrat ve mock seviyesinde doğrulanmış olup, Codex'in backend çalışması tamamlandığında entegrasyonu teyit edilecektir:
1. `GET /api/public/applications/current/notification-preferences` endpoint'inin canlı D1 veritabanından `application_id`, `current_consent_version`, `effective_whatsapp_opt_in`, `requires_reconsent` ve `can_opt_in` alanlarını dönmesi.
2. Canlı WhatsApp sağlayıcı adapter'ı ve gerçek şablon dağıtım servisinin entegrasyonu.
3. Personel bildirim logları ve bildirim geçmişinin canlı staging ortamında görüntülenmesi.
