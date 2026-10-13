> Bu hazırlık raporu aktivasyondan önceki durumu kaydeder. Güncel durum **GO-LIVE SUCCESS**; [production aktivasyon raporuna](../production-go-live-v7/report.md) bakın.

# Production v7 — yetkili tek belgeli UAT güvenlik incelemesi

8 Ekim 2026. **Yerel güvenlik incelemesi PASS; production deploy açık onay bekliyor.**

**BLOCKED (canlı uçtan uca UAT için):** İncelenmiş kod production'a deploy edilmedi ve production v7 `ready / settings_protocol=3` heartbeat henüz yok. Fiziksel iki kopya engeli kaldırıldı. PRINT_ENABLED=false korunuyor; bu çalışma job, belge yüklemesi veya fiziksel baskı göndermedi.

## Fiziksel kabul ve mevcut production

- [x] Kullanıcının Antigravity üzerinden onayladığı Test A: A4 Portrait, 1 kopya — PASSED.
- [x] Test B: A4 Landscape, 1 kopya — PASSED.
- [x] Test C: A4 Portrait, 2 kopya — PASSED; spooler Job #208, tek işte tam iki fiziksel çıktı.
- [x] Kullanıcı scanner/ClamAV ve Windows yazıcı varsayılanlarının korunduğunu onayladı. Bu görevde fiziksel test tekrar edilmedi.

Son read-only production kontrolü: **2026-10-08 12:54 UTC / 15:54 Türkiye**. Worker `goc`, aktif sürüm `0e8dec4b-4cd2-40f6-ac1c-0879954a261d` (%100). Aktif kuyruk **0**, toplam print satırı **0**, UAT rezervasyonu **0**, printer heartbeat henüz **yok**. `PRINT_ENABLED=false`, 50 kopya / 200 page-copy bütçesi korunuyor. A3, color ve duplex flag'leri false. Mevcut orientation/protocol-3 desteği canlı Worker kaynak incelemesinde ve önceki 21 API/gate testinde doğrulandı; iki yüz fiziksel kaynak sayfası değil, `page_count × copies` bütçesi uygulanır.

D1 `uluslarasiofis-production`, PRINT_FILES R2 `uluslarasiofis-print-production` ve mevcut DOCUMENTS R2 kaynağı korundu. Dakikalık `* * * * *` ve günlük `0 0 * * *` cron'ları canlı metadata'da mevcut. `PRINTER_SECRET`, `PRINT_R2_ACCESS_KEY_ID`, `PRINT_R2_SECRET_ACCESS_KEY` ve **R2_ACCOUNT_ID** production'da `secret_text`; yalnız binding ad/tipleri okundu. Sonuncusu yerel config'te görünse bile deploy sırasında mevcut remote secret binding olarak korunmalı. Secret değerleri alınmadı, değiştirilmedi veya rotate edilmedi.

Kanıt: [son production read-only kontrolü](security-review/final-live-readonly.json), [binding metadata](security-review/binding-metadata.json). Önceki HTTP smoke/gate kontrolleri [http-probes.json](http-probes.json) içindedir; son kontrol bunları tekrar baskı isteğiyle çalıştırmadı.

## İlk patch'teki bulgular ve düzeltmeler

İlk taslak [initial-review.patch](security-review/initial-review.patch) olarak saklandı. Üç başarısız güvenlik testi [red.log](security-review/red.log) içinde:

1. Public status'u yetkilendirmeye bağlamak normal 200/available:false sözleşmesini bozuyordu. Public endpoint eski davranışını koruyor; yetkili capability için ayrı `/api/staff/print/uat/status` eklendi.
2. Signed R2 upload URL'si, oturum iptal edildikten sonra da bearer yetkisi taşıyordu. UAT yüklemesi artık Worker üzerinden gerçek personel oturumuyla yapılır; signed URL üretilmez. Gövde ve hash okunmasının ardından oturum, pencere ve intent yeniden doğrulanır; R2 yazımından hemen önce son süre kontrolü vardır.
3. Tarih/hash tabanlı slot, pencere değişince veya print satırı purge edilince ikinci iş açabiliyordu. Sabit `staff-print-uat-v7` rezervasyonu mevcut D1 `audit_events` tablosunda atomik `INSERT ... ON CONFLICT DO NOTHING RETURNING` ile tutulur. Print satırı silinse ve yeni pencere açılsa bile ikinci iş hakkı doğmaz.

## İstenen 10 güvenlik şartı

| Şart | Yerel sonuç ve kanıtlanan davranış |
|---|---|
| 1. PRINT_ENABLED=false / öğrenci | PASS. UAT kapalı veya geçersizse mevcut 503 gate; aktif UAT'ta anonymous/student cookie/forged staff cookie/bearer veya public bypass header iş oluşturamaz. |
| 2. Mevcut sunucu tarafı staff session | PASS. D1 üzerinden mevcut reviewer/admin oturumu, shared staff kimliği, aktif kullanıcı, iptal, idle ve expiry denetlenir. Yeni hesap veya farklı auth sistemi yok. |
| 3. Gerçek SHA-256 | PASS. Worker gerçek byte'ların SHA-256'sını yükleme **öncesinde**, finalize ve Agent content tesliminde hesaplar. İstemci hash alanı kabul edilmez; dosya adı güven kaynağı değildir. Yanlış PDF R2'ye yazılmaz. |
| 4. En fazla 15 dakika | PASS. Canonical UTC ISO başlangıç/bitiş, server clock, 15 dakika üst sınır; eksik, malformed, ileri başlangıç ve expired pencere fail-closed. Hash/stream ve son D1 lookup sırasında expiry test edildi. Intent/queue/claim/ready/submission geçişleri ayrıca D1 clock deadline koşulu taşır. |
| 5. Toplam 1 iş / 1 kopya | PASS. Kalıcı atomik rezervasyon, eşzamanlı farklı oturum/token denemelerinde tek kazanan. UAT yalnız PDF/A4/monochrome/simplex/1 copy; Agent gerçek page_count=1 doğrulaması. Aynı intent retry ikinci satır açmaz; window değişimi, row purge ve cleanup yeni hak vermez. |
| 6. Bütün oluşturma/yükleme aşamaları | PASS. Intent, Worker PUT ve finalize sunucu tarafında staff-authenticated. PUT ayrıca upload token, reserved job ID, exact media type/size ve fixture hash ister. `/api/public/.../upload` adı erişimi public yapmaz; merkezi gate ve handler gerçek session ister. Machine uçları mevcut PRINTER_SECRET auth'unu korur ve yalnız rezervasyon job'ını işler. |
| 7. CSRF/session/replay/expiry | PASS. Same-origin POST/PUT/finalize, eksik/yanlış Origin, yanlış token, iptal/idle/inaktif/expired session; stream sırasında iptal, expire sırasında finalize; parallel/replayed PUT ve bütün expired mutation aşamaları test edildi. R2 conditional PUT mevcut nesnenin üzerine yazmayı engeller. |
| 8. Public status | PASS. Anonymous `GET /api/public/print/status` **200, available:false** kalır; active UAT bunu true yapmaz. `/yazdir/` normal public UI kapalı kalır. |
| 9. Kapatma ve cleanup | PASS. PRINT_UAT_ENABLED=false veya pencere sonu yeni work'u kapatır. Job ve dosya mevcut retention/cleanup akışındadır. Minimal audit rezervasyonu kalır; otomatik reset yok. Authenticated heartbeat/reconcile/result recovery korunur. |
| 10. Diğer production sistemleri | PASS (kaynak/regresyon incelemesi). Scanner/ClamAV/application işlevleri, kaynaklar ve cron davranışı değiştirilmedi. Mevcut frontend değişiklikleri bu deploy kapsamına alınmamalı. Gerçek ClamAV servisi çalıştırılmadı. |

Sınırlar: Bir intent rezervasyonu aldıktan sonra hata/crash olsa bile tek UAT hakkı tüketilir; fail-closed tasarım bilinçlidir. İptal/başarısız deneme sonrası ikinci UAT için otomatik pencere/reset mekanizması yoktur. Audit marker'ını silerek tekrar denemek bu yetkilendirmeye dahil değildir. Süre sonu başlamış Windows spool işini fiziksel olarak geri alamaz; yeni claim/submission kapanır, belirsiz submission otomatik tekrar basılmaz.

## Gerçek kaynaklara uygulanan kapsam

Güncel [staff-uat-review.patch](staff-uat-review.patch) gerçek ana kaynaklara uygulandı; [review-manifest.json](review-manifest.json) baseline/proposed SHA-256 değerlerini içerir. `review/` güncel kaynak kopyasıdır. Patch Git HEAD'e göre değil, bu görevden önceki mevcut kaynak baseline'ına göre üretilmiştir; kullanıcıya ait paralel değişiklikleri içermez.

- Domain/service: `print-uat-policy.js`, `print-access.js`, `print-uat-job.js` — sıkı pencere, staff gate, fixture ve job kısıtı.
- D1: `print-uat-repository.js`, `printRepository.js` — kalıcı atomik rezervasyon ve database deadline koşulları; migration yok.
- Routes: `print-uat-routes.js`, `printRoutes.js`, `printerRoutes.js`, `worker.js` — authenticated Worker upload, dedicated private status, hash ve protocol/job kontrolü.
- Config: yalnız production vars'a `PRINT_UAT_ENABLED: "false"` eklendi. Başlangıç/bitiş/hash ayarlanmadı.
- Test: `print-uat.test.js`, `printUatStorage.test.js`; mevcut cleanup testinin takvimden bağımsız gelecek purgeAfter fixture düzeltmesi. Cleanup runtime değiştirilmedi.

Canlı ve aday Worker top-level AST karşılaştırmasında 471 declaration aynı, 7 mevcut print/router declaration değişmiş; mevcut declaration silinmemiş. Eklenenler UAT yardımcılarıdır. Scanner, başvuru ve günlük backup declaration'larında değişiklik görülmedi. Bu inceleme [worker-ast-diff.json](security-review/worker-ast-diff.json) içindedir; runtime E2E yerine geçmez.

## Testler ve build

| Çalıştırma | Sonuç |
|---|---|
| Tam `npm test` | **701 toplam: 700 PASS, 0 FAIL, 1 SKIP** — gerçek ClamAV opt-in entegrasyonu atlandı |
| UAT davranış testleri | **29/29 PASS** — tam pakete dahil |
| Native local Workers R2/D1 | **2/2 PASS** — conditional PUT tek nesne ve D1 dört parallel reservation tek kazanan; production kaynaklarını kullanmaz |
| Windows Agent Python unittest | **45/45 PASS** |
| Scanner Python mock unit | **14/14 PASS** — scanner/ClamAV servisine dokunulmadı |
| Production secret metadata preflight | **PASS** — secret değerlerini okumaz |
| Production build + `deploy:dry-run:production` | **PASS** — `--dry-run: exiting now`, deploy yapılmadı |

Güncel loglar [security-review](security-review/) klasöründe. Local dry-run, remote secret değerlerini yerel ortama getirmediğimiz için required-secret uyarısı verir; remote binding metadata preflight başarılıdır. Mevcut dynamic-import/chunk-size build uyarıları da sürer. Bunlar build başarısızlığı değildir; gerçek production Agent secret eşleşmesi henüz heartbeat ile kanıtlanmadı.

## Deploy onayı sonrası sıra — henüz çalıştırılmadı

1. Açık production deploy onayı alınır. Aktif Worker sürümü/binding/cron yeniden okunur; beklenen sürüm değişmişse fark yeniden incelenir.
2. Yalnız incelenmiş Worker modülü deploy edilir; mevcut asset deployment, tüm remote secret binding'leri, D1/R2 ve cron'lar korunur. Dirty checkout'taki genel frontend asset paketini yükleyen standart deploy komutu bu dar onayın kapsamına girmez. PRINT_ENABLED=false ve PRINT_UAT_ENABLED=false kalır; pencere/hash verilmez.
3. Worker sağlık smoke: `/`, `/basvuru/`, `/basvurum/`, `/yetkili/`, `/yazdir/`; public print status 200/false; anonim intent/finalize/PUT ve claim kapalı. Geçersiz ID/gövde kullanılır, gerçek belge gönderilmez. Sonrasında queue/print-row sayısı 0, kaynak/cron/binding metadata aynı doğrulanır.
4. [Antigravity Windows talimatı](antigravity-windows-start.md) ile yalnız production heartbeat doğrulaması yapılır. 200 ready/protocol-3 heartbeat, taze seen_at, tek runner; kapalı claim'de 503 beklenir. Henüz belge gönderilmez veya otomatik başlangıç kurulmaz.
5. Bundan sonra **ayrı açık tek-belgeli UAT izni** gerekir. Yetkili oturumdaki operatör dedicated staff status ve intent → authenticated Worker PUT → finalize API akışını kullanır. Public `/yazdir/` UI bu UAT için açılmaz. Client tarafı bypass veya doğrudan D1/R2 job ekleme yoktur.
6. İzinli UAT ayarları: global false, UAT true, <=15 dakikalık canonical UTC timestamps ve fixture SHA. ZIP'teki `same-portrait-source.pdf` (bir sayfa) hash: `bbb32becd02165be13ef8f62075741ed5999a46cdb1c4495c7c40c30177b4d0d`. Bir kez A4 landscape/mono/simplex/1 copy seçilir; hash byte'lardan doğrulanır.
7. E2E ve tek fiziksel çıktının kabulünden sonra UAT kapatılır; mevcut retention işler. General public aktivasyon ve Windows otomatik başlangıç ayrıca açık karar gerektirir. Bu görev PRINT_ENABLED=true kararını vermez.

**Sonraki açık madde: incelenmiş Worker için production deploy onayı.** Production E2E READY ilanı ancak onaylı deploy, kapalı sağlık testleri ve v7 production heartbeat sonrası yapılabilir. Staging kaynaklarına dokunulmadı.
