# Production kurtarma hazırlığı

Durum: PR #6, yalnız hazırlık ve sentetik test. Production yayın kilidi aktif; gerçek export/kopya/restore/rollback yapılmadı. Bu belge operasyon onayı değildir. Günlük yayın tasarımı [daily-deployment-roadmap.md](daily-deployment-roadmap.md) içindedir.

## 1. Gerçekte bilinen durum

[Preflight 38779923958](https://github.com/kagandms/uluslarasiofis/actions/runs/38779923958) exact SHA ve CI'ı, 427 dosyalı artifact'ı, Cloudflare account/Worker bağlantısını, D1/R2 binding'lerini, iki cron'u, 13 runtime secret ismi/tipini ve 23 migration'ın canlı ledger isimlerini doğruladı. Backup kanıtı aşamasında `Backup evidence must identify production` ile durdu; rollback kontrolü çalışmadı. Bu, güncel bir veri kurtarma kanıtı değildir.

| Mekanizma | Koruduğu/kanıtladığı | Saklama konumu ve eksik taraf |
| --- | --- | --- |
| `backupD1ToR2` | D1 kullanıcı tablolarının satırlarını JSON'a toplama kodu ve sentetik testi var | `DOCUMENTS` → `uluslarasiofis-documents-production`, `backups/production/YYYY-MM-DD/d1-backup-*.json`; `latest.json` pointer değil, ikinci tam kopyadır |
| Günlük otomasyon | `0 0 * * *` UTC cron'unda JSON backup çağrısı; authenticated staff POST yolu da var | Backup hatası yakalanıp loglanıyor. Repoda bağımsız alarm/başarı takibi veya backup lifecycle/retention uygulaması yok; provider lifecycle ayarları bu görevde sorgulanmadı |
| Son JSON metadata kaydı | `docs/production-only-evidence/production-only-backup-evidence.json`: 8 Ekim, 29 tablo, 231 satır | Güncel envanter değildir. Tamamı geçmiş kaydıdır; bugünkü nesne varlığı/okunabilirliği bu görevde kontrol edilmedi |
| Eski SQL ve yerel prova | `docs/physical-deploy-evidence/backup-rehearsal.json`: 8 Ekim, 125067 byte, SHA-256, `0600`, eski local migration provası | SQL dosyası MacBook'taki `.codex/secure-backups/.../production-pre0018.sql` altında kaydedilmiş. Dosya bu cloud ortamında doğrulanmadı; bulut erişimi, güncellik ve R2 kapsamı kanıtlanmış değil |
| R2 belge ve print dosyaları | Production binding'leri mevcut | Nesnelerin bağımsız kopyası, version geçmişi, bütünlük envanteri ve restore kanıtı repoda bulunamadı. Bucket lock/lifecycle/şifreleme durumu bilinmiyor |
| Rollback | Worker sürüm/uyumluluk kanıtını isteyen bir gate var | Onaylı güncel rollback hedefi, code+asset paketi ve başarılı uyumluluk kanıtı bulunamadı |

JSON backup şema/DDL, indeks, trigger ve `d1_migrations` tablosunu içermez. Tablolar ayrı SELECT'lerle okunur; tek tutarlı snapshot/transaction garantisi yoktur. D1/R2 arasındaki referansların aynı andaki durumunu kanıtlamaz. Tüm sonuç bellekte biriktirildiği için boyut/runtime limitlerine de tabidir. Kullanıcı tabloları oturum ve credential hash'leri dahil hassas bilgiler içerebilir: JSON dosyası da hassas yedektir. Aynı production bucket/account'ta bulunması, bağımsız felaket kurtarma kopyası sağlamaz.

`DOCUMENTS` öğrenci belgeleri, fiziksel başvuru içerikleri ve geçici fotoğraflarla birlikte JSON yedeklerini de barındırabilir. `PRINT_FILES` kısa ömürlü yazdırma dosyalarıdır. Mevcut politika başarılı print dosyalarını yaklaşık 15 dakika, hata dosyalarını 60 dakika; kuyruk satırlarını 24 saat tutacak cleanup davranışı içerir. Günlük backup bu aralıkta silinen dosyaları koruyamaz. Yedekleme retention'ı öğrenci/print verilerinin silinme süresini fiilen uzatabileceğinden ayrıca onaylanmalıdır.

D1 backup, harici Apps Script/Sheets verilerini, Azure hesabını, Windows Print Agent kurulumunu/spooler durumunu, scanner PC dosyalarını, tarayıcı depolarını veya Worker secret **değerlerini** korumaz. Bunların kapsam ve bağımlılık envanteri ayrıca tamamlanmalıdır. Secret metadata doğru olsa bile tam hesap kaybında değerlerin nasıl yeniden sağlanacağı, CI'a taşımadan harici secret manager/escrow üzerinden planlanmalıdır. Mevcut Worker, cron, scanner, fiziksel başvuru ve Print Agent davranışı değiştirilmedi; eski Vercel bağlantısına müdahale edilmedi.

## Ayrı bakım süreci

Mevcut `recovery-preparation.yml` bakım için tek giriş noktasıdır; bugün yalnız kimliksiz sentetik test çalıştırır. Gerçek backup/restore ve schedule henüz yoktur. İkinci deployment workflow'u, controller, observer veya dört imza otoritesi kurulmayacak.

Onay sonrası bu aynı bakım sürecine günlük backup ve aylık/değişiklik sonrası restore modları eklenmeli. Metadata güncellemesi mevcut sağlıklı backup ve restore sonuçlarını tekrar kullanabilir; normal kod release'i için yeniden export/restore gerekmez. Hata/gecikme alarmı ve son başarısız bakım koşusunu gizlemeyen sonuç kaydı gerekir. İlk otomasyon sıklığı önerileri 24 saat backup, 30 gün restore; RPO/RTO ve retention kullanıcı kararıdır.

D1: provider planı/Time Travel penceresi ve export izinleri önce doğrulanmalı. Time Travel bağımsız SQL kopyası değildir. SQL; şema, indeks, trigger ve migration ledger'ını içermeli; SHA-256/boyut doğrulanmalı. R2: belge ve print kapsamı ayrı seçilmeli; içerik SHA-256 + HTTP/custom metadata + referans envanteri tutulmalı. D1/R2 atomik snapshot sağlamaz: consistency raporu gerçek backup yöntemini, pencereyi veya version/reference fencing'i ve eksik/geçici nesne davranışını açıklamalı. Her normal deploy için 15 dakika üretim durdurma şartı yoktur.

Gerçek provada production'a yazamayan ayrı D1/R2 kaynakları, kapalı dış ağ/cron/scanner/yazıcı/notification bağlantıları kullanılır. SQL integrity/FK, schema/ledger, satır/hash, nesne byte/metadata ve referanslar kontrol edilir. Eski print işleri tekrar çalıştırılmaz. SQL restore, provider Time Travel restore'unu test etmiş sayılmaz; sırf prova için production restore yapılmaz.

## Tek güvenilir bakım kaydı

`config/recovery-trust.json` schema 2: `enabled:false`, signer/vault/restore hedefleri null. Dolayısıyla bugün başarılı production kanıtı kabul edilemez. Public key ve immutable producer commit SHA onayla sabitlenir; tek Ed25519 bakım anahtarı yeterlidir. Anahtar mevcut runtime/deployment secret'larından türetilmez; ayrı protected Recovery environment veya mevcut managed key kullanılabilir. Yeni servis zorunlu değildir. Gerçek üretici/anahtar/işler henüz kurulmadı.

Producer immutable reviewed commit'ten çalışmalı; uygulamanın her yeni commit'i için producer yeniden tasarlanmaz. Gerçek API/storage ve test sonuçlarını doğrulamadan imza üretmemeli; arbitrary JSON imzalayan bir komut veya sentetik başarı yolunu production'a açmamalı. İmza güvenilen üreticiyi doğrular; içeriğin gerçekten varlığını tek başına yeniden ispatlamaz.

Metadata bundle `{payload,signature}`; payload exact alanları `schema:2,source,producer_sha,run_id,backup,restore,rollback`. İmza canonical JSON UTF-8 byte'ları üzerinde Ed25519'dur: object anahtarları UTF-16 `.sort()`, array sırası korunur, whitespace yok. Signature 64 byte base64'tür. Unknown alanlar, yanlış kaynak/producer/run, bozuk imza, eski/future zaman, eksik kapsam reddedilir. En fazla 256 KiB regular JSON dosyası; symlink yok. Secret değerleri, SQL, öğrenci verisi, nesne anahtarı veya signed URL metadata'ya girmez.

- **Backup:** capture ve gerçek storage verification son 24 saatte; SQL/bookmark/manifest/encrypted archive/storage receipt/consistency report SHA-256, boyutlar, iki R2 kapsamı, vault ve retention. Re-sign eski capture/verified zamanını yenileyemez.
- **Restore:** son 30 günde başarı, izole hedef, test edilmiş eski backup/manifest ID'si, report hash'i ve zorunlu kontroller. Yeni backup ile aynı backup ID'si şartı yoktur. Aynı producer + format/schema/ledger recovery contract'ı gerekir; değişiklikte yeni drill gerekir.
- **Rollback:** exact release SHA, aktif/geri dönüş immutable Worker version ID'leri, son 24 saatte compatibility raporu ve current/target schema/migrations/secret isim-tip/binding/cron/vars hash eşitliği. Code+assets hash'leri ve application/print/scanner/no-replay testleri korunur. Aktif sürüm read-only Cloudflare deployments endpoint'inden gelir; gradual veya belirsiz deployment reddedilir. Secret değerleri okunmaz; rotasyon uyumu ayrıca incelenir.

Release, yalnız `actions:read` ile production bakım workflow'unun **en son** koşusunu seçer. Koşu failed/in-progress ise eski yeşile dönmez. Başarılı doğru repo/ref/workflow koşusundaki tek, süresi dolmamış `recovery-evidence` metadata artifact'ı indirilir; imzalı `run_id` aynı koşuyla eşleşir. İçerik `production-evidence.json` dosyasıdır. Bugünkü sentetik bakım workflow'u böyle artifact üretmez; gate geçmez. Kaynak veri/şifreli backup bile CI artifact'ına yüklenmez. Backup byte'ları ve private manifest onaylı private storage'da kalır.

Release backup veya restore çalıştırmaz. Yeni backup/drill/metadata producer uygulaması onay sonrası aynı bakım workflow'unda tamamlanmalı. Rollback metadata'sı release SHA/aktif sürüm değiştiğinde salt metadata doğrulamasıyla güncellenebilir; SQL export/restore tekrar gerektirmez. Bu son üretim/otomasyon adımı hazırmış gibi gösterilmedi.

## Onay, erişim ve maliyet seçenekleri

| Gerekli karar/onay | En küçük uygulanabilir seçenek | Daha güçlü seçenek / maliyet |
| --- | --- | --- |
| Read-only envanter ve plan/izin doğrulaması | DB boyutu, Time Travel penceresi, R2 toplam hacim/lifecycle; nesne adları/öğrenci verisi loglanmaz | Metadata API/sorgu maliyeti; gerçek hacim bilinmeden fiyat verilmez |
| Gerçek SQL export ve R2 kaynak okuma | Ayrı bakım identity: kaynak D1 export ve iki R2 bucket read/list; mevcut deployment token genişletilmez | D1 export API write-level permission istiyorsa salt export kullanım sınırı ayrıca onaylanmalı; izin adı read demekle varsayılmaz |
| Private yedek hedefi, encryption ve retention | Aynı account'ta production'dan ayrı private bucket, ayrı erişim; backup yazımı ve restore okuması sınırlı; retention/delete yönetimi uygulamadan bağımsız | Ayrı account veya provider hesabı kaybına daha dayanıklı; ilave hesap/transfer/yönetim. Aynı account seçeneği hesap kaybını kapsamaz. Mevcut uygun private storage varsa yeniden kullan; zorunlu yeni KMS/controller yok |
| İzole gerçek restore | Aynı account'ta ayrı geçici D1 ve iki R2 bucket; restore kimliği production'a yazamaz; side effect yok; kontrollü temizleme ayrıca onaylı | Ayrı account daha güçlü sınırdır. Her prova D1 import/read/write, R2 PUT/GET/LIST ve geçici storage/runner maliyeti oluşturur |
| Öğrenci/print verisi kopyası | Belgelerin retention'ı, geçici print dosyalarının kapsamı ve deletion politikası açıkça onaylanır | İlk schema hâlâ print kapsamı ve tek archive retention ister; print'i hariç tutmak/ayrı süre tutmak approved schema/test revizyonu gerektirir. Sessiz kapsam daraltma yapılmaz |
| Tek bakım anahtarı / otomasyon | Ayrı protected Recovery environment, dar backup/restore kimlikleri; producer pinning ve metadata-only sonuç; approved geçici runner/işlem alanı | Mevcut managed signing/encryption varsa kullan. GitHub job kullanılacaksa veri sadece private geçici alanda/stream'de, log/artifact/repo'da değil; key/şifre çözme erişimi sınırlı. Sürekli schedule ayrıca yetkilendirilmeli |

Toplam gider: saklanan byte × süre × kopya sayısı + R2 işlemleri + D1 export/import + kısa ömürlü test compute + varsa transfer/key hizmeti. R2 artımlı backup tam kopyadan ucuz olabilir; chain/tombstone/deletion ve restore doğrulaması olmadan kabul edilmez. Henüz kaynak açılmadı, yeni token/anahtar oluşturulmadı, gerçek veri dışarı aktarılmadı.

## Hazır testler ve sınırlar

Sentetik script checked-in 23 migration ve kodda üretilen fake byte'larla memory SQL → SQLite/native D1 ve iki R2 kapsamı restore eder. 42 tablo, 2 nesne; integrity/FK/schema/ledger/hash/metadata/reference ve outbound deny test edilir. Credential/remote input reddedilir. `eligible_for_production:false`; gerçek cloud restore kanıtı değildir.

Regresyonlar tek imza, bağımsız periyodik drill, değişen format/schema, sahte/eksik/eski kanıt, yanlış run/source, son başarısız bakım, rollback drift, gradual Worker deployment ve artifact no-build/dry-run sınırlarını kapsar. Gerçek PR CI sonucu PR #6'da tutulur; yeni başarı raporları için ayrı doküman üretilmez. Publication lock, mevcut runtime, D1/R2, cron, scanner/Print Agent ve Vercel davranışı korunur.

## Seçilmiş başlangıç politikası ve bekleyen doğrulamalar

`config/recovery-operations.json`: aynı Cloudflare hesabında production’dan ayrı private vault ve izole restore kaynakları seçildi; mevcut resource ID’leri hâlâ null. Günlük tam SQL (şema, migration ledger ve veri), 30 gün retention hedefi ve aylık izole restore kaydedildi. DOCUMENTS kalıcı belgeleri içerir; mevcut otomatik JSON yedeklerinin bulunduğu `backups/` öneki kopyalamadan önce dışlanır. Diğer belgeler sessizce dışlanmaz. PRINT_FILES `include`: canlı cleanup/queue doğrulaması olmadan kapsamdan çıkarılmaz. `execution_enabled:false`, `approval_ref:null`, `monthly_budget_usd:null`, `deletion_policy_approved:false`; başlangıç kararı gerçek operasyon/bütçe/retention-uyumluluğu onayı değildir. Print exclusion ancak canlı inceleme SHA-256'sı ve ayrıca scope onayıyla seçilebilir; mevcut signed evidence gate hâlâ print kapsamı istediğinden gerçek exclusion için onun da reviewed revizyonu gerekir.

DOCUMENTS için `backups/` dışlaması hem tarihli JSON kopyalarının hem `latest.json` dosyasının yeniden arşivlenmesini önler; kaynak dosyaları silmez. Geçici fotoğraf ve süreli receipt dosyalarının 30 günlük retention ile uyumu hâlâ incelenecek. Uygulamanın DELETE/cleanup işlemi private backup kopyasını otomatik silmez. Eski JSON dosyaları kaynakta sonsuz kalırsa yeni günlük kopyaları 30 günle döndürmek, içerdikleri verinin yaşını 30 günle sınırlamaz. Eski JSON için dışlama artık seçildi; temporary prefix ve kaynak retention düzeltmesi ayrıca incelenecek; bu dal hiçbir kaynak nesnesini silmez. Restore sonrası silinmiş verinin tekrar görünmesini önleyen deletion/tombstone kontrolü gerçek provaya dahildir.

Canlı envanter bu hazırlıkta **alınamadı**: Codex'te Cloudflare identity yok; token yalnız Production environment'ta, branch policy yalnız production. Yeni bakım workflow'u henüz production'da kayıtlı değil; merge veya branch policy değişikliği yapılmadı. Token Codex'e taşınmadı. `inventory.mjs` sadece metadata GET ve sabit read-only GraphQL query kullanır; kapasite, policy hash ve aggregate bilgileri döndürür, SQL/nesne içeriği okumaz. Eksik metrik sıfır sayılmaz; Time Travel current bookmark 30 günlük erişim kanıtı değildir. Yeni token istenmiyor; gerçek ölçüm için aşağıdaki minimum Dashboard aggregate bilgileri yeterli başlangıçtır.

15 Ekim 2026'da doğrulanan public fiyatlar: [R2 Standard](https://developers.cloudflare.com/r2/pricing/) storage $0.015/GB-ay, Class A $4.50/milyon, B $0.36/milyon; billing-unit rounding vardır. Free kullanım account genelinde paylaşılır; boş kaldığı varsayılmaz. [D1](https://developers.cloudflare.com/d1/platform/pricing/) Paid storage dahil 5 GB sonrası $0.75/GB-ay, read/write kullanımına bağlı ek bedeller. [Time Travel](https://developers.cloudflare.com/d1/platform/limits/) Free 7 / Paid 30 gün; 30 günlük SQL retention için Paid upgrade otomatik şart değildir. Account planı/hacim, paylaşılan free tier, SQL genişleme oranı ve runner/import kullanımı doğrulanamadığından gerçek aylık toplam **bilinmiyor**. `cost.mjs` 30 tam kopya + aylık restore için ölçülmüş değerlerden R2 hesabı ve açık SQL-expansion varsayımıyla metadata tahmini üretir; D1/runner/vergi/ek hizmetler ayrı, sonuç fiyat garantisi değildir.

Bakım kodu `operations.mjs` onay/bütçe/retention/private vault/izolasyon kontrollerini I/O'dan önce yapar; SQL ve nesne copy/read-back/consistency, restore integrity/schema/ledger/hash/deletion/no-replay sırasını tanımlar. `d1-export.mjs` tam schema+data polling adapter'ını ve signed download'a auth taşımama sınırını hazırlar. Private R2 storage/import adapter'ı, encryption tercihi, signer ve gerçek kapsam kanıtı henüz bağlanmadı; CLI onay sonrasında bile bunlar tamamlanmadan operasyon çalıştırmaz. Varsayılan writer veya üretim success receipt üreticisi yoktur. Fixture I/O sonuçları gerçek backup/restore kanıtı değildir.

## Dashboard’dan gereken minimum bilgi

| Yer | Gereken bilgi |
| --- | --- |
| Workers planı + D1 → production DB → Overview / Time Travel | Free/Paid plan; mevcut DB boyutu; UI’da görünen Time Travel aralığı. SQL export veya restore çalıştırmak gerekmez. |
| R2 → `uluslarasiofis-documents-production` ve `uluslarasiofis-print-production` → Metrics | Aynı tarih/saat için toplam byte/GB ve nesne sayısı; Standard/Infrequent Access sınıfı. PRINT_FILES eksikse maliyet sıfır varsayılmaz. |
| Aynı iki bucket → Settings | Lifecycle silme/sınıf geçişi/yarım upload kuralları: hangi önek, kaç gün; bucket lock varsa kapsam/süre; kural yoksa “yok”. |
| Billing → Usage | Aynı dönem için R2 toplam storage + Class A/B ve D1 storage/read/write kullanımı; kalan ücretsiz kota biliniyorsa miktarı. Bilinmiyorsa “bilinmiyor”. |

Toplu sayaçlar ve kural ekranları yeterlidir; belge listeleri veya öğrenci içerikleri gerekmez. Mümkünse aynı görüntüde ölçüm dönemi de görünsün. `backups/` önekinin ayrı boyutu UI’da görünmüyorsa ek iş gerekmiyor: toplam DOCUMENTS boyutu geçici olarak kapsama göre yüksek bir depolama girdisi olur ve bu varsayım tahminde belirtilir. SQL genişleme oranı ve restore/runner süresi bu ekranlardan ölçülemez; ilk tahminde açık varsayım olarak kalır. Gerçek aylık toplam ve bütçe onayı şu anda yoktur.
