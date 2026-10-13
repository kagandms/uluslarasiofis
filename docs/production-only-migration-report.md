# Production-only geçiş raporu — 8 Ekim 2026

**BLOCKED — Fiziksel Windows Agent v6 UAT ve kurum/ürün sahibi kabulü tamamlanmadı. Staging kaynaklarının ve yerel çalışmaların silinmeye uygunluğu henüz kanıtlanmadı; son silme onayı alınmadı.**

Production güvenlik düzeltmesi ve kapalı deploy tamamlandı. Production-only migration tamamlanmış değildir. Hiçbir staging kaynağı silinmedi; Windows Agent başlatılmadı, fiziksel baskı gönderilmedi, öğrenci yazdırması açılmadı.

## 1. Production güvenlik ve print gate durumu

- [x] Canlı Worker modülü indirildi ve gerçek aktif kod incelendi. Önceki aktif sürüm `b2053e01-a44c-47fd-b26b-306b38466334`; modül SHA-256 `e2336bc1a43efbfe29158bd354273892b7d59aefc815ad7b36e6ad18da1eca44`. `PRINT_ENABLED` kontrolü yoktu.
- [x] `src/server/domain/print-gate.js` merkezi kontrolü route dispatch öncesinde çalışır. Yalnız string `true` yeni print işine izin verir. Eksik, false, boş, büyük harfli, whitespace içeren, boolean ve sayı değerleri kapalıdır.
- [x] Upload-intent/finalize/claim/content/validation-result/submission-started ve gelecekteki bilinmeyen print iş uçları `503 PRINT_DISABLED` ile DB/R2 işleminden önce reddedilir. Status/iş takibi ve yetkili heartbeat/reconcile/result korunur. Cron bu gate'in dışındadır.
- [x] Disabled public status DB/R2 olmasa da 200 ve `available:false` verir.
- [x] `PRINTER_SECRET`, `PRINT_R2_ACCESS_KEY_ID`, `PRINT_R2_SECRET_ACCESS_KEY` aktif Worker'da plaintext'ti. Aynı mevcut değerler tek Worker upload'unda secret_text binding'e taşındı; değerler değiştirilmedi, rotate edilmedi, loga/rapora yazılmadı. Mevcut Agent anahtarıyla reconcile yetkilendirmesi 200 döndü.
- [x] Yerel aktarım sırasında eşzamanlı olarak production vars'a eklenen üç plaintext credential girdisi tespit edilip yalnız bu girdiler kaldırıldı. Diğer yerel değişiklikler korundu.
- [x] Production config `PRINT_ENABLED=false`, açık production cron tanımı ve `secrets.required` içerir. Production deploy/dry-run komutları `--keep-vars` kullanmaz. `predeploy:production` ve `predeploy:dry-run:production` yerel plaintext credential vars'ı ve eksik remote Secret binding'lerini reddeder. Secret değerleri okunarak doğrulanmaz. Ham CLI ile standart preflight'ın atlanması bu korumanın dışında kalır.
- [x] Canlı eski ayar görüntüsünün nedeni belirlendi: production printer_heartbeats boştu. Worker taze ready heartbeat olmadığında protokol 0 varsayarak portrait/3 kopya bildirir. A4 ayrıca PRINT_ENABLE_A3=false ile sınırlıdır. Bu eski kod kanıtı değildir; canlı kod zaten protocol 3 landscape, protocol 2+ 50 kopya, 200 baskı bütçesini içeriyordu.
- [x] 0011–0014 print migration'ları production'da zaten uygulanmıştı; migration çalıştırılmadı. Schema hard ceiling 50 kopya / 1000 impression; production iş bütçesi 200. Protocol 3 fiziksel Windows yön doğrulaması için gereklidir.

## 2. Production deployment sonucu

- [x] `goc`, APP_ENV=production; **8 Ekim 2026 13:45:02 Türkiye saati** deploy edildi.
- Aktif version: `6d9b67ed-675e-4d63-a3ee-460c8162cfba`, trafik %100.
- Deployment: `3eab9951-6626-40f9-800b-8d9534898fa0`.
- Worker SHA-256: `7eed30d20d47825151a76a6c6af8d26b775f8faa2ac0af35d11fef8ddfe681ac`.
- Derlenen Worker ile önceki canlı modül arasındaki inceleme farkı yalnız gate helper, disabled status dönüşü, route gate çağrısı ve dependency yol yorumudur. Diğer server işlevleri aynı.
- Deploy Cloudflare multipart upload API ile mevcut ASSETS'i ve Secret binding'lerini koruyarak yapıldı; yereldeki diğer frontend/eklenti değişiklikleri yayınlanmadı. D1/R2 resource binding'leri, secret adları ve cron tanımları korundu.
- Altı mevcut URL'nin yanıt gövdesi SHA-256'ı deploy öncesi ve sonrası eşleşti.
- Eski gatesiz sürüme doğrudan rollback güvenli değildir. Geri alma gerekirse credential'ları Secret olarak ve gate'i kapalı koruyan incelenmiş bir paket hazırlanmalıdır. Aktif production commit'leri ve önceki kaynak kopyaları korundu.

## 3. GitHub staging branch durumu

- [x] Remote branch'ler: `main` (`9f034e9`), `production` (`16cc28f`), `staging` (`a6c9fd1`). Başka branch staging varsayılmadı; hiçbir branch oluşturulmadı veya silinmedi.
- [x] Açık PR listesi boş. GitHub Actions workflow sayısı 0; aktif production için workflow silinmedi.
- [x] GitHub deployment envanterinin ilk sayfasında 100 tarihsel Vercel deployment kaydı var. Son kayıtlar arasında staging HEAD için Preview deployment bulunuyor. Bunların aktif entegrasyon/deployment bağımsızlığı ayrıca doğrulanmalıdır.
- [ ] Staging geçmişinde production HEAD'e göre 19 farklı commit; `git cherry` üç patch eşdeğerliği olmayan commit gösteriyor (`6042e06`, `38575ad`, `d6f6aff`). Bu, gerekli davranışın current production dosyalarında bulunmadığını tek başına kanıtlamaz. İçerik bazında korunma/aktarım incelemesi silme öncesi tamamlanmalıdır.
- [ ] Branch silme, tracking prune ve workflow/config kaldırma bekliyor.
- Production yerel HEAD `cb6b9a8`; remote production `16cc28f`. Mevcut dirty çalışma ve yeni düzeltmeler commit/push edilmedi. Tek GitHub production akışı henüz tamamlanmadı.

## 4. MacBook staging dosyaları

- [x] Aktif production klasörü `/Users/kagansmtdms/Downloads/Проекты/uluslarasiofis-main`, branch production.
- [x] Ayrı staging worktree `/Users/kagansmtdms/Downloads/Проекты/uluslarasiofis-staging`, branch staging; yaklaşık 429 MB, 55 modified/untracked yol. Migration, mobile-transfer ve physical-intake kaynakları dahil kaydedilmemiş çalışma var. Klasör gereksiz kabul edilmedi ve silinmedi.
- [x] `git worktree list` diğer staging bağlantılı helper worktree'leri de gösteriyor. Bunların sahiplik/içerik/geri dönüş denetimi silme öncesi gerekir; paylaşılan kopyalar otomatik silinmedi.
- [x] İzole inceleme kopyası `/private/tmp/ulof-production-only-20261008` oluşturuldu. Ana klasöre yalnız gate, config, ilgili testler/preflight ve rapor aktarıldı. Kaynak dosyalar aktarılmadan önce karşılaştırıldı; eşzamanlı değişiklikler korunarak ele alındı.
- [x] Production migration'ları, Agent kaynakları, v2–v6 ZIP'leri, testler ve diğer mevcut çalışmalar korundu. Shared env dosyaları ve Windows Agent dosyaları silinmedi.
- [ ] Staging klasör/artefakt/config temizliği bekliyor. İnceleme kopyası da geri dönüş ve gözden geçirme için tutuluyor.

## 5. Cloudflare staging Worker/D1/R2 durumu

- [x] Hesap Worker'ları goc ve goc-staging; D1 production ve staging; bucket envanteri kaydedildi.
- [x] goc-staging, uluslarasiofis-staging ve uluslarasiofis-print-staging mevcut; hiçbiri silinmedi.
- [x] Ayrıca uluslarasiofis-documents-staging ve uluslarasiofis-documents-local bucket'ları bulundu. Kullanıcı silme listesinde olmayan bu kaynaklar otomatik silmeye eklenmedi.
- [x] Staging Worker'ın DB/DOCUMENTS/PRINT_FILES binding'leri staging kaynaklarına bağlı. Dakikalık ve günlük cron mevcut; workers.dev endpoint ve previews etkin.
- [x] Production Worker'ın DB/DOCUMENTS/PRINT_FILES binding'leri yalnız production kaynaklarına bağlı; staging binding referansı yok.
- [ ] Tüm route/domain, token paylaşımı, scanner bağlantıları, içerik-retention ve sağlayıcı entegrasyon bağımsızlığı nihai silme öncesi tekrar doğrulanmalıdır. Secret değerleri karşılaştırılmadı; token iptali/rotasyonu yapılmadı.

## 6. Silinen ve korunan kaynaklar

**Silinen staging/GitHub/MacBook/Cloudflare kaynağı: yok.**

Production config'teki üç plaintext credential girdisi kaldırıldı; credential değerleri Cloudflare Secret binding olarak korundu. Bu credential iptali değildir.

Korunanlar: main/production/staging branch'leri, tüm mevcut worktree'ler, goc ve goc-staging, iki D1, tüm R2 bucket'ları, production secret'ları ve cron'ları, scanner/ClamAV, Windows Agent ve mevcut çalışma dosyaları. Final silme onayı henüz istenmedi; fiziksel UAT ve bağımsızlık kapıları önce tamamlanmalıdır.

## 7. Production regresyon sonuçları

- [x] İlk gate regresyonu RED: 12 testte 8 failure / 4 pass. Düzeltme sonrası ilgili lifecycle/cron/gate testleri GREEN.
- [x] Son tam Node paketi: **669 test, 668 pass, 0 fail, 1 skip**. Skip gerçek ClamAV opt-in entegrasyon testidir; o test bu turda çalıştırılmadı.
- [x] Python print Agent **36/36**, Python scanner **14/14**. Windows driver testleri mock kullanır ve fiziksel UAT kanıtı değildir.
- [x] Aktif production klasörüne aktarım sonrası ilgili 27 Node testi geçti; production build, production dry-run ve secret preflight başarılı. Build mevcut OCR dynamic-import ve chunk-size uyarılarını içerir.
- [x] Değiştirilen scope için git diff --check başarılı. Tüm başlangıç diff'inde src/public/public.css dosyasında önceden mevcut blank-line-at-EOF uyarısı vardı; ilgisiz CSS değiştirilmedi.
- [x] `/`, `/basvuru/`, `/basvurum/`, `/yetkili/`, `/yazdir/`, eklenti metadata endpoint'i 200; mevcut içerikler aynı. Bunlar smoke kontrolleridir; yeni oturumla gerçek başvuru/belge/personel işlem UAT'si bu turda yapılmadı.
- [x] Gerçek print API gate testleri, geçerli mevcut printer credential dahil, altı iş başlatan uçta 503 PRINT_DISABLED; public status available:false; print kuyruğu boş.
- [x] D1 remote SELECT çalışıyor; DB id production ile aynı. Her iki production R2 bucket metadata API'si başarılı. Documents R2'deki son yedek yalnız güvenli metadata alanları çıktı verilerek okundu; belge/credential içeriği raporlanmadı.
- [x] Dakikalık cron gerçek tail gözlemi: `outcome:ok`, exception_count=0. Kuyruk boş olduğundan bu tur yeni nesne silme testi yaratılmadı.
- [x] Önceki production cleanup testi, Projeyi mühendislik açısından analiz chat'indeki `01a11afc-ae4c-7d32-9c92-a306d9596e04` turunun gerçek komut çıktılarından doğrulandı: `failed:pending:present:0:object-present → failed:complete:null:0:object-absent`; `automaticCleanupVerified:true`; sonrasında yalnız sentetik job/nesneler kaldırılmış. İlk başarısız denemenin malformed storage key nedeniyle olduğu sonraki kanıtla düzeltilmiş; bu rapor eski başarısız sonucu güncel durum diye kullanmaz.
- [x] Günlük cron `0 0 * * *` korunuyor. Son production yedek timestamp `2026-10-08T00:00:13.538Z` (Türkiye 03:00:13); 29 tablo, 231 kayıt. Timestamp cron saatine uyuyor; bu tur deploy sonrası yeni günlük invocation gözlenmedi.
- [x] Scanner D1 heartbeat güncel `ready`, ClamAV 1.5.4, signature 28147; scan job aggregate 9 clean complete, 1 failed, 1 stale. Scanner kodu/binding'i değiştirilmedi; yeni gerçek malware/ClamAV UAT çalıştırılmadı.

## 8. Windows Agent v6 production geçişi

- [x] Ayrıntılı plan `windows-agent-v6-production-uat.md` dosyasında hazır.
- [ ] Agent başlatma için ayrı kurum/ürün sahibi izni; doğru production origin, mevcut secret ve tek runner doğrulaması.
- [ ] Gate kapalı protocol-3 heartbeat kontrolü.
- [ ] Öğrenci erişimini açmadan yerel sentetik fiziksel portrait/landscape, kopya ve grayscale/driver testleri; resmi sonuç kabulü.
- [ ] Fiziksel kabulden sonra ayrıca production etkinleştirme izni ve kontrollü sentetik uçtan uca baskı/cleanup testi.
- Agent bu tur başlatılmadı. Öğrenci yazdırması kapalı kaldı.

## 9. Kalan engeller ve sıradaki işlem

1. **Sıradaki açık iş: kurum sorumlusu gözetiminde Windows Agent v6 fiziksel UAT ve sonuç kabulü.**
2. Staging commit'leri ve 55 yerel çalışma yolunun gerekli içeriklerinin production'da veya güvenli geri dönüş kopyasında korunduğu kanıtı.
3. Vercel Preview, route/domain, scanner ve token paylaşımı/retention denetiminin tamamlanması.
4. Production kaynak kodunun GitHub production akışıyla senkronlaştırılması; bu görevde push yapılmadı.
5. Silinecek kesin kaynaklar + production bağımsızlığı kanıtının yeniden sunulması ve son silme onayı.

**PRODUCTION-ONLY MIGRATION COMPLETE yazılamaz. BLOCKED — Fiziksel UAT, korunma/bağımsızlık denetimi ve son silme onayı bekleniyor.**

## Kanıtlar ve teknik referans

Makine okunur deployment, cron, backup, kaynak, inventory ve önceki cleanup kanıtları; RED/GREEN, Node/Python testleri, build/dry-run logları ve canlı-bundle diff `docs/production-only-evidence/` klasöründedir. Hiçbir credential değeri içermez.

Deploy'da ASSETS ve mevcut Secret binding'lerini koruyan metadata alanları Cloudflare'ın [Upload Worker Module API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/) ve [multipart upload metadata](https://developers.cloudflare.com/workers/configuration/multipart-upload-metadata/) sözleşmesiyle doğrulandı.
