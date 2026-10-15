# Production kurtarma hazırlığı ve onay raporu

İncelenen production HEAD: `5db4d049807ab58614702145c0dc30fe1c48f780`. Hazırlık dalı: `tablet/recovery-safety-preparation`. Bu dal kullanıcı onayıyla production tabanlı Draft PR incelemesine hazırlanmıştır. Production merge/deploy veya gerçek backup/restore/rollback yapılmadı. Gerçek veriye erişen hiçbir yeni görev başlatılmadı.

**Tasarım değerlendirmesi:** Aşağıdaki katı kanıt protokolü ilk hazırlık önerisidir; günlük deployment için nihai mimari olarak onaylanmış değildir. Dört authority ve her taze backup’a restore bağı gereğinden ağırdır. [Sade günlük deployment değerlendirmesi ve en kısa yol haritası](daily-deployment-roadmap.md) bu şartların nasıl ayrı bakım sürecine taşınması gerektiğini açıklar. İnceleme/revizyon tamamlanmadan merge önerilmez; mevcut kapılar bugün değiştirilmedi.

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

## 2. Gerçek D1 ve R2 backup prosedürü — çalıştırılmadı

1. Önce yalnız metadata ile hesap planı, D1 Time Travel penceresi, DB boyutu, iki R2 bucket'ın toplam byte/nesne sayısı, lifecycle/lock ayarları ve sürüm sayıları belirlenmeli. Nesne içerikleri/listelerindeki öğrenci adları loglanmamalı. Bu bilgi olmadan maliyet veya RPO/RTO garantisi verilemez.
2. Bağımsız hesapta private backup vault ve ayrı restore account/resources seçilmeli. Ayrı kimlikler, bölge/veri yerleşimi, retention, şifreleme alıcısı ve anahtar escrow'u onaylanmalı. Vault için uygulamanın delete yetkisi olmayan immutable retention/lock kanıtı gereklidir. Üretim deployment token'ının izinleri artırılmayacak.
3. D1 Time Travel, sağlayıcının mevcut recovery point/bookmark mekanizmasıdır; tek başına bağımsız bir SQL export veya R2 kopyası değildir. Gerçek hesap planında kullanılabilir zaman aralığı ve hedef bookmark metadata'sı doğrulanmalı, private manifest'e kaydedilmeli. Bir restore komutu production DB'de çalıştırılmayacak. [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) ve [export](https://developers.cloudflare.com/d1/reference/import-export/) API/CLI sürümü ve gereken izinler uygulanmadan önce doğrulanmalı.
4. D1/R2 için ortak atomik snapshot yoktur. Hazırlanan kanıt şeması en fazla 15 dakikalık **ayrıca onaylanmış quiesced window** ister: uygulama yazımları, cleanup ve ilgili dış üreticiler kontrollü biçimde durdurulmadan tutarlılık iddia edilemez. Bu bir production davranış değişikliği olacağından bu görevde yapılmadı. Kesintisiz alternatif ancak object-version retention ve D1/R2 referans fencing tasarımı ayrı incelenip test edilirse kabul edilebilir; `best-effort` bu gate'i geçmez.
5. Aynı tutarlı pencerede provider bookmark, tüm şema/indeks/trigger'ları ve migration ledger'ı içeren SQL export, tüm ilişkili `DOCUMENTS` ve `PRINT_FILES` nesneleri alınmalı. Nesne içerikleri + HTTP/custom metadata + boyut + SHA-256 + D1 referansları private manifest'e yazılmalı. JSON backup ve silinmiş/retention'a girmiş nesnelerin dahil/haric kapsamı açıkça seçilmeli. Prefix veya eski tarih filtreleriyle sessizce eksik kopya alınmamalı.
6. Veri işlemi, GitHub hosted runner veya Codex workspace yerine izinleri sınırlandırılmış ayrı bulut recovery controller'da yapılmalı. Export ve nesneler streaming authenticated encryption ile vault'a aktarılmalı; plaintext SQL, nesne anahtarları ve manifest yalnız private controller alanında bulunmalı. Anahtarın kendisi Actions/Codex'e gelmemeli. Sıfırdan şifreleme protokolü yazılmamalı; incelenmiş bir araç/managed encryption kullanılmalı. Şifre çözme kaybına karşı bağımsız anahtar kurtarma provası gerekir.
7. Şifreli blob tekrar okunup SHA-256/boyut doğrulanmalı; vault erişimi ve kilit/retention kanıtlanmalı. SQL ve her iki R2 kapsamı eksiksiz doğrulanmadan receipt imzalanmamalı. GitHub'a sadece onaylı metadata receipt gelebilir; veri içeren artifact/log üretilmemeli.

Bu dal, gerçek export/kopya API çağrısı veya bunları çalıştırabilecek kimlikli workflow içermez. Gerçek controller/şifreleme/receipt üreticisi ve metadata teslim hattı onaydan sonraki ayrı uygulama adımıdır; bugün operasyonel backup sistemi hazırmış gibi gösterilmez.

GitHub Actions gelecekte ayrı, reviewer onaylı RecoveryBackup/RecoveryRestore environment'larından yalnız controller işini başlatan kontrol düzlemi olarak kullanılabilir. Tercih kısa ömürlü GitHub OIDC'dir: controller repository, protected environment/ref, exact reviewed workflow/producer SHA, audience ve run durumunu doğrulamadan yetki vermemeli. Kaynak veri token'ları ve decrypt/signing key'leri controller sınırında kalmalı. Bu OIDC/servis bağlantısı henüz uygulanmadı; mevcut workflow'a yeni token/izin eklenmedi. Zamanlanmış gerçek export veya günlük gerçek restore için de sıklık, bütçe ve veri kapsamını içeren ayrı sürekli yetkilendirme gerekir.

## 3. İzole restore planı ve hazır sentetik mekanizma

Gerçek prova, production'dan farklı account'ta önceden onaylı boş D1 ve iki R2 bucket'a yapılmalı. `config/recovery-trust.json` bu hedefleri henüz içermiyor. Restore identity production'a yazamamalı; vault'u silememeli. Worker public route, cron, scanner, print agent, notification ve diğer dış servis bağlantıları bu ortamda bulunmamalı. Varsayılan egress deny ve canlı anahtarların yokluğu kontrol edilmeli. Production verisinin ayrı hesaba kopyalanması için bu adım da açık onay gerektirir.

Restore doğrulaması: decrypted SQL hash/boyut, SQLite `integrity_check`, D1 `quick_check`, foreign keys, şema/index/trigger eşitliği, migration dosya/ledger eşleşmesi, tüm tablo satır sayıları/hash'leri, her R2 nesnesinin byte/hash/HTTP-custom metadata'sı ve tüm D1→R2 referansları. Sayımlar ve hash'ler private raporda kalır; public receipt yalnız raporun aggregate SHA-256'sını taşır. R2 ETag özellikle multipart için içerik SHA-256'sı yerine kullanılmaz. Bir dosya eksik/bozuksa veya side effect açıksa işlem failed sayılır.

SQL import provası, Time Travel bookmark'ının production üzerinde geri alınmasını test etmiş sayılmaz. Provider bookmark'ından başka bir izole DB'ye clone/restore desteklenip desteklenmediği önce doğrulanmalı; destek yoksa bu recovery yolu doğrulanmamış olarak raporlanır ve sırf prova için production restore yapılmaz. Ayrı account aynı provider'ın genel kesintisini de tek başına karşılamaz; provider dışı ikinci kopya istenirse ek erişim, veri yerleşimi ve maliyet onayı gerekir.

Geri yüklenen eski print/notification/scanner işleri otomatik çalıştırılmamalı. Yazılmış olabilecek ama cevabı kaybolmuş print işleri tekrar kuyruğa alınmamalı; idempotency ve `unknown`/`submission_started` senaryoları controller'ın compatibility suite'inde doğrulanmalı. Gerçek production'a dönüş ayrı onaylı operasyon/runbook gerektirir; bu dalda requeue/restore/rollback komutu yoktur.

Hazır script `scripts/recovery/synthetic-restore.mjs` yalnız checked-in 23 migration'ı ve kod içinde oluşturulan sentetik byte'ları kullanır. Kullanıcı SQL dosyası, kaynak bucket/DB veya remote flag kabul etmez; servis credential'ı verilirse durur. Bellek içi SQL export → SQLite restore → ayrı yerel native D1 restore ve dört ayrı yerel R2 binding'inde kaynak/hedef kopya testi yapar. İçerik, metadata, ledger, satır/hash, foreign key, schema ve dış ağ engeli kontrol edilir. Uygulama Worker'ı yüklenmez, cron/print/scanner çağrılmaz. Çıktı `environment: synthetic-local`, `eligible_for_production: false` içerir. Bu bir gerçek bulut restore provası/production recovery kanıtı değildir.

CI sentetik scripti çalıştırır. `.github/workflows/recovery-preparation.yml` ayrıca yalnız manuel ve exact production SHA seçimiyle aynı kimliksiz yerel testi çalıştıracak şekilde hazırlandı. Environment secret, backup artifact veya remote operasyon içermez. Bu workflow bu görevde GitHub üzerinde çalıştırılmadı.

## 4. Worker rollback uyumluluğu

Salt okunur onaylı observer, aktif deployment'ın bütün sürümlerini/yüzdelerini belirlemeli; bu ilk tasarım tek aktif sürüm varsayar, gradual/multiple deployment varsa durmalıdır. Mevcut ve aday rollback version ID'leri provider metadata'sından gelmeli. Her sürümün code+asset paket hash'leri, ilgili reviewed source/config, canlı D1 şeması, migration dosya SHA'ları, runtime secret isim/tipleri, D1/R2 binding'leri, cron'lar ve davranış belirleyen plain-text vars private raporda ilişkilendirilmeli.

`contractFromMetadata` sıralamadan etkilenmeyen hash sözleşmesi üretir: schema `{type,name,sql}`, migrations `{name,sha256}`, secrets `{name,type}`, bindings `{name,type,id}`, cron string'leri, reviewed plain-text vars ve doğrulanmış worker/asset SHA-256'ları. Array'ler deterministik sıralanır; secret değerleri okunmaz. Secret değerinin rotasyonu yalnız metadata ile saptanamaz: bu tasarım değer uyumluluğunu kanıtladığını iddia etmez; rotation/escrow kaydı ve application contract testi ayrıca gereklidir.

Gate, current ve target için schema/migrations/secrets/bindings/crons/vars hash'lerinin tam eşitliğini ister. Bu ihtiyatlı tasarım farklı şemaya rollback'i otomatik olarak uyumlu kabul etmez. Target code/assets farklı olabilir ama her ikisi de immutable version'a doğrulanmış olmalı. İlgili isolated application/print/scanner/no-job-replay test raporu imzalanmalı. Offline verifier raporu tek başına yeniden çalıştırmaz; producer'ın doğru sürümleri gerçekten test etmesi güven zincirinin zorunlu parçasıdır.

Rollback receipt'i exact release SHA, aktif Worker version ID, ayrı target version ID, doğrulanmış backup ID ve restore ID'ye bağlıdır. En fazla 15 dakikalık signed live observation, aktif version/contract ve vault'taki backup receipt/manifest varlığını tekrar doğrular. ID veya contract değişirse preflight durur. Worker rollback D1/R2 verisini geri almaz; ayrıca veri restore etmek için ayrı onay gerekir. Publication kilidi yine koşulsuz aktiftir.

## 5. İmzalı kanıt kaydı ve otomatik doğrulama

Eski unsigned `true` alanları artık başarılı kanıt sayılmıyor. Historical evidence dosyaları değiştirilmedi. Üretim verifier'ı reviewed `config/recovery-trust.json` politikasını ve gerçek saati kullanır; `EVIDENCE_NOW` ile yaş kontrolü aşılamaz. Şu an `enabled:false`, boş public key listesi ve null vault/restore/retention nedeniyle kanıt okunmadan `RECOVERY_POLICY_NOT_APPROVED` ile durur. Başarılı production receipt dosyası eklenmedi.

İleride metadata-only bundle `docs/recovery/production-evidence.json` (veya protected metadata teslim hattının yerel JSON dosyası) üzerinden verilebilir. Dosya normal dosya olmalı, symlink olmamalı ve en fazla 256 KiB olabilir. Ham backup/öğrenci dosyaları için bir giriş yolu değildir. Production workflow evidence adımlarına yalnız non-secret account ID eklenmiştir; deployment credential'ı paylaşılmaz.

Bundle `{schema:1,records:[...]}` biçimindedir. Her record `{key_id,payload,signature}` içerir. Payload alanları `schema,kind,id,issued_at,source,producer_sha,run_id,details` ile sınırlıdır. Source environment/repo/Worker/account/DB/iki bucket kimliklerini taşır. İmza Ed25519 ile `canonical(payload)` UTF-8 byte'larına atılır; object key sırası UTF-16 `.sort()`, array sırası korunur, whitespace eklenmez. `signature` 64-byte imzanın base64 karşılığıdır. `key_id` yalnız reviewed public key/role/producer SHA allowlist'inden kabul edilir; payload'ın run ID'si ve producer SHA'sı imzalıdır. Bilinmeyen alanlar reddedilir; object anahtarı, öğrenci bilgisi, raw SQL, secret veya signed download URL alanı yoktur.

| Role | İmzalanmadan önce zorunlu gerçek doğrulama | Verifier bağlantısı |
| --- | --- | --- |
| backup | Provider bookmark hash'i, SQL boyut/hash'i, iki R2 envanterinin aggregate hash/count/byte'ı, encrypted archive hash/boyut, storage receipt hash, vault ve retention, tutarlı pencere | Capture **ve** verification son 24 saat içinde; issued zamanını yenilemek eski capture'ı güncellemez |
| restore | Aynı backup/manifest, onaylı izole hedef, başlangıç/bitiş, bütün zorunlu kontroller, private report hash | En fazla 30 gün; backup'tan sonra tamamlanmış olmalı; başka backup'ın provası kabul edilmez |
| rollback | Release SHA, current/target version ID, iki metadata contract'ı, backup/restore ID'leri, test rapor hash'i ve test sonuçları | Son 24 saat; source ve fresh observation ile eşleşmeli |
| observation | Canlı version/contract ve vault'taki backup/manifest/storage receipt varlığı, provider okuma sonucu | Son 15 dakika; yeniden imzalamak eski observed zamanını tazelemez |

Başlangıç tasarımı, güncel backup'ın **kendisinin** restore edilmiş olmasını ister. 24 saatlik fresh backup şartıyla birleşince bu genellikle release başına/daily gerçek restore gerektirir; maliyeti ve süresi ayrıca onaylanmalıdır. Daha eski bir drill'in farklı yeni backup'ları kapsadığını gösteren zincir kanıtı bu sürümde yoktur. Backup ve restore için farklı gerçek signing key fingerprint'leri zorunludur; aynı anahtara farklı key ID vermek yeterli değildir.

Dört authority rolünün public key fingerprint'leri birbirinden farklı olmalıdır. Fresh observer ayrıca şifreli archive SHA-256/boyut ve gerçek retention bitişini backup receipt'iyle eşleştirir. Bu ilk schema tek ortak archive/retention modeli kullanır: D1, belgeler ve kısa ömürlü print dosyaları için ortak retention açıkça onaylanmadıkça etkinleştirilemez. Ayrı veri sınıfı süreleri gerekiyorsa component archive/key/retention kayıtları ayrı bir reviewed schema değişikliğiyle eklenmelidir; print verisi sessizce uzun dönem saklanmaz.

İmzalar ancak güvenilir üreticinin beyanını doğrular; tek başına gerçek dosya varlığı veya dürüst bir test çalışmasını matematiksel olarak kanıtlamaz. Bu nedenle imza private key'leri off-runner servis/hardware sınırında tutulmalı; signer sadece reviewed immutable producer SHA ve doğrulanmış başarılı run/provenance için imza üretmeli. Arbitrary JSON imzalayan manuel endpoint olmamalı. Observer vault blob'larını ve mevcut canlı version'ı bağımsız kontrol etmeden receipt üretmemeli. Key/producer revocation allowlist PR'ıyla yapılır. Bu signing/observer servisleri **henüz kurulmuş/doğrulanmış değildir**; test anahtarları yalnız bellekte ve `synthetic-test` source altında oluşturulur, dosyaya/artifact'a çıkmaz ve production CLI tarafından kabul edilmez.

## 6. Erişim, güvenlik ve maliyet onayları

| Onaylanması gereken işlem | Erişim ve güvenlik etkisi | Maliyet/işletim etkisi |
| --- | --- | --- |
| Read-only inventory ve provider izin/limit doğrulaması | Ayrı metadata observer identity; Worker versions/settings/schedule/secret **isim-tipleri**, D1 şema/ledger, vault metadata. Deployment token'a yeni izin eklenmez | D1 metadata sorguları/API çağrıları; hacim tahmini sonrasında bütçe |
| Gerçek D1 snapshot bookmark/SQL export ve R2 kopyası | Ayrı source read/export + R2 read/list identity; export API D1 write-level permission gerektiriyorsa yalnız ayrı identity ve export endpoint allowlist'i incelenerek onaylanmalı. Source silme/değiştirme yetkisi verilmemeli | DB export süre/limitleri, CPU/bellek; R2 GET/LIST/PUT, storage ve varsa network/region transfer ücretleri |
| Ayrı vault, encryption ve retention | Private destination write-only identity; uygulamadan bağımsız delete/lock yönetimi, key escrow. Ek veri kopyası ve uzayan saklama öğrenci/print verileri için ayrıca onaylı olmalı | Saklanan şifreli byte × retention × kopya sayısı, günlük artış; lock yüzünden erken silinemeyen veri maliyeti |
| Gerçek izole restore ve compatibility test | Production'a yazamayan ayrı account D1/R2 write identity; vault read/decrypt yalnız restore servisinde. Çıkış ağı kapalı, dış işler bağlı değil | Her restore'da D1 import/read/write, R2 PUT/GET/LIST, geçici depolama, controller compute ve doğrulama süresi |
| Kontrollü tutarlılık penceresi | Ayrı ve açık production davranış değişikliği onayı; yazım/cleanup/harici üretici durdurma ve tekrar açma prosedürü | Kısa bakım penceresi/iş kesintisi; 15 dakika sınırı aşıldığında başarısız backup |
| Signing/observer servisi ve metadata teslimi | Ed25519 public key + producer SHA pinning, bağımsız backup/restore authority, denetlenebilir servis kimliği. Deployment secret'ları taşınmaz | KMS/signature/secret manager, controller, log ve alarm maliyeti; metadata-only erişim hattı uygulaması |

Bu işlem setleri hiçbirisi bu görevde çalıştırılmadı. Hacim, bölge, hesap planı ve saklama süreleri bilinmediği için TL/USD rakamı veya garanti RPO/RTO verilmez. Formül: toplam tutulan byte + R2 işlem sayıları + D1 import/export/okuma/yazma + compute/KMS + varsa transfer. Her tekrar tam kopya yerine incremental yaklaşım daha ucuz olabilir; ancak chain completeness/deletion/tombstone/restore testleri ayrıca uygulanıp kanıtlanmadan gate'e kabul edilmez. Print için hedef RPO mevcut 15 dakikalık ömürle birlikte seçilmelidir; 24 saatlik günlük kopya yeterli koruma sayılmaz.

## 7. Production release için kalan engeller

- Ayrı kaynak/vault/restore kimlikleri, güvenli hesaplar, encryption/escrow, retention ve RPO/RTO kararları onaylanmış değil.
- Gerçek controller, bağımsız signer/observer ve private backup/metadata teslim hattı uygulanıp doğrulanmalı; reviewed public key ve producer SHA'ları politikaya eklenmeli.
- Onaylı gerçek tutarlı backup, aynı backup'ın izole restore raporu ve exact Worker hedefi için rollback contract testi yapılmalı. Bugün bunların hiçbiri geçmiş sayılmıyor.
- Canlı Worker code/assets sürümünün reviewed kaynakla bağı ayrıca doğrulanmalı. Son metadata preflight'i, canlı Worker kodunun repository HEAD'iyle aynı olduğunu tek başına kanıtlamaz.
- Permission eksikleri deployment token'ını genişleterek kapatılmayacak; her ayrı identity için en dar uygulanabilir izin önce doğrulanacak.
- Hazırlık dalının normal push ve Draft PR açılışı kullanıcı tarafından onaylandı. PR CI sonucu doğrulanmalı; sadeleştirme revizyonu, ayrı merge onayı ve GitHub Production environment üzerinden preflight onayı gerekir.
- Yayın kilidi bu değişiklikle açılmıyor. Tüm recovery kontrolleri geçse dahi gerçek deploy ayrıca reviewed implementation ve açık deploy onayı gerektirir.
- Mevcut release workflow'u hâlâ preflight/dry-run provasıdır. Aynı test edilmiş artifact'ı tekrar build etmeden yayımlayan production yolu ve ona bağlı salt okunur health check, yayın kilidi açılmadan önce ayrıca tamamlanıp incelenmeli.

## Hazırlanan dosyalar

| Dosya/alan | Hazırlanan davranış |
| --- | --- |
| `config/recovery-trust.json` | Kapalı, boş anahtar ve hedef politikası; gerçek trust/config onayı bekler |
| `scripts/recovery/evidence.mjs` | Ed25519, role/producer/source, gerçek saat, kapsam/hash ve çapraz backup/restore/rollback bağlarını doğrular |
| `scripts/recovery/check-evidence.mjs` ve iki mevcut CI evidence guard'ı | Sabit reviewed politika, sınırlı metadata JSON girişi, güvenli hata logu; unsigned kanıta güvenmez |
| `scripts/recovery/contract.mjs` | Metadata fingerprint'leri; eksik/boş envanter ve gerekli D1/R2 binding eksikliği reddedilir |
| `scripts/recovery/restore-checks.mjs` | R2 byte SHA-256, HTTP/custom metadata ve cache-expiry tarih karşılaştırması |
| `scripts/recovery/synthetic-restore.mjs` | Gerçek veri/credential/remote parametre kabul etmeyen yerel sentetik SQL/native D1/R2 testi |
| `.github/workflows/ci.yml`, `recovery-preparation.yml` | Kimliksiz sentetik test adımı ve ayrıca manuel exact-SHA hazırlık workflow'u |
| `.github/workflows/production-release.yml` | Evidence kontrolüne yalnız non-secret account context; publication kilidi korunur |
| `test/recoverySafety.test.js`, `test/ci-release-safety.test.js` | İmza, scope, producer, zaman, eksik/bozuk içerik, izolasyon, drift ve workflow güvenliği regresyonları; eski unsigned başarılı fixture beklentileri kaldırıldı |

## Yerel hazırlık doğrulaması

`node --disable-warning=ExperimentalWarning --test test/recoverySafety.test.js test/ci-release-safety.test.js` imza/provenance, stale/future, scope, unknown-field, missing coverage, yanlış backup/target, bağımsız signer ve rollback drift negatiflerini test eder. `node --disable-warning=ExperimentalWarning scripts/recovery/synthetic-restore.mjs` yalnız sentetik yerel provadır. Üretim veri hacmi, backup blob varlığı, decrypt anahtarı, gerçek cloud restore ve fiziksel scanner/yazıcı bu testlerden doğrulanmış sayılmaz.

Bu görevde elde edilen sonuçlar:

| Kontrol | Gerçek sonuç |
| --- | --- |
| Son kodla tam `npm test` | 1013 test: 1010 başarılı, 0 hata, 3 atlanan |
| Recovery/release odaklı testler | 16/16 başarılı; production scope'ta başarılı receipt üretilmedi |
| Bağımsız sentetik CLI | 42 tablo, 23 migration, 2 R2 nesnesi; `eligible_for_production:false`; SQL tam SQLite integrity ve native D1 quick/FK kontrolleri başarılı |
| Native D1/R2 receipt stability | 20/20 başarılı |
| Scanner / Print Agent | 14 + 45 Python testi başarılı; `pip check` temiz |
| Local D1 / Worker smoke | 23 migration, ikinci apply değişmedi, foreign keys ve sentetik endpoint kontrolleri başarılı |
| Audit / actionlint / diff | `npm audit --audit-level=high`: 0 açık; actionlint 1.7.7 ve `git diff --check` başarılı |
| Production build | Başarılı; mevcut chunk boyutu ve dynamic import uyarıları devam ediyor |
| Hazırlanan backup / rollback CLI | İkisi de beklendiği gibi exit 1, `RECOVERY_POLICY_NOT_APPROVED`; herhangi bir gerçek operasyon yapılmadı |
| Guarded production dry-run | Kimliksiz ve boş izole CLI config ile denendi; mevcut print secret metadata guard'ında durdu. Başarılı sayılmadı; production credential alınmadı |
| Yeni GitHub Actions / gerçek cloud recovery | Draft PR CI sonucu PR üzerinde ayrıca raporlanır; gerçek cloud recovery çalıştırılmadı, veri/erişim onayları bekleniyor |

Üç skip, iki macOS ZIP/CRC okuyucu testi ve gerçek MacBook ClamAV HTTPS entegrasyon testidir. Bu testler başarılı gösterilmedi. Production runtime dosyaları, Wrangler binding/vars/cron yapılandırması ve migration dosyaları bu dalda değiştirilmedi; publication kilidi aktif kaldı.
