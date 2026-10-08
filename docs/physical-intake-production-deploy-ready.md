# Production fiziksel başvuru yayın hazırlığı

**PRODUCTION PHYSICAL INTAKE DEPLOY READY — varsayılan OFF gate ile yayın adayı.**

Bu sonuç kod, migration provası, build ve dry-run hazırlığını ifade eder. Production Worker deploy edilmedi; production migration uygulanmadı; gerçek telefonda production UAT yapılmadı. Tam kullanım açılışı kontrollü UAT kabulüne bağlıdır.

## Git tabanı ve dosya kapsamı

GitHub production HEAD: `16cc28f0ef9e66b925b8e7eb1774c72a2e15b3dd`. Yerel production HEAD: `cb6b9a8ee515ea11cb2f2bd9ab677121567075ea`.

Canlı sistemin kaynak çalışma klasörü bu HEAD'lerin üzerinde commit edilmemiş print, guide ve YKN dosyaları içeriyor. Önceki **49 dosyalık patch production çalışma dosyalarına göre hazırlanmıştı; çıplak Git HEAD'e göre 49 dosyalık bir branch diff'i değildi**. Bu fark gizlenmedi: mevcut production dosyalarının 63 tanesi, byte içerikleri değiştirilmeden, `6123ec3` snapshot commit'ine kaydedildi. Bu commit staging aktarımı değildir ve print/scanner görevlerini değiştirmez. Eski agent ZIP paketleri, rollout arşivleri ve cache dosyaları commit kapsamına alınmadı.

Fiziksel özellik commit'i `c5fe4c0`. Bu commit'in inceleme tabanı `6123ec3` olmalıdır. Production HEAD'e göre toplam branch diff'i snapshot dosyalarını ve yerel HEAD'de önceden bulunan YKN fix'ini de içerir. Production'a kör bir merge yapılmamalı; snapshot'ın mevcut production tabanı olduğu gözden geçirilmelidir.

İlk 49 dosyanın tamamı taşınan davranışın, migration geçmişinin veya testlerin bir parçasıdır; alakasız yeni özellik eklenmedi. Bununla birlikte, hepsi yeni production runtime dosyası değildir:

- 38 dosya: runtime, arayüz, paket/build ve entegrasyon.
- 4 SQL: üçü production'da zaten uygulanmış tarihsel migration, yalnız `0018` yenidir.
- 7 dosya: testler ve test fixture'ı.

Bu görevde sekiz dosya daha gerekti: merkezi sunucu gate'i, erişim/candidate endpoint'i, tek JPEG konteyner doğrulaması, üç test dosyası, migration preflight script'i ve Wrangler'daki OFF ayarı. Son özellik farkı **57 dosya**. Tam liste: `physical-deploy-evidence/feature-files.json`. Production tabanının 63 dosyası bu sayıya dahil değildir.

174 özgün production dosyasının hash'i yeniden karşılaştırıldı: değişen yok. Online manager, online scanner repository, auth, scanner script'leri, print agent ve backup kodu korundu. Wrangler'daki tek özellik farkı `PHYSICAL_INTAKE_MODE: off`; `PRINT_ENABLED`, print binding'leri ve mevcut cron tanımları aynı kaldı. Geçici fotoğraf temizliği mevcut minute cron akışına print temizliğinden sonra eklendi; yeni provider görevi oluşturulmadı.

## Backend ve veri ayrımı

Online akış `applications`, `document_records`, `document_revisions`, `document_revision_files` ve mevcut API'leri kullanır. Fiziksel akış `physical_intakes`, `physical_intake_files` ve `/api/staff/physical-intakes/*` üzerinden çalışır. Online kayıtlar dönüştürülmez, yeniden sınıflandırılmaz veya güncellenmez. İsteğe bağlı `linked_application_id` yalnız doğrulanmış bir referanstır.

Fiziksel kayıt PDF ve öğrenci bilgileriyle oluşturulur; yeni PDF sürümleri immutable saklama anahtarları kullanır. Optimistic version kontrolü eşzamanlı güncellemeleri korur. Soft delete/restore vardır; kalıcı belge silme veya öğrenci verisi migration'ı eklenmedi. Sunucu PDF erişimini ve onayı `finalized + clean` sonucuna bağlar; D1 trigger'ları onay koşulunu ayrıca uygular.

Belgeler mevcut özel `DOCUMENTS` R2 bucket'ındaki `quarantine/<UUID>` anahtarlarıyla saklanır. Public R2 URL kullanılmaz. Boyut, format, sayfa/piksel sınırları, ETag/SHA-256 bütünlüğü ve oturum yetkisi kontrol edilir.

## Varsayılan OFF gate ve kontrollü UAT

`PHYSICAL_INTAKE_MODE` yalnız `off`, `uat`, `on` değerlerini anlamlı biçimde kullanır. Eksik/geçersiz değer OFF olur. OFF, fiziksel kayıt/okuma, QR oluşturma, claim ve telefon yükleme işlemlerini sunucuda engeller. Online başvurular çalışmaya devam eder. Migration henüz yoksa OFF scanner eski online repository'yi kullanır; yanlışlıkla açılan gate ile eksik şema da online scanner'ı bozamaz.

UAT için dört yeni **operator değişkeni** gerekir:

| Değişken | Değer |
|---|---|
| `PHYSICAL_INTAKE_MODE` | `uat` |
| `PHYSICAL_INTAKE_UAT_SESSION_HASH` | Operator'ın seçtiği PC oturumunun candidate digest'i |
| `PHYSICAL_INTAKE_UAT_STARTS_AT` | UTC ISO başlangıç |
| `PHYSICAL_INTAKE_UAT_EXPIRES_AT` | UTC ISO bitiş; başlangıçtan en fazla 3600 saniye |

Digest bir bearer token değildir; mevcut staff cookie'si veya herhangi bir gizli anahtar gösterilmez. Endpoint erişimi kendiliğinden açmaz. Ortak personel hesabı modeli korunur; UAT izni hesap adına değil tek PC oturumuna bağlanır. Aynı hesapla başka bilgisayarda açılan oturum erişemez. Logout, aktif kullanıcı/rol kontrolü, staff idle/session expiry ve UAT bitişi erişimi keser.

Candidate endpoint, özellik OFF olarak deploy edildikten sonra seçilen PC'deki oturumlu, aynı-origin sayfadan çağrılır:

```js
const response = await fetch('/api/staff/physical-access/session', {
  method: 'POST', credentials: 'same-origin'
});
const activation = await response.json();
```

Operator `activation.candidateSessionHash` değerini özel yönetim kanalında kullanır; rapora/loga yazmaz. Cloudflare yönetiminde yalnız yukarıdaki dört fiziksel değişken hazırlanır. Print ayarlarına, mevcut secret değerlerine ve scanner görevlerine dokunulmaz. Bu aktivasyon bu görevde uygulanmadı.

## QR fotoğrafları ve retention

QR 256 bit rastgele, tek claim hakkı olan token taşır. Süresi en fazla **15 dakika**, UAT bitişi daha erkense ona kadar. Token URL fragment'indedir. Telefon claim sonrası fragment'i kaldırır; HttpOnly/Secure/SameSite=Strict cookie alır. Telefonun görüntülediği altı haneli kod yalnız QR'ı oluşturan PC tarafından onaylanabilir. Bu onay olmadan yükleme yapılamaz. Kopyalanmış QR tek başına upload yetkisi vermez; başka PC/personele ait oturum orijinal aktarımı onaylayamaz veya okuyamaz.

JPEG başlığı, segment sınırları, tek görüntü sonu ve piksel sınırı doğrulanır; görüntü sonuna eklenmiş arşiv/ikinci görüntü reddedilir. Dosya 8 MiB; oturum 30 fotoğraf/120 MiB; oturum açma, claim ve upload oran sınırları vardır. Aynı ID + aynı içerik tekrarları idempotent; farklı içerik/oturum ve eşzamanlı çakışmalar reddedilir.

Fotoğraflar `mobile_document_transfer_files` metadata'sı ve özel R2 objeleri olarak kalır. `pending` veya `unsafe/failed` dosyalar PC'ye verilmez. PC temiz dosyayı aldığına dair acknowledgement gönderince R2 objesi hemen silinir; tekrar upload'u önleyen consumed metadata TTL sonuna kadar tutulur. Pencere kapandığında aktarım iptal edilip objeler temizlenir. Süresi dolan oturumlar mevcut minute cron üzerinden her çalışmada 20 oturumluk partilerle temizlenir. Bu nedenle 15 dakika kesin erişim sınırıdır; fiziksel silme cron/backlog ve provider başarısına bağlıdır, kesin 15 dakikalık silme SLA'sı değildir. Gate OFF olsa da migration sonrası temizlik devam eder.

Fiziksel başvurunun kaydedilen PDF sürümleri geçici fotoğraf politikasından ayrıdır: soft delete PDF geçmişini korur, otomatik kalıcı PDF purge eklenmedi. Scan job/audit metadata'sı da fotoğraf gövdesi değildir ve D1'de kalır. D1 yedeği R2 obje gövdelerinin yedeği değildir.

## Mevcut scanner ile çalışma ve gerçek motor kanıtı

Yeni bir scanner servisi/Cloudflare Queue yok. Ek D1 kuyruğu `staff_document_scan_jobs`; view `staff_scan_files` yalnız güncel/finalized fiziksel PDF'leri ve süresi dolmamış mobil fotoğrafları seçer. Eski `document_scan_jobs` ve online repository değişmedi. Combined repository önce online işi, sonra staff işini lease eder. `staff_` job ID ve `physical_`/`mobile_` file ID, mevcut Python parser/wire formatına uygundur. Lease, retry, digest, ETag, stale result ve full scan evidence kontrolleri korunur.

Başlangıçta yerel installed imza `28146` 24 saatlik sınırı aştığı için gerçek test `signature_stale` ile durdu. Bu sınır gevşetilmedi. Resmî veritabanının **ayrı geçici kopyası** güncellendi; çalışan scanner'ın dizini/görevi değiştirilmedi. Mevcut runner + gerçek ClamAV 1.5.4, resmî `28147` veritabanıyla, local HTTPS Worker API üzerinden şu sonuçları üretti:

- Fiziksel PDF: `clean`, dosya erişimi açıldı.
- Telefon JPEG: `clean`, yalnız sahibi PC erişebildi.
- JPEG'e eklenmiş arşiv: sunucu upload doğrulamasında `415`.
- EICAR gömülü fiziksel PDF: `unsafe`, indirme engellendi.

JPEG'e arşiv eklenmesi mevcut motorda `clean` dönebildiği için konteyner sınırı kontrolü eklendi. Scanner komutu/policy'si değiştirilmedi. `--official-db-only` dahil mevcut full scan bayrakları kullanıldı. Main CVD için `sigtool` doğrulaması `Verification OK` verdi. İzole updater detached X509 store uyarıları verdi; mevcut ClamAV doğrulama seçenekleri devre dışı bırakılmadı ve özel/uydurulmuş signature veritabanı kullanılmadı.

Opt-in gerçek fiziksel motor testi:

```sh
RUN_PHYSICAL_REAL_CLAMAV=1 \
PHYSICAL_SCANNER_STATE=/path/to/existing/scanner-installation \
PHYSICAL_SCANNER_SIGNATURES=/path/to/fresh/official/signatures \
node --disable-warning=ExperimentalWarning --test test/physical-scanner-real.test.js
```

Bu test kendi HTTPS endpoint'i, synthetic token'ı ve geçici state dizinini kullanır; production'a istek/job göndermez. Production'da normal agent'ın son heartbeat'i ve gerçek yeni job verdict'i UAT sırasında ayrıca doğrulanacaktır. Son okunan production heartbeat `ready / 1.5.4 / 28147`, `seen_at=2026-10-08T14:35:13.478Z` idi; bu, güncel liveness kanıtı değildir. Aktivasyon öncesinde yeni heartbeat görülmeli. Online backlog çok uzunsa QR TTL dolmadan fotoğraf taraması tamamlanamayabilir; `pending` bypass yapılmaz.

## Migration, yedek ve tekrar uygulama

Production'da üç tarihsel physical migration zaten kayıtlı; tekrar çalıştırılmayacak ve yeniden numaralandırılmayacak. Aynı numaralı print/physical dosyaları farklı tam dosya adlarıyla Wrangler tarafından izlenir. Yeni preflight, tüm geçmişin tam dosya adlarıyla kayıtlı olduğunu ve tek bekleyenin `0018` olduğunu doğruladı.

`0018` yalnız transfer/file kolonlarını, rate-limit tablosunu, supplemental queue/view/index ve approval trigger'larını ekler. Online application tablolarında `UPDATE`, `DELETE`, `DROP` veya yeniden oluşturma yok. Mevcut physical satırlara status değişikliği uygulanmaz; yeni guard'lar gelecekteki onayları denetler. Eski fotoğraflar `pending`, digest yokken erişilemez; migration onları clean ilan etmez.

Raw SQL ikinci kez çalıştırılmaya uygun bir idempotent script değildir: duplicate column ile durur. Desteklenen yol `wrangler d1 migrations apply` ve tam dosya adı kaydıdır. Yerel gerçek Wrangler provasında ilk uygulama başarılı, tekrarında `No migrations to apply` görüldü. Kısmi/manuel uygulanmış şema preflight'ta **BLOCKED_SCHEMA_DRIFT** olur; migration kaydına elle INSERT, dosyayı yeniden adlandırma veya raw SQL'i tekrar yürütme yapılmaz.

Read-only production SQL export yedeği oluşturuldu, özel yerel dizinde `0700`, dosyada `0600` izinleriyle saklandı. Hash ve yol `physical-deploy-evidence/backup-rehearsal.json` içinde; SQL içerikleri Git'e alınmadı. `0018`, bu export'un yerel in-memory kopyasında uygulandı: **32 mevcut tablonun eski kolonlarındaki satırlar aynen kaldı**. Ayrıca populated synthetic verilerde koruma, tracked repeat ve failure rollback testleri geçti. Canlı online yazımlar devam ettiği için cutover'dan hemen önce yeniden export/Time Travel restore point alınmalıdır.

## Kontrollü production UAT için sıra

1. Branch'in runtime snapshot tabanını ve 57 dosyalık feature commit'ini gözden geçir; production'a merge/deploy için ayrı yayın kararı ver.
2. Gate OFF olarak kalırken yeni yedek al, hash/izinlerini kaydet; D1 Time Travel restore point ve mevcut Worker/version/config'i kaydet.
3. `node scripts/check-physical-production-migration.mjs uluslarasiofis-production` yalnız metadata okur. `READY_PENDING` ise yalnız bekleyen `0018` uygulanır; `ALREADY_APPLIED_SKIP` ise tekrar uygulanmaz. Drift varsa dur.
4. Worker'ı OFF gate ile deploy et. Online liste/detay/arşiv, `/yazdir/` mevcut QR/print akışı, print status ve scanner heartbeat için smoke kontrolü yap. Fiziksel API'nin unauthorized/kapalı erişimi reddettiğini doğrula.
5. Güncel production scanner heartbeat `ready`, signature yaşı en fazla 24 saat ve normal agent'ın polling'i doğrulanmış olsun. Mevcut görevi/secret'ı değiştirme.
6. Seçilen PC'de giriş yap; candidate digest al. Operator yalnız bu oturumu, en fazla bir saat için UAT değişkenleriyle etkinleştirsin. Aynı hesabın ikinci PC'sinin fiziksel API/QR erişimini reddettiğini kontrol et.
7. Gerçek telefonun kamera ve galerisinden **sentetik test belgeleri** gönder. Altı haneli kodu orijinal PC'de onayla. Gerçek scanner job'ında ETag/SHA, engine/signature metadata ve `clean` verdict'i görmeden PC import/approve bekleme.
8. Synthetic fiziksel kaydı `UAT-...` öğrenci/test pasaport bilgileriyle oluştur; PDF açma, revision, reject/approve, soft delete/restore ve logout/expired QR kontrollerini yap. Gerçek öğrenci verisi kullanma. UAT kayıtlarını soft delete et; PDF geçmişinin korunduğunu bil.
9. UAT sonunda gate OFF'a döner veya süresi biter. Tüm kabul kontrolleri geçmeden `on` yapılmaz. Herkese normal staff kullanımını açmak, ayrı operator değişikliği ve yayın kararıdır.

## Deploy ve rollback komutları — bu görevde çalıştırılmadı

Yedek dizini Git dışında, özel izinli olmalı. Aşağıdaki mutation komutları yalnız onaylanmış yayın penceresinde:

```sh
# Read-only cutover export; output path must be private and outside Git.
npx wrangler d1 export uluslarasiofis-production --remote --env production --output /private/backup/production-pre0018.sql
node scripts/check-physical-production-migration.mjs uluslarasiofis-production

# Only after READY_PENDING; do not execute raw migration SQL.
npx wrangler d1 migrations apply uluslarasiofis-production --remote --env production
node scripts/check-physical-production-migration.mjs uluslarasiofis-production

npm run build:production
npx wrangler deploy --env production --dry-run --keep-vars
npx wrangler deploy --env production --keep-vars
```

Wrangler config OFF değerini açıkça içerir. `--keep-vars` mevcut remote değişkenleri/secret'ları korumak için kullanılır; config'teki print değerleri yayın öncesi canlı değerlerle karşılaştırılır. Secret put/delete yapılmaz. Staging kaynakları veya agent kurulumları değiştirilmez.

Rollback'in ilk adımı yalnız `PHYSICAL_INTAKE_MODE=off`: yeni fiziksel/telefon işlemleri kesilir; online sistem ve mevcut scanner kuyruğu normal devam eder, geçici temizlik çalışır. Staff lease sonuçları gate kapatılınca reddedilebilir; clean bypass yoktur, online lease'ler bundan etkilenmez.

Kod rollback gerekiyorsa `6123ec3` mevcut production snapshot'ından ayrı temiz checkout oluştur, `npm ci` ve production build/dry-run yap, mevcut print ayarları/secret'ları korunarak `--keep-vars` ile baseline Worker + asset'lerini yeniden yayımla. D1 `0018` tabloları/kolonları yerinde bırakılır; DROP/down migration yapılmaz. Bu additive şema eski online/print koduyla uyumludur.

`wrangler rollback <verified-version-id> --env production` alternatifi yalnız o sürümün çalışan print kodu, asset'leri ve env ayarları doğrulandıysa kullanılabilir. Son Wrangler inventory'sindeki version ID `0814ac13-668d-4682-8d32-38c1047f1242` otomatik güvenli rollback hedefi ilan edilmedi; eski version print ayarlarını da geri alabilir. Tercih kontrollü baseline rebuild + değişkenleri korumadır.

D1 export/Time Travel restore yalnız veri hasarı halinde ayrı kurtarma kararıyla yapılır; tüm DB'yi geri almak sonraki online başvuruları kaybettirebilir. Migration rollback için production DB restore edilmez. R2 objeleri/online belgeleri topluca silinmez.

## Son doğrulama

| Kontrol | Sonuç |
|---|---|
| Tam Node, gerçek fiziksel ClamAV opt-in dahil | 745 test: 744 pass, 0 fail, 1 skip |
| Skip | Eski ayrı opt-in online ClamAV acceptance suite; yeni fiziksel gerçek motor testi çalıştı |
| Scanner Python | 14 / 14 |
| Mevcut Print Agent Python | 45 / 45; mevcut test venv'i, görev değişmedi |
| Native D1/R2 | Node suite içinde geçti |
| Production export + yerel 0018 provası | 32 mevcut tablo, eski satırlarda değişiklik yok |
| Wrangler local migration repeat | İlk uygulama OK, tekrar No migrations to apply |
| Production metadata preflight | READY_PENDING; yalnız 0018 |
| Feature patch check | 57 dosya, error-all whitespace check başarılı; uygulanmadı |
| Production build + dry-run | Başarılı, gate OFF; gerçek deploy yok |
| Production primary files | 174 özgün dosya değişmedi |

Build'de mevcut bundle/dynamic import uyarıları ve yerel dry-run'da print secret değerlerinin olmamasına ilişkin uyarı görülebilir; remote secret-name preflight geçti, secret değerleri alınmadı/değiştirilmedi. Runtime dependency audit önceki port turunda temizdi; dev toolchain dependency yükseltmesi bu göreve dahil edilmedi.

Bu rapor, önceki fiziksel port raporunun yayın hazırlığı açısından güncel devamıdır. Yayın adayı hazır; gerçek production telefon UAT kabulü sonraki kontrollü yayının parçasıdır.
