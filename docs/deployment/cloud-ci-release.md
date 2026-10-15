# Cloud CI ve production release hazırlığı

Durum: **yerel incelemeye hazır; GitHub’a push edilmedi, yayın kilitli.**
Bu değişiklik bir production deploy yetkilendirmesi değildir. Gerçek uzak migration ve rollback de ayrı onaylı işlemlerdir.

## Çalışan CI tasarımı

`CI` workflow’u production PR’larında, production push’larında ve manuel çalışır. Aynı dosya release provası için reusable workflow’dur. Node 24.19.0, npm 11.9.0 ve Python 3.12.14 kullanır. Action referansları sürüm etiketi yerine doğrulanmış commit SHA’larına sabittir.

Sıra: `npm ci --ignore-scripts` → tüm Node bağımlılıklarında high audit kapısı → iki tam JavaScript koşusu → 20 kontrollü native D1/R2 yarış testi → scanner ve Print Agent Python testleri → yeni boş yerel D1 migration zinciri, ikinci apply, ledger ve foreign-key kontrolü → sentetik Worker smoke → production build ve SHA/config checksum artifact’ı. Her adım başarısızlığında job durur.

CI job’u `contents: read` dışında token yetkisi istemez; checkout credential’ları diskte kalıcı tutulmaz. Job’da Production environment, Cloudflare credential referansı, `secrets: inherit`, remote migration veya deploy komutu yoktur. Production’u yayımlayan başka servisleri tetikleyen API çağrısı da yoktur. `pull_request_target` kullanılmaz. CI için production secret tanımlamayın.

`scripts/ci/local-worker-smoke.mjs`, Git tarafından listelenen kaynakları yeni geçici dizine kopyalar; ignored `.dev.vars`, `.env`, `.wrangler`, yerel öğrenci verileri ve credential profilleri taşınmaz. Geçici XDG config ile kimliksiz çalışır. D1 yerel placeholder kimliğini ve D1/R2 `remote:false` ayarlarını doğrular. Bütün D1 komutları `--local` kullanır. Yeni DB’de tüm SQL dosyalarının tam adları migration ledger ile karşılaştırılır; ikinci apply’da değişiklik olmadığı ve foreign key’ler kontrol edilir. Worker yalnız 127.0.0.1’de açılır. Altı HTML sayfası, bulunmayan kayıt lookup’u, oturumsuz 401, yalnız sentetik draft oluşturma ve owner oturumuyla okuma sınanır. Oturum cookie’si bellekte kalır. Süreç ve geçici veriler sonunda silinir. Test CI runner’ının npm/Python paketleri ve GitHub action indirmeleri için ağ kullanması gerekir; production servisine erişim gerektirmez.

Artifact yalnız CI’daki kimliksiz build çıktısı ve kaynak/config kimliği içindir. **Şu anda yayınlanabilir olarak onaylanmış bir paket veya deployment kanıtı değildir.** Runtime production secret’ları veya D1/R2 verileri artifact’a eklenmez. Artifact saklama süresi yedi gündür.

## Production provası neden deploy edemez?

`Production release rehearsal (publication locked)` workflow’u yalnız `workflow_dispatch` ile çağrılır. Push, schedule, workflow_run veya Vercel callback’i tetiklemez. Başlatırken workflow branch’i `production` seçilmelidir. Girdi tam 40 karakter küçük harf commit SHA’sıdır; repository, dispatch branch’i, workflow revision SHA’sı, checkout HEAD ve fetch edilmiş origin/production HEAD eşleşmek zorundadır. Branch adı, kısa SHA, shell metni ve başka repository reddedilir. Girdi shell koduna doğrudan yerleştirilmez.

Bu SHA aynı run içindeki reusable CI’a aktarılır; test başarısızlığında son job çalışmaz. Son job `Production` environment’ına bağlıdır ve **koşulsuz exit 1** ile publication kilidini bildirir. Cloudflare secret referansı veya deploy/rollback/migration işlemi içermez. Required reviewer eksik olsa, biri Run workflow’a bassa veya ortam değişkeni eklese bile yayın yapamaz. Kilidi kaldırmak ayrı bir incelenmiş kod değişikliği gerektirir; bir `enable=true` girdisi yoktur. Provanın son durumunun kırmızı olması bilinçlidir; CI’nın Validate sonucu ayrıca yeşil olmalıdır. Bu prova job’unu branch’in required test check’i yapmayın.

Concurrency `production-release`, `cancel-in-progress:false` ile aynı anda bir release provası yürütür. Uzun süren onay beklemeleri sonraki provayı sıraya alabilir; mevcut run kontrol edilmelidir.

## Sizin tablet üzerinden tamamlayacağınız GitHub ayarları

1. Önce bu dalı inceleyin; push ve PR açma için ayrıca onay verin. Bu görev remote branch oluşturmaz. PR base’i `production` olmalıdır. Workflow production’a merge edilmeden production provası kullanılamaz; PR’daki secret’sız CI ilk doğrulamayı sağlar.
2. Repository Settings → Actions: Actions’ı etkinleştirin; sabitlenmiş resmi `actions/checkout`, `setup-node`, `setup-python`, `upload-artifact` action’larına izin verin. Varsayılan workflow token’ı read-only olsun. CI workflow’u read-only içerik iznini ayrıca beyan eder. CI’a Cloudflare secret eklemeyin.
3. İlk gerçek GitHub CI koşusundan sonra check adını doğrulayarak Validate job’unu production için required status check yapın. Başarısız veya eksik check’te merge engellenmeli; güncel branch zorunluluğu ve PR/code-owner review yapılandırılmalı. `.github/CODEOWNERS` tek başına koruma uygulamaz. Workflow/script/lockfile/config/migration değişikliklerinin incelenmesini zorunlu kılın. Mevcut deletion ve force-push yasaklarını koruyun. İlk bootstrap merge’i ve varsa admin bypass’ı ayrı, bilinçli bir yönetici işlemidir.
4. Mevcut `Production` environment’ında yalnız production branch’ine izin verin. Uygun required reviewer/onay düzenini kurun. Environment protection özelliğinin planınızda kullanılabilir olduğunu doğrulayın. Prevent self-review seçeneği ikinci yetkili kişi gerektirir; tek operatör olarak aynı hesabın başlattığı run’ı onaylama beklentisiyle birlikte açmayın. Bağımsız onay isteniyorsa ikinci güvenilir reviewer atayın. Plan bu korumayı sunmuyorsa eşdeğer koruma kararı verilmeden yayın kilidini kaldırmayın.
5. Repository owner yetkiniz API’de admin görünebilir; GitHub App token’ı yönetim API’lerinde ayrıca 403 alabilir. Önceki 403’ler aşılmadı. Yönetim ayarlarını kendi GitHub arayüzünüzden yapabilirsiniz. İleride entegrasyon kullanılacaksa yalnız hedef repository için: kod push’u için Contents write, workflow dosyası güncellemesi için Workflows write, PR için Pull requests write, dispatch için Actions write gerekir. Ruleset/branch protection yönetimi Administration; environment/reviewer ve environment secret yönetimi Environments izinleri gerektirir. Repository Actions secret yönetimi ayrıca Secrets izni gerektirebilir. Bu yönetim izinlerini CI job’una vermeyin; bütün admin yetkilerini geliştirme ajanına aktarmak gerekli değildir.

Okunabilen mevcut durum: production protected=true; aktif ruleset production için deletion ve non_fast_forward engelliyor, bypass actor yok. Production environment branch allowlist’i production; görünür protection listesinde reviewer yok. Classic protection ayrıntıları ve Actions/secret yönetim ayarları önceki doğrulamada 403 idi; bunların yokluğu varsayılmıyor. Ayarlar bu görevde değiştirilmedi. Vercel’in mevcut otomasyonu da değiştirilmedi; GitHub push’larının mevcut Vercel Preview etkisi yayın onayı öncesinde değerlendirilmelidir.

## Cloudflare: daha sonra güvenli biçimde tanımlanacak bilgiler

**Şimdi bir değeri sohbete, Git’e veya `.dev.vars` dosyasına koymayın.** Gerçek deploy job’u eklenip incelendiğinde token yalnız GitHub **Production environment secret** `CLOUDFLARE_API_TOKEN` olarak kullanılmalı. Doğru account ID’yi owner doğrulamalı; `CLOUDFLARE_ACCOUNT_ID` environment variable olabilir. Mevcut `D1_ANALYTICS_ACCOUNT_ID` alanını bağımsız doğrulama olmadan deployment account seçicisi saymayın. Bu hazırlık workflow’u bu secret’ları okumaz.

En düşük yetki yaklaşımı:

| İhtiyaç | Yetki / kapsam |
| --- | --- |
| `goc` Worker paketini yayımlamak, mevcut secret ad/tip metadata’sını kontrol etmek | Hedef Cloudflare account’ta Workers Scripts Edit. Token yetkisini bütün hesaplara açmayın. Provider desteklemiyorsa token’ın tek Worker’a sınırlandığını iddia etmeyin; account kapsamı ve ayrı üretim ortamıyla riski sınırlandırın. |
| D1 binding kimliğini salt okunur çözümlemek | Wrangler gerçekten gerektirirse aynı account’ta D1 Read. |
| Mevcut R2 bucket binding metadata’sını çözümlemek | Wrangler gerçekten gerektirirse aynı account’ta Workers R2 Storage Read. Bu, runtime R2 access key’lerini CI’a taşımak için gerekçe değildir. |
| Worker cron ayarlarını korumak | Mevcut Workers Scripts kapsamının schedule API erişimini doğrulayın; ayrı permission talebi gelirse yalnız belgelenmiş gereken kapsamı ekleyin. |
| Özel zone route/DNS değiştirmek | Bu workers.dev hedefi için gerekmez; Zone/DNS/Workers Routes Edit vermeyin. İleride route değişikliği ayrı kapsamdır. |
| Uzak migration | Release job’una D1 Edit vermeyin. Ayrı onaylı migration job’u ve ayrı account/DB kapsamlı D1 Edit token gerekir. |

Token’ı Workers KV, R2 Write/Delete, DNS Edit veya Account Super Admin gibi kullanılmayan yetkilerle oluşturmayın. Wrangler’ın gerçek salt okunur preflight hatası ek yetki gerektiğini gösterirse exact endpoint ve gereken izin gözden geçirilmeli. `wrangler whoami`nin kullanıcı profilini listelemek için istediği ilave User Details/Memberships erişimleri deployment için otomatik olarak gerekli sayılmamalı.

`PRINTER_SECRET`, `PRINT_R2_ACCESS_KEY_ID`, `PRINT_R2_SECRET_ACCESS_KEY`, scanner/Apps Script/personel kimlik secret’ları mevcut Worker’da kalır; production değerlerini GitHub CI’a kopyalamayın. Mevcut print metadata prehook’u korunmalıdır. Bu görevde kimlik eksikliğinden production dry-run tamamlanamaz; guard atlanmaz.

## Gerçek deploy kilidini açacak sonraki değişiklik

Aşağıdakiler tamamlanmadan `publication-locked` job’u deploy işlemiyle değiştirilmemeli:

1. Production’a girmiş workflow/CI kodu ve exact SHA incelenmiş olmalı; GitHub required checks, environment approval, sınırlı credential ve olası Cloudflare Workers Builds/Git tetikleyicileri doğrulanmalı. Çift publication yolu bırakılmamalı. Vercel bağlantısı ayrıca kapsam kararı olmadan kaldırılmamalı.
2. Onay öncesinde aktif Worker version/deployment ID, secret **ad/tipleri**, D1/R2 binding kimlikleri, cron’lar, güvenli config farkları ve migration ledger/schema metadata’sı salt okunur kontrol edilmeli. Öğrenci satırları ve secret değerleri loglanmamalı. `npm run deploy:dry-run:production` mevcut prehook ile geçmeli.
3. Aynı test edilmiş SHA’dan oluşturulan artifact checksum/manifest’i release review’a bağlanmalı. Environment onayından hemen sonra SHA ve origin/production HEAD tekrar karşılaştırılmalı; onaylanan SHA değiştiyse durulmalı. `latest`, branch adı, başka run’ın artifact’ı veya sonradan yeniden build edilmiş farklı paket yayımlanmamalı. Mevcut `deploy:production` script’i yeniden build eder: aynı artifact’i yayınlayacak incelenmiş wrapper veya yeniden build eşitliğini kanıtlayan checksum kapısı ayrı kod değişikliğinde hazırlanmalı. Bu nedenle mevcut rehearsal artifact’ı otomatik deploy’a bağlanmadı.
4. Mevcut secret metadata guard’ı, `goc`, production D1/R2 binding’leri, `PRINT_ENABLED=true`, `PHYSICAL_INTAKE_MODE=on`, physical receipt flag’i, UAT kapalı durumu, print limitleri, scanner ve Windows Print Agent v7/protocol-3 uyumluluğu korunmalı. `* * * * *` ve `0 0 * * *` cron’ları sürmeli. Dashboard vars drift’i config ile karşılaştırılmalı; `--keep-vars` körlemesine eklenmemeli. Wrangler config ve mevcut deploy betikleri bu değişiklikte değiştirilmedi.
5. Ayrı explicit deploy onayı exact repository, SHA, Worker ve değişiklik kapsamına bağlanmalı. Yetkili, onaylı job ancak bundan sonra yayın yapabilmeli. Health check’ler salt okunur olmalı; gerçek öğrenci başvurusu, notification veya fiziksel print job’u üretmemeli.

## Migration ve rollback güvenliği

CI yalnız yeni geçici yerel D1’de migration çalıştırır. Release her seferinde otomatik uzak migration çalıştırmamalıdır. 23 SQL dosyasının tam adı/hash’i ile ledger karşılaştırması gerekir; tekrarlanan sayısal önekler dosya adını kısaltma gerekçesi değildir. Eski `check-physical-production-migration.mjs` 0018’i son dosya gibi yorumluyor; güncel 0019–0023 varken genel release kapısı olarak kullanılmamalı.

Production migration gerekiyorsa veri etkisi ve eski/yeni Worker şema uyumluluğu incelenmeli; tutarlı SQL backup ve D1 recovery noktası, güvenli bulut saklama/retention ve restore provası kanıtlanmalı. Mevcut günlük D1→R2 JSON yedeği korunur; transaction snapshot/SQL recovery veya test edilmiş RPO/RTO yerine geçmez. MacBook’ta kalan eski SQL backup dosyası bulut kurtarma planı değildir. Expand/contract ve veri koruyan ileri düzeltme tercih edilmeli. Production veri yazımı için ayrı onay ve ayrı credential gerekir.

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
