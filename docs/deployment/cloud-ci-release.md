# Cloud CI ve production release hazırlığı

Durum (24 Ekim 2026): **PR #31 ile baseline güncellemesi merge edildi; exact-SHA run #34 (`864556d652d087a17280d35ef8e352682c333150`, `operation=preflight`) başarılı oldu ve publish adımı atlandı.** Bu çalışma ağacındaki uygulama adayları commit edilmedi ve exact production SHA'sı olarak korumalı workflow'a sunulmadı. `publish` gerçek Worker yayını yapar; bu doküman veya yerel doğrulama deploy yetkisi değildir. Uzak migration ayrıca onaylı operasyondur.

## Çalışan CI tasarımı

`CI` workflow’u production PR’larında, production push’larında ve manuel çalışır. Aynı dosya release provası için reusable workflow’dur. Node 24.19.0, npm 11.9.0 ve Python 3.12.14 kullanır. Action referansları sürüm etiketi yerine doğrulanmış commit SHA’larına sabittir.

Sıra: `npm ci --ignore-scripts` → tüm Node bağımlılıklarında high audit kapısı → iki tam JavaScript koşusu → 20 kontrollü native D1/R2 yarış testi → scanner ve Print Agent Python testleri → yeni boş yerel D1 migration zinciri, ikinci apply, ledger ve foreign-key kontrolü → sentetik Worker smoke → production build ve SHA/config checksum artifact’ı. Her adım başarısızlığında job durur.

CI job’u `contents: read` dışında token yetkisi istemez; checkout credential’ları diskte kalıcı tutulmaz. Job’da Production environment, Cloudflare credential referansı, `secrets: inherit`, remote migration veya deploy komutu yoktur. Production’u yayımlayan başka servisleri tetikleyen API çağrısı da yoktur. `pull_request_target` kullanılmaz. CI için production secret tanımlamayın.

`scripts/ci/local-worker-smoke.mjs`, Git tarafından listelenen kaynakları yeni geçici dizine kopyalar; ignored `.dev.vars`, `.env`, `.wrangler`, yerel öğrenci verileri ve credential profilleri taşınmaz. Geçici XDG config ile kimliksiz çalışır. D1 yerel placeholder kimliğini ve D1/R2 `remote:false` ayarlarını doğrular. Bütün D1 komutları `--local` kullanır. Yeni DB’de tüm SQL dosyalarının tam adları migration ledger ile karşılaştırılır; ikinci apply’da değişiklik olmadığı ve foreign key’ler kontrol edilir. Worker yalnız 127.0.0.1’de açılır. Altı HTML sayfası, bulunmayan kayıt lookup’u, oturumsuz 401, yalnız sentetik draft oluşturma ve owner oturumuyla okuma sınanır. Oturum cookie’si bellekte kalır. Süreç ve geçici veriler sonunda silinir. Test CI runner’ının npm/Python paketleri ve GitHub action indirmeleri için ağ kullanması gerekir; production servisine erişim gerektirmez.

Artifact yalnız CI’daki kimliksiz build çıktısı ve kaynak/config kimliği içindir. **Şu anda yayınlanabilir olarak onaylanmış bir paket veya deployment kanıtı değildir.** Runtime production secret’ları veya D1/R2 verileri artifact’a eklenmez. Artifact saklama süresi yedi gündür.

## Production preflight ve publication davranışı

`Production release (manual)` workflow’u yalnız `workflow_dispatch` ile çağrılır. Push, schedule, workflow_run veya Vercel callback’i tetiklemez. Başlatırken workflow branch’i `production` seçilmelidir. Girdi tam 40 karakter küçük harf commit SHA’sıdır; repository, dispatch branch’i, workflow revision SHA’sı, checkout HEAD ve fetch edilmiş origin/production HEAD eşleşmek zorundadır. Branch adı, kısa SHA, shell metni ve başka repository reddedilir. Girdi shell koduna doğrudan yerleştirilmez.

Bu SHA aynı run içindeki reusable CI’a aktarılır; test başarısızlığında Production environment job’u başlamaz. CI, test edilen build içeriği için SHA ve dosya checksum manifest’i üretir. Production environment onayından sonra protected job güncel production HEAD’i tekrar karşılaştırır, aynı run artifact’ini doğrular ve yalnız gerekli adımlarda Cloudflare environment secret/variable’ını kullanır. Worker binding/cron/runtime secret metadata’sı, D1 migration ledger’ı salt okunur kontrol edilir; sonrasında artifact dry-run ve secret metadata guard çalışır. Production verisi veya secret değeri okunmaz/loglanmaz. Eski yedek kanıtı tazelik ve başarılı restore kanıtı şartını karşılamazsa durur.

`operation=preflight` seçildiğinde bu yol Worker deploy etmez ve migration uygulamaz. `operation=publish` seçildiğinde aynı protected job doğrulanmış exact-SHA artifact'ını production Worker'a yayımlar, aktif version/ayarları yeniden kontrol eder ve salt-okunur health check çalıştırır. Bu gerçek production deploy'dur; yalnız açık kullanıcı isteği ve Production environment onayıyla seçilebilir. Migration, otomatik rollback veya veri restore bu akışta yapılmaz. Prova job'unu branch’in required test check’i yapmayın.

Concurrency `production-release`, `cancel-in-progress:false` ile aynı anda bir release provası yürütür. Uzun süren onay beklemeleri sonraki provayı sıraya alabilir; mevcut run kontrol edilmelidir.

## Sizin tablet üzerinden tamamlayacağınız GitHub ayarları

1. Bu yerel dalı inceleyin; push ve PR açma için ayrıca onay verin. PR base’i `production` olmalı. Production’a henüz merge etmeyin. Mevcut CI zaten Actions’ın çalıştığını ve sabitlenmiş action’ların kullanılabildiğini doğruladı.
2. GitHub UI’dan `Validate` check’inin production için required status check olduğunu doğrulayın. Branch protection API’si bu oturumda 403 verdi; protected branch ve deletion/force-push kuralları görülebildi ancak required check bağımsız doğrulanamadı. Kullanıcı bu ayarın etkin olduğunu bildirdi.
3. `Production` environment’ın yalnız production branch policy’si ve `kagandms` reviewer’ı doğrulandı. Self-review engeli kapalı. Actions secret/variable API’si 403 verdiğinden, kullanıcı tarafından tanımlandığı belirtilen `CLOUDFLARE_API_TOKEN` secret ve `CLOUDFLARE_ACCOUNT_ID` variable değerlerinin environment kapsamını UI’dan doğrulayın. Bunları repository secret/variable’a taşımayın; runtime Worker secret’larını değiştirmeyin.
4. D1 snapshot + SQL export + R2 object backup ve restore prova kanıtlarını; ardından rollback uyumluluk kanıtını gerekli JSON alanlarıyla kaydedin. Gate’in rapor ettiği eksik kapsam veya izin olursa yalnız tam gereken izin/kanıtı tamamlayın; yayın kilidini açmayın.

15 Ekim 2026 doğrulaması: production protected=true; production HEAD `632b2b8ecb34ad60c173a409f61c739caea1ee33`; aynı SHA’daki CI başarılı; aktif ruleset production için deletion ve non_fast_forward engelliyor. Production environment’da production branch politikası ve `kagandms` reviewer’ı görünüyor; self-review engeli kapalı. Actions secret/variable admin API’si bu oturumda 403 verdiğinden `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` varlığını API’den doğrulayamadım. Kullanıcının belirttiği environment değerlerine workflow referans verir; değerleri göstermez. Ayar değiştirilmedi. Vercel’in mevcut otomasyonu da değiştirilmedi.

## Cloudflare preflight ve kimlik kapsamı

Secret değerlerini sohbete, Git’e veya `.dev.vars` dosyasına koymayın. Yeni preflight workflow’u token’ı yalnız GitHub **Production environment secret** `CLOUDFLARE_API_TOKEN` ve account ID’yi `CLOUDFLARE_ACCOUNT_ID` variable olarak kullanır. Workflow bu kimliği henüz çalıştırmadı; Cloudflare erişimi ve izin kapsamı doğrulanmış sayılmaz. Mevcut `D1_ANALYTICS_ACCOUNT_ID` değeri deployment account seçicisi olarak kullanılmaz.

En düşük yetki yaklaşımı:

| İhtiyaç | Yetki / kapsam |
| --- | --- |
| `goc` Worker paketini yayımlamak, mevcut secret ad/tip metadata’sını kontrol etmek | Hedef Cloudflare account’ta Workers Scripts Edit. Token yetkisini bütün hesaplara açmayın. Provider desteklemiyorsa token’ın tek Worker’a sınırlandığını iddia etmeyin; account kapsamı ve ayrı üretim ortamıyla riski sınırlandırın. |
| D1 binding kimliğini salt okunur çözümlemek | Wrangler gerçekten gerektirirse aynı account’ta D1 Read. |
| Mevcut R2 bucket binding metadata’sını çözümlemek | Wrangler gerçekten gerektirirse aynı account’ta Workers R2 Storage Read. Bu, runtime R2 access key’lerini CI’a taşımak için gerekçe değildir. |
| Worker cron ayarlarını korumak | Mevcut Workers Scripts kapsamının schedule API erişimini doğrulayın; ayrı permission talebi gelirse yalnız belgelenmiş gereken kapsamı ekleyin. |
| Özel zone route/DNS değiştirmek | Bu workers.dev hedefi için gerekmez; Zone/DNS/Workers Routes Edit vermeyin. İleride route değişikliği ayrı kapsamdır. |
| Migration ledger salt okunur sorgusu | Release preflight yalnız `SELECT name FROM d1_migrations ORDER BY id` çalıştırır. Cloudflare token’ı bu endpoint’i okuyamazsa yayın durur; D1 Edit izni otomatik eklenmez. Uzak migration release akışında yoktur. |

Token’ı Workers KV, R2 Write/Delete, DNS Edit veya Account Super Admin gibi kullanılmayan yetkilerle oluşturmayın. Wrangler’ın gerçek salt okunur preflight hatası ek yetki gerektiğini gösterirse exact endpoint ve gereken izin gözden geçirilmeli. `wrangler whoami`nin kullanıcı profilini listelemek için istediği ilave User Details/Memberships erişimleri deployment için otomatik olarak gerekli sayılmamalı.

`PRINTER_SECRET`, `PRINT_R2_ACCESS_KEY_ID`, `PRINT_R2_SECRET_ACCESS_KEY`, scanner/Apps Script/personel kimlik secret’ları mevcut Worker’da kalır; production değerlerini GitHub CI’a kopyalamayın. Mevcut print metadata prehook’u korunmalıdır. Bu görevde kimlik eksikliğinden production dry-run tamamlanamaz; guard atlanmaz.

## Gerçek deploy kilidini açacak sonraki değişiklik

Aşağıdakiler tamamlanmadan `preflight-locked` job’u deploy işlemiyle değiştirilmemeli:

1. Production’a girmiş workflow/CI kodu ve exact SHA incelenmiş olmalı; GitHub required checks, environment approval, sınırlı credential ve olası Cloudflare Workers Builds/Git tetikleyicileri doğrulanmalı. Çift publication yolu bırakılmamalı. Vercel bağlantısı ayrıca kapsam kararı olmadan kaldırılmamalı.
2. Onay öncesinde aktif Worker version/deployment ID, secret **ad/tipleri**, D1/R2 binding kimlikleri, cron’lar, güvenli config farkları ve migration ledger/schema metadata’sı salt okunur kontrol edilmeli. Öğrenci satırları ve secret değerleri loglanmamalı. `npm run deploy:dry-run:production` mevcut prehook ile geçmeli.
3. Aynı test edilmiş SHA’dan oluşturulan artifact checksum/manifest’i release review’a bağlanmalı. Mevcut workflow aynı run artifact’ini indirir ve doğrular; dry-run sonrası rebuild çıktısının da manifest eşitliğini kontrol eder. Gerçek deploy implementasyonu daha sonra bu doğrulanmış artifact’i doğrudan yayımlamalı; `latest`, branch adı veya başka run artifact’ı kullanılmamalı.
4. Mevcut secret metadata guard’ı, `goc`, production D1/R2 binding’leri, `PRINT_ENABLED=true`, `PHYSICAL_INTAKE_MODE=on`, physical receipt flag’i, UAT kapalı durumu, print limitleri, scanner ve Windows Print Agent v7/protocol-3 uyumluluğu korunmalı. `* * * * *` ve `0 0 * * *` cron’ları sürmeli. Dashboard vars drift’i config ile karşılaştırılmalı; `--keep-vars` körlemesine eklenmemeli. Wrangler config ve mevcut deploy betikleri bu değişiklikte değiştirilmedi.
5. Ayrı explicit deploy onayı exact repository, SHA, Worker ve değişiklik kapsamına bağlanmalı. Yetkili, onaylı job ancak bundan sonra yayın yapabilmeli. Health check’ler salt okunur olmalı; gerçek öğrenci başvurusu, notification veya fiziksel print job’u üretmemeli.

## Migration ve rollback güvenliği

CI yalnız yeni geçici yerel D1’de migration çalıştırır. Release her seferinde otomatik uzak migration çalıştırmamalıdır. 23 SQL dosyasının tam adı/hash’i ile ledger karşılaştırması gerekir; tekrarlanan sayısal önekler dosya adını kısaltma gerekçesi değildir. Eski `check-physical-production-migration.mjs` 0018’i son dosya gibi yorumluyor; güncel 0019–0023 varken genel release kapısı olarak kullanılmamalı.

Production migration gerekiyorsa veri etkisi ve eski/yeni Worker şema uyumluluğu incelenmeli; tutarlı SQL backup ve D1 recovery noktası, güvenli bulut saklama/retention ve restore provası kanıtlanmalı. Mevcut günlük D1→R2 JSON yedeği korunur; transaction snapshot/SQL recovery veya test edilmiş RPO/RTO yerine geçmez. MacBook’ta kalan eski SQL backup dosyası bulut kurtarma planı değildir. Expand/contract ve veri koruyan ileri düzeltme tercih edilmeli. Production veri yazımı için ayrı onay ve ayrı credential gerekir.

Preflight için `docs/production-only-evidence/production-only-backup-evidence.json` içinde üretim D1 snapshot, SQL export ve R2 object yedeği 24 saatten yeni, benzersiz provider `backup_id` ile doğrulanmış olmalı; başarılı D1/R2 restore drill son 30 gün içinde olmalı ve kanıt URL’si ya da SHA-256 içermeli. 23 Ekim 2026 16:13 UTC tarihli güncel kanıt bu gate'ten geçti. R2 recovery copy aynı Cloudflare hesabındaki mevcut print bucket'ında; bağımsız hesap yedeği değildir. `rollback-compatibility.json` ayrıca mevcut/rollback Worker version ID’leriyle şema, runtime secret ad/tipleri, D1/R2 binding ve cron uyumluluğunu belgelemeli; kanıt 24 saatten eski olmamalı. Bu kanıt dosyaları gerçek backup/restore veya rollback doğrulamasının yerine geçmez.

Otomatik rollback workflow’u eklenmedi. Eski gatesiz sürüme kör dönüş güvenli değildir. Rollback öncesinde eski/yeni şema, secret ad/tipleri, gate’ler, cron’lar, bindings ve asset paketi uyumluluğu incelenmeli. Mevcut güvenli sürüm ID’si/paketi korunmalı; yalnız onaylanan uyumlu sürüme ayrı manuel job ile dönülmeli. Worker rollback D1’i veya R2 nesnelerini geri almaz; DB restore ayrı veri operasyonu/onaydır. Uyumlu eski sürüm yoksa güvenli ileri düzeltme uygulanmalı.

## Yerel tekrar komutları

```sh
npm ci --ignore-scripts
npm audit --audit-level=high
npm test
npm test
npm run test:receipt-stability -- 20
npm run ci:local
npm run build:production
```

Python 3.12 izole venv’de iki requirements dosyası kurulup `pip check`, `unittest discover -s test/scanner` ve `unittest discover -s scripts/print_agent` çalıştırılmalı. Python üst paketleri mevcut requirements’ta sabit; bütün transitif bağımlılıklar hash’li lock ile sabitlenmiş değildir. Fiziksel Windows yazıcısı veya canlı ClamAV işletimi bu offline testlerden çıkarılamaz. MacOS ZIP okuyucu ve opt-in gerçek ClamAV testlerinin skip durumu ayrıca raporlanmalıdır.
