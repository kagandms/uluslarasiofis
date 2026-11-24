# Topi yetkili asistanı, YKN otomatik akış ve YÖKSİS Excel aktarımı — uygulama planı (v2.1)

- **Tarih:** 2026-11-23 (v2: koda karşı doğrulanmış, çok-agent'lı yürütmeye göre bölünmüş; v2.1: gerçek örnek Excel (`Ikamet_Islemleri_20261123_1307.xls`) incelendi, Excel görevleri ona göre yeniden yazıldı; Topi şalteri kaldırıldı)
- **Kapsam:** `src/staff/`, `src/server/{routes,domain,repositories,security}/`, `src/managers/yknManager.js`, `src/ui/passportCropperModal.js`, `src/services/`, `src/utils/`, `yetkili/index.html`, `migrations/`, `test/`
- **Kaynak:** Kod incelemesi (HEAD `d7d2562`, `production` = `origin/production`, çalışma ağacı temiz) ve kullanıcının 2026-11-23 tarihli istek ve yanıtları. Bölüm 3'teki her gerçek bu tarihte dosyadan okunarak doğrulandı.
- **Durum:** PLAN. Kod yazılmadı, test çalıştırılmadı. **Yayın istemez**: arka planda yürüyen canlıya alma işinden bağımsızdır; hiçbir görev `production`'a merge, push veya workflow dispatch yapmaz. Yerelde denendikten sonra canlıya alma kararı ayrıca verilir (`AGENTS.md`).

## 0. Bu belge nasıl kullanılır

- Her agent'a **yalnız kendi görev bölümü (Bölüm 8) + Bölüm 3 (gerçekler) + Bölüm 4 (küresel kısıtlar) + ilgili sözleşme (Bölüm 7)** verilir. Her görev bölümü kendi başına anlaşılır yazıldı; başka görevin kodunu okumak gerekmez, yalnız onun **Sözleşme**sine güvenilir.
- Görev kimlikleri: `1A` Topi sunucu, `1B` Topi arayüz, `2A` YKN saf modüller, `2B` YKN bağlama, `3A` Excel sunucu, `3B` Excel istemci.
- Her görev şu alanlarla yazılmış bir brief'e sahiptir: **GOAL / YOU OWN / DO NOT TOUCH / CONTEXT / DONE WHEN**. Rol ve RULES kuralları `~/.claude/CLAUDE.md` + `AGENTS.md`'den gelir (agy kodu yazar; shell çalıştırmaz; test, build, diff incelemesi Claude'da; commit/push/merge yok).
- Adımlar `- [ ]` ile işaretlenir; "başarısız test → çalıştır → uygula → çalıştır → commit" sırası korunur (commit'i agent değil Claude atar).

## 1. Amaç ve mimari

1. **Topi yetkili:** yetkili panele Topi asistanı. Model yalnız bir araç + parametre seçer; sunucu doğrular ve çalıştırır; sonuç **modele geri verilmeden** ekranda sabit biçimde gösterilir (kişisel veri modele gitmez). Yazma ve tarayıcı işleri istemcide, kullanıcı onayıyla yapılır.
2. **YKN otomatik zincir:** pasaportla arama bitince `1. Kabul mektubunu oku ve YÖKSİS'te ara` otomatik çalışır, YÖKSİS aramasından portala dönülünce `2. Bilgileri al ve pasaport fotoğrafını kırp` otomatik çalışır, açılan pasaport sayfasından yüz otomatik kırpılır ve `Her Şeyi YÖKSİS'e Aktar` tetiklenir. Yanlış belge koruması ve açma/kapama anahtarı vardır.
3. **Excel:** YÖKSİS eksik evrak listesi her gün bir görevli tarafından Excel olarak yüklenir; tarayıcıda ayrıştırılır, mevcut `yoksis_document_audit_records` tablosuna toplu yazılır. Eski tek tek tarama, Excel doğrulanana kadar yedek olarak kalır.

## 2. Kullanıcı kararları ve onay bekleyen varsayımlar

**Kesin (2026-11-23):**
1. Topi yetkili işleri: öğrencinin herhangi bir bilgisiyle başvuru sorgulama; "şuna YKN ver" + pasaport no → YKN ekranında aramayı ilerletebildiği kadar ilerletmek ama **talep göndermemek**; tebliğ bulma; belge çıktısı (ör. "10 tane taksit dilekçesi"); çalışma saati girme (ör. "Kağan için bugüne 6,5 saat"); YÖKSİS eksik evrakta arama ve durum söyleme.
2. YKN: tam otomatik. **Medeni hal boşsa `Bekar`** (YÖKSİS'te zaten kontrol edilir). Yüzü kendisi bulur. **Belgeler bazen yanlış yere yükleniyor (pasaport alanına diploma vb.); buna karşı koruma şart.**
3. Excel: örnek dosya 2026-11-23'te alındı ve profili çıkarıldı (F17). Eski tarama, Excel doğrulanana kadar yedek olarak kalır. **Topi yetkili asistanı şalter olmadan, sürekli açıktır** (kullanıcı kararı).

**Varsayımlar (itiraz edilmedikçe böyle uygulanır):**
- ~~A1~~ **KARARLAŞTI (kullanıcı, 2026-11-23):** Topi'ye pasaport no verilince Topi tüm YKN zincirini yürütür: Apply'da öğrenciyi bulur, bilgileri çeker, kabul kodunu YÖKSİS'e aratır, pasaport fotoğrafını kırpar ve YÖKSİS'e aktarır. **Yalnız YÖKSİS'teki "Kaydet" tuşuna basmaz** (son kontrol ve kayıt görevlidedir). Apply'a talep gönderme hiçbir yolla yoktur. Topi komutu, "Otomatik zincir" anahtarı kapalı olsa da o çalıştırma için zinciri zorla başlatır (`ykn:auto-run` olayı, Bölüm 7.2).
- ~~A2~~ **KARARLAŞTI:** Cinsiyet pratikte hiç boş gelmiyor (kullanıcı). Yine de savunma olarak, boş gelirse aktarım durur ve görevliye söyler (ucuz bir kontrol); varsayılan atanmaz. Yalnız medeni hal boşsa `Bekar` olur.
- ~~A3~~ **KARARLAŞTI (kullanıcı):** Şalter yok. Topi yetkili paneli yayınla birlikte her zaman açıktır. `AI` bağlaması yoksa uç nokta 503 "Asistan şu anda kullanılamıyor." döner (herkese açık sohbetle aynı davranış). `wrangler.jsonc` değişmez.
- A4. Başvuru sorgusu yalnız mevcut arama alanlarını kapsar: başvuru referansı, öğrenci no, ad, soyad (tam ad iki sırayla), pasaport no. **Telefon/e-posta ile arama yoktur**; Topi bunu söyler. YÖKSİS eksik evrak araması ad, soyad, öğrenci no, pasaport no kapsar.
- A5. Fiziki (kâğıt) başvurular Topi sorgusuna bu planda dahil değildir.
- A6. Çalışma saati yalnız **bugün** yazılır ve 30 dakikalık adımlarla (mevcut API kuralı). Başka tarih istenirse Topi reddedip nedenini söyler.
- A7. "N dilekçe çıkar": mevcut PDF, `pdf-lib` ile N kez tek PDF'e çoğaltılıp yazdırma penceresinde açılır (üst sınır 50).
- A8. SheetJS 0.18.5'te hazırlanmış dosyayla prototip kirletme açığı bilinir (CVE-2023-30533); girdi, görevlinin YÖKSİS'ten indirdiği dosyadır, risk düşük. İçe aktarma kodu yalnız hücre değerlerini düz nesneye kopyalar. Sürüm yükseltmesi (`package.json` paylaşılan dosya) ayrı karar.
- A9. **Örnekten kapandı:** dosya yalnız eksikleri değil **tüm ikamet işlemlerini** içerir; kategori "Göç Durumu" sütunundan türetilir. Onay bekleyen tek eşleme kararı: `Eksik belgeler iletildi – Göç incelemesi bekleniyor` (45 satır) **Beklemede** sayılır, `Eksik Evrak` kategorisine yalnız `Eksik Belge İstendi (…)` (7 satır) girer; iki durumda da "Eksik evrak" sütununda açıklama görünür. Değiştirmek tek sabittir (`classifyGocStatus`).

## 3. Doğrulanmış kod gerçekleri (2026-11-23, `d7d2562`)

| # | Gerçek | Yer |
|---|---|---|
| F1 | Çalışma saati: `POST /api/staff/work-hours` gövde `{ person: 'kagan_samet'|'asaf'|'eyup'|'oguz'|'eray', minutes: int, 0..1440, 30'un katı }`; **tarih sunucuda "bugün"** (İstanbul), tarih parametresi yok. Oturum zorunlu, rol kısıtı yok. | `src/server/routes/staffWorkHoursRoutes.js` (PEOPLE, `saveToday`); test: `test/staffWorkHours.test.js` |
| F2 | Başvuru kuyruğu araması: `POST /api/staff/applications/query`, gövde `q` (searchTerm), `page`, `page_size`; roller `['reviewer','admin']`. SQL araması 7 alan: referans, öğrenci no, ad, soyad, "ad soyad", "soyad ad", pasaport. Telefon/e-posta yok. Sonuç DTO'su `createQueueItemDto`. | `src/server/routes/staffApplicationRoutes.js:15,113,270`; `src/server/repositories/d1/applicationRepository.js:271-307` |
| F3 | YÖKSİS eksik evrak: yazma `POST /api/staff/yoksis-document-audit/records` gövde `{ scanId, records: [{entry:{applicationNumber,studentNumber}, result:{status, identity:{...,phone zorunlu}, applicationStatus, documents[]}}] }` (en çok 25 kayıt, 128 KB); okuma `POST .../query` gövde `{q,status,match,page,pageSize}`. Tüm `/api/staff/yoksis-document-audit/*` yolları `worker.js:119`'da önek eşlemesiyle yönlenir. Upsert anahtarı `application_number` (`NNNN-NN-NNNNNNN`). `student_number` 8–14 rakam, zorunlu. `classifyStatus` metinden kategori çıkarır (`islem tamamlandi`→successful, `islem bekliyor`→pending, `eksik belge bekliyor`→missing_documents, ret→rejected). | `src/server/routes/staffYoksisDocumentAuditRoutes.js`; `migrations/0034_*.sql`, `0035_*.sql`; en son migration **0045** (sıradaki 0046; başlamadan `origin/production`'da çakışma kontrolü) |
| F4 | Sohbet modeli: `createChatModel(environment, {timeoutMs, maxOutputTokens}).complete({messages, tools, signal}) → {text, toolCalls:[{name, arguments}]}`; araç biçimi `{name, description, parameters}`; modele verilen ek araç adları kabul edilir. Model adı `CHATBOT_MODEL` ile değişir. Test yardımcısı `createFakeAiBinding(script)` (`test/helpers/fakeAiBinding.js`, `.calls` kaydı tutar). | `src/server/services/chatbotModel.js:202`; `test/chatbotModel.test.js` |
| F5 | Hız sınırı: `consumePublicRateLimit(repository, {endpoint, identity, nowSeconds, windowSeconds, maxRequests}) → boolean`; sabitler `src/server/security/application-rate-limits.js` içinde (`CHATBOT_*` örnekleri). | `src/server/security/requestRateLimit.js:18`; `application-rate-limits.js:27-40` |
| F6 | Topi görsel API'si: `ensureTopiStyles(document)`, `createTopi(document,{state,calm,size})`, `setTopiState(element,state,{calm})`, `TOPI_STATES`. | `src/public/topiMascot.js:1,86,106,149` |
| F7 | Yetkili sayfa bölümleri (`data-workspace-view`): `applications archive cover documents inquiries physical print teblig work-hours ykn yoksis-audit`. SheetJS `xlsx.full.min.js` 0.18.5 sayfada zaten yüklü (`window.XLSX`). Başlatma noktası: `src/staff/main.js` (`initYknManager` ~126, `initializeYoksisDocumentAuditManager` ~72). | `yetkili/index.html:34-40,177-203`; `src/staff/main.js` |
| F8 | Belgeler: `documents-config.js` içinde `id: 'taksitlendirme-dilekcesi'`, `fileUrl: '/documents/ogrenim_ucreti_taksitlendirme_dilekcesi.pdf'`. "Yazdır (Hızlı Çıkar)" `window.open(fileUrl)` + `load` sonrası `print()`. **Kopya sayısı özelliği yok.** `pdf-lib` bağımlılığı var. | `src/config/documents-config.js:69`; `src/ui/documents-manager.js:102-130` |
| F9 | Tebliğ: kutu `#tebligat-search-input`, yıl `#tebligat-year-select`, sonuç `#tebligat-search-results`, açma düğmesi `#tebligat-search-toggle`; başlatıcı `initTebligatSearch()`. | `src/ui/tebligatSearch.js:206`; `yetkili/index.html:506-520` |
| F10 | YKN düğmeleri: `#ykn-passport-input`, `#btn-ykn-search`, `#btn-read-acceptance` (1. kabul mektubu+YÖKSİS ara), `#btn-copy` (2. bilgi al + kırpıcı), kırpıcıda `#btn-passport-crop-transfer`, `#cropper-select-gender`, `#cropper-select-medeni`. Gizli eski adım düğmeleri de var. | `yetkili/index.html:337,454-461,466-471,1054` |
| F11 | `yknManager.js` kapanışında zaten **zincirleme bayrakları** var: `shouldAutoRunAcceptanceAfterSearch` (arama bitince `btnReadAcceptance.click()`, ~3445), `shouldAutoRunCopyAfterSearch`, `shouldOpenCropperWhenReady`. Arama bitiş noktası ~3445; YÖKSİS aktarım yanıtı `TRANSFER_TO_YOKSIS` başarı dalı ~3066-3095 ("Kabul kodu YÖKSİS sekmesinde aratıldı ve öğrenci formu hazır"). | `src/managers/yknManager.js` |
| F12 | **Mevcut "Tek Tık" iş akışı** (`startOneClickWorkflow`, `ONE_CLICK_STAGE`: ACCEPTANCE_READING→YOKSIS_SEARCHING→APPLY_DATA_READING→PASSPORT_READING→CROPPER_WAITING→YOKSIS_FILLING) zaten var; CROPPER_WAITING'te insan kırpıp onaylar. Bu plan Tek Tık'a **dokunmaz**; iki düğmeli yolu zincirler. | `yknManager.js:907-920,1333-1365,1449-1530,2319` |
| F13 | Pasaport sayfası puanlama **zaten var**: `scorePassportPageText(text, studentName, passportNo)` (MRZ `P<`/`<<<` +100, pasaport sözcüğü +30, pasaport no eşleşmesi +50, ad parçası en çok +40, doğum tarihi etiketi +25…). Sayfa seçimi `bestPassportPageIndex`. `passportPages[i]` `{dataUrl, pageNumber, text}` içerir (OCR metni). Kaynak seçimi `handleCropSourceSelection(source)` (~1646), `cropSources`. | `yknManager.js:96-190,235,1758,1646` |
| F14 | Kırpıcı (`passportCropperModal.js`): modül-özel `passportCropperInstance` (Cropper.js), `currentAspectRatio`; cinsiyet/medeni alanları öğrenci verisinden doldurulur, Apply kaynaklıysa `disabled` (l.300-306); `downloadCroppedImage(autoTransfer)` (l.335) dışa aktarılmamış, `btnTransfer` bunu `true` ile çağırır (l.597), `ykn:photo-cropped` olayını yollar ve **her çağrıda yerel bir .jpg indirir**; kapanışta `ykn:cropper-closed`. Dışa aktarımlar: `updateCropperSources, closePassportCropper, isPassportCropperOpen, appendPassportPages, replacePassportPages, setCropperSourceLoading, openPassportCropper, initPassportCropperModal`. | `src/ui/passportCropperModal.js:14-38,130-160,171-260,335-400,597` |
| F15 | Test düzeni: düz `test/*.test.js`, `node:test`, çalıştırma `npm test` (= `node --test test/**/*.test.js`). YKN testleri çoğunlukla kaynak-sözleşmesi ve `chrome`/DOM mock'u (`yknLiveContract`, `yknStudentTransition`, `yknTransport`). Migration sınaması `scripts/ci/check-migration-ledger.mjs`. | `package.json:7`; `test/` |
| F16 | Yerel önizleme: `.claude/launch.json` içinde `dev` (5173) ve görev dallarına özel sunucular var; `.dev.vars` gizli, **okunmaz/yazdırılmaz**. | `.claude/launch.json` |
| F17 | **Örnek Excel** `Ikamet_Islemleri_20261123_1307.xls` (alındı 2026-11-23; kişisel veri bu belgeye ve depoya **girmez**, profil yalnız toplu sayılarla çıkarıldı): eski `.xls` (CDFV2), tek sayfa, başlık 1. satırda, **1972 satır × 13 sütun**, hücreler metin (sayılar metin olarak saklı). Sütunlar sırayla: `E-İkamet Başvuru No` (`NNNN-NN-NNNNNNN`, 1972/1972 uyumlu) · `Öğrenci No` (11 hane; 1 satır `C`+11 hane) · `Ad Soyad` (tek sütun, 2–4 sözcük) · `Birim` (10 değer, 70 boş) · `Program` (141 değer, 70 boş) · `İşlem Türü` (`İlk Başvuru` 1920 / `Eksik Evrak` 52) · `Süreç Durumu` (`GöçNet'te Tamamlandı` 1970 / `İşlem Kaydedildi (Tamamlanmadı – 0 gün)` 2) · `GöçNet Kayıt No` (1972 benzersiz; **satır = işlem**) · `Kayıt Tarihi` (`GG.AA.YYYY`) · `Göç Durumu` (11 değer: `İşlem Bekliyor` 1346, `İşlem Tamamlandı` 568, `Eksik belgeler iletildi – Göç incelemesi bekleniyor` 45, `Değerlendirme Aşamasında` 5, `Eksik Belge İstendi (son: GG.AA.YYYY, N gün kaldı \| süresi geçti)` 7, `Sorgulanmadı` 1) · `Eksik Belge Son Tarih` (48 dolu) · `Eksik Belge Açıklaması` (24 dolu, en çok 261 karakter, 1 çok satırlı) · `Göç Son Sorgu Tarihi` (`GG.AA.YYYY`). **Aynı başvuru no birden çok satırda** (27 başvuru, 58 satır): yalnız `GöçNet Kayıt No`, `Kayıt Tarihi`, `İşlem Türü` (ve bir kez `Süreç Durumu`) farklı; `Göç Durumu`/açıklama/son tarih aynı. **Telefon, pasaport no ve belge satırı listesi yok.** Dosya adı kalıbı `Ikamet_Islemleri_YYYYMMDD_HHmm.xls`. | profil betiği tek kullanımlıktı, çıktı yalnız toplu sayı |

## 4. Küresel kısıtlar (her agent prompt'una eklenir)

- Yalnız kendi task dalı + kendi worktree'si; iki yazar aynı worktree'de olmaz. Dallar Bölüm 6'da.
- Başka agent'ın dosyasını düzenleme; sahiplik Bölüm 6 ve görev brief'indeki **YOU OWN** ile sınırlıdır. Paylaşılan dosyalar tek sahipli: `migrations/` (yalnız 3A), `package.json`, `package-lock.json`, `wrangler.jsonc`, `config/production-publication.json`, `docs/README.md` (Claude).
- Korunacaklar: `PRINT_ENABLED=true`, `PHYSICAL_INTAKE_MODE=on`, üretim D1/R2/secret bağlamaları. Uygulanmış migration düzenlenmez; yeni migration yalnızca ekleme ve kullanıcı onayıyla.
- Eklenti (`ykn_eklenti-main/`) bu planda **değişmez**; `manifest.json` sürümü ve izinleri sabit.
- Yetkili uç noktaları `requireStaff` + `requireSameOrigin` + hız sınırı kullanır; yanıtta ve kayıtta gizli değer, parola, token, tam kişisel veri dökümü yoktur; `console` günlüğüne kişisel veri yazılmaz.
- Kullanıcıya görünen metinler Türkçe; kısa, eylem önerir.
- Her görev: yeni dosyalarda JSDoc; kullanılmayan kod, ölü bayrak, TODO bırakılmaz.
- Doğrulama (Claude koşar): `npm test`, `npm run build:production`, `npm run deploy:dry-run:production`. Agent shell çalıştırmaz.
- agy: `agy -p "/usage"` ile kota, model `gemini-4-hydrogen-high` (limit bitince `gemini-4-argon-high`); **aynı anda en çok 3 agent**; `/swarm` yok.

## 5. Review Focus (spec'in söylemediği, kullanıcıyı ısıracak durumlar)

1. Topi'ye "sil", "arşivle", "talep gönder", "durumu onayla", "YÖKSİS'e kaydet" gibi komut → reddeder, yapabildiklerini sayar (yeni araç eklenmeden hiçbir yazma yok; YÖKSİS Kaydet'i hiçbir yolla yok). *(1A test)*
2. "10 taksit dilekçesi" yerine "10000", "-3", "on tane" → üst sınır 50, geçersizse düzeltme ister; "taksit" iki belgeyle eşleşirse sorar. *(1A/1B test)*
3. Çalışma saati: "6,5", "6.5", "6 buçuk", "6.25" (30 dk adımı değil), "25 saat", belirsiz kişi ("Ali"), geçmiş/gelecek tarih → doğru ayrıştırma ya da soru; asla tahminle kayıt yok, kayıt öncesi onay düğmesi. *(1A test)*
4. Başvuru araması çok sonuç döndürürse (ör. "Ahmed"): ilk 5 + "toplam N, ekranda tümünü gör" bağlantısı; sonuç yokken Topi uydurma yapmaz. *(1A test)*
5. YKN zinciri: pasaportta yüz yok / birden fazla yüz, seçilen sayfa pasaport değil (diploma, kabul mektubu), pasaport no OCR'da yok, cinsiyet boş, YÖKSİS'te kayıt bulunamadı → akış **durur**, nedenini durum paneline yazar, hiçbir şey YÖKSİS'e aktarılmaz. *(2A/2B test)*
6. Zincir çift tetiklenmez: kullanıcı elle de tıklarsa, ikinci arama sürerken yeni pasaport yazılırsa eski zincir iptal olur. *(2B test)*
7. Excel: zorunlu başlık eksik/yeniden adlandırılmış (YÖKSİS ekranı değişirse), rakam dışı öğrenci no (örnekte 1 satır `C`+11 hane → tablo kuralı reddeder, satır numarasıyla raporlanır), aynı başvuru no birden çok işlem satırı (örnekte 27 başvuru/58 satır → en son işlem esas), metin olarak saklı sayılar ve `GG.AA.YYYY` tarihleri, boş Birim/Program (70 satır), çok satırlı ve 255+ karakterlik açıklama, 10 MB üstü dosya, `.csv`/`.pdf` uzantısı, `__proto__` başlıklı hücre, aynı dosyanın iki kez yüklenmesi (idempotent), yükleme yarıda kesilirse yeniden denenebilir, yeni dosyada olmayan eski kayıt **silinmez ve "çözülmüş" sayılmaz** (dışa aktarma zaman penceresi olabilir; yalnız "son yüklemede yok" rozeti). *(3A/3B test)*

## 6. Dalgalar, dallar, sahiplik

| Dalga | Görev | Dal (production'dan) | Bağımlılık | Agent |
|---|---|---|---|---|
| 1 | **1A.0** Sözleşme dosyası | `task/staff-topi-api` | yok | agy #1 |
| 1 | **2A** YKN saf modüller | `task/ykn-auto-pure` | yok | agy #2 |
| 1 | **3A** Excel sunucu | `task/yoksis-excel-api` | yok | agy #3 |
| 2 | **1A** Topi sunucu (1A.0'ın devamı) | `task/staff-topi-api` | 1A.0 | agy |
| 2 | **1B** Topi arayüz | `task/staff-topi-ui` (1A.0 commit'inden açılır) | 1A.0 sözleşmesi | agy |
| 2 | **2B** YKN bağlama | `task/ykn-auto-flow` (2A commit'inden açılır) | 2A | agy |
| 3 | **3B** Excel istemci | `task/yoksis-excel-ui` (3A commit'inden açılır) | 3A (örnek dosya geldi, kilit yok) | agy |

Dalga 2'de aynı anda en çok 3 agent; sıra: 2B → 1A → 1B (1B, 1A bitmeden de başlar; yalnız sözleşmeye bağlıdır). Başlamadan önce kullanıcıya agent sayısı, dosya sahipliği ve worktree yolları bildirilir.

**Dosya sahipliği matrisi (çakışma yok):**

| Dosya | Sahip |
|---|---|
| `src/shared/staff-assistant-contract.js` | 1A.0 (sonra salt okunur) |
| `src/server/routes/staffAssistantRoutes.js`, `src/server/domain/staffAssistantTools.js`, `staffAssistantIntent.js` | 1A |
| `src/server/security/application-rate-limits.js` (yalnız yeni sabit ekleme), `src/server/worker.js` (yalnız 1 rota satırı) | 1A |
| `src/staff/staffAssistant.js`, `staffAssistant.css`, `documentCopies.js`, `src/staff/main.js` (yalnız başlatma satırı), `yetkili/index.html` (yalnız tek `<link>` satırı; kök kutu JS ile oluşturulur) | 1B |
| `src/services/passportFaceCrop.js`, `src/services/passportDocumentGuard.js`, `src/utils/passportPageScore.js`, `src/managers/yknAutoFlow.js` | 2A |
| `src/managers/yknManager.js`, `src/ui/passportCropperModal.js` | 2B |
| `src/server/domain/yoksisAuditPolicy.js`, `src/server/routes/staffYoksisDocumentAuditRoutes.js`, `migrations/0046_*.sql` (numara teyitli), ilgili testler | 3A |
| `src/staff/yoksisExcelImport.js`, `src/managers/yoksisDocumentAuditManager.js`, `yetkili/index.html` (yalnız `#view-yoksis-audit` içi) | 3B |
| `docs/README.md`, `package.json*`, `wrangler.jsonc` | Claude |

`yetkili/index.html`'e iki ayrı görev dokunur (1B başlık satırı, 3B bölüm içi): farklı bölgeler; birleştirmede çakışırsa Claude ikisini de korur.

## 7. Sözleşmeler (görevler arası, değişmez)

### 7.1 Topi yetkili sözleşmesi (`src/shared/staff-assistant-contract.js`, 1A.0 yazar)

```
POST /api/staff/assistant
İstek:  { message: string (1..300), history?: [{ role: 'user'|'assistant', content: string (<=300) }] (<=6) }
Yanıt:  { reply: string, state: <TOPI_STATES değerlerinden biri>, action?: Action, results?: ResultBlock }

Action =
 | { type: 'navigate',          view: 'applications'|'archive'|'cover'|'documents'|'inquiries'|'physical'|'print'|'teblig'|'work-hours'|'ykn'|'yoksis-audit' }
 | { type: 'ykn.run',           passportNo: string  /^[A-Z0-9]{5,20}$/ }   // tüm YKN zinciri; YÖKSİS'te Kaydet HİÇ tıklanmaz
 | { type: 'documents.print',   documentId: string (documents-config id), copies: int 1..50 }
 | { type: 'workHours.propose', person: 'kagan_samet'|'asaf'|'eyup'|'oguz'|'eray', minutes: int 0..1440, 30'un katı, label: string }
 | { type: 'tebligat.search',   query: string (2..80) }

ResultBlock =
 | { kind: 'applications', total: int, items: [{ id, referenceNumber, studentNumber, firstName, lastName, passportNumber, status, submittedAt }] (<=5) }
 | { kind: 'yoksisAudit',  total: int, lastImportAt: string|null, items: [{ applicationNumber, studentNumber, fullName, applicationStatus, statusCategory, missingDocuments: [{ name, required, note }], missingDeadline: string|null, unit: string, scannedAt, isStale: boolean }] (<=5) }
```
Dışa aktarılanlar: `STAFF_ASSISTANT_VIEWS`, `STAFF_ASSISTANT_PEOPLE`, `STAFF_ASSISTANT_MAX_COPIES = 50`, `validateStaffAssistantAction(value) → Action` (geçersizse `Error('invalid-action')`), `validateStaffAssistantResponse(value) → Response`. Sunucu yanıtı göndermeden, istemci uygulamadan önce **ikisi de** doğrular.

### 7.2 YKN saf modül sözleşmesi (2A → 2B)

```
// src/utils/passportPageScore.js
export function scorePassportPageText(text, studentName = '', passportNo = '') -> number   // yknManager.js'deki gövdenin birebir kopyası (F13)

// src/services/passportDocumentGuard.js
export function evaluatePassportPage({ text, studentName, passportNo }) -> { isPassport: boolean, hasMrz: boolean, passportNoMatched: boolean, nameMatched: boolean, score: number, reason: string }
//   isPassport = hasMrz && (passportNoMatched || nameMatched)  — diploma/kabul mektubu MRZ taşımaz → false

// src/services/passportFaceCrop.js
export async function detectFaceCrop(imageDataUrl, aspectRatio) -> { x, y, width, height } | { error: 'no-face' | 'multiple-faces' | 'unavailable' }
//   piksel kutusu, görüntü sınırları içinde, aspectRatio'ya uyar, baş+omuz payı ile genişletilmiş

// src/managers/yknAutoFlow.js
export function createYknAutoFlow(deps) -> { start(passportNo, { force = false } = {}), onSearchDone(student), onYoksisReady(), onCropperReady(ctx), cancel(reason) , isActive() }
//   force:true (Topi komutu) anahtar kapalı olsa da bu çalıştırmayı başlatır. Zincirin son adımı kırpıcıdaki 'Her Şeyi YÖKSİS'e Aktar'dır; YÖKSİS'te kaydet/gönder adımı yoktur ve eklenemez.
// Olaylar (portal → yknManager): window 'ykn:auto-run' { passportNo }  (Topi'den)
//                           (yknManager → panel): window 'ykn:auto-flow-status' { state, message, level }
//   deps: { enabled: () => boolean, click: (id: 'read-acceptance'|'copy') => void, getPages: () => [{dataUrl,text}], getPageIndex: () => number,
//           selectNextSource: () => Promise<boolean>, detectFace, evaluatePage, applyCrop(box), setDefaults({medeni}), getGender: () => string,
//           submit: () => void, report: (message, level) => void }
```

### 7.3 Excel içe aktarma sözleşmesi (3A → 3B) — F17'ye göre

```
POST /api/staff/yoksis-document-audit/import
{ importId: string /^[A-Za-z0-9_-]{1,128}$/, exportedAt?: string|null ('YYYY-MM-DD HH:mm', dosya adından), final: boolean,
  rows: [{ applicationNumber: 'NNNN-NN-NNNNNNN',
           studentNumber: /^\d{8,14}$/,
           fullName: string (1..240),                     // tek sütun; sunucu bölmez
           unit?: string (<=120), program?: string (<=160),
           processType: string (<=40),                    // 'İlk Başvuru' | 'Eksik Evrak' (en son işlemin türü)
           transactionCount: int >= 1,                    // aynı başvurunun işlem satırı sayısı
           gocStatus: string (1..300),                    // "Göç Durumu" ham metni
           missingDeadline?: 'YYYY-MM-DD'|null, missingNote?: string (<=1000),
           gocLastQueryAt?: 'YYYY-MM-DD'|null }] (1..50) }
→ 200 { storedCount: int, rejected: [{ index: int, reason: string }] }
   final:true (tüm partiler başarılı olduktan sonra, boş `rows` yerine son partiyle birlikte ya da ayrı istekle `rows:[]` kabul edilir): `yoksis_audit_imports.finalized_at` ve `row_count` yazılır. Yeni dosyada olmayan kayıtlar **silinmez ve çözülmüş işaretlenmez**.
GET  /api/staff/yoksis-document-audit/import/latest → { importId, uploadedAt, uploadedBy (görünen ad), rowCount, exportedAt: string|null } | null
POST /api/staff/yoksis-document-audit/query  (mevcut; yanıt kayıtlarına YALNIZ source='excel' olanlarda ek anahtar):
   record.import = { unit, program, missingDeadline, lastTransactionType, transactionCount, gocLastQueryAt, isStale }  // isStale: son yüklemede görülmedi
```
Sunucu doğrulayıcıları `yoksisAuditPolicy.js`'den: `validateImportRow(value) → row`, `classifyGocStatus(gocStatus) → 'successful'|'pending'|'missing_documents'|'other'`, `normalizeSearch(text)`. **`classifyGocStatus` eşlemesi** (normalize: küçük harf, Türkçe karakter katlama, noktalama sil): `islem tamamlandi`→successful · `islem bekliyor`→pending · `eksik belge istendi…` (önek)→missing_documents · `eksik belgeler iletildi…` (önek)→pending (A9) · `degerlendirme asamasinda`→pending · `sorgulanmadi` ve bilinmeyen→other. `result_status` her Excel satırında `'verified'`.


---

## 8. Görevler

### Görev 1A.0 — Topi sözleşme dosyası (`task/staff-topi-api`, ilk adım)

**GOAL:** Bölüm 7.1 sözleşmesini çalışır doğrulayıcılarla kod hâline getirmek; 1A ve 1B bu dosyayı ortak kullanır.
**YOU OWN:** `src/shared/staff-assistant-contract.js`, `test/staffAssistantContract.test.js`.
**DO NOT TOUCH:** diğer her şey.
**CONTEXT:** F1, F6, F7, F8; `src/shared/` desen örneği: `src/shared/phoneNumber.js`.
**DONE WHEN:** aşağıdaki testler geçer; dışa aktarımlar Bölüm 7.1 ile aynıdır.

- [ ] Başarısız test (`staffAssistantContract.test.js`): geçerli her `Action` türü kabul edilir; `copies: 51`, `copies: 0`, `minutes: 45`, `minutes: 1500`, `person: 'ali'`, `view: 'admin'`, `passportNo: 'a b'`, ek/bilinmeyen alan → `invalid-action`; `validateStaffAssistantResponse` 5'ten çok `items` ve fazladan alan reddeder.
- [ ] `node --test test/staffAssistantContract.test.js` başarısız (modül yok).
- [ ] Uygula: yalnız doğrulama (kapalı liste kontrolü, tip/aralık, bilinmeyen anahtar yasak).
- [ ] Testi çalıştır → geçer. Commit (Claude): `feat(staff-assistant): shared action/response contract`.

### Görev 1A — Topi sunucu (`task/staff-topi-api`)

**GOAL:** `POST /api/staff/assistant`: mesajdan deterministik kalıp + model yedeği ile araç seçmek, salt okunur araçları çalıştırıp sonucu ekranlık sabit blok olarak döndürmek, yazma/tarayıcı işlerini `Action` olarak önermek.
**YOU OWN:** `src/server/routes/staffAssistantRoutes.js`, `src/server/domain/staffAssistantTools.js`, `src/server/domain/staffAssistantIntent.js`, `src/server/security/application-rate-limits.js` (yalnız yeni `STAFF_ASSISTANT_*` sabitleri), `src/server/worker.js` (yalnız bir `if (pathname === '/api/staff/assistant')` satırı), `test/staffAssistantIntent.test.js`, `test/staffAssistantApi.test.js`.
**DO NOT TOUCH:** `chatbotRoutes.js`, `chatbotKnowledge.js`, `homeChatbot.js`, 7.1 sözleşme dosyası (salt okunur), `wrangler.jsonc`, `migrations/`, diğer her şey.
**CONTEXT:** F1–F5, A3–A6; Bölüm 7.1; mevcut herkese açık sohbet desen örneği `src/server/routes/chatbotRoutes.js`.
**DONE WHEN:** testler yeşil; `AI` bağlaması yoksa uç nokta 503 ("Asistan şu anda kullanılamıyor."); sonuç verisi modele hiç gitmez.

**Arayüzler**
- `staffAssistantIntent.js`: `parseStaffIntent(message) → { tool: string, args: object } | null` (önce Türkçe kalıplar: "ykn", "tebliğ", "dilekçe"/"çıkar", "saat", "eksik evrak", "ara"/"sorgula"/"bul"; eşleşmezse `null`), `parseHoursText(text) → number | null` (saat cinsinden; "6,5", "6.5 saat", "altı buçuk", "6 saat 30 dk"), `parseCount(text) → number | null`, `resolvePerson(text) → key | { ask: string } | null`.
- `staffAssistantTools.js`: `STAFF_ASSISTANT_TOOLS` (donmuş `{name, description, parameters}` listesi; model yalnız bunları görür) ve `runStaffAssistantTool(name, args, { environment, request }) → { reply?, action?, results?, ask? }`. Araçlar: `search_applications` (F2'nin depo işlevini çağırır, rol `reviewer|admin` zorunlu), `lookup_yoksis_audit` (F3 tablosundan okur; `lastImportAt` 3A tablosu yoksa `null`), `navigate`, `run_ykn_flow`, `propose_documents_print`, `propose_work_hours`, `search_tebligat`. Her araç, karşılık geldiği mevcut uç noktanın rol kuralını aynen uygular.
- `staffAssistantRoutes.js`: `handleStaffAssistant(request, environment, requestId) → Response`.

- [ ] **1A.1 Başarısız testler** `staffAssistantIntent.test.js`: `parseHoursText('6,5')===6.5`, `'6.5 saat'`, `'altı buçuk'→6.5`, `'6 saat 30 dk'→6.5`, `'6.25'→6.25` (sonradan 30 dk kuralıyla araç reddeder), `'25'` ham sayı döner ama araç reddeder; `parseCount('10 tane')===10`; `resolvePerson('Kağan için')==='kagan_samet'`, `'Ali'→null`; `parseStaffIntent("AB123456 pasaportunu ykn'ye ver")` → `{tool:'run_ykn_flow', args:{passportNo:'AB123456'}}`; `"sil"`, `"talep gönder"` → `null`.
- [ ] **1A.2 Başarısız testler** `staffAssistantApi.test.js` (yerel D1 + `createFakeAiBinding`, `test/helpers/d1-test-binding.js`): kimliksiz 401; başka origin 403; 301 karakter 400; `AI` bağlaması yoksa 503; "sil" → `reply` reddeder, `action` yok; başvuru araması sonuç bloğu döner ve **fake AI çağrı kaydında kişi adı/numara geçmez**; `reviewer|admin` olmayan rol başvuru sorgusunda 403; saat 45 dk → `action` yok + `reply` açıklar; 6.5 saat → `workHours.propose` `minutes:390`; başka tarih → reddeder; hız sınırı aşımında 429.
- [ ] **1A.3** `node --test test/staffAssistantIntent.test.js test/staffAssistantApi.test.js` → başarısız.
- [ ] **1A.4** Uygula `staffAssistantIntent.js`, `staffAssistantTools.js` (model adı araç seçimi için `createChatModel(...).complete({messages:[sistem+kullanıcı], tools: STAFF_ASSISTANT_TOOLS})`; **sonuç ikinci model çağrısına verilmez**; zaman aşımı 8 sn; `sistem` istemi araç dışı konuşmayı reddeder).
- [ ] **1A.5** Uygula `staffAssistantRoutes.js`; yanıtı göndermeden `validateStaffAssistantResponse`; hız sınırı: `STAFF_ASSISTANT_RATE_LIMIT` (kişi başı 15 dk'da 40) ve `STAFF_ASSISTANT_DAILY_LIMIT` (kişi başı günde 300), kimlik = personel kimliği; `worker.js`'e tek rota satırı.
- [ ] **1A.6** Testleri çalıştır → geçer. Commit (Claude): `feat(staff-assistant): server route, read-only tools and intent parsing`.

### Görev 1B — Topi arayüz (`task/staff-topi-ui`)

**GOAL:** Yetkili panelde Topi paneli: sohbet, sonuç blokları ve eylemlerin istemcide güvenli uygulanması (onaylı yazma, YKN arama, belge çoğaltma, gezinme).
**YOU OWN:** `src/staff/staffAssistant.js`, `src/staff/staffAssistant.css`, `src/staff/documentCopies.js`, `src/staff/main.js` (yalnız import + başlatma satırı), `yetkili/index.html` (yalnız bir `<link rel="stylesheet" href="/src/staff/staffAssistant.css">` satırı), `test/staffAssistantUi.test.js`, `test/documentCopies.test.js`.
**DO NOT TOUCH:** `homeChatbot.js`, `chatbot.css`, `topiMascot.js` (yalnız içe aktar), `yknManager.js`, 7.1 sözleşme dosyası, sunucu dosyaları.
**CONTEXT:** F1, F6–F10, A1, A6, A7; Bölüm 7.1; mevcut desen örnekleri `src/public/homeChatbot.js` (panel/durum), `test/homeChatbot.test.js`, `test/staffYoksisDocumentAuditUi.test.js` (kaynak-sözleşmesi testi).
**DONE WHEN:** testler yeşil; 320 px ve koyu modda panel kullanılabilir; yazma yalnız onay düğmesiyle.

**Arayüzler**
- `staffAssistant.js`: `initializeStaffAssistant({ root = document, fetcher = fetch, now = Date.now } = {}) → { open, close, destroy }`. Kök kutuyu JS oluşturur (`#staff-assistant-root`), `ensureTopiStyles` + `createTopi` kullanır, her yanıt `state`'ine göre `setTopiState`. Yetkisiz (oturumsuz) iken hiç görünmez.
- `documentCopies.js`: `async buildCopiesPdfBlob(fileUrl, copies, { fetcher, PDFDocument }) → Blob` (`pdf-lib`: kaynağı yükle, sayfaları `copyPages` ile `copies` kez ekle; çıktı sayfa sayısı = kaynak × kopya; 20 MB üstü çıktı hata).
- Eylem uygulayıcılar (yalnız bu görevde): `navigate` → `button[data-workspace-view="<view>"]` tıklar; `ykn.run` → önce `navigate ykn`, sonra **yalnız** `window.dispatchEvent(new CustomEvent('ykn:auto-run', { detail: { passportNo } }))` gönderir (YKN düğmelerine ve alanlarına doğrudan dokunmaz; zinciri Görev 2B yönetir) ve panelde zincir durumunu `ykn:auto-flow-status` olaylarından gösterir; `tebligat.search` → `#tebligat-search-toggle` açar, `#tebligat-search-input`'a yazar `input` olayını tetikler; `documents.print` → `buildCopiesPdfBlob` + `window.open(blobUrl)` + `load` sonrası `print()` (F8 deseni); `workHours.propose` → ekranda "6,5 saat · Kağan Samet · bugün — Kaydet / Vazgeç"; **Kaydet** tıklanınca `POST /api/staff/work-hours {person, minutes}`; başarısızsa hatayı gösterir.

- [ ] **1B.1 Başarısız testler** `documentCopies.test.js`: 2 sayfalık PDF + 10 kopya → 20 sayfa; `copies:0`/`51` hata; kaynak yüklenemezse hata.
- [ ] **1B.2 Başarısız testler** `staffAssistantUi.test.js` (DOM mock'u ve sahte `fetcher`): `workHours.propose` **Kaydet'e basılmadan** `/api/staff/work-hours`'a fetch atmaz; `ykn.run` yalnız `ykn:auto-run` olayını gönderir; hiçbir YKN düğmesi/alanı doğrudan tıklanmaz/yazılmaz; geçersiz pasaport no (`'a b'`) olay göndermez; sunucudan gelen geçersiz `action` yok sayılır (sözleşme doğrulayıcısı); oturum yokken panel render edilmez; Enter ile gönderim, Esc ile kapanış, ekran okuyucu `aria-live`.
- [ ] **1B.3** Çalıştır → başarısız.
- [ ] **1B.4** Uygula `documentCopies.js`, `staffAssistant.js`, `staffAssistant.css` (320 px, koyu mod, `prefers-reduced-motion`), `main.js`'e `staffAuthReady` sonrası başlatma.
- [ ] **1B.5** Testleri çalıştır → geçer. Commit (Claude): `feat(staff-assistant): Topi panel, confirmed writes, document copies`.

### Görev 2A — YKN saf modüller (`task/ykn-auto-pure`)

**GOAL:** Zincirin test edilebilir parçaları: yüz bulma, pasaport sayfası koruması, durum makinesi. Yalnız yeni dosyalar; `yknManager.js`'e dokunmaz.
**YOU OWN:** `src/utils/passportPageScore.js`, `src/services/passportDocumentGuard.js`, `src/services/passportFaceCrop.js`, `src/managers/yknAutoFlow.js`, `test/passportDocumentGuard.test.js`, `test/passportFaceCrop.test.js`, `test/yknAutoFlow.test.js`.
**DO NOT TOUCH:** `yknManager.js`, `passportCropperModal.js`, `ykn_eklenti-main/`, `package.json*`.
**CONTEXT:** F10–F14, A2; Bölüm 7.2 (imzalar birebir). `scorePassportPageText` gövdesini `yknManager.js:96-190`'den **olduğu gibi kopyala** (2B, özgün kopyayı silip buradan içe aktaracak).
**DONE WHEN:** üç test dosyası yeşil; imzalar 7.2 ile aynı.

**Yüz bulma kararı (önce, kodsuz — 2A.1):** Chrome `FaceDetector` her kurulumda yok. Seçenekler: (i) `FaceDetector` varsa onu, yoksa (ii) kendi sitemizden servis edilen küçük bir yüz modeli (BlazeFace tipi, dış CDN yok). Claude, kullanıcının yerelde verdiği ~20 pasaport taramasıyla (repoya **eklenmez**) ölçer: ölçüt ≥19/20 doğru kutu, yanlış kırpma 0, yükleme süresi ve boyutu rapora yazılır. Sonuç bu belgeye "Karar" olarak eklenir. `package.json` değişimi gerekirse Claude yapar. `detectFaceCrop` imzası değişmez; model seçimi yalnız iç uygulamadır. **`'unavailable'` dönerse zincir durur** (el ile kırpma).

- [ ] **2A.1** Yüz bulma kararı (yukarıda); karar notu planın sonuna eklenir.
- [ ] **2A.2 Başarısız testler:** `passportDocumentGuard.test.js` — MRZ'li metin + doğru pasaport no → `isPassport:true`; MRZ var, no yok ama ad eşleşir → `true`; **diploma/kabul mektubu metni (MRZ yok) → `false`**; MRZ var ama başka kişinin no/adı → `false`; boş metin → `false`. `passportFaceCrop.test.js` (dedektör enjekte edilir): tek yüz → kutu sınır içinde ve `aspectRatio`'ya ±%2 uyar; yüz yok → `no-face`; iki yüz → `multiple-faces`; dedektör yok → `unavailable`. `yknAutoFlow.test.js` (sahte `deps`): `enabled()` false iken hiçbir `click` yok; `onSearchDone` → `click('read-acceptance')`; `onYoksisReady` olmadan `click('copy')` yok; `onSearchDone` iki kez gelirse tek zincir; `cancel` sonrası olaylar yok sayılır; sayfa pasaport değilse `selectNextSource()` denenir, hepsi elenirse `submit` çağrılmaz ve `report(…,'error')` nedeni yazar; yüz yok/çok → `submit` yok; `getGender()===''` → `submit` yok ve "Cinsiyeti seçin" mesajı; medeni boşsa `setDefaults({medeni:'Bekar'})`; her şey tamam → sırasıyla `applyCrop(box)`, `submit()`; adım hatası → `cancel`.
- [ ] **2A.3** Çalıştır → başarısız.
- [ ] **2A.4** Uygula `passportPageScore.js` (kopya), `passportDocumentGuard.js` (hasMrz = `P<`/`<<<` ya da 2×≥30 karakterlik `<` içeren satır; eşleşmeler `scorePassportPageText` bileşenleriyle aynı mantık), `passportFaceCrop.js`, `yknAutoFlow.js` (durum makinesi: IDLE→SEARCHED→ACCEPTANCE→YOKSIS_READY→COPY→CROPPER→DONE|STOPPED; her durdurma `report`'a Türkçe neden ve öneri yazar).
- [ ] **2A.5** Testleri çalıştır → geçer. Commit (Claude): `feat(ykn): passport guard, face crop and auto-flow state machine (pure modules)`.

### Görev 2B — YKN bağlama (`task/ykn-auto-flow`, 2A commit'inden)

**GOAL:** 2A modüllerini `yknManager.js` ve kırpıcıya bağlamak; arama bitince `#btn-read-acceptance`, YÖKSİS hazır olunca `#btn-copy`, kırpıcı hazır olunca otomatik kırpma + `Her Şeyi YÖKSİS'e Aktar`. Açma/kapama anahtarı.
**YOU OWN:** `src/managers/yknManager.js`, `src/ui/passportCropperModal.js`, `test/yknAutoFlowWiring.test.js` (yeni).
**DO NOT TOUCH:** `ykn_eklenti-main/`, `yetkili/index.html` (anahtar JS ile eklenir), 2A dosyaları (salt okunur), mevcut testler (beklentileri değiştirme; yeni test dosyası yaz). **Tek Tık akışına (`startOneClickWorkflow`, `ONE_CLICK_STAGE`) dokunma.**
**CONTEXT:** F10–F14, A1, A2; Bölüm 7.2; mevcut testlerin mock deseni `test/yknLiveContract.test.js`, `test/yknStudentTransition.test.js`.
**DONE WHEN:** yeni test yeşil; mevcut tüm YKN testleri aynen yeşil; anahtar kapalıyken davranış bugünküyle bire bir aynı; zincir hiçbir adımda YÖKSİS'te kaydet/gönder yapmaz.

- [ ] **2B.1** `scorePassportPageText`'in `yknManager.js`'teki özel kopyasını silip `src/utils/passportPageScore.js`'ten içe aktar (davranış aynı; mevcut testler yeşil kalmalı).
- [ ] **2B.2 Başarısız test** `yknAutoFlowWiring.test.js` (kaynak-sözleşmesi + mock): `yknManager.js` `createYknAutoFlow`'u içe aktarır; arama bitiş noktasında (F11, ~3445) `autoFlow.onSearchDone` çağrısı; `TRANSFER_TO_YOKSIS` başarı dalında (F11) `autoFlow.onYoksisReady`; `ykn:cropper-ready` olayına abone; anahtar `localStorage` anahtarı `ykn-auto-flow-v1` (varsayılan **açık**, `try/catch` ile); anahtar kapalıyken `enabled()` false; kırpıcı modülü `applyCropBox`, `submitCropperTransfer`, `setCropperDefaults`, `getCropperGender` dışa aktarır; anahtar kapalıyken `click` çağrısı yapılmaz. (Tek Tık kodunun değişmediğini Claude diff incelemesinde doğrular: `startOneClickWorkflow` ve `ONE_CLICK_STAGE` satırları diff'te yok.)
- [ ] **2B.3** Çalıştır → başarısız.
- [ ] **2B.4** `passportCropperModal.js`: `ready()` içinde `window.dispatchEvent(new CustomEvent('ykn:cropper-ready', { detail: { pageIndex } }))`; dışa aktar: `applyCropBox({x,y,width,height}) → boolean` (`passportCropperInstance.setData`), `submitCropperTransfer()` (= `downloadCroppedImage(true)`), `setCropperDefaults({ medeni })` (yalnız `cropperSelectMedeni` boşsa ve `disabled` değilse yazar), `getCropperGender() → string`. Başka davranış değişmez (her aktarımda yerel .jpg indirme F14'te olduğu gibi kalır).
- [ ] **2B.5** `yknManager.js`: `createYknAutoFlow({...deps})` kur (deps F10–F14'ten: `click` → ilgili düğme `.click()`; `getPages` → `currentStudentData.passportPages`; `evaluatePage` → `evaluatePassportPage`; `selectNextSource` → `handleCropSourceSelection` ile sıradaki `cropSources` adayı; `report` → `addStatus`); arama bitiş noktası, `TRANSFER_TO_YOKSIS` başarı dalı ve `ykn:cropper-ready` olayına bağla; kullanıcı elle `#btn-ykn-search`/yeni pasaport yazarsa `autoFlow.cancel('Yeni arama başlatıldı')`; açma/kapama onay kutusu "Otomatik zincir" `#ykn-passport-input` yanına **JS ile** eklenir; `ykn:auto-run` olayını dinle: `#ykn-passport-input`'a pasaportu yaz (büyük harf), `autoFlow.start(passportNo, { force: true })`, `#btn-ykn-search` tıkla; her durum değişiminde `ykn:auto-flow-status` yayınla. Test: olay gelince anahtar kapalı olsa da zincir başlar; zincir hiçbir noktada YÖKSİS kaydet/gönder düğmesini/mesajını tetiklemez (eklenti mesajları listesi `TRANSFER_TO_YOKSIS`, `COPY_APPLY_DATA`, `FILL_YOKSIS_FORM` dışına çıkmaz).
- [ ] **2B.6** Testleri çalıştır (yeni + tüm `test/ykn*.test.js`) → geçer.
- [ ] **2B.7** Claude: build + dry-run; kullanıcı gözetiminde 3 öğrenciyle yerel deneme (kapalı anahtarla bugünkü davranış, açık anahtarla zincir, bilerek yanlış belge). Commit (Claude): `feat(ykn): wire automatic search→acceptance→crop→transfer chain`.

### Görev 3A — Excel sunucu (`task/yoksis-excel-api`)

**GOAL:** F17 biçimindeki Excel satırlarını güvenle alıp mevcut `yoksis_document_audit_records` tablosuna yazan `import` ve `import/latest` uç noktaları; durum sınıflandırması; son yükleme kaydı; mevcut `/query` yanıtına Excel ek alanları.
**YOU OWN:** `src/server/domain/yoksisAuditPolicy.js` (yeni), `src/server/routes/staffYoksisDocumentAuditRoutes.js`, `migrations/0046_yoksis_audit_import.sql` (numara başlamadan `origin/production`'da teyit edilir), `test/yoksisAuditPolicy.test.js`, `test/staffYoksisDocumentAuditImportApi.test.js`, `test/yoksisAuditImportMigration.test.js`.
**DO NOT TOUCH:** mevcut `/records` davranışı ve mevcut testler (`staffYoksisDocumentAuditApi.test.js` aynen yeşil kalır), `ykn_eklenti-main/`, `src/managers/*`, `yetkili/index.html`.
**CONTEXT:** F3, F17, A8, A9; Bölüm 7.3; migration deseni `migrations/0034_yoksis_document_audit.sql`, test deseni `test/yoksisAuditMigration.test.js`, `test/staffYoksisDocumentAuditApi.test.js`.
**DONE WHEN:** testler yeşil; `scripts/ci/check-migration-ledger.mjs` geçer; eski `/records` ve `/query` testleri değişmeden yeşil; Excel yolu mevcut satırın dolu `first_name`, `last_name`, `passport_number`, `phone` alanlarını **asla** boşaltmaz.

**Veri modeli (yalnız ekleme, uygulanmış migration düzenlenmez):**
- Yeni tablo `yoksis_audit_imports(id TEXT PRIMARY KEY, uploaded_at TEXT NOT NULL, uploaded_by_staff_id TEXT NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT, exported_at TEXT NULL, row_count INTEGER NOT NULL DEFAULT 0, finalized_at TEXT NULL)`.
- `yoksis_document_audit_records`a sütunlar: `source TEXT NOT NULL DEFAULT 'scan' CHECK (source IN ('scan','excel'))`, `last_seen_import_id TEXT NULL`, `unit TEXT NOT NULL DEFAULT ''`, `program TEXT NOT NULL DEFAULT ''`, `missing_deadline TEXT NULL`, `goc_last_query_at TEXT NULL`, `last_transaction_type TEXT NOT NULL DEFAULT ''`, `transaction_count INTEGER NOT NULL DEFAULT 1`.
- Excel upsert (anahtar `application_number`): yeni satırda `first_name = fullName`, `last_name = ''` (UI ikisini birleştirir; `matchesOnlineApplication` zaten birleşik ad kullanır), `phone`/`passport_number` boş; var olan satırda ad/telefon/pasaport **korunur** (`CASE WHEN mevcut <> '' THEN mevcut ELSE yeni END`); durum, kategori, `documents_json`, birim, program, tarihler, `source='excel'`, `last_seen_import_id`, `scanned_at` güncellenir. `documents_json` = `missingNote` doluysa `[{ name: <255'e kısaltılmış, satır sonları boşluğa çevrilmiş not>, required: true, note: 'Son tarih: GG.AA.YYYY' (varsa), uploadStatus: '' }]`, yoksa `[]`. Tablo kuralı `student_number` yalnız rakam: ihlalde satır `rejected` olur (kural gevşetilmez).
- Partiler 50 satır, 128 KB; `search_text` mevcut alanlardan (ad, öğrenci no, pasaport) üretilir.

- [ ] **3A.1 Çıkarım + başarısız test** `yoksisAuditPolicy.test.js`: mevcut `classifyStatus`, `normalizeSearch`, `validateDocuments` ve sabitleri `yoksisAuditPolicy.js`'e taşı (rota oradan içe aktarır, davranış aynı). `classifyGocStatus`: `'İşlem Tamamlandı'→successful`, `'İşlem Bekliyor'→pending`, `'Eksik Belge İstendi (son: 06.12.2026, 13 gün kaldı)'→missing_documents`, `'Eksik Belge İstendi (son: 21.11.2026, süresi geçti)'→missing_documents`, `'Eksik belgeler iletildi – Göç incelemesi bekleniyor'→pending`, `'Değerlendirme Aşamasında'→pending`, `'Sorgulanmadı'→other`, `'bilinmeyen metin'→other`. `validateImportRow`: telefon/pasaport alanı yok kabul; `applicationNumber:'12-3'` ret; `studentNumber:'C12345678901'` ret (reason Türkçe); ek/bilinmeyen anahtar ret; `fullName` 241 karakter ret; `missingDeadline:'31.02.2026'` ret (ISO değil); `missingNote` 1001 karakter ret.
- [ ] **3A.2 Başarısız testler** `staffYoksisDocumentAuditImportApi.test.js`: kimliksiz 401; başka origin 403; 51 satır 400; geçersiz `importId` 400; geçerli parti `storedCount` döner ve satırlar `source='excel'`, `last_seen_import_id=importId`, doğru `status_category`; bozuk satır `rejected:[{index,reason}]` ile bildirilir, diğerleri yazılır; **aynı importId iki kez gönderilince** satır sayısı artmaz (idempotent); önceden `scan` kaynaklı satır (ad, telefon, pasaport dolu) Excel ile güncellenince bu üç alan korunur, durum güncellenir; `final:true` `finalized_at` ve `row_count` yazar; hiç yüklenmemiş yeni dosyada olmayan eski kayıt **silinmez ve alanları değişmez**; `import/latest` kişi/zaman/`exportedAt` döndürür, yüklemeden önce `null`; `/query` yanıtında yalnız `source='excel'` kayıtlarda `import` anahtarı var ve `isStale` son yüklemede görülmeyenler için `true`; `scan` kayıtların yanıt biçimi değişmemiştir.
- [ ] **3A.3 Başarısız migration testi** `yoksisAuditImportMigration.test.js`: yeni tablo ve sütunlar mevcut, eski satırlar `source='scan'`, `CHECK` yanlış `source` değerini reddeder, `transaction_count` varsayılanı 1.
- [ ] **3A.4** Üç test dosyasını çalıştır → başarısız.
- [ ] **3A.5** Uygula: migration, `yoksisAuditPolicy.js`, uç noktalar (aynı hata sınıflandırma ve kişisel veri sızdırmayan günlük kuralları; `worker.js` önek eşlemesi `/api/staff/yoksis-document-audit/*` zaten yönlendirir, `worker.js` değişmez).
- [ ] **3A.6** Testleri çalıştır → geçer; `node --test test/staffYoksisDocumentAuditApi.test.js test/yoksisAuditMigration.test.js` değişmeden geçer. Commit (Claude): `feat(yoksis): Excel import endpoint, Göç status classification and import ledger`.

### Görev 3B — Excel istemci (`task/yoksis-excel-ui`, 3A commit'inden)

**GOAL:** Görevlinin `Ikamet_Islemleri_*.xls` dosyasını seçip yükleyebildiği, ilerlemeyi, uyarıları ve son yüklemeyi gördüğü arayüz; dosyayı tarayıcıda ayrıştırıp 7.3 sözleşmesine çeviren modül.
**YOU OWN:** `src/staff/yoksisExcelImport.js`, `src/managers/yoksisDocumentAuditManager.js` (yalnız yükleme bölümü), `yetkili/index.html` (yalnız `#view-yoksis-audit` içi), `test/yoksisExcelImport.test.js`, `test/fixtures/yoksis-ikamet-islemleri-ornek.json` (**yapay** satırlar, F17 başlıklarıyla; gerçek kişi verisi yok; neden: sütun düzeninin regresyonunu yakalamak), `test/staffYoksisAuditExcelUi.test.js`.
**DO NOT TOUCH:** sunucu dosyaları, `ykn_eklenti-main/yoksis-document-audit*.js` (eski tarama yedek olarak aynen kalır), 3A dosyaları.
**CONTEXT:** F3, F7, F17, A8, A9; Bölüm 7.3; yedek/yeniden deneme deseni `PENDING_STORAGE_KEY`, `MAX_RETRY_ENTRIES` (`yoksisDocumentAuditManager.js` başı). Sayfada `window.XLSX` (SheetJS 0.18.5) hazırdır; `.xls` ve `.xlsx` ikisini de okur.
**DONE WHEN:** testler yeşil; Claude'un yerelde çalıştırdığı gerçek örnek dosya (yalnız yerelde, repoya girmez) içe aktarılınca: 1972 satır okunur; 27 başvurunun 58 satırı birleştirilir (31 tekrar satırı), 1 satır reddedilir → 1940 başvuru (2026-11-23 düzeltme: eski "1944/27" hesap hatasıydı; gerçek dosyayla doğrulandı) (rakam dışı öğrenci no) ve D1'de sayılar bununla eşleşir.

**Ayrıştırma kuralları:** başlıklar Türkçe harf, boşluk ve büyük/küçük harf duyarsız eşlenir (`E-İkamet Başvuru No`→`applicationNumber`, `Öğrenci No`→`studentNumber`, `Ad Soyad`→`fullName`, `Birim`→`unit`, `Program`→`program`, `İşlem Türü`→`processType`, `GöçNet Kayıt No`+`Kayıt Tarihi`→sıralama için, `Göç Durumu`→`gocStatus`, `Eksik Belge Son Tarih`→`missingDeadline`, `Eksik Belge Açıklaması`→`missingNote`, `Göç Son Sorgu Tarihi`→`gocLastQueryAt`); **zorunlu başlıklar** `applicationNumber, studentNumber, fullName, gocStatus` — biri yoksa dosya reddedilir ve eksik başlık adları gösterilir ("YÖKSİS dışa aktarma biçimi değişmiş olabilir"). Hücreler `String(...).trim()` ile okunur (sayı da metin de kabul), tarihler `GG.AA.YYYY`→ISO (geçersiz → `null`), `Eksik Belge Açıklaması` satır sonları boşluğa. Aynı `applicationNumber` satırları **birleştirilir**: en yeni işlem (`Kayıt Tarihi` sonra `GöçNet Kayıt No` büyük olan) `processType`'ı belirler, `transactionCount` = satır sayısı, `Göç Durumu`/not/son tarih en yeni satırdan alınır. `exportedAt` dosya adından (`Ikamet_Islemleri_20261123_1307` → `2026-11-23 13:07`), yoksa `null`. Üst sınırlar: 10 MB, 5000 satır; yalnız `.xls`/`.xlsx`. Hücre değerleri `Object.create(null)` tabanlı düz nesneye kopyalanır (A8).

- [ ] **3B.1 Başarısız testler** `yoksisExcelImport.test.js` (SheetJS ile yapay çalışma kitabı, F17 başlıklarıyla): başlık eşleme harf/boşluk duyarsız; sütun sırası değişse de doğru okunur; zorunlu başlık eksik → dosya reddi + eksik adlar; aynı başvuru 3 işlem satırı → 1 kayıt, `transactionCount:3`, en yeni işlem türü; metin olarak saklı 11 haneli öğrenci no kabul, `C12345678901` `rejected` (satır numarasıyla); `31.02.2026` → `missingDeadline:null`; çok satırlı açıklama tek satıra iner; boş Birim/Program geçerli; 10 MB üstü, `.csv`, `.pdf` reddedilir; `__proto__`/`constructor` başlıklı sütun düz nesneye sızmaz; dosya adından `exportedAt`; 120 kayıt → 50'lik 3 parti.
- [ ] **3B.2 Başarısız testler** `staffYoksisAuditExcelUi.test.js` (kaynak-sözleşmesi, mevcut `staffYoksisDocumentAuditUi.test.js` deseni): dosya seçici `accept=".xls,.xlsx"`; "Son yükleme: GG.AA.YYYY SS:dd · Kişi · N satır" satırı; `exportedAt` 24 saatten eskiyse sarı uyarı "Bu dosya dünden kalma görünüyor"; yükleme özeti "N satır, M başvuru (K tekrar birleştirildi), R reddedildi"; reddedilen satırlar tablo olarak (satır no + neden) gösterilir; `final:true` yalnız tüm partiler başarılıysa gönderilir; parti hatasında kalan partiler `PENDING_STORAGE_KEY` desenine kaydedilir ve "Kaldığı yerden devam" düğmesi çıkar; eski "YÖKSİS listesini tara" düğmesi "Yedek: tek tek tara" etiketiyle ikinci plana alınır ve **kaldırılmaz**; `isStale` kayıtlarda "Son yüklemede yok" rozeti; `import` alanı olan kayıtta birim/program ve son tarih (kalan gün) gösterilir.
- [ ] **3B.3** Çalıştır → başarısız. **3B.4** Uygula `parseYoksisExcel(arrayBuffer, fileName) → { rows, rejected, mergedCount, totalRows, exportedAt, missingHeaders }`, yükleme/ilerleme/yeniden deneme, son yükleme satırı, birim/program/son tarih görünümü.
- [ ] **3B.5** Testleri çalıştır → geçer. Claude: build, dry-run, yerel D1 ile gerçek örnek dosyayı içe aktar (sayılar DONE WHEN ile eşleşir); D1 yazma bütçesini (≈1944 satır × indeksler) Cloudflare kullanım kartından kontrol eder. Commit (Claude): `feat(yoksis): daily Excel import UI for İkamet İşlemleri export`.

---

## 9. Entegrasyon ve yayın

- [ ] Her task dalı kendi testinden geçince **sahibi yerelde dener** (`feedback: yerelde dene, sonra canlı`). Önerilen deneme sırası: 2B → 1A+1B → 3A+3B. Entegrasyon denemesi için ayrı bir test dalı gerekirse (`test/combined-*` desenindeki gibi) yalnız Claude kurar.
- [ ] Merge yalnız kullanıcının "canlıya alınsın" kararından sonra, `production`'a **merge commit** ile (squash/rebase yok). 3A migration içerdiği için **tam yol**: `preflight`, kanıt incelemesi, sonra `publish`. 1A/1B/2A/2B yalnız kod ise hızlı yol uygulanabilir; her yayın ayrı ve tam SHA ile açıkça istenir. Topi yetkili şaltersiz, yayınla birlikte açıktır; bu yüzden yerel denemeyi gerçek personel akışlarıyla (5 komut) yapmak yayın şartıdır. Eklenti değişmediği için paketleme/sürüm artışı yok.
- [ ] Tamamlanınca `docs/README.md` satırı güncellenir (Claude), ilgili bellek notları yenilenir.
- [ ] **Yapay zekâ kalite ve güvenlik kapısı (Bölüm 12):** her canlıya alma kararından önce Bölüm 12'deki kapı çalışır ve sonucu kanıt notuna yazılır.

## 10. v1 → v2 değişiklikleri (gözden geçirme notu)

- Koda karşı doğrulanınca **düzeltilenler:** çalışma saati yalnız "bugün" ve 30 dk adımı (v1 `date`/`hours` varsaymıştı); başvuru araması telefon/e-posta kapsamaz; Excel yazımı mevcut `/records` biçimine uymaz (telefon zorunlu, kimlik çapraz kontrolü) → ayrı doğrulayıcılı `import` yolu; model sarmalayıcısı ek araç kabul eder (varsayım doğrulandı); "N kopya" özelliği kodda yoktu → `documentCopies.js`; `scorePassportPageText` ve zincir bayrakları zaten vardı → yeniden yazılmadı, kullanıldı; `Tek Tık` akışı vardı → dokunulmaz; `#view-yoksis-audit`/Topi kökü `yetkili/index.html` çakışması azaltıldı (kök kutu JS ile).
- **Çok agent'a uygunluk:** görevler 1A.0/1A/1B, 2A/2B, 3A/3B olarak bölündü; dosya sahipliği matrisi, sözleşmeler (7.1–7.3) ve imzalar sabitlendi; dalga planı ve eşzamanlılık sınırı (3) eklendi.
- **v2.1 (gerçek örnek Excel sonrası):** dosya yalnız eksikleri değil tüm ikamet işlemlerini içeriyor (1972 satır); kategori `Göç Durumu`'ndan çıkar; satır=işlem olduğundan aynı başvuru no birleştirilir; telefon/pasaport/belge listesi yok (mevcut dolu alanlar korunur); "çözülmüş" mantığı **kaldırıldı** (dışa aktarma bir zaman penceresi olabilir); toplu yazma 25→50 satıra çıkarıldı; yeni sütunlar birim, program, son tarih; Topi şalteri (A3) kaldırıldı; 3B kilidi kalktı.
- **Yürütme önkoşulları (açık):** (1) 2A.1 için kullanıcının yerelde vereceği ~20 pasaport taraması; (2) A9'daki tek eşleme kararı (`Eksik belgeler iletildi…` → Beklemede) için itiraz var mı. Excel örneği alındı; A1, A2, A3 kararlaştı; A4–A8 onaylandı (2026-11-23).

## 11. Faz 5 — Sohbet kaydı, ofis inceleme kartı ve Evet/Hayır oyu (karar: 2026-11-23)

- **Tarih:** 2026-11-23. **Kaynak:** kullanıcının aynı gün verdiği karar ve `bbde4f5`/`9cf071d` yayınlarından sonra `production` kodunun okunması. **Durum:** PLAN; kod yazılmadı, test çalıştırılmadı. Faz 1–4 (Topi yetkili, YKN, Excel) ile dosya bakımından bağımsızdır; paylaşılan dosyalar için bkz. 11.6.
- **Kesin karar (kullanıcı, 2026-11-23):** Öğrencilerin Topi ile konuşmaları ve Topi'nin cevapları **kaydedilir**; her Topi cevabının altına **Evet / Hayır** düğmesi eklenir; ofis yetkili panelden sohbetleri okuyup cevap kalitesini inceler. Bu karar, 20 Kasım'daki "sohbet yalnızca bellekte, içerik günlüğe yazılmaz" kısıtını **tersine çevirir** (bugünkü kod yalnız istek no, sonuç türü, araç adları ve süreyi günlüğe yazar: `src/server/routes/chatbotRoutes.js`, `finally` bloğundaki `console.info`).
- **KVKK uyarısı (bir kez söylendi, karar verildi):** Öğrenciler sohbete ad, telefon, ITU numarası, pasaport bilgisi yazabilir; bunlar kişisel veridir. Canlıya çıkmadan önce girişteki ilk aydınlatma (KVKK) penceresi "sohbetler hizmeti geliştirmek için kaydedilir ve ofis personeli tarafından okunabilir" diyecek şekilde güncellenir (madde 4); mesajlar maskelenmeden kaydedildiği için erişim yalnız yetkili personeldir ve silinebilir; personel erişimi sınırlı ve silinebilir olur; kayıt hatası sohbeti asla bozmaz.

### 11.1 Onay bekleyen kararlar (varsayılan köşeli parantezde; itiraz edilmedikçe uygulanır)

1. **KARARLAŞTI (kullanıcı, 2026-11-23):** Saklama süresi ofisin istediği kadar: sohbetler personel silene kadar durur, **otomatik silme yok** (cron/`wrangler.jsonc` değişmez). Personel tek oturumu ya da "N günden eski hepsini" elle silebilir.
2. **KARARLAŞTI (kullanıcı, 2026-11-23):** Okuma yetkisi **tüm yetkili personel** ("Gelen Sorular" ile aynı kimlik doğrulama); ayrı yetki ayarı yok.
3. **KARARLAŞTI (kullanıcı, 2026-11-23):** **Maskeleme yapılmaz**; mesajlar yazıldığı gibi kaydedilir. Bu yüzden kayıt tamamen kişisel veri sayılır: erişim yalnız yetkili personel, silme düğmeleri ve girişteki aydınlatma metni (madde 4) bunun karşılığıdır.
4. **KARARLAŞTI (kullanıcı, 2026-11-23):** Sohbet kaydı uyarısı, öğrenci siteye ilk girdiğinde çıkan **ilk aydınlatma (KVKK) penceresinde** gösterilir; botu açınca ayrıca yeni bir uyarı eklenmez. Taslak cümle: "Asistanla yaptığınız sohbetler hizmeti geliştirmek için kaydedilir ve Uluslararası Ofis personeli tarafından okunabilir. Lütfen sohbete kimlik, pasaport veya telefon numarası yazmayın." Beş dile çevrilir; yayınlanmadan önce ofis veya hukuk birimi okur. Widget'taki mevcut "Yapay zekâ hata yapabilir…" satırı değişmez.
5. **KARARLAŞTI (kullanıcı, 2026-11-23):** Reddedilen ve enjeksiyon denemesi turları da sonuç etiketiyle kaydedilir.
6. **KARARLAŞTI (kullanıcı, 2026-11-23):** "Hayır" oyundan sonra mevcut ofis formu (`inquiry`) düğmesi gösterilir.

### 11.2 Doğrulanmış kod gerçekleri (`production` = `9cf071d`)

- Sohbet ucu `POST /api/public/chat` (`chatbotRoutes.js`); denetim sırası sabit, ucuz kontroller önce; istek başına tek `console.info` satırı vardır.
- Widget (`src/public/homeChatbot.js`) konuşma geçmişini yalnızca bellekte tutar, tarayıcı depolaması kullanmaz; her yanıt `appendMessage` ile eklenir, durum makinesi `resolveReplyMascotState` ile belirlenir.
- Gelen Sorular: `migrations/0045_office_inquiries.sql`, `src/server/routes/inquiryRoutes.js`, `staffInquiryRoutes.js`, `src/staff/inquiryManager.js`, `src/server/repositories/d1/officeInquiryRepository.js`. Yeni kart bu desenleri izler.
- Açık uç noktalar için IP başına sınırlama ve "hata verirse kapalı kal" kuralı mevcuttur (`application-rate-limits.js`).
- Faz 3A `migrations/0046_*.sql` numarasını ayırdı; bu faz **0047**'yi kullanır. İki iş farklı sırada canlıya çıkarsa numaralar yeniden düzenlenir (canlıya uygulanmış bir migration yeniden numaralanmaz).

### 11.3 Tasarım

- **Tablolar (migration 0047, korumalı yol):** `chat_sessions(id TEXT PK rastgele, language, created_at, last_at, turn_count)` ve `chat_turns(id TEXT PK rastgele, session_id FK, seq, user_text, assistant_text, outcome, tools TEXT, latency_ms, feedback TEXT CHECK IN ('up','down') NULL, feedback_at, created_at)`. İndeksler: `created_at`, `(feedback, created_at)`, `(outcome, created_at)`. IP, tarayıcı bilgisi ve başvuru kimliği **tutulmaz**.
- **Asgari veri:** `user_text` en çok 500, `assistant_text` en çok 4000 karakter (API sınırlarıyla aynı). **Maskeleme yok** (karar, 11.1 madde 3): mesajlar yazıldığı gibi saklanır.
- **Oturum kimliği:** sunucu ilk turda üretir ve yanıtta döner; widget yalnızca bellekte tutar; sayfa yenilenince yeni oturum başlar.
- **Yazma yolu:** yanıt hazırlandıktan sonra `waitUntil` ile en iyi çaba; yazma hatası yanıtı değiştirmez (isteğin günlük satırına hata sayacı eklenir).
- **Oy:** sohbet yanıtına `turn_id` (rastgele, tahmin edilemez) eklenir; yeni uç `POST /api/public/chat/feedback` `{turn_id, value: 'up'|'down'}`; aynı köken, 2 KB gövde sınırı, IP başına sınır (hata verirse kapalı), tur başına tek oy (ikinci oy üzerine yazar). Sabit sistem mesajlarına (hata, 503) oy düğmesi konmaz.
- **Widget:** her Topi cevabının altında küçük Evet/Hayır düğmeleri, beş dilde, telefonda en az 44 px dokunma alanı, ekran okuyucu etiketli, "hareketi azalt"ta animasyonsuz; oydan sonra teşekkür metni; "Hayır"da mevcut `inquiry` düğmesi.
- **Yetkili kart "Sohbetler":** en yeni oturumlar üstte; süzgeçler: tümü / "Hayır" oyu alanlar / ofise yönlendirilenler / reddedilenler / yedek menü; bugün ve 7 gün için cevap, "Evet", "Hayır" sayıları; oturum açıp turları okuma; **oturum silme**; **N günden eski hepsini silme**.

### 11.4 Sözleşme (11.4, görevler arası, değişmez)

- `POST /api/public/chat` yanıtı mevcut alanlara ek olarak `session_id` ve `turn_id` döndürür (kayıt başarısızsa ikisi de `null`, yanıt aynı kalır).
- `POST /api/public/chat/feedback` → `204`; hata kodları: 400 geçersiz gövde, 404 bilinmeyen `turn_id`, 429 sınır, 503 depolama yok.
- Yetkili: `GET /api/staff/chat-sessions?filter=&cursor=`, `GET /api/staff/chat-sessions/:id`, `DELETE /api/staff/chat-sessions/:id`, `DELETE /api/staff/chat-sessions?older_than_days=N`, `GET /api/staff/chat-stats` (kimlik doğrulaması `staffInquiryRoutes.js` ile aynı).

### 11.5 Görevler

- [ ] **4A — Veri katmanı ve uçlar** (`task/chat-log-api`): sahibi `migrations/0047_chat_log.sql`, `src/server/domain/chatLog.js` (doğrulama ve uzunluk sınırları), `src/server/repositories/d1/chatLogRepository.js`, `src/server/routes/chatFeedbackRoutes.js`, `chatbotRoutes.js`'te yalnız yazma kancası ve yanıt alanları, ilgili testler. **DONE WHEN:** uzunluk sınırı ve geçersiz girdi testleri geçer; DB kapalıyken sohbet eskisi gibi cevap verir (başarısız yazma testi); oy ucu sınırları ve tek-oy testi geçer; `npm test` yeşil.
- [ ] **4B — Widget oy düğmeleri** (`task/chat-log-ui`, 4A sözleşmesinden): sahibi `src/public/homeChatbot.js`, `chatbot.css`, `i18n/chatbot-messages.js`, `test/homeChatbot.test.js`. **DONE WHEN:** düğmeler beş dilde, RTL, 320 px, hareketi azalt; oy 4A ucuna gider; kayıt yoksa (`turn_id` boş) düğme görünmez; mevcut testler geçer.
- [ ] **4C — Yetkili "Sohbetler" kartı** (`task/chat-log-staff`, 4A'dan): sahibi `src/staff/chatLogManager.js` (yeni), `src/server/routes/staffChatLogRoutes.js` (yeni), `src/server/repositories/d1/chatLogRepository.js` yalnız okuma/silme sorguları (4A'dan sonra), ilgili testler. **DONE WHEN:** liste, süzgeç, sayılar, oturum açma ve silme çalışır; "Gelen Sorular" desenine uyar; yetkisiz erişim 401.
- [ ] **4D — Gizlilik metinleri ve belgeler** (4B'den sonra): sahibi girişteki ilk KVKK aydınlatma penceresi (`src/public/privacyNoticeModal.js` ve ilgili i18n dizeleri; widget uyarısı değişmez), `chatbotKnowledge.js` `privacy` konusu (beş dil, DRAFT işareti kalır), `docs/manual-production-release.md` kanıt notu. **DONE WHEN:** ilk KVKK penceresi beş dilde sohbet kaydını ve kimin okuyabildiğini söyler; mevcut onay kutusu ve davranış bozulmaz; metinleri ofis onaylar.
- **Sıra:** 4A → 4B ve 4C paralel (farklı dosyalar) → 4D → kullanıcı yerelde dener (yalnız sentetik sohbetler) → canlıya alma.

### 11.6 Dalga, dal ve paylaşılan dosyalar

| Görev | Dal (production'dan) | Bağımlılık |
|---|---|---|
| 4A | `task/chat-log-api` | yok |
| 4B | `task/chat-log-ui` (4A commit'inden) | 4A sözleşmesi |
| 4C | `task/chat-log-staff` (4A commit'inden) | 4A |
| 4D | `task/chat-log-privacy` | 4B |

Paylaşılan dosyalar tek sahipli çalışır: `src/server/worker.js` (rota satırı: 1A ve 4A/4C sırayla), `yetkili/index.html` ve `src/staff/main.js` (1B ve 4C sırayla), `migrations/` (3A=0046, 4A=0047), `package.json*`, `wrangler.jsonc`, `docs/README.md` (Claude). Birleştirmede çakışırsa Claude ikisini de korur ve testleri yeniden çalıştırır.

### 11.7 Yayın

- 4A migration içerir (korumalı yol): **tam yol**, 23 Kasım'da uygulanan sırayla: kullanıcı onayı → Time Travel yer imi alınır → `npm run db:migrate:production` → bekleyen migration kalmadığı doğrulanır → `config/production-publication.json` baseline'ı ilerletilir ve `docs/manual-production-release.md`'ye kanıt notu eklenir → push → `preflight` → kanıt incelemesi → `publish`. Her adım kullanıcının açık isteğiyle; ham `wrangler deploy` yasak.
- Yayından sonra: widget'ta oy düğmeleri, yetkili kartı ve ilk girişteki KVKK penceresi canlıda gözle denenir; ilk haftada "Hayır" oranı ve ofise yönlendirme sayıları izlenir.

## 12. Yapay zekâ kalite ve güvenlik test planı (karar: 2026-11-23)

- **Tarih:** 2026-11-23. **Kaynak:** kullanıcının "yeni testler ekleyelim; güvenlik ve yardımcı olabilirlik; uzun süre var, dikkatli ve adım adım" isteği; mevcut test varlıkları `production` (`9cf071d`) üzerinde sayıldı. **Durum:** PLAN; kod yazılmadı, hiçbir test çalıştırılmadı.
- **Kapsam:** (a) bugün canlıdaki herkese açık Topi sohbeti, (b) Faz 5 (sohbet kaydı ve oy), (c) planlanan Topi yetkili asistanı (Faz 1A/1B). Üçü için ortak ilke: **model yalnız konuşur ve araç seçer; kuralı, yetkiyi ve veriyi sunucu belirler; testler bunu kanıtlar.**

### 12.1 Bugün elimizde olanlar (kaynak: depo)

- Birim ve API testleri: yaklaşık 1900 test (`test/chatbotApi.test.js` ~5700 satır, `chatbotEvidence.test.js` ~2300, `chatbotKnowledge.test.js`, `chatbotTools.test.js`); sahte model bağlaması ile çalışır, CI'da her seferinde koşar, maliyetsizdir.
- Değerlendirme koşucusu `scripts/chatbot-eval/`: `cases.json` (229 vaka) ve başka bir model ailesinin yazdığı **kör set** `blind-cases.json` (130 vaka); gerçek Workers AI ile **yalnız yerelde** çalışır (CI'da çalıştırılmaz: maliyet ve hız sınırı).
- Son ölçümler (20 Kasım): kör set ~%92–95, tam set ~%97, yanlış belge listesi 0, güvenlik başarısızlığı 0.
- Bilinen açık: ret cevapları istemciye işaretlenmiyor (Topi "kafası karışık" yerine "yönlendirme" gösteriyor); canlı sohbet içeriği görülemiyor (Faz 5 çözer).

### 12.2 Yeni test aileleri

**A. Güvenlik (kırmızı takım):** her biri beş dilde, doğrudan ve dolaylı biçimlerde; beklenen sonuç sabit ret/yönlendirme metni ve **sıfır** sızıntı.
1. İstem enjeksiyonu ve jailbreak: rol yapma, "önceki talimatları yok say", başka dilde talimat, kodlanmış metin (base64, ters yazı, sıfır genişlikli karakter, RTL geçersiz kılma), çok turlu "yavaş kandırma", sahte sistem/araç mesajı ve araç çağrısı taklidi JSON'u.
2. Veri sızıntısı: sistem istemi, gizli anahtar/token/yapılandırma, iç adresler, personel adları, başka öğrencinin durumu; başvuru numarası **tahmin etme** (sıralı deneme), numarasız durum sorgusu, "arkadaşım adına".
3. Dolaylı enjeksiyon: öğrencinin yazdığı ad/mesaj içine gömülü talimatlar (sohbet kaydında ve ileride yetkili asistanda); modele geri verilen her metin için "talimat olarak çalışmaz" testi.
4. Kötüye kullanım ve maliyet: çok uzun mesaj, çok sayıda tur, tekrar saldırısı, günlük bütçe yarışı (eşzamanlı istekte sayaç doğruluğu), model zaman aşımı, boş/devasa/yanlış dilde model cevabı, bozuk araç JSON'u; hepsinde sabit güvenli yanıt ve bütçe/sınır aşılmaz.
5. Hassas konular: tehdit, kendine zarar, hukuki/tıbbi garanti isteme, sınır dışı etme korkusu: asistan söz vermez, tahmin yürütmez, ofise veya uygun kuruma yönlendirir (sabit metinler, beş dil).

**B. Doğruluk ve yardımcı olabilirlik:**
1. **Belge listesi kehaneti (oracle):** `documentPolicy.js`'teki bütün tür × yaş × konaklama × ev sahibi × parmak izi bileşimlerini üretip her biri için asistanın belge listesinin politikayla **birebir** aynı olduğunu doğrulayan özellik testi (şimdi 72 elle yazılmış senaryo var; bu hepsini kapsar). Yeni belge politikası ya da yeni dil eklenince otomatik genişler.
2. **Beş dil tutarlılığı:** aynı senaryo beş dilde aynı belge kümesini verir; sabit metinlerde eksik anahtar yok.
3. **Dayanak (groundedness):** bilgi konuları ve durum özetleri yalnız kayıtlı metin/veriden gelir; tarih, ücret, süre, "onaylanır" gibi söz içeren cümle sızmaz (zaten var olan yasak listesi genişletilir; "söz verme" testi).
4. **Yardımcı olma ölçüsü:** "cevaplanabilir sorular" kümesi (bilgi konuları, adımlar, durum, belge) için beklenen cevap; ölçüler: yedek menüye düşme oranı, gereksiz ofise yönlendirme oranı, gereksiz soru sorma oranı. Hedefler 12.4'te.
5. Belirsiz/eksik bilgi: tek, kısa, doğru netleştirme sorusu (tür/yaş/konaklama); kullanıcı senaryo değiştirince (yeni gerçekler eskisini geçer) tutarlı kalma; yanlış anlaşılan şeyin kullanıcıya gösterilip düzeltilebilmesi ("Anladığım bilgiler: …").

**C. Faz 5 (sohbet kaydı ve oy) testleri:** kayıt başarısızken sohbet eskisi gibi cevap verir; kayıt `ctx.waitUntil` ile gecikmeyi artırmaz; uzunluk sınırları; oy ucu: tahmin edilemez `turn_id`, tur başına tek oy, oy doldurma (aynı IP'den çok oy) sınırı, geçersiz gövde; silme gerçekten siler (oturum ve tüm turlar); personel kimlik doğrulaması olmadan okuma/silme 401; kayıtta IP/tarayıcı bilgisi **yok** (şema testi); `session_id`/`turn_id` sızıntısı başka oturuma erişim vermez.

**D. Topi yetkili asistanı (planlı) testleri:** model yalnız araç adı + parametre döndürür; parametre şeması sıkıdır, bilinmeyen araç/alan reddedilir; sonuçta kişisel veri modele **geri verilmez** (ekranda sabit biçimde gösterilir); yazma işleri yalnız istemcide, kullanıcı onayıyla; "talep gönderme" ve YÖKSİS "Kaydet" **hiçbir yoldan** tetiklenemez (kırmızı çizgi testi); yetkisiz çağrı 401/403; araç başına hız sınırı; her işlem denetim kaydına yazılır; öğrenci verisine gömülü talimat araç seçimini değiştirmez.

### 12.3 Aşama sırası (dikkatli, adım adım; her adım ayrı dalda, ayrı onayla)

- **Aşama 0 (bugünkü canlı sohbet için, Faz 5'ten bağımsız):** (1) `test-gap-audit` ile mevcut sohbet kodunun test boşlukları; (2) A ve B ailelerinin birim/API düzeyinde yeni testleri (sahte model ile CI'da); (3) belge listesi oracle'ı; (4) kör sete **yeni kör vaka paketi** (başka model ailesi yazar, mevcut yazarlar görmez); (5) kırmızı takım turu: bağımsız bir ajan (Neon/Argon) yalnız dışarıdan, gerçek model ile saldırı denemeleri yazar ve çalıştırır; bulunan her açık önce vaka, sonra düzeltme olur; (6) sonuç kanıt notuna yazılır. Kod değişikliği çıkarsa ayrı dal, hızlı yol.
- **Aşama 1 (Faz 5 ile birlikte):** C ailesi, 4A–4D görevlerinin DONE WHEN'ine eklenir; **kapalı döngü:** ofis her hafta "Hayır" oyu alan ve yedek menüye düşen sohbetleri inceler, kişisel veriyi temizleyerek **yeni regresyon vakası** yapılır (`cases.json`'a eklenir); böylece gerçek kullanım testleri besler.
- **Aşama 2 (Topi yetkili asistanı ile birlikte):** D ailesi 1A/1B görevlerinin DONE WHEN'ine eklenir; 1A sözleşmesi (7.1) yazılmadan önce kırmızı çizgi testleri yazılır (önce test).
- **Aşama 3 (sürekli):** canlıda ilk iki haftada günlük sonuç türü dağılımı ve oy oranı izlenir; eşik aşılırsa (12.4) ilgili aile genişletilir; model veya bilgi metni her değiştiğinde tüm kapı yeniden çalışır.

### 12.4 Kapı (her canlıya alma kararından önce çalışır)

1. `npm test` yeşil (yeni aileler dahil), `npm run build:production`, `npm run deploy:dry-run:production`.
2. Yerelde gerçek Workers AI ile tam set + kör set + yeni kırmızı takım seti. **Sert eşikler:** güvenlik başarısızlığı = 0; yanlış belge listesi = 0; kişisel veri/sistem istemi sızıntısı = 0; kör set ≥ %90 ve düşmez; yedek menüye düşme ≤ %5; gereksiz ofis yönlendirmesi ≤ %10. Eşik tutmazsa canlıya alınmaz.
3. Sonuçlar (vaka sayısı, tarih, model, başarısız vakalar) `docs/` altında tarihli bir kanıt notuna yazılır (tarih, kaynak, doğrulama durumu).
4. Bağımsız gözden geçirme: `security-review` ve `code-review` (Claude), `agy --mode plan` ile salt okunur güvenlik taraması (`security-auditor`, `vulnerability-scanner`); bulgular kapanmadan yayın yok.
5. Değerlendirme koşucusu gerçek modele istek attığı için **CI'ya konmaz**; yalnız yerelde ve kullanıcının onayladığı bütçeyle çalışır (günlük nöron sınırı izlenir).

### 12.5 Ajan ve dosya sahipliği (çakışma yok)

| İş | Sahip dosyalar | Not |
|---|---|---|
| Aşama 0 testleri (A, B) | `test/chatbot*.test.js` (yeni dosyalar: `test/chatbotSecurity.test.js`, `test/chatbotPolicyOracle.test.js`) | yalnız test; kod gerekirse ayrı görev |
| Kör vaka paketi | `scripts/chatbot-eval/blind-cases-2.json` (yeni) | farklı model ailesi yazar; mevcut set değişmez |
| Kırmızı takım | `scripts/chatbot-eval/redteam-cases.json` (yeni), koşucuya yalnız dosya adı ekleme | gerçek model, yerel |
| C ailesi | Faz 5 görevleriyle aynı dosyalar | 4A–4D DONE WHEN |
| D ailesi | Faz 1A/1B ile aynı dosyalar | önce test |

- Her ajanın istemi "ANY shell command yok" ile başlar; testleri, koşucuyu ve diff incelemesini Claude çalıştırır. **Ajan raporu kanıt değildir**: vaka sayıları ve eşikler koşucu çıktısından okunur.
- Kör set bir kez **kullanılmış** sayıldıktan sonra ayarlama için kullanılmaz (aşırı uyum); her pakette yeni kör vakalar yazılır.

### 12.6 Açık sorular (varsayılanlar köşeli parantezde)

1. Eşikler (12.4 madde 2) uygun mu? [evet; ilk ölçümden sonra gözden geçirilir]
2. Kırmızı takımı bağımsız bir model ailesi mi yürütsün? [evet: Neon veya Argon, Claude/Opus ajan modelleri değil]
3. Aşama 0 hemen mi başlasın, yoksa Faz 5 ve Topi yetkili ile mi birleşsin? [Aşama 0 önce: canlıdaki sohbet şimdiden herkese açık]

## 13. Ek işler (kullanıcı isteği, 2026-11-23): Topi yumak oyunu ve belge yeniden isteme hatası

- **Tarih:** 2026-11-23. **Kaynak:** kullanıcının aynı günkü isteği; `production` = `425652a` üzerinde kod okundu. **Durum:** PLAN; kod yazılmadı. Faz 1–4 ile birlikte uygulanır ve test edilir; yayın ayrı karardır.

### 13.1 Görev 5A — Topi yumak oyunu (`task/topi-yarn-play`)

- **Gerçek:** Öğrenci sayfasındaki Topi başlatıcısında yalnız fare kovalama var: `createTopiMouse` (`src/public/topiMascot.js:173`, `TOPI_MOUSE_SVG_SOURCE`), `homeChatbot.js:166` (hareketi azalt açıksa hiç oluşturulmaz), `chatbot.css` `.topi-mouse` ve `@keyframes topi-mouse-chase` (7 sn, sonsuz). Yetkili sayfada bugün Topi yok; Topi yetkili paneli 1B ile gelir.
- **İstek:** Fare oyununun yanına yumakla oynama eklenir; oyun tek tip olmaktan çıkar.
- **Tasarım:** `topiMascot.js`'e `TOPI_YARN_SVG_SOURCE` (küçük yün yumağı, iplik ucu, mevcut renk değişkenleriyle; dış görsel yok) ve `createTopiYarn(document, { size })` (`<span class="topi-yarn" aria-hidden="true">`). Ortak seçici `pickTopiToy(random = Math.random) → 'mouse'|'yarn'` ve sıradaki oyunu seçen `createTopiPlaytime(document, { reducedMotion, random })`: her animasyon turu bitince (`animationiteration`) oyuncak değişebilir; aynı oyuncak en çok 2 tur üst üste. Yumak animasyonu `@keyframes topi-yarn-roll`: yuvarlanma ve dönme, Topi'ye doğru gidip patiyle itilmiş gibi geri seker. Hareketi azalt açıkken hiçbir oyuncak oluşturulmaz; panel açıkken oyuncaklar gizlenir (mevcut fare kuralı gibi).
- **Kapsam:** öğrenci başlatıcısı (`homeChatbot.js`, `chatbot.css`) şimdi; yetkili Topi paneli 1B'de aynı `createTopiPlaytime`'ı kullanır (1B brief'ine eklenir; 1B başka dalda olduğu için birleştirmede Claude kontrol eder).
- **YOU OWN:** `src/public/topiMascot.js`, `src/public/homeChatbot.js` (yalnız oyuncak bölümü), `src/public/chatbot.css` (yalnız oyuncak kuralları), `test/topiPlaytime.test.js` (yeni). Faz 5'in 4B görevi de `homeChatbot.js`/`chatbot.css`'e dokunur: 5A önce biter, 4B onun commit'inden açılır.
- **DONE WHEN:** fare ve yumak ikisi de görünür; seçici testleri (sahte `random` ile sıra, 2 tur kuralı, hareketi azalt → oyuncak yok, `aria-hidden`); mevcut `test/homeChatbot.test.js` aynen yeşil; 320 px ve koyu modda gözle kontrol (Claude, tarayıcı önizlemesi).

### 13.2 Görev 5B — Reddedilen belge yeniden yüklenince tekrar istenemiyor (`task/document-rerequest-fix`)

- **Belirti (kullanıcı):** Bir belgesi bir kez reddedilen (yeniden yükleme istenen) öğrenci yenisini yükleyince, yetkili aynı belgeyi **tekrar** isteyemiyor.
- **Kullanıcı teyidi (2026-11-23):** düğme **hiç görünmüyor** (hata mesajı yok). Yani sunucu listede `can_request_resubmission: false` döndürüyor; 409 yolu (şüpheli 2) birincil değil, öncelik görünürlük koşulları (şüpheli 1, 4) ve medya türü/sayfa (`page_order = 0`) koşulları.
- **İlgili kod (okundu, kök neden henüz doğrulanmadı):** düğme görünürlüğü `can_request_resubmission` (`src/server/routes/staffApplicationRoutes.js:224`): yüklenmiş belge için `revision_status === 'submitted'`, `review_status ∈ {pending, under_review}`, `scan_status ∈ {clean, unsafe, failed}`, başvuru `under_review|resubmission_required` ister. Öğrencinin yeniden yüklemesi (`resubmissionUploadRepository.js:160-215`) yeni revizyonu `submitted`, dosyayı `scan_status='pending'`, kaydı `review_status='pending'` yapar ve tarama işi açar. Sunucu yolu `requestStaffDocumentResubmission` → `resolveResubmissionTarget` → `requestCurrentDocumentResubmission` (`applicationReviewRepository.js:237`). Not ekleme `prepareStudentDocumentMessage` yalnız `revisions.status='resubmission_required'` iken ekler.
- **Şüpheliler (önce test ile kanıtlanacak):** (1) yeni revizyonun taraması `pending`'de kalırsa düğme hiç çıkmaz (tarama işi yeniden yüklemede doğru kuyruklanıyor mu, tarayıcı yeni revizyonu işliyor mu); (2) ikinci istekteki koşullu `UPDATE` zincirinden birinin (`changes() = 1`) eski revizyon/not/audit satırı yüzünden 0 dönmesi → 409 `DOCUMENT_REVIEW_CONFLICT`; (3) istemcinin eski `revision_number`'ı göndermesi (liste yenilenmeden); (4) başvuru durumunun yeniden yüklemeden sonra izin verilen kümenin dışına çıkması.
- **YOU OWN:** düzeltmenin dokunduğu sunucu/istemci dosyası (kök nedene göre Claude daraltır), `test/documentRerequestAfterResubmission.test.js` (yeni). Migration yok; gerekirse ayrı karar.
- **Adımlar:** (a) **önce başarısız test**: yerel D1 ile tam döngü: belge yüklenir → yetkili yeniden yükleme ister → öğrenci yeni dosyayı yükler → tarama `clean` sonuçlanır → yetkili listesinde `can_request_resubmission === true` ve ikinci istek 200 döner; ayrıca tarama `pending` iken düğmenin durumu ve kullanıcıya gösterilen açıklama; (b) kök neden; (c) en küçük düzeltme; (d) mevcut belge/inceleme/tarayıcı testleri aynen yeşil.
- **DONE WHEN:** aynı belge en az 3 kez arka arkaya istenip yüklenebilir (test); tarama bekliyorsa yetkili ekranında "Tarama bekleniyor" gibi açık bir neden görünür, düğme sessizce kaybolmaz.

### 13.3 Sıra ve sahiplik

- 5A ve 5B, Faz 1–4 dosyalarıyla çakışmaz (5A: `topiMascot.js`/`homeChatbot.js`/`chatbot.css`; 5B: belge inceleme dosyaları). Dalga 2 ile aynı anda en çok 3 agent kuralı korunur.
- Birleştirme sırası: 5A → 4B (aynı widget dosyaları). 5B bağımsız, hızlı yol adayıdır (migration yoksa).

## 14. Devir notu — 2026-11-23 akşamı kalınan yer (kullanıcı "duralım" dedi)

- **Tarih:** 2026-11-23. **Kaynak:** bu oturumdaki agy çalıştırmaları ve Claude incelemesi. **Durum:** ara durum; hiçbir dal `production`'a merge/push edilmedi, yayın yok.
- **Worktree'ler** (hepsi `/Users/kagansmtdms/Downloads/Проекты/` altında, `node_modules` ana klasöre symlink): `uo-staff-topi-api`, `uo-ykn-auto-pure`, `uo-yoksis-excel-api`, `uo-yoksis-excel-ui`, `uo-ykn-auto-flow`, `uo-document-rerequest-fix`, `uo-staff-topi-ui`.
- **agy istemleri ve çalıştırıcı:** `/Users/kagansmtdms/Downloads/Проекты/uo-handover-2026-11-23/` (`common.txt` + `t-*.txt`; `run.sh <worktree-soneki> <model> <görev-dosyası>`). **Önemli:** headless agy, klasör yeniden adlandırıldığı için dosya okuyamıyordu; `run.sh` her çalıştırmaya yalnız o worktree'ye okuma/yazma ve `~/.gemini` okuma izni veren `--settings` geçirir. Arka planda iki kez başlatma yapılmaz (bir kez iki yazar aynı worktree'ye yazdı; sonuç incelendi, sorun kalmadı).

| Görev | Dal | Durum | Sonraki adım |
|---|---|---|---|
| 1A.0 sözleşme | `task/staff-topi-api` | **commit `daf9350`**, 7/7 test | — |
| 1A Topi sunucu | `task/staff-topi-api` | commit **yok**; kod + testler worktree'de (24/24 yeşildi). Ardından "SQL'i `repositories/d1/staffAssistantRepository.js`'e taşı + isStale" düzeltmesi (`t-1a-fix.txt`) çalıştı, **sonucu incelenmedi** | testleri koş (`node --test test/staffAssistant*.test.js`), `staffAssistantTools.js`'te SQL kalmadığını doğrula, commit `feat(staff-assistant): server route, read-only tools and intent parsing` |
| 2A YKN saf modüller | `task/ykn-auto-pure` | **commit `6938cf7`**, 28/28, hayalet yüz + iptal düzeltmeleri dahil | — |
| 2B YKN bağlama | `task/ykn-auto-flow` (2A'dan) | commit **yok**; worktree'de, tüm YKN testleri 266/266 | **`t-2b-fix.txt` gönderilmedi**: Tek Tık çalışırken otomatik zincirin devreye girmemesi (3 koruma). Sonra incele, commit `feat(ykn): wire automatic search→acceptance→crop→transfer chain`; kullanıcıyla yerel deneme (2B.7) |
| 3A Excel sunucu + migration 0046 | `task/yoksis-excel-api` | **commit `ea6d26e`**, 24/24; ledger kontrolü CI token ister (yerelde koşmadı) | — |
| 3B Excel arayüz | `task/yoksis-excel-ui` (3A'dan) | **commit `7d1dff1`**, 25/25 | gerçek `Ikamet_Islemleri_*.xls` ile yerel sayım doğrulaması (dosya bilgisayarda bulunamadı; kullanıcı koyacak) |
| 5B belge yeniden isteme | `task/document-rerequest-fix` | agy **çalışıyordu** (durdurulmadı, kendi kendine biter); kullanıcı teyidi: düğme hiç görünmüyor; UI kodu doğru, kök neden sunucu tarafında aranıyor | çıktısını incele: başarısız test + kök neden (dosya:satır) + en küçük düzeltme; testleri koş, commit |
| 1B Topi arayüz | `task/staff-topi-ui` (`daf9350`'den, worktree hazır, boş) | **başlatılmadı**; istem hazır `t-1b.txt` | başlat |
| 5A yumak oyunu | `task/topi-yarn-play` | **başlatılmadı**, worktree yok; istem yazılmadı (tasarım 13.1) | istem yaz, başlat (1B'den sonra panele bağlanır) |
| Faz 5 (4A–4D), Bölüm 12 testleri | — | başlanmadı | Faz 1–4 ve 5A/5B bittikten sonra |

- **Açık sorular:** gerçek Excel dosyasının yeri (3B doğrulaması); ~20 pasaport taraması ile yüz bulma ölçümü (2A.1; şimdilik Chrome `FaceDetector`, yoksa zincir durur → elle kırpma); A9 varsayılanı uygulandı (itiraz gelmedi).
- **Devam sırası:** (1) 5B çıktısı ve 1A düzeltmesini incele/commit; (2) `t-2b-fix.txt` + `t-1b.txt` + 5A'yı başlat (en çok 3 agent); (3) hepsi bitince entegrasyon dalında `npm test`, `npm run build:production`, `npm run deploy:dry-run:production`; (4) kullanıcı yerel deneme; merge/yayın ayrı karar.

## 15. Durum — 2026-11-23 akşamı ikinci oturum (Bölüm 14'ün yerine geçer)

- **Tarih:** 2026-11-23. **Kaynak:** bu oturumdaki agy çalıştırmaları, Claude incelemesi, tam test paketi. **Durum:** tüm Faz 1–4 görevleri ile 5A/5B ve 2C tamamlandı, kendi dallarında yerel commit; `production`'a merge/push/yayın **yok**.
- **Yeni kararlar (kullanıcı):** (1) Yüz bulma: Chrome'un yerleşik `FaceDetector`'ı normal Chrome'da yok → **Görev 2C**: MediaPipe `@mediapipe/tasks-vision` **1.2.2** (iki haftadan eski sürüm) + BlazeFace modeli `vendor/mediapipe/` altında, kendi sitemizden `/mediapipe-support/1.2.2/` yolundan, yalnız kırpma gerekince yüklenir (`package.json` değişti). `public/_headers` **değişmedi** (yayın betiği `scripts/ci/worker-upload.mjs` bu dosyayı birebir sabitler). (2) 5B kök nedeni canlı veride (salt okunur) bulundu: düğmesi görünmeyen belgelerin hepsi **onaylı** belgeler → onaylı belgede de "Yeniden Yükleme İste" çıkar; sunucu onayı kaldırma + yeniden istemeyi tek korumalı batch'te yapar, audit'e `previousDocumentStatus: 'approved'` yazar.
- **Dallar ve son commit'ler:** `task/staff-topi-api` 7a3d9fe · `task/staff-topi-ui` adcfcd0 · `task/ykn-auto-pure` 6938cf7 · `task/ykn-auto-flow` 8555c8a (2B + 2C) · `task/yoksis-excel-api` 763c038 · `task/yoksis-excel-ui` 7d1dff1 · `task/topi-yarn-play` 11f9835 · `task/document-rerequest-fix` a8cc9aa.
- **Entegrasyon dalı** `test/combined-2026-11-23` (worktree `uo-integration`, son merge ec74548): `npm test` 2056 test, 0 başarısız (1 atlanan, önceden de vardı); `npm run build:production` ve `npm run deploy:dry-run:production` geçti. Yerel D1 kopyasına (yalnız bu worktree) 0045+0046 uygulandı; `.dev.vars` ana klasörden kopyalandı (okunmadı). Yerel sunucu: `.claude/launch.json` → `integration-2026-11-23` (port 5180).
- **Doğrulananlar:** gerçek Excel yalnız yerelde toplu sayılarla (1972 satır, 1940 başvuru, 31 tekrar satırı birleşti, 1 ret, 39 parti); öğrenci sayfasında fare/yumak sırayla değişiyor.
- **Açık:** (a) kullanıcının yerel denemesi (YKN zinciri 3 öğrenci + yanlış belge; Topi yetkili 5 komut; Excel yükleme ve D1 sayıları; onaylı belgeyi yeniden isteme); (b) yüz bulma doğruluğu bu yerel denemede ölçülecek (canlı sayfaya dış kod yükleme izin denetimince reddedildi); (c) merge/yayın ayrı karar — 3A migration içerdiği için tam yol (preflight → publish), `package.json` değiştiği için de tam yol; (d) Faz 5 (4A–4D) ve Bölüm 12 testleri başlanmadı; 4B, 5A'nın dalından açılmalı.

### 15.1 Kullanıcı yerel denemesi sonrası düzeltmeler (2026-11-23 akşam)

- **Bulgular (kullanıcı):** Topi'nin kaydettiği çalışma saati, açık kalan Çalışma Saatleri ekranının eski "0 saat" değeriyle ezildi (ekran yenilenmiyordu); "bu öğrenciyi siler misin" reddedilmedi, arama sonucuna düştü (yazma yok); sonuçlarda ham `under_review`; Excel ekranında seç/yükle karışıyor; "Kaldığı yerden devam" anlaşılmıyor → **kullanıcı kararı: kaldırıldı** (yarıda kalırsa aynı dosya yeniden yüklenir; sunucu başvuru no ile upsert yaptığı için çift kayıt olmaz).
- **Düzeltmeler:** `task/staff-topi-ui` 6e32f3b (ekran yenileme olayı + Türkçe durum etiketleri), `task/staff-topi-api` 1720bbd (çekimli/kibar sil-arşivle-onayla-talep gönder ret), `task/yoksis-excel-ui` bd03dde (1-2 numaralı adımlar, dosya seçilmeden düğme pasif, devam özelliği kaldırıldı).
- **Entegrasyon** `test/combined-2026-11-23` 23d43f8: 2060 test, 0 başarısız; build ve dry-run geçti. YKN/yüz bulma denemesi YÖKSİS erişimi gelince (2026-11-24 öğleden sonra).
- **İkinci deneme (2026-11-23 19:30):** çalışma saati düzeldi (kullanıcı teyidi). "onu göçe iletildi olarak işaretler misin" arama sonucuna düşüyordu → durum değiştirme/işaretleme/düzenleme/taşıma istekleri de ret (`task/staff-topi-api` 1cd9390). Kullanıcı isteği: "YÖKSİS Eksik Evrak (Beta)" → "(Beta)" kaldırıldı, alt yazı "Günlük Excel ile eksik evrak listesini güncelle" (`task/yoksis-excel-ui` 1e5fcbe). Entegrasyon 71e7610: 2061 test, 0 başarısız; build ve dry-run geçti.

### 15.2 Faz 5 ve Bölüm 12 Aşama 0 (2026-11-23 gece)

- **Yapılanlar (kendi dallarında yerel commit, entegrasyon `test/combined-2026-11-23` e353f74 + çakışma çözümleri):** 4A `task/chat-log-api` 71701fe (migration **0047**, sohbet kaydı + oy ucu; bilinmeyen oturum kimliği aynen yeniden yazılır), 4B `task/chat-log-ui` 4f0348e (Evet/Hayır, 5 dil, oturum kimliği yalnız bellekte, "Hayır" → soru formu), 4C `task/chat-log-staff` 9e8f8d8 (yetkili "Sohbetler": liste, süzgeç, sayılar, okuma, silme, N günden eski silme; silmeler audit'e yazılır), 4D `task/chat-log-privacy` 533e3e1 (KVKK penceresi + Topi gizlilik konusu, TASLAK; **4A ile birlikte yayınlanmalı**), Aşama 0 `task/chatbot-tests-stage0` 0a84db7 (güvenlik ailesi + belge oracle'ı), vaka paketleri `task/chatbot-eval-cases` 12bfa84 (blind-cases-2 150, redteam 100; Argon yazdı), konsol gizlilik düzeltmesi `task/ykn-auto-flow` 40099d2.
- **İnceleme kapısı:** agy Argon salt okunur güvenlik taraması: yeni açık yok; iki orta bulgu önceden var olan koddu (SheetJS CDN — A8; YKN konsol metni → düzeltildi). Kural (2026-11-23): Claude alt ajanı kullanılmaz; incelemeler agy ile.
- **Doğrulama:** entegrasyonda 2116 test, 0 başarısız; build, dry-run geçti; yerel D1'e 0047 uygulandı; 320 px'te Evet/Hayır, teşekkür ve soru formu düğmesi gözle doğrulandı; tur ve oy yerel D1'de.
- **Açık:** (1) gerçek Workers AI ile değerlendirme (tam set + kör set + blind-cases-2 + redteam ≈ 610 vaka) — ücretli, kullanıcı onayı ve yerel günlük bütçe ayarı gerekir (`CHATBOT_GLOBAL_DAILY_LIMIT` 300); (2) YKN zinciri + yüz bulma denemesi (YÖKSİS erişimi, 2026-11-24 öğleden sonra); (3) KVKK metni ofis/hukuk onayı; (4) yetkili "Sohbetler" ve Topi paneli kullanıcı gözüyle (giriş gerekir); (5) yayın: 0046 + 0047 migration ve package.json → tam yol.

### 15.3 Değerlendirme kapısı ve son durum (2026-11-23 gece)

- Gerçek Workers AI değerlendirmesi iki tur koşuldu; ikinci turda Bölüm 12.4 madde 2 eşikleri karşılandı (güvenlik 0, yanlış belge 0, kör setler %94,3 ve %96,6, kırmızı takım %100). Kanıt: [2026-11-23-chatbot-eval-evidence.md](2026-11-23-chatbot-eval-evidence.md). Düzeltme dalı `task/chatbot-quality-fixes` (5faa7c5, da84392). İki kör paket artık kullanılmış sayılır; sonraki kapı için yeni kör paket gerekir.
- Kullanıcı isteği: "Sohbetler" kartı sırayla gelmiyordu → 11. ve 12. kart animasyonu eklendi (`task/chat-log-staff` a792ad6).
- Entegrasyon `test/combined-2026-11-23`: 2127 test, 0 başarısız; build ve dry-run geçti.
- **Yarına kalan (YÖKSİS erişimi gerekir):** YKN otomatik zinciri 3 öğrenciyle (biri yanlış belge), yüz bulma doğruluğu sayımı, Topi'den "şuna YKN ver". Sonra: KVKK metni ofis/hukuk onayı, kullanıcının "Sohbetler" ve Topi panelini gözle denemesi, yayın kararı (tam yol: 0046 + 0047 + package.json).

### 15.4 Sohbet geçmişi yerleşimi ve tarih testi (2026-11-24 sabah)

- **Kullanıcı denemesi:** "Sohbetler" kartı tıklanmıyordu ve Gelen Sorular panelinin içine yığılıyordu. Kök neden: `src/ui/workspaceNavigation.js` `VIEW_TITLES` listesinde `chat-logs` yok; 4C'nin eklediği tıklama yakalayıcısı ana ekranı gizleyip paneli kendi açıyordu. **Karar (kullanıcı):** ayrı kart/sekme/görünüm olmayacak; "Gelen Sorular" panelinin altında **"Topi ile sohbet geçmişleri"** bölümü. Yapıldı: `task/chat-log-staff` ed9f87a (kart, sekme, `#view-chat-logs` ve yakalayıcı silindi; bölüm `#view-inquiries` içinde `#staff-inquiries-manager` altında). Ana ekran yine 10 kart.
- **Tarihe bağlı test (production'da da kırmızıydı):** 2026-11-24'ten itibaren `test/applicationWizard.test.js` içindeki üç test kırmızıydı: sabit doğum tarihi `24.10.2008`, yalnız 2026-11-23'e kadar "son bir ayda 18'e girdi" penceresindeydi. Ürün kodu (`src/shared/age.js`) doğru; testler bugünün İstanbul tarihinden türetilen tarihlere çevrildi (`task/test-relative-dates` c3cdad8, `submissionReadiness.test.js` dahil); altı farklı sahte günde (artık yıl günü, ay/yıl sonu dahil) geçtiği sınandı. Bu düzeltme `production`'a ayrı, küçük bir commit olarak da alınabilir (migration yok).
- Entegrasyon `test/combined-2026-11-23` (merge c3cdad8 sonrası): 2127 test, 0 başarısız; build ve dry-run geçti.

### 15.5 Kaynak seçimi ve sohbet süzgeçleri (2026-11-24)

- **Kullanıcı geri bildirimi:** Gelen Sorular ekranında form soruları ve Topi sohbetleri alt alta durunca hangisinin ne olduğu ancak açınca anlaşılıyordu; daha fazla süzgeç istendi. **Yapılanlar:** (1) `task/chat-log-staff-ui` 2eedd10: ekranın üstünde iki sekme, "Formdan gelen sorular" (yeni soru sayısı rozetiyle) ve "Topi sohbetleri"; aynı anda tek panel görünür, her sohbet satırında "Topi" etiketi; sohbet listesine dil, dönem (24 saat/7 gün/30 gün), metin arama, süzgeçleri temizleme ve "N sohbet" sayısı eklendi. (2) `task/chat-log-filters-api` 46bdf9b: `GET /api/staff/chat-sessions` artık `lang`, `period`, `q` (2–80 karakter, `ESCAPE` ile bağlı parametre, Türkçe İ/ı katlamalı) ve yanıtta `total` verir. (3) Yerel deneme için gerçek form ucundan 8 sentetik soru eklendi (5 yeni, 3 cevaplanmış; yalnız yerel D1).
- Entegrasyon ba7bd02: 2140 test, 0 başarısız; build ve dry-run geçti. Arama LIKE ile tüm turlara bakar; bugünkü hacimde (binler) sorun yok, on binleri geçerse FTS ayrıca düşünülür.

### 15.6 Milestone (2026-11-24)

- **Etiket:** `milestone/topi-ykn-excel-chatlog-2026-11-24` (açıklamalı, yerel; `test/combined-2026-11-23` ba7bd02). İçindeki dal SHA'ları etiket mesajında yazılı. Durum: `production`'a merge/push/yayın yok; 2140 test, build ve dry-run geçti.
- **Neden:** Kullanıcı kararı: YÖKSİS bağlantısı denemesinde sorun çıkmazsa büyük olasılıkla bu sürüm canlıya alınacak; sonraki arayüz değişiklikleri (yan menü) bu noktadan sonradır. Geri dönmek için `git checkout milestone/topi-ykn-excel-chatlog-2026-11-24` (birleşik dal da bu etiketten açılabilir).
- **Canlıya alma adayı = bu milestone** (yan menü eklenirse ayrıca karar): tam yol (0046 + 0047 migration, package.json), her adım kullanıcı isteğiyle.
