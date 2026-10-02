# Birleşik pilot — staging uygulama ve UAT planı

2 Ekim 2026. **Bu planın uzak adımları çalıştırılmadı.** Deploy/migration/secret etkinleştirme ayrıca yetkilendirilecek staging görevidir. Review ZIP ve candidate HEAD seçilmeden işlem başlatılmamalı. Production/main ve Oracle kapsam dışında.

## Gerçek config hedefi ve uygulama sırası

`wrangler.jsonc` / `package.json` üzerinde doğrulanan hedefler:

| Alan | Değer |
| --- | --- |
| Env / Worker | `staging` / `goc-staging` |
| D1 binding / DB / ID | `DB` / `uluslarasiofis-staging` / `8f034e90-17fc-43d7-aa5d-125571019612` |
| R2 binding / private bucket | `DOCUMENTS` / `uluslarasiofis-documents-staging` |
| Migration script | `npm run db:migrate:staging` → Wrangler D1, `--remote --env staging` |
| Build / deploy script | `npm run build:staging` / `npm run deploy:staging` |
| Giriş / takip | `/basvuru/` / `/basvurum/` |
| Scanner origin | Onaydan sonra Worker'ın gerçek HTTPS origin'i; beklenen staging adı `goc-staging.topkapiuni.workers.dev`, ulaşılabilirliği burada kontrol edilmedi |

`remote:false` binding alanları **local dev** davranışıdır; deploy edilen Worker staging binding ID/bucket'ını kullanır. Vite build ve `wrangler dev` `.wrangler/deploy/config.json` redirect'ini değiştirebilir. Default Wrangler komutunun doğru ortamı seçtiğini varsaymayın. Migration/secret/read-only envanter komutlarına explicit root `--config wrangler.jsonc` ekleyin. Deploy öncesi staging build'in ürettiği redirect ve resolved config'i yeniden okuyun.

1. Onaylı final HEAD'e ayrı staging checkout açın; `git status`, HEAD, `npm ci`, package script ve root config'i doğrulayın. Wrangler account identity (`whoami`) ve gerçekten yetkili staging hesabı karşılaştırılmalı; production ID varsa durun. Credential değerleri veya auth çıktıları paylaşılmamalı.
2. Önce **salt okunur** migration envanteri ve current schema alın. D1 staging backup/export'u yetkili operatörün özel 0600 yolunda tutun; öğrenci/veri içerebileceği için review ZIP'e koymayın. Staging D1 0001–0007 ise 0008 sonra 0009; başka 0008/0009 içerikleri varsa hash/schema farkı çözülmeden apply yok. Daha önce apply edilmiş doğru migration'lar yeniden numaralandırılmamalı.
3. Yalnız yetki geldikten sonra migration scriptini doğru root config'e bağlayın:

   ```sh
   npm run db:migrate:staging -- --config wrangler.jsonc
   ```

   Sonrasında envanter, `applications` access/ref/version sütunları, scan jobs/heartbeat tabloları, FK ve legacy pending backfill kontrolü. Legacy kayıtlarda code hash null normaldir; plaintext recovery uydurmayın.
4. `npm test`, Python ve `npm run build:staging`; `.wrangler/deploy/config.json` içindeki configPath'i çözün. Üretilen config name `goc-staging`, D1 ID/DB ve R2 bucket yukarıdaki staging hedefi olmalı; local config redirect'i kalmışsa yeniden doğru staging build yapın. Önceki Worker deployment/version ve rollback kaydını alın. Yetkiyle `npm run deploy:staging` uygulayın; bu script tekrar staging build yapar. Sağlık/assets/staff auth/student routes kontrolü ile yayını doğrulayın.
5. `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` upload-signing config'i ve `STAFF_SHARED_USERNAME` mevcut staging modele göre kontrol edilmeli. Bunlar runner'a verilmez. Gerçek staff hesabı gerekiyorsa desteklenen `/api/staff/auth/bootstrap` + `X-Staff-Bootstrap-Token` akışı kullanılmalı; uzak D1'e staff credential/session INSERT etmeyin. Shared username e-posta olmak zorunda değildir.
6. Yeni private scanner secret dosyası üretin; değerini terminale/log/sohbete yazmayın. Worker `SCANNER_SECRET` adı ile aynı değer makinedeki `SCANNER_SECRET_FILE` dosyasına kurulmalı; dosya 0600, state 0700. Yetki geldikten sonra explicit root config ile:

   ```sh
   npx wrangler secret put SCANNER_SECRET --env staging --config wrangler.jsonc < "$SCANNER_SECRET_FILE"
   ```

7. MacBook imzalarını güncelleyin ve tazeliği doğrulayın; kanıttaki 2 Ekim imzasını 5 Ekim için yeterli saymayın. Ayrı terminalde onaylı gerçek origin, private dosya ve state değerleriyle aşağıdaki komutlar uygulanır. Uzak testte `SCANNER_CA_FILE` ayarlanmaz; sistem CA kullanılır.

   ```sh
   export SCANNER_ORIGIN="${PILOT_ORIGIN:?Onayli HTTPS staging originini ayarlayin}"
   export SCANNER_RUNNER_ID=macbook-pilot
   "$SCANNER_STATE_DIR/venv/bin/python" scripts/scanner/runner.py --update
   "$SCANNER_STATE_DIR/venv/bin/python" scripts/scanner/runner.py --status
   caffeinate -i "$SCANNER_STATE_DIR/venv/bin/python" scripts/scanner/runner.py
   ```

   `SCANNER_STATE_DIR`, `SCANNER_SECRET_FILE`, `SCANNER_DATABASE_DIR`, `SCANNER_CERTS_DIR`, `SCANNER_CLAMSCAN`, `SCANNER_FRESHCLAM` yapılandırması [ClamAV runbook](pilot-local-clamav-runbook.md) ile aynıdır. `--once` exit 0 tek başına scan PASS değildir; actual job/result/engine metadata kontrol edilir. İlk job için capability güvenli beklemesi 10 dakikaya kadar olabilir.
8. Scanner ready heartbeat ve bir gerçek uzak sentetik clean job sonrasında aşağıdaki UAT tamamlanır. Uzak kontrol sayfalarında raw access code/session/lease/scanner secret veya presigned URL ekran görüntüsü paylaşılmamalı; status ve hash/redacted evidence yeterlidir.

## Uzak UAT kabul listesi

Tüm satırlar şu an **NOT EXECUTED**. Yerel browser/JSDOM/adapter/native proof bunların yerine geçmez. Sentetik öğrenci kimliği ve küçük sentetik belgeler kullanılmalı; gerçek öğrenci belgesi ya da gerçek kimlik ile test yapılmamalı.

| Senaryo | Somut işlem | Beklenen kabul / kaydedilecek kanıt |
| --- | --- | --- |
| Gerçek browser giriş / create response kaybı | A cihazında `/basvuru/` draft oluştur, kodu açık kullanıcı eylemiyle sakla; bir create response kaybı senaryosunda HttpOnly session varsa resume ve regenerate dene. | Referans sabit, kod response/explicit UI dışında yok; ikinci draft/öğrenci-numarası recovery yetkisi yok. Cookie güvenliği; legacy owner code edinme ayrıca. |
| İki fiziksel cihaz | B cihazında referans+kodla giriş; A ve B farklı browser/cihaz. Yanlış kod, yalnız öğrenci no/referans ve başka başvuru dene. | Aynı başvuru, bağımsız owner cookie; yanlış girişte 401/400 ve yeni cookie yok; cross-owner upload/finalize reddi. |
| Draft/type/address ve 409 | İki cihaz aynı version'ı okusun; A alan/type/address kaydetsin, B stale save yapsın. Hızlı yazma sırasında in-flight autosave ve yeni input ekle. | B 409, kendi girdisi korunur, otomatik stale overwrite yok; kullanıcı refresh/karşılaştırma sonrası güncel version ile save. Tek cihaz normal yazı v1→v2→v3. |
| Ortak üniversite NAT | Aynı gerçek campus çıkışından 65 doğru giriş; başka sentetik başvurular. Bir reference için 6 yanlış kod, başka reference/IP için quota/window kontrolü. | Doğru kodlar 429 ile kilitlenmez; yanlış denemeler finite 15 dakika kotası; latency/Worker errors/backlog kaydı. Kontrollü sentetik yük. |
| Staff reset / CSRF / identity | Gerçek reviewer/admin ile kişi kimliği kontrol sürecini uygula, reset modalındaki referansı karşılaştır. Yetkisiz rol, cross-origin mutation ve owner regen dene. | UI checkbox yalnız operatör beyanıdır; gerçek kontrol ayrıca kayıtlı. Staff reset tüm eski owner cookie'lerini 401 yapar; eski kod 401, yeni kod 200. Referans sabit, safe audit. |
| Public submit tam zinciri | Tüm gerekli sentetik belgeler, güncel declaration/contact ack ve submit; success ekranındaki ref/kod hatırlatması. | Eski lifecycle kuralları korunur; submit pending ile mümkün olan mevcut politikayı temiz tarama olarak sunmaz. Staff review clean bekler. |
| Private R2 browser PUT | PDF/PNG/JPEG/WebP için gerçek signed intent → browser PUT → finalize. CORS preflight/signed required headers (`if-none-match` dahil) ve object metadata kontrolü. Aynı capability ile ikinci PUT dene. | İlk write-once PUT/finalize başarılı; overwrite 412/ret. MIME/boyut/object identity doğru; R2 private/direct unauthenticated GET reddi. Finalize ve durable job ilişkisi. |
| Gerçek clean / staff / ZIP | Runner'a hazır imzalarla iş ver; gerçek uzak clean metadata bekle. Staff preview/download/review ve üretilen ZIP'i indir. | Clean öncesi gate kapalı; sonrasında exact object bytes ve ZIP entry/hash eşleşir. Clean insan onayı değildir; review ayrı eylemdir. |
| Initial ve replacement | Staff supported request-resubmission; öğrenci farklı cihazda yalnız istenen belgeyi replace/finalize eder. | Yeni revision/current file ve yeni job; ikinci gerçek tarama. Eski revision/lease/result yenisini clean yapmaz; istenmeyen belge replacement reddi. |
| Unsafe / failed kapıları | Sadece sentetik EICAR; encrypted/broken içerik ve uygun timeout/signature-stale/outage kontrolleri. | EICAR unsafe; encrypted/broken/timeout non-clean; preview/download/review/ZIP reddi. Üç failed attempt ve yetkili retry audit; unsafe manuel clean yok. |
| Scanner auth / rotation | Missing/wrong/old secret, yalnız staff cookie, farklı/expired lease ve replay; sonra kontrollü secret rotation. | Yetkisiz 401, wrong/stale/replay 409; secret URL'de yok. Eski credential geçersiz, yeni runner hazır; mevcut jobs expiry sonrası devam eder. |
| Kesinti / iki runner / yedek | Mac runner dururken upload; restart/network kesintisi/lease expiry. İki ayrı runner ID ile controlled claim. Windows yedeğini kendi imza/state/private ACL/config ile aç. | Durable backlog korunur; bir file'a tek geçerli lease, duplicate/stale sonuç reddi; Windows gerçek clean/EICAR evidence. Windows testi yapılmadan yedek hazır sayılmaz. |
| Operasyon ve Pazartesi kapısı | Hafta sonu host sorumlusu/güç/uyanıklık/internet ve Pazartesi yedek operatörü belirle; heartbeat/backlog/son scan izle. | Fresh update, ready heartbeat, clean/unsafe gerçek uzak kanıt, staff/ZIP/iki cihaz/NAT kabulü ve rollback kaydı tamam. Sadece local PASS ile belge kabulünü açma. |

## Rotation, rollback ve durdurma

Runner foreground Ctrl-C/SIGTERM ile durur; yalnız kendi PID'si, toplu `pkill` yok. `caffeinate -i` o süreç sürerken idle sleep'i önler; kapak/güç kesintisi için garanti değildir. Kalıcı global uyku ayarı değişikliği yapılmaz. Başlangıç eşzamanlılığı host başına 1; kapasite/bellek ölçümü artırmadan paralellik açılmaz.

Secret rotation: eski runner'ı durdur; yeni private credential üret; Worker secret'ını onayla değiştir; yeni dosya ile başlat; eski secret 401 kanıtını al. Eski lease tek başına yetki değildir. Mevcut tek-secret modelinde host başına ayrı iptal yetkisi yok; Mac/Windows geçişinde buna göre kontrol edilir.

Sorunda önce yeni upload/öğrenci erişimini pilot operasyon kararıyla durdurun, runner'ı durdurup credential'ı iptal/değiştirin. Önceki güvenilir Worker deployment'ına yetkili rollback; **0008/0009 additive schema ve job/audit kayıtları korunur**, DROP/durum toplu clean/elle pending bypass uygulanmaz. Önceki Worker access-code UI'ını sunmuyorsa cross-device erişim kullanıcıya kapalı kalmalıdır. Tekrar açışta current-pending reconciliation ve legacy existing-session code edinme kontrolü gerekir. D1 backup restore, ileri yazıları kaybettirebileceği için schema geri alma yöntemi olarak otomatik uygulanmaz.

## Native yerel kanıtı yeniden üretme

Gerçek ClamAV ve requirements venv hazırken, ayrı integration checkout'unda build yapın. **Her koşu için yeni paired `.wrangler` proof/state dizini** kullanın. Hazırlayıcı mevcut proof dizinini ezmez. Aşağıdaki komutlar yalnız local; native helper'ın `/__runtime_probe` route'u ürün Worker'ına eklenmez.

```sh
npm run build:staging
export SCANNER_REAL_STATE="$HOME/.local/share/uluslarasiofis-scanner"
export SCANNER_CLAMSCAN="$(brew --prefix)/bin/clamscan"
export SCANNER_CERTS_DIR="$(brew --prefix)/etc/clamav/certs"
export NATIVE_PROOF_DIR="$PWD/.wrangler/native-review-replay"
export NATIVE_PERSIST="$PWD/.wrangler/native-review-replay-state"
python3 test/scanner/prepare-native-proof.py
export NATIVE_CONFIG="$NATIVE_PROOF_DIR/wrangler.json"
export NATIVE_CA="$NATIVE_PROOF_DIR/cert.pem"
export NATIVE_SECRET="$NATIVE_PROOF_DIR/secret"
export NATIVE_FIXTURES="$NATIVE_PROOF_DIR/fixtures"
export NATIVE_ORIGIN=https://127.0.0.1:8799
export NATIVE_OUTPUT="$NATIVE_PROOF_DIR/safe-evidence.json"
npx wrangler d1 migrations apply uluslarasiofis-local --config "$NATIVE_CONFIG" --local --persist-to "$NATIVE_PERSIST"
npx wrangler dev --config "$NATIVE_CONFIG" --local --persist-to "$NATIVE_PERSIST" --local-protocol https --https-key-path "$NATIVE_PROOF_DIR/key.pem" --https-cert-path "$NATIVE_CA" --ip 127.0.0.1 --port 8799 --inspector-port 9238 --show-interactive-dev-session false
```

Aynı exported ayarların bulunduğu ikinci terminalde `python3 test/scanner/native-acceptance.py`. Local staff session/under_review fixture ve local R2 CLI PUT kullanır; uzak staff bootstrap/browser kabulü değildir. Queue availability hızlandırılır; verdict sadece gerçek runner'dan gelir. Safe evidence'i koruyun, yalnız bu Worker'ı durdurun ve **bu koşuda oluşturulan** private proof/state dizinlerini temizleyin. Başka namespace veya operator scanner state/official signatures silinmez.
