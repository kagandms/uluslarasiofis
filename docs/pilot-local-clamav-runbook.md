# MacBook ClamAV tarama işletimi — Prompt B

2 Ekim 2026. Bu kılavuz `codex/pilot-local-clamav` içindir. Uzak migration/deploy veya Prompt A entegrasyonu bu görevde yürütülmedi. MacBook kurulumu ve sentetik gerçek taramalar yapıldı; pilotun uzak adresinde sürekli runner henüz etkin değil.

## Protokol ve erişim sınırı

- İlk yükleme ve replacement finalize işlemleri, kendi D1 batch işlemlerinde `document_scan_jobs` kaydı oluşturur. Migration 0009 eski current/pending kayıtları tamamlar; claim, heartbeat ve status reconciliation kaçan kayıtları onarır.
- Runner yalnız yapılandırılmış HTTPS origin'e çıkar. Redirect reddedilir. Staff cookie, R2 bucket anahtarı, public clamd/TCP veya tünel gerekmez.
- `SCANNER_SECRET` yalnız scanner uçlarına yetki verir: claim, leased content, result, heartbeat ve sırsız status. Student/staff giriş yetkisi değildir. Bu secret, tarama sonucunu yazabilen güvenilir makine kimliğidir; ele geçirilirse sahte sonuç riski vardır.
- Claim 256 bit rastgele lease token üretir; veritabanı yalnız hash tutar. Download ayrıca bu token ister, tek job/object ile sınırlıdır ve claim'den sonra 120 saniye içinde başlatılır. URL'de secret/token yoktur.
- Worker R2 boyut/MIME/ETag doğrular, koşullu GET yapar ve SHA-256'yı job'a bağlar. Runner boyut/hash doğrular. Result file/revision/key/size/hash/ETag, current revision ve geçerli lease ile sınırlıdır. Result sırasında R2 kimliği tekrar doğrulanır; replay reddedilir.
- Initial PUT artık `If-None-Match: *` ile write-once. Eski yükleme capability'leri için claim en erken `max(intent.expires_at, finalize + 300 saniye)` olur; normal TTL ile yaklaşık **10 dakikaya kadar kasıtlı bekleme** olabilir.
- Lease 300 saniye, toplam otomatik deneme 3; hata sonrası 60/120 saniye gecikme. Expired lease tekrar alınabilir; üçüncü başarısızlık `failed` olur. Eski revision işleri `stale` olur. Aynı dosyada UNIQUE iş ve atomik claim vardır.
- Staff reviewer/admin panelinde durum yenileme, backlog, son başarılı tarama, heartbeat ve yalnız `failed` current iş için audit'li retry vardır. Unsafe iş otomatik retry edilmez. Retry sonucu tekrar `pending`; tarama sonucu atamaz.

## Bu MacBook'taki doğrulanmış kurulum

macOS 27.0.1 / Darwin 27 arm64, 16 GiB RAM, başlangıçta 71 GiB boş disk. ClamAV 1.5.4 Homebrew ile kuruldu. Özel durum dizini `$HOME/.local/share/uluslarasiofis-scanner` (0700), secret/config dosyaları 0600. İmzalar daily 28141, main 63, bytecode 339; daily üretim zamanı `2026-10-02T06:26:12Z`. Bu numaralar kanıtın anını gösterir; işletimde yeni imzalar alınmalıdır.

Resmî [Homebrew formula](https://formulae.brew.sh/formula/clamav), [ClamAV yapılandırması](https://docs.clamav.net/manual/Usage/Configuration.html) ve [tarama kılavuzu](https://docs.clamav.net/manual/Usage/Scanning.html) esas alındı. `clamscan` her çağrıda motor/veritabanı yükler; `clamdscan` motor ayarlarını daemon'dan alır. Bu runner açık politika seçenekleriyle **clamscan** kullanır. Clamd gerekmez; aşağıdaki ayrı daemon işletimi yerelde de doğrulandı.

Yeni MacBook kurulumu (mevcut kurulumu/config'i koruyun):

```sh
uname -sm
sw_vers
sysctl -n hw.memsize
df -h "$HOME"
brew install clamav
export SCANNER_STATE_DIR="$HOME/.local/share/uluslarasiofis-scanner"
export SCANNER_DATABASE_DIR="$SCANNER_STATE_DIR/signatures"
export SCANNER_CERTS_DIR="$(brew --prefix)/etc/clamav/certs"
export SCANNER_CLAMSCAN="$(brew --prefix)/bin/clamscan"
export SCANNER_FRESHCLAM="$(brew --prefix)/bin/freshclam"
umask 077
mkdir -p "$SCANNER_DATABASE_DIR" "$SCANNER_STATE_DIR/tmp"
chmod 700 "$SCANNER_STATE_DIR" "$SCANNER_DATABASE_DIR" "$SCANNER_STATE_DIR/tmp"
```

En az 4 GiB kullanılabilir RAM ve 5 GiB disk payı bırakın. Tek temiz PDF ölçümünde yaklaşık 5.97 saniye, 1.59 GB RSS / 1.68 GB peak footprint görüldü. Bu ölçüm büyük/karmaşık belgeler için kapasite garantisi değildir. Başlangıç eşzamanlılığı runner başına 1; aynı Mac üzerinde ikinci runner/clamd açmak ayrıca bellek tüketir.

Özel `freshclam.conf` içeriği (yer tutucuları yerel gerçek yollar/kullanıcı ile doldurun, mevcut dosyayı körlemesine ezmeyin):

```text
DatabaseDirectory <özel-durum-dizini>/signatures
DatabaseOwner <yerel-kullanıcı>
DatabaseMirror database.clamav.net
Checks 12
ScriptedUpdates yes
CVDCertsDirectory <brew-prefix>/etc/clamav/certs
```

```sh
chmod 600 "$SCANNER_STATE_DIR/freshclam.conf"
"$SCANNER_FRESHCLAM" --config-file="$SCANNER_STATE_DIR/freshclam.conf"
"$(brew --prefix)/bin/sigtool" --cvdcertsdir="$SCANNER_CERTS_DIR" --verify "$SCANNER_DATABASE_DIR/daily.cvd"
"$SCANNER_CLAMSCAN" --cvdcertsdir="$SCANNER_CERTS_DIR" --database="$SCANNER_DATABASE_DIR" --version
python3 -m venv "$SCANNER_STATE_DIR/venv"
"$SCANNER_STATE_DIR/venv/bin/python" -m pip install -r scripts/scanner/requirements.txt
```

İlk indirmeden sonra `.cld` oluşmuşsa `sigtool --verify` için mevcut `daily.cld` yolunu kullanın. `main`, `daily`, `bytecode` veritabanları bulunmalı. ClamAV 1.5'in certificate dizini açıkça seçilmiştir; TLS veya imza doğrulamasını kapatmayın. İmza yok, eksik, gelecekte veya build zamanı 24 saatten eskiyse runner hazır sayılmaz. Dosya mtime'ını değiştirmek tazelik sağlamaz.

## Config/secret adları ve provisioning

| Ad | Konum / anlam |
| --- | --- |
| `SCANNER_SECRET` | Worker secret; repo içinde değer yok, `.dev.vars.example` boş ad içerir |
| `SCANNER_SECRET_FILE` | Aynı credential'ın yalnız makine kullanıcısının okuyabildiği dosyası |
| `SCANNER_ORIGIN` | Onaylı pilotun HTTPS origin'i; path/query/kullanıcı bilgisi içermez |
| `SCANNER_RUNNER_ID` | Kişisel veri içermeyen 1–64 karakter `[A-Za-z0-9_-]` kimlik |
| `SCANNER_STATE_DIR` | Özel config/signature/venv/tmp dizini |
| `SCANNER_DATABASE_DIR` | Varsayılan `$SCANNER_STATE_DIR/signatures` |
| `SCANNER_CERTS_DIR` | ClamAV resmi CVD certificate dizini; zorunlu |
| `SCANNER_CLAMSCAN`, `SCANNER_FRESHCLAM` | Executable yolları; varsayılan PATH'teki adlar |
| `SCANNER_SCAN_TIMEOUT_SECONDS` | 1–120; varsayılan hard wall timeout 120 saniye |
| `SCANNER_CA_FILE` | Yalnız yerel sentetik TLS testinde özel CA; uzak pilotta sistem CA kullanılır |

Yeni credential'ı yerel dosyaya üretin; terminale/sohbete yazdırmayın:

```sh
export SCANNER_SECRET_FILE="$SCANNER_STATE_DIR/scanner.secret"
"$SCANNER_STATE_DIR/venv/bin/python" -c 'import os,secrets; from pathlib import Path; path=Path(os.environ["SCANNER_SECRET_FILE"]); descriptor=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600); os.write(descriptor,secrets.token_urlsafe(32).encode()); os.close(descriptor)'
```

Bu komut var olan secret dosyasının üzerine yazmaz. Owner yalnız onaylanan staging ortamında `npx wrangler secret put SCANNER_SECRET --env staging < "$SCANNER_SECRET_FILE"` ile provisioning yapabilir. **Bu uzak komut bu görevde çalıştırılmadı.** Değerleri `.env` sürüm kontrolüne, log'a, audit'e veya ekran görüntüsüne koymayın. Makine FileVault/özel kullanıcı oturumu ve 0700/0600 izinleriyle korunmalı; runner root gerektirmez.

## Başlat / durdur / yeniden başlat

Repo checkout'unda yukarıdaki env adlarını export edin. Uzak origin ancak onaylanan deployment hazırken seçilir:

```sh
export SCANNER_ORIGIN="${PILOT_ORIGIN:?Onayli HTTPS pilot originini yerelde ayarlayin}"
export SCANNER_RUNNER_ID=macbook-pilot
"$SCANNER_STATE_DIR/venv/bin/python" scripts/scanner/runner.py --update
"$SCANNER_STATE_DIR/venv/bin/python" scripts/scanner/runner.py --status
caffeinate -i "$SCANNER_STATE_DIR/venv/bin/python" scripts/scanner/runner.py
```

Runner güncellemeyi başlangıçta ve her 2 saatte yapar; hata durumunda `update_failed` heartbeat gönderir, clean üretmeden 60 saniye sonra tekrar dener. İş yokken 30 saniyede poll/heartbeat olur. İş sırasında heartbeat aralığı uzayabilir; UI 120 saniyeden eski sinyali çevrimdışı gösterir. Status yenilemesi manuel ve anlıktır.

- Durdurma: foreground terminalinde Ctrl-C; SIGTERM de kabul edilir. Devam eden bounded işlem tamamlanır, sonra döngü durur. Scanner'ın kendi PID'sine sinyal verin; toplu `pkill` kullanmayın.
- Restart: aynı env/config/secret ile aynı komutu çalıştırın. D1 iş kaydı kalır; yarım kalan lease en geç 300 saniyede tekrar alınabilir. İmza update sonrası yeniden claim başlar.
- Tek iş testi: `runner.py --once`; imzaları önceden güncellemek gerekir. İş yok veya motor degraded ise claim yapmadan çıkar. Sadece exit 0'a bakıp clean kabul etmeyin; D1/status sonucuna bakın.
- İnternet kesilirse sonuç kaybolmaz: lease expiry/retry mekanizması devreye girer. Üç kesinti/timeout sonrası iş `failed` kalabilir; staff sorun düzeldikten sonra kontrollü retry eder.
- Mac açık, **uyanık ve internete bağlı** olmalıdır. `caffeinate -i` yalnız çalıştığı süreç boyunca idle sleep'i önler; kapak kapatmayı veya güç kesintisini garantiyle önlemez. Genel güç ayarı değiştirilmedi.
- Sürekli kullanıcı düzeyi launchd otomasyonu kurulmadı. Pilot için görünür foreground çalışma yeterlidir; yeniden login/reboot sonrası bu başlatma adımları tekrar uygulanır. Host çevrimdışıyken upload/submit korunur fakat sonuçlar pending kalır.

### İsteğe bağlı clamd işletimi

Runner clamd kullanmadığından bunu yanında sürekli açmak gerekmez. Yerelde doğrulanan özel `clamd.conf`: `DatabaseDirectory`, `CVDCertsDirectory`, `LocalSocket <state>/clamd.sock`, `LocalSocketMode 600`, `FixStaleSocket yes`, `PidFile <state>/clamd.pid`, `TemporaryDirectory <state>/tmp`, `Foreground yes`, `MaxThreads 1`, `MaxQueue 2`, `MaxFileSize 11M`, `MaxScanSize 100M`, `MaxFiles 1000`, `MaxRecursion 16`, `MaxScanTime 0`, `StreamMaxLength 11M`, `AlertExceedsMax yes`, `AlertEncrypted yes`, `AlertBrokenExecutables yes`, `AlertBrokenMedia yes`, `ScanPDF yes`, `ScanImage yes`. TCPPort/TCPAddr eklemeyin.

```sh
"$(brew --prefix clamav)/sbin/clamd" --config-file="$SCANNER_STATE_DIR/clamd.conf"
```

Foreground Ctrl-C/SIGTERM ile durdurun; restart aynı komuttur. İmza güncellemesinden sonra restart veya yalnız bu daemon PID'sine SIGUSR2 reload uygulanır. Unix socket PING→PONG, VERSION→1.5.4/28141 ve socket 0600 gerçek makinede doğrulandı; ardından daemon durduruldu. Public TCP oluşturulmadı.

## Tam tarama ve gizlilik politikası

10 MiB upload sınırı ve PDF/JPEG/PNG/WebP korunur. ClamAV `--official-db-only=yes`, cache kapalı, PDF/image açık, file limit 11M (10 MiB girişten büyük), toplam açılmış içerik 100M, en fazla 1000 dosya / 16 seviye kullanır. Exceeded/encrypted/broken alert'leri açık; motorun soft scan time limiti 0, parent process hard timeout 120 saniye. Bytecode timeout 60000 ms. Sıfır exit tek başına yeterli değildir: bir dosya / sıfır enfeksiyon özeti ve warning/error/skipped bulunmaması gerekir.

Clean adayları ayrı 20 saniyelik child parser ile doğrulanır: strict, şifresiz 1–500 sayfa PDF; gerçekten decode edilen JPEG/PNG/WebP, tek frame ve <=25 milyon piksel. Şifreli, malformed, çözümlenemeyen, limit aşan veya parse timeout içeriği `failed` olur. Bunlar otomatik yeniden denemelerde de düzelmiyorsa öğrenciye ofisin uygun resubmission akışı gerekir. Engine zararlı imzası bulursa `unsafe`; bu, insan belge onayı değildir.

Runner belgeyi yalnız özel `tmp/job-*` 0700 dizininde `document` 0600 adıyla işlem süresince tutar. Normal başarı/hata/timeout sonunda siler. Process crash kalıntıları başlangıçta ve döngüde, yalnız `job-*` ve bir saatten eskiyse silinir; taze başka runner işleri korunur. Mac uzun süre kapalı kalırsa bu temizlik restart'a kadar gerçekleşmez. Disk arşivi/otomatik quarantine oluşturulmaz. İçerik, kişisel filename veya ham ClamAV/parser diagnostics log'a gitmez. Gerçek öğrenci belgesi public tarama hizmetine gönderilmedi.

## Operatör müdahalesi / secret rotation

Pending sayısı artıyorsa staff panelinden status yenileyin: heartbeat, imza yaşı, engine/update durumu ve son scan zamanı. Önce makine/network/freshclam/config sorununu düzeltin. Yalnız `failed` işte retry butonunu kullanın; API same-origin, reviewer/admin ve current finalized file kontrol eder, audit yazar. Unsafe dosyayı manuel clean yapmayın. Mevcut preview/download/review/ZIP kapıları clean gerektirir; pending ile submit davranışı değiştirilmedi.

Rotation: eski runner'ı durdurun; yeni private dosyada yeni 256 bit credential üretin, onaylı Worker secret'ını değiştirin, yeni dosya yoluyla runner'ı başlatın. Eski secret istekleri 401 almalıdır. Eski lease token tek başına yetki vermez; kalan işler expiry sonrası tekrar alınır. Eski private dosyayı gerektiğinde silin. Worker secret değerini UI/log'a çıkarmayın; shell history'ye secret literal girmeyin. İki host aynı anda çalışacaksa farklı `SCANNER_RUNNER_ID`, kendi private state ve aynı sınırlı protokol kullanılır; claim fencing dosyayı tek host'a verir. Host başına ayrı credential/revocation modeli bu pilotun mevcut tek-secret protokolünde yoktur.

## Windows / Linux'a taşıma

Python 3.12+ venv, `requirements.txt`, güncel resmi ClamAV/freshclam ve official CVD certificate dizini gerekir. Homebrew yolları yerine `SCANNER_CLAMSCAN`, `SCANNER_FRESHCLAM`, `SCANNER_CERTS_DIR` ayarlanır; Windows executable adları `.exe` olabilir. State/private secret Windows'ta yalnız servis kullanıcısı ACL'siyle korunmalıdır (POSIX mode kontrolü Windows'ta uygulanmaz). Normal kullanıcı, outbound HTTPS ve imza mirror erişimi yeterli; R2 anahtarı/staff cookie/tünel gerekmez. Freshclam conf yeni host'taki database/user/cert yollarına uyarlanır.

Windows Task Scheduler veya Linux user service aynı foreground runner'ı çalıştırabilir; service kurulumu bu görevde yapılmadı. Önce eski host durdurulur, yeni host heartbeat ve gerçek sentetik scan kanıtlanır. Paralel iki host için lease davranışı testlerde doğrulandı; gerçek Windows/Linux çalıştırması ve iki fiziksel host testi **NOT EXECUTED**.

## Staging UAT — owner onayıyla ayrı yürütülecek

1. Prompt A ve B'nin ayrı commit'lerini entegrasyon/güvenlik görevinde inceleyin. 0008 erişim için ayrılmıştır; 0009 scanner içindir. Birleşik HEAD üzerinde test/build ölçün. Production'a yazmayın.
2. Staging D1 backup ve migration envanterini alın. 0008/0009 sıra/çakışma kontrolünden sonra onaylı staging migration/deploy yapın. Yeni `.dev.vars.example` adı dışında secret değeri commit'e girmez.
3. Owner private credential dosyasından staging `SCANNER_SECRET` provision eder. Runner sistem CA ile gerçek staging HTTPS adresine bağlanır. Worker'da DB/DOCUMENTS bağları ve 0009 hazır olmalıdır.
4. Gerçek browser'da sentetik temiz PDF/PNG/JPEG/WebP yükleyin: R2 CORS `if-none-match` dahil gerekli signed header'ları kabul etmeli; ilk/replacement PUT tekrar kullanımında 412/ret beklenir. Bu görevde presigned browser PUT uzak R2 üzerinde çalıştırılmadı.
5. Job'un finalize ile atomik oluştuğunu, bekleme sonunda gerçek engine metadata ile clean olduğunu; staff preview/download, review ve indirilen ZIP içeriğini doğrulayın. Replacement sonrası yeni job/ikinci gerçek scan olmalı.
6. Sadece sentetik EICAR fixture kullanın: unsafe, preview/download/review/ZIP reddi. Şifreli/broken içerik, engine yok/timeout, bayat imza ve failed/retry akışlarını kontrol edin. Gerçek öğrenci belgesiyle UAT yapmayın.
7. Host'u durdurup pending upload yapın; job korunmalı. Restart/lease expiry sonrası devamı, ağ kesintisini, iki runner çift claim reddini, expired/replay/unauthorized result ve eski revision reddini kontrol edin. Sırlar network ekranlarında paylaşılmamalı.
8. Çalışma saatleri, açık/uyanık/internet sorumluluğu ve Windows yedek host'un devreye alınmasını belirleyin. İki cihazdan öğrenci erişimi Prompt A'nın ayrı kabulüdür.

## Geri alma

Önce runner'ı durdurup Worker scanner secret'ını iptal/değiştirin. Owner onayıyla önceki Worker deployment'ına dönmek scanner dispatch'i durdurur; dosyalar pending/failed/unsafe kapılarında kalır. Additive 0009 tablolarını ve job/audit kayıtlarını koruyun; üretimde DROP veya toplu durum değiştirme yapmayın. Tekrar etkinleştirme current-pending reconciliation ile devam edebilir. Geçmiş upload capability güvenliğini zayıflatacak write-once rollback için entegrasyon incelemesi gerekir. Mac ClamAV/official signatures kalabilir; öğrenci belge arşivi yoktur.

## Yerel doğrulamayı tekrar çalıştırma

```sh
npm ci
npm test
"$SCANNER_STATE_DIR/venv/bin/python" -m unittest discover -s test/scanner -v
RUN_REAL_CLAMAV=1 SCANNER_REAL_STATE="$SCANNER_STATE_DIR" node --disable-warning=ExperimentalWarning --test test/scannerReal.test.js
npm run build:staging
git diff --check
```

Opt-in gerçek test ephemeral HTTPS server/secret ve SQLite/R2 test adaptörü kullanır, gerçek MacBook ClamAV çalıştırır; synthetic clock yalnız queue availability'yi ilerletir, clean elle atanmaz. Native workerd + local D1 + local R2 kanıtı ayrıca teslim raporundadır. Native yerel testlerde `--local --persist-to <izole-dizin>` kullanın; Vite build'in `.wrangler/deploy/config.json` config redirect'inin seçtiği env/db'yi kontrol edin. Uzak UAT ile yerel sonucu karıştırmayın.
