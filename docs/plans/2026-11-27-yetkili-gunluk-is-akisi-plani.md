# Yetkili Günlük İş Akışı İyileştirmeleri — Uygulama Planı

> **For agentic workers:** Kod `agy` tarafından yazılır; orkestratör görev görev yürütür, diff'i okur ve testleri kendisi çalıştırır. Claude alt ajanı kullanılmaz. Adımlar onay kutusu (`- [ ]`) ile izlenir.

- **Tarih:** 2026-11-27 · **Kaynak:** koda karşı inceleme, `origin/production` = `097020c`
- **Durum (2026-11-27):** Görev 1–5, 6A ve 7 yerelde uygulandı ve `claude/portal-update-features-plan-7a67da` dalında birleştirildi. Son birleşimde `npm test` 2.498 test (2.497 geçti, 1 atlandı), `build:production` ve `deploy:dry-run:production` geçti; gerçek Excel ile bellek içi uçtan uca deneme ve sentetik veriyle tarayıcı kontrolü yapıldı. Topi tarayıcıda denenmedi. Push, `production` birleştirmesi, migration uygulaması ve yayın **yapılmadı**. 6B şablon bekliyor. Aşağıdaki görev metinleri uygulama öncesi planı gösterir (Görev 4 tarih koruması için Görev 7 geçerlidir).

**Goal:** Durum metinlerini açıklaştırmak, taramadan geçemeyen dosyayı tek tuşla yeniden istemek, gelen sorulara not eklemek, Topi'den belge çıktısını doğal cümleyle istemek, çalışma saatlerinden puantaj Excel'i indirmek ve günlük YÖKSİS Excel'indeki Göç durumunu onaylı biçimde portal kayıtlarına işlemek.

**Architecture:** Mevcut durum makinesi ve `applications` / `physical_intakes` şemaları yeniden kurulmaz. "Göç eksik evrak" yeni bir başvuru durumu değil, ayrı bir tabloda tutulan ek bilgidir. Eşitleme "önizle → personel onaylar → uygula" şeklindedir; yazmalar mevcut korumalı geçiş fonksiyonlarından geçer.

**Tech Stack:** Cloudflare Worker, D1, sade JavaScript, `node --test`, jsdom, Vite.

## Global Constraints

- `AGENTS.md` yayın kuralları geçerlidir. Merge ≠ yayın; yayın yalnız kullanıcının tam SHA için ayrı isteğiyle.
- Migration yayın akışı tarafından uygulanmaz. Her migration: ayrı onay → Time Travel bookmark → `npm run db:migrate:production` → `docs/manual-production-release.md` kanıtı ve `config/production-publication.json` temel SHA güncellemesi (ayrı onay) → `preflight` → `publish`.
- Yalnız ekleyici migration (`CREATE TABLE`, `ADD COLUMN`). Mevcut tablo yeniden kurulmaz.
- Eşitleme hiçbir kaydı kendiliğinden geriye almaz, reddetmez, tamamlamaz veya silmez.
- Öğrenci verisi, not metni ve Excel açıklaması loglara ve denetim meta verisine yazılmaz.
- Öğrenciye görünen her yeni metin 5 dilde: tr, en, ru, tk, ar.
- Görev sonu: `npm test`, `npm run build:production`, `npm run deploy:dry-run:production`.

## Review Focus

1. Aynı öğrencinin geçen yıldan kalan "İşlem Tamamlandı" satırı yeni başvuruyu onaylamamalı → tarih koruması (Görev 4A testi).
2. Önizleme ile uygulama arasında başka personel kaydı değiştirirse veya yeni Excel yüklenirse → o satır çakışma olur, yazılmaz (4A).
3. Excel'deki ad ile portaldaki ad uyuşmuyorsa veya aynı öğrencinin birden çok açık kaydı varsa → "Elle kontrol", otomatik seçilmez (4A).
4. Taramadan geçemeyen eski revizyon, öğrenci yenisini yüklediyse listede görünmemeli (2 testi).
5. Not yazılırken liste yenilenirse veya iki personel aynı notu değiştirirse metin kaybolmamalı / sessizce ezilmemeli (3 testi).

---

## Görev 1: Durum metinleri (yalnız metin, migration yok)

Veritabanı kodları (`sent_to_migration`, `migration_approved`) değişmez.

| Kod | Öğrenci metni (tr) | Personel metni |
| --- | --- | --- |
| `sent_to_migration` | Göç İdaresi dosyanızı inceliyor | Göç İdaresi inceliyor |
| `migration_approved` | Göç İdaresi tarafından onaylandı | Göç İdaresi tarafından onaylandı |

**Files (modify):** `src/public/i18n/messages.js`, `src/public/i18n/physical-receipt-messages.js`, `src/server/domain/chatbotStatusText.js`, `src/config/physical-statuses.js`, `src/staff/applicationsManager.js` (`STATUS_LABELS`, `STATUS_ACTION_LABELS`, `STATUS_FILTERS`), `src/staff/physical-intake-view.js`, `src/staff/staffAssistant.js`, `src/staff/application-ratings.js`, `src/shared/applicationDocumentPdf.js`.

**Değişmeyecek:** "Göçe İletildi" eylem düğmesi ve onay pencereleri (personelin yaptığı işi anlatır), `tebligatPage.js`, ana sayfadaki süreç adımı, `notificationTemplates.js`.

- [ ] Test: her dosyada iki kodun yeni metnini 5 dil için doğrulayan beklentiler; eski metne bağlı mevcut testler güncellenir.
- [ ] Testlerin kırıldığını gör, metinleri değiştir, `npm test` geçsin.
- [ ] `src/server/domain/chatbotEvidence.js` ve `chatbotPrompt.js` eski ifadeye bağlı eşleme içeriyor mu kontrol et; chatbot testleri geçmeli.
- [ ] 320 px'te personel tablosu ve öğrenci takip ekranı taşmasız.

## Görev 2: Taramadan geçemeyen dosyayı yeniden isteme (migration yok)

**Kök neden:** (a) Tarama paneli yalnız son 5 işi, öğrenci adı ve düğme olmadan gösteriyor (`scanner-repository.js` `readStatus`). (b) Başvuru detayında düğme yalnız `under_review` / `resubmission_required` durumunda çıkıyor (`staffApplicationRoutes.js` `can_request_resubmission`); henüz "Gönderildi" olan başvuruda görünmüyor. (c) Panel sayacı, yerine yenisi yüklenmiş eski hatalı işleri de sayıyor olabilir.

**Files:** Modify `src/server/repositories/d1/scanner-repository.js`, `src/server/routes/scanner-routes.js`, `src/staff/scanner-manager.js`, `src/server/routes/staffApplicationRoutes.js`, `src/staff/applicationsManager.js`. Test `test/scannerApi.test.js`, `test/scannerStatusUi.test.js`, `test/staffReviewWorkflow.test.js`.

**Interfaces:** `GET /api/staff/scanner/status` yanıtındaki `failed_jobs` en çok 50 **güncel** kayıt döner (`is_current=1`, `cleanup_status='none'`, `scan_status IN ('failed','unsafe')`, silinmemiş başvuru) ve ek alanlar taşır: `application_id, student_number, first_name, last_name, document_code, revision_number, application_status, can_request_resubmission`. Yeni alan `actionable_failed_total: number`.

- [ ] Testler: güncel olmayan revizyon listelenmez; `unsafe` listelenir; alanlar döner; 51 kayıtta 50 satır ve toplam 51.
- [ ] Panel satırı: öğrenci adı/no, belge adı, anlaşılır sebep; düğmeler **Başvuruyu aç**, **Tekrar yükleme iste**, (yalnız tekrar denenebilir kodlarda) **Taramayı yeniden dene**.
- [ ] "Tekrar yükleme iste": önceden doldurulmuş, düzenlenebilir sebep metni (tr + en) → onay → mevcut `request-resubmission` ucu.
- [ ] Başvuru `submitted` ise düğme metni "İncelemeye al ve tekrar iste": önce mevcut durum geçişi `under_review`, sonra istek. İkincisi başarısızsa hata gösterilir, başvuru incelemede kalır, düğme yeniden denenebilir.
- [ ] Detay ekranında `submitted` + taraması `failed|unsafe` belge için aynı düğme görünür.
- [ ] `sent_to_migration` ve sonrası: düğme yok, "Önce Göç'ten geri alın" açıklaması.
- [ ] Çok sayfalı revizyonda hatalı dosya ilk sayfa değilse de istek çalışır (`resubmission-review-target.js` yalnız `page_order=0` okuyor; test yaz, gerekiyorsa düzelt).

## Görev 3: Gelen sorulara personel notu (migration 0048)

**Files:** Create `migrations/0048_office_inquiry_notes.sql`. Modify `src/server/domain/officeInquiry.js`, `src/server/repositories/d1/officeInquiryRepository.js`, `src/server/routes/staffInquiryRoutes.js`, `src/staff/inquiryManager.js`, `src/staff/inquiries.css`. Test `test/officeInquiryMigration.test.js`, `test/staffInquiryApi.test.js`, `test/staffInquiriesUi.test.js`.

**Interfaces:**
- Kolonlar: `staff_note TEXT CHECK (staff_note IS NULL OR length(trim(staff_note)) BETWEEN 1 AND 1000)`, `staff_note_updated_by_staff_id TEXT REFERENCES staff_users(id)`, `staff_note_updated_at TEXT`.
- `PUT /api/staff/inquiries/<id>/note` gövde `{ note: string, expected_note_updated_at: string|null }` → `{ item }`. Boş metin notu siler. Eşleşmeyen sürüm → 409 `INQUIRY_NOTE_CONFLICT`.
- DTO ekleri: `staff_note, staff_note_updated_by_name, staff_note_updated_at`. Audit olayı `staff.office_inquiry_note_saved`, metin içermez.

- [ ] Testler: kaydet, güncelle, sil, 1001 karakter reddi, 409, oturumsuz 401, farklı köken reddi, herkese açık form yanıtında not alanı yok.
- [ ] UI: kartta "Not ekle / Notu düzenle", sayaç, Kaydet/Vazgeç, "Son düzenleyen · tarih". Not "Yeni" ve "Cevaplandı" sekmelerinde görünür.
- [ ] Kaydedilmemiş taslak liste yenilenince korunur; 409'da taslak kalır, güncel not gösterilir.

## Görev 4: Excel'den portal durumlarını eşitleme (migration 0049)

### Eşleme

| Excel "Göç Durumu" | Portalda sonuç |
| --- | --- |
| İşlem Tamamlandı | `migration_approved` *(kullanıcı teyidi gerekli, bkz. Açık Kararlar)* |
| Eksik Belge İstendi (…) | Durum `sent_to_migration` kalır; ek bilgi "Göç eksik evrak istiyor" + son tarih + açıklama |
| Eksik belgeler iletildi… / İşlem Bekliyor / Değerlendirme Aşamasında | "Göç İdaresi inceliyor"; eksik evrak işareti kalkar |
| Sorgulanmadı / tanınmayan | Değişiklik yok |

### Güvenlik kuralları

- Yalnız son tamamlanmış Excel'in satırları (`last_seen_import_id`), `source='excel'`. Dosya 24 saatten eskiyse uygulama düğmesi ek onay ister.
- Eşleşme: öğrenci numarası birebir **ve** normalize ad soyad uyumlu. Yalnız isimle asla.
- Tarih koruması: E-İkamet no'nun `YYYY-AA` bölümü, portal başvuru ayından (fizikselde `application_date`) en çok 1 ay eski olabilir.
- Aynı kayda birden çok uygun satır → en büyük E-İkamet no. Aynı öğrencinin birbirine bağlı olmayan birden çok açık kaydı → "Elle kontrol".
- Önizlemede varsayılan seçili: yalnız `sent_to_migration` kayıtlarının değişiklikleri. Portalda henüz iletilmemiş görünenler ayrı grupta, **seçilmemiş**; seçilirse önce mevcut "Göçe iletildi" geçişi uygulanır (online'da belgeleri toplu onaylar, ekranda yazılır).
- `migration_approved`, `completed`, `rejected`, `cancelled`, taslak ve silinmiş kayıtlar değiştirilmez; çelişki varsa "Elle kontrol" listesine girer.

### 4A — Sunucu

**Files:** Create `migrations/0049_migration_office_states.sql`, `src/server/domain/migrationSync.js`, `src/server/repositories/d1/migrationSyncRepository.js`. Modify `staffYoksisDocumentAuditRoutes.js`, `applicationReviewRepository.js`, `physical-intake-repository.js`, `physicalIntakePurge.js`, online kalıcı silme yolu. Test `test/migrationSyncPolicy.test.js`, `test/migrationSyncApi.test.js`, `test/migrationSyncMigration.test.js`.

**Interfaces:**
- Tablo `migration_office_states(record_kind CHECK IN ('online','physical'), record_id, application_number, state CHECK IN ('reviewing','missing_documents','approved'), note, deadline, import_id, updated_by_staff_id, updated_at, PRIMARY KEY(record_kind, record_id))`.
- `buildMigrationSyncPlan({ auditRows, portalRecords }) → { changes, needsAttention, manual, unchangedCount }`; öğe: `{ record_kind, record_id, application_number, current_status, target_state, version, reason }` (`version` = online `updated_at`, fiziksel `lock_version`).
- `POST /api/staff/yoksis-document-audit/sync/preview` `{}` → `{ import_id, exported_at, ...plan }`.
- `POST …/sync/apply` `{ import_id, items: [{ record_kind, record_id, application_number, version }] }`, en çok 20 öğe → `{ applied: [...], conflicts: [...] }`. Sunucu planı yeniden hesaplar; istemcinin hedef durumuna güvenmez.
- Kayıt `sent_to_migration` durumundan çıkınca ek bilgi satırı aynı batch'te silinir.

- [ ] Review Focus 1–3 testleri, eşleme tablosunun her satırı, tekrar uygulama (idempotent), yarıda kesilen toplu uygulama, kalıcı silmede ek bilgi temizliği, audit'te kişisel veri yok.

### 4B — Personel arayüzü ve filtreler

**Files:** Create `src/staff/migrationSyncDialog.js`. Modify `yetkili/index.html` (`#view-yoksis-audit`), `yoksisDocumentAuditManager.js`, `application-queue-table.js`, `applicationsManager.js`, `staffApplicationRoutes.js`, `applicationRepository.js`, `physical-intake-view.js`, `physical-intake-policy.js`, `physical-intake-repository.js`.

- [ ] Excel yüklendikten sonra **"Durumları portala işle"** düğmesi. Önizleme: sayılar (Onaylanacak / Eksik evrak / İncelemeye dönecek / Elle kontrol / Değişmeyen), satır listesi, tek tek seçim.
- [ ] Uygulama 20'lik paketlerle, ilerleme çubuğu; sonunda uygulanan ve çakışan listesi; yarıda kalırsa kalan satırlar yeniden önizlenir.
- [ ] Online ve fiziksel listede **"Göç: Eksik evrak"** ve **"Göç İdaresi onayladı"** filtreleri; satırda rozet, son tarih ve açıklama.

### 4C — Öğrenci görünümü

**Files:** `applicationTrackingRoutes.js`, `physical-tracking-policy.js`, `applicationTracking.js`, `physical-application-tracking.js`, i18n dosyaları, `chatbotStatusText.js`.

- [ ] Eksik evrak işareti varken öğrenci: "Göç İdaresi dosyanız için eksik evrak istiyor. Son tarih: GG.AA.YYYY. Lütfen Uluslararası Öğrenci Ofisi ile iletişime geçin." (5 dil). Excel'in ham açıklaması öğrenciye gösterilmez.
- [ ] Herkese açık yanıtlara yeni kişisel alan eklenmediğini doğrulayan testler.

## Görev 5: Topi'de rahat belge çıktısı isteme (yalnız kod)

**Kök neden (2026-11-27'de `parseStaffIntent` çalıştırılarak görüldü):**

| Yazılan | Sunucuda aranan | Sorun |
| --- | --- | --- |
| `başvuru formu cıkarır mısın 10tane` | `başvuru formu mısın 10tane` | Soru eki ve bitişik adet aramada kalıyor, adet kayboluyor |
| `lisans checklist çıkar 10tane` | `lisans checklist 10tane` | Aynı |
| `lisans checklist çıkar 10 tane` | `lisans checklist`, 10 kopya | `matchOfficeDocuments` bütün sözcüklerin geçmesini istiyor; "yüksek lisans" da "lisans" içerdiği için iki belgeye uyması beklenir (testle doğrulanacak) |

**Files:** Modify `src/server/domain/staffAssistantIntent.js` (adet ve dolgu sözcüğü temizliği), `src/server/domain/staffAssistantTools.js` (`matchOfficeDocuments`, `runProposeDocumentsPrint`), `src/config/documents-config.js` (belge başına `aliases`). Test `test/staffAssistantIntent.test.js`, `test/staffAssistantApi.test.js`.

**Interfaces:** `OFFICE_DOCUMENTS[].aliases: string[]` (yalnız Topi eşleştirmesi için). `matchOfficeDocuments(documentId, query)` imzası aynı; sıra: kimlik → tam başlık → tam takma ad → puanlı sözcük eşleşmesi. Temizlik, yapay zekâ modelinin gönderdiği `query` için de uygulanır.

**Kurallar:**
- Adet her yazımda okunur: `10tane`, `10 tane`, `10 adet`, `10x`, `x10`, `on tane`, `10`. Adet yoksa 1.
- Dolgu sözcükleri atılır: soru ekleri (mı/mi/mısın/misin), rica ve fiiller (rica etsem, lazım, istiyorum, bas, ver, çıkar, yazdır), "bana", "şu", "bir de". Türkçe karaktersiz yazım aynı sonucu verir.
- Küçük yazım hatası (5+ harfli sözcükte 1 harf: `chekclist`, `taahütname`) eşleşir.
- Takma adlar: "lisans checklist", "ön lisans checklist" → Ön Lisans/Lisans; "yüksek lisans checklist", "master checklist", "doktora checklist" → Yüksek Lisans/Doktora; "taksit" → Taksit Dilekçesi; "indirim" → İndirim Dilekçesi; "ikamet listesi" → İkamet/Kimlik evrak listesi; "form" tek başına belirsiz kalır.
- Gerçekten belirsizse (yalnız "checklist", "dilekçe") bütün liste değil, yalnız uyan 2–3 belge **tıklanabilir seçenek** olarak gösterilir; seçimde ilk mesajdaki adet korunur.
- Hiç eşleşme yoksa en yakın belgeler seçenek olarak önerilir.
- Yazdırma yine personel onayıyla olur; adet sınırı 1–50 değişmez.

- [ ] Testler: tablodaki üç cümle ve ekran görüntüsündeki yazımlar doğru belge + 10 kopya verir; 9 belgenin her biri için en az 3 doğal yazım; belirsiz istekte yanlış belge otomatik seçilmez; adet korunur.
- [ ] Mevcut Topi testleri geçer; belge dışı istekler (tebliğ, saat, YKN, YÖKSİS) yazdırmaya yönlenmez.
- [ ] Seçenek düğmeleri için `src/staff/staffAssistant.js` ve `test/staffAssistantUi.test.js` güncellenir (Görev 1'deki durum metni değişikliğinden sonra, aynı dosya).

## Görev 6: Puantaj — çalışma saatlerini Excel'e aktarma (yalnız kod, migration yok)

**İstek:** Her çalışan için "Excel'e aktar" tuşu; inen dosya okulun puantaj şablonu (isimler, gün gün saatler, toplam). Şablon sonra verilecek; şimdi yapı kurulur.

**Mevcut durum:** `GET /api/staff/work-hours?date=YYYY-MM-DD` o ayın bütün kayıtlarını zaten döndürüyor; yeni uç ve tablo gerekmez. Sayfada yüklü SheetJS 0.18.5 (`yetkili/index.html`) veri okur/yazar, ancak şablonun biçimini (renk, kenarlık, birleşik hücre) koruyarak doldurmaya uygun değildir.

**Architecture:** İki ayrı parça: (1) şablondan bağımsız **puantaj veri modeli**, (2) bu modeli dosyaya çeviren **yazıcı**. Şablon gelince yalnız yazıcı ve hücre haritası değişir.

**Files:** Create `src/staff/timesheet/timesheetModel.js`, `src/staff/timesheet/timesheetWriter.js`. Modify `src/staff/work-hours.js`. Test `test/timesheetModel.test.js`, `test/timesheetWriter.test.js`, `test/workHoursUi.test.js` (yoksa oluşturulur).

**Interfaces:**
- `buildTimesheet({ month: 'YYYY-MM', today: 'YYYY-MM-DD', person: { key, name }, records }) → { month, person, days: [{ date, weekday, isWeekend, minutes: number|null }], totalMinutes, recordedDays, missingDays }`
- `writeTimesheet(timesheet, { XLSX }) → { fileName, bytes }`; dosya adı `Puantaj_<YYYY-AA>_<Ad-Soyad>.xlsx`.

### 6A — Yapı (şablonsuz)

- [ ] Ay seçili tarihten alınır. Her çalışan kartında ayrı bir **"Puantaj Oluştur"** düğmesi; tıklayınca yalnız o kişinin o aylık dosyası iner. Toplu "Tümünü aktar" düğmesi yok. Geçmiş ay seçiliyken de düğme etkindir.
- [ ] Geçici sade dosya: ad, ay, ayın her günü (tarih, gün adı, saat), toplam saat. Ekranda "okul şablonu henüz eklenmedi" notu.
- [ ] Kayıt girilmeyen gün **boş**, 0 saat girilen gün **0** yazılır. Eksik gün (hafta içi, bugüne kadar) varsa indirmeden önce sayısı uyarılır; indirme engellenmez.
- [ ] Testler: 28/29/30/31 günlük aylar, yarım saat, toplam, boş ay, boş/0 ayrımı, Türkçe karakterli dosya adı, gelecek günler.

### 6B — Okul şablonu (şablon geldiğinde)

- [ ] Gerekenler: boş şablonun **`.xlsx`** hali ve doldurulmuş bir örnek. Eski `.xls` ise önce `.xlsx` olarak kaydedilir.
- Karar (2026-11-27, kullanıcı): her kişi için ayrı dosya ve ayrı düğme.
- [ ] Netleştirilecekler: saat mi, işaret kodu mu; hafta sonu ve resmî tatil gösterimi; unvan, birim, imza gibi ek alanlar.
- [ ] Biçim korunarak yalnız ilgili hücreler doldurulur (öneri: `.xlsx` içindeki sayfa XML'ini mevcut `@zip.js/zip.js` ile düzenlemek; formüller korunur). Hücre haritası tek dosyada: `src/staff/timesheet/templateMap.js`.
- [ ] Şablonda kimlik numarası gibi kişisel veri varsa depoya konmadan önce temizlenir.
- [ ] Test: üretilen dosyada her günün ve toplamın doğru hücrede olduğu; çıktı gerçek Excel'de açılıp şablonla karşılaştırılır.

---

## Yürütme

| Sıra | Görev | Dal / worktree | agy skills | Yayın |
| --- | --- | --- | --- | --- |
| 1 | Görev 1, sonra 2 (ortak dosya, sıralı) | `task/status-labels-rescan` | i18n-localization, frontend-developer, unit-testing-test-generate | Sürüm 1, yalnız kod |
| 1 (sonra) | Görev 5 (`staffAssistant.js` Görev 1 ile ortak, sıralı) | `task/status-labels-rescan` | api-design-principles, unit-testing-test-generate | Sürüm 1, yalnız kod |
| 1 (paralel) | Görev 6A (bağımsız dosyalar) | `task/timesheet-export` | frontend-developer, unit-testing-test-generate | Sürüm 1, yalnız kod |
| Şablon gelince | Görev 6B | `task/timesheet-template` | frontend-developer, unit-testing-test-generate | Ayrı sürüm, yalnız kod |
| 1 (paralel) | Görev 3 | `task/inquiry-notes` | sql-pro, api-design-principles, frontend-developer | Sürüm 2, migration 0048 |
| 2 | 4A → 4B → 4C (1–3 merge edildikten sonra) | `task/yoksis-status-sync` | sql-pro, api-design-principles, frontend-developer, i18n-localization | Sürüm 3, migration 0049 |

- Model: `gemini-4-hydrogen-medium`; yalnız tekrarlayan hata veya kota bitiminde `gemini-4-neon-medium`. Her görevden önce `agy -p "/usage"`.
- Her agy istemi: GOAL, YOU OWN, DO NOT TOUCH, CONTEXT, DONE WHEN, RULES, REPORT, SKILLS. agy komut çalıştırmaz; testleri orkestratör çalıştırır.
- Orkestratör skills: `dispatching-parallel-agents` (paralel adım), hata olursa `systematic-debugging`, görev sonunda `verification-before-completion`, UI için `webapp-testing`, Görev 4 sonunda `test-gap-audit`; yayında `wrangler`.
- İnceleme: `agy --mode plan` (code review; Görev 3 ve 4 için güvenlik incelemesi), bulgular koddan doğrulanır.

## Açık Kararlar

1. "İşlem Tamamlandı" Göç'ün **onayı** mı? (Red veya iptal de bu metinle geliyorsa 4A eşlemesi değişir.) Görev 4'ten önce YÖKSİS'te birkaç kayıtla teyit edilmeli.
2. Fiziksel "Onaylandı" (`approved_for_processing`, ofis onayı) Göç onayıyla karışıyor. Öneri: "Ofis onayladı" yapılsın.
3. Göç eksik evrakını öğrenci portaldan yükleyebilsin mi? Bu planda hayır (ofise yönlendirilir); istenirse ayrı iş.

## Excel yükleme saati

Sabah mesai başında günde bir kez: YÖKSİS'ten taze indir, yükle, durumları işle. Böylece eksik evrak son tarihi olanlar aynı gün aranabilir. Önce YÖKSİS'te Göç sorgusunun ne zaman yenilendiği ("Göç Son Sorgu Tarihi") gözlenmeli; birkaç gün sabah ve akşam dosyası karşılaştırılıp saat kesinleştirilmeli.

## Görev 7: Excel'de görünmeyen eksik evrak (2026-11-27 saha bulgusu)

**Belirti:** Bir başvuru YÖKSİS ekranında "Eksik Belge İstendi (son: 25.12.2026)", portalda ise "İşlem Bekliyor / Eksik evrak bulunmadı".

**Kök neden 1 — kaynak veri eski (portal hatası değil):** Aynı gün 09:19'da indirilen Excel'de satırın kendisi "İşlem Bekliyor", eksik belge alanları boş ve "Göç Son Sorgu Tarihi" 12.11.2026. Uygulamanın kendi ayrıştırıcısı dosyayı aynen okuyor; birleştirmede hiçbir eksik evrak durumu kaybolmuyor. YÖKSİS ekran görüntüsü indirmeden sonra (09:27) alınmış. Çıkarım: Excel her kaydın **son sorgulandığı andaki** durumunu verir; kayıt yeniden sorgulanınca güncellenir. Dosyada "İşlem Bekliyor" satırlarının 1.033'ünün son sorgusu 8 günden eski.

**Kök neden 2 — Görev 4'teki tarih koruması yanlış (yayımlanmadan bulundu):** E-İkamet numarasının ikinci bölümü ay değil (`00`–`99`). Gerçek dosyada koruma 2.192 başvurunun yalnız 90'ını kabul ediyor.

**Düzeltme:**
- Excel "Kayıt Tarihi" aktarılır ve saklanır (`record_date`, henüz uygulanmamış migration 0049'a eklenir). Tarih koruması bu tarihi kullanır: portal kaydının tarihinden 30 günden daha eski satır uygulanmaz; tarihi olmayan satır "Elle kontrol"e girer. Birden çok satırda en yeni kayıt tarihi, eşitse en yeni Göç sorgusu seçilir.
- Daha eski sorguya dayanan satır, daha yeni sorguyla konmuş eksik evrak işaretini kaldıramaz.
- YÖKSİS listesinde her satırda "Göç son sorgu: GG.AA.YYYY (N gün önce)"; sonuçlanmamış ve 7 günden eski ise "güncel olmayabilir" uyarısı, "Eksik evrak bulunmadı" yerine "Son sorguda eksik evrak yoktu".
- Filtre: "Göç sorgusu eski (7+ gün)". Yükleme özetinde ve eşitleme önizlemesinde eski sorgulu kayıt sayısı.
- Personel talimatı: kesin sonuç için kayıt önce YÖKSİS'te yeniden sorgulanır, sonra Excel indirilir. YÖKSİS'te toplu sorgu olup olmadığı **doğrulanmadı**.
