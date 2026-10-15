# CI/CD hazırlığı teslim raporu

15 Ekim 2026 — kagandms/uluslarasiofis.

Yerel dal: `ci/cloud-safe-release`. Başlangıç/base HEAD: `9acc1d86116591be616e6083a030523bba65363e`.
Dal temiz `work` checkout’undan ayrıldı; bu HEAD uzak production ile aynıydı. Uygulama production branch’ine geçilmedi. Değişiklikler yerel çalışma ağacında inceleme içindir; GitHub’a push/PR yapılmadı.

## 1. Eşzamanlı kayıt hatası

Önce yalnız assertion’a güvenli tanılama eklendi: HTTP status, error code ve error message. Yanıt gövdelerindeki session/cookie, belge, öğrenci verileri veya başarı payload’ı loglanmadı. Eski kaynakla 25 doğal tekrar başarısızlık üretmedi; bu, önceki hatayı çözülmüş saymak için kullanılmadı.

Gerçek Miniflare D1 üzerinde deterministik sıra kuruldu: bir registration isteğinin ilk replay sorgusu `null` sonucuyla bekletildi; diğer gerçek HTTP registration isteği transaction’ını tamamladıktan sonra bekletilen istek devam etti. DB verisi ve HTTP yanıtları taklit edilmedi; yalnız gerçek sorgu sonucunun teslim zamanı kontrol edildi.

**Düzeltmeden önce kaydedilen gerçek yanıtlar:**

```json
[
  {"status":409,"code":"RESERVATION_EXPIRED","message":"Numara tahsisi geçersiz; yeni numara ayırın."},
  {"status":200}
]
```

Kök neden `registerPhysicalReceipt` içindeki iki okuma arasındaki yarıştı. Başlangıçtaki replay okuması kaydı henüz göremiyor; ikinci istek aynı UUID/body ile kaydı atomik oluşturup reservation’ı tüketiyor; geciken istek tüketilmiş reservation görüyor ve mevcut `try/catch` dışında 409 atıyordu. Transaction hatalarındaki ikinci replay kontrolüne hiç ulaşmıyordu.

Düzeltme: reservation okuması/doğrulaması da mevcut `try/catch` içine alındı. Hata halinde aynı registration UUID’si ve body hash’i ile kalıcı kayıt yeniden okunuyor. Aynı işlem tamamlanmışsa aynı kayıt dönüyor; UUID farklı içerikle kullanılıyorsa `REGISTRATION_CONFLICT` sürüyor. Gerçekten geçersiz/oturuma ait olmayan/sona ermiş tahsis için kalıcı eşleşen kayıt yoksa önceki hata davranışı korunuyor. DB transaction ve constraint’ler değiştirilmedi; migration eklenmedi. Başarılı replay artık hata olarak loglanmıyor.

Native test aynı intake ID’sinin döndüğünü, tek physical intake, tek receipt ve tek registration audit satırı bulunduğunu; farklı body’nin 409 aldığını da doğruluyor. Mevcut content write-once, print idempotency ve submission_started cleanup güvenliği kontrolleri devam ediyor. Bu deterministik test güncel toolchain ile **20 ardışık koşuda geçti**.

## 2. Güvenlik bağımlılıkları

Beş high kayıt iki temel advisory ve bağımlılık etkilerinden oluşuyordu:

| Zincir | Önce | Sonra |
| --- | --- | --- |
| @cloudflare/vite-plugin | 1.62.0 | 1.64.0, exact pin |
| wrangler | 4.143.0 | 4.151.0, exact pin |
| miniflare | 5.20260926.0-alpha | 5.20261012.0-beta, upstream bağımlılığı |
| sharp | 0.35.4 | 0.35.5 |
| source-map-js | 1.2.1 | 1.2.2 |

`sharp` advisory’si GHSA-wq5f-xc86-pv6w; `source-map-js` advisory’si GHSA-68fv-2mgg-jv7q. Cloudflare paketleri kendi uyumlu upstream sürümleriyle güncellendi; miniflare için uyumsuz bağımsız override eklenmedi. Workerd ve esbuild/platform paketleri bu zincirin parçası olarak güncellendi. Mevcut undici override’ı ve runtime dependency sürümleri korundu.

`npm install --save-dev --save-exact ... --ignore-scripts` ve hedefli `npm update source-map-js --ignore-scripts` kullanıldı; `npm audit fix --force` kullanılmadı. Sonrasında `npm ci --ignore-scripts` ile temiz lockfile kurulumu başarılı oldu. `npm audit --audit-level=high`: **0 vulnerability**, high/critical dahil tüm seviyeler sıfır. Audit sonucu bu tarihteki registry verisidir, gelecekteki advisory’leri garanti etmez.

Upstream Cloudflare araç zinciri Miniflare beta sürümü kullanıyor. Yerel Worker, D1/R2 native testleri ve production build ile uyumluluk sınandı; canlı production deploy denenmedi.

## 3. Yeni CI ve release provası

- `.github/workflows/ci.yml`: secret’sız kurulum/audit, iki tam JS koşusu, 20 native tekrar, Python testleri, yeni yerel D1 migration/smoke, production build, SHA/checksum artifact’ı.
- `.github/workflows/production-release.yml`: yalnız manuel, tam SHA doğrulamalı, aynı SHA’yı reusable CI’a veren ve Production environment son job’unda koşulsuz durarak publication’ı kilitleyen prova. Hiçbir deploy/remote migration/rollback komutu veya Cloudflare secret referansı yok.
- `.github/CODEOWNERS`: workflow, CI script’leri, deployment/config/lockfile/migration alanları için review sahibi önerisi; gerçek zorunluluk GitHub yönetim ayarıyla etkinleştirilir.
- `scripts/ci/check-release-sha.mjs` ve negatif testi: yanlış repository, yanlış dispatch branch, yanlış workflow revision SHA, kısa/geçersiz/shell benzeri input, checkout uyumsuzluğu ve stale production ref reddediliyor.
- `scripts/ci/local-worker-smoke.mjs`: ignored local state veya credential kopyalamadan geçici kaynak/konfigürasyon/DB ile migration ve sentetik HTTP smoke.
- `scripts/ci/receipt-stability.mjs`: hata gizlemeden native regression’ı tekrarlar; test timeout veya nonzero exit halinde durur.

CI başarısızlığında manuel akışın son job’u çalışmaz. CI’yı production merge için zorunlu kılma ayarı yönetici tarafından henüz uygulanmadı. Publication kilidi environment ayarından bağımsız olarak kodda duruyor; yapılandırmalar tamamlandığında bile ayrı incelenmiş deployment implementasyonu olmadan deploy mümkün değil. Rehearsal’ın son kırmızı durumu beklenir.

GitHub Actions üzerinde canlı koşu yapılmadı: push ve PR için kullanıcı onayı bekleniyor. Yerel kontroller, YAML/actionlint ve aynı komutların çalıştırılması GitHub hosted runner sonucu olarak sunulmuyor.

## 4. Doğrulama sonuçları

| Kontrol | Sonuç |
| --- | --- |
| Eski kod + zorlanan gerçek D1 yarışı | Beklenen FAIL; gerçek 409/RESERVATION_EXPIRED kaydedildi |
| Düzeltme + receipt test grubu | 48/48 geçti |
| Native yarış/receipt/print regression | 20/20 ardışık tekrar geçti |
| Tam JavaScript koşusu 1 | 993 test; 990 geçti, 0 hata, 3 skip; 148,44 saniye |
| Tam JavaScript koşusu 2 | Yeni CI testi dahil 994 test; 991 geçti, 0 hata, 3 skip; 127,68 saniye |
| Tam JavaScript koşusu 3 | 994 test; 991 geçti, 0 hata, 3 skip; 121,73 saniye |
| Son workflow-revision SHA kontrolü sonrası negatif guard testi | 1/1 geçti |
| Temiz Python venv pip install/pip check | Başarılı |
| Temiz Python venv scanner | 14/14 geçti |
| Temiz Python venv Print Agent | 45/45 geçti |
| Yeni boş yerel D1 ve Worker smoke | 23 migration; ikinci apply değişiklik yok; ledger/foreign keys doğru; altı HTML ve sentetik API akışı geçti |
| Production build | Başarılı; mevcut chunk-size/dynamic-import uyarıları sürüyor |
| Node audit | 0 açık |
| Workflow statik kontrol | actionlint 1.7.7 başarılı; release archive checksum doğrulandı |
| Production dry-run | Kimlik eksikliği nedeniyle mevcut metadata prehook’unda BLOCKED; guard aşılmadı |

Üç skip iki macOS ZIP okuyucu testi ve opt-in gerçek MacBook ClamAV testidir. Scanner ve Print Agent unit testleri canlı ClamAV, gerçek Windows yazıcı veya donanım bağımsız hizmet sürekliliğini kanıtlamaz.

Ham yerel loglar `/workspace/cicd-validation/` altında: `native-forced-before.log`, `native-fixed-repeat.log`, `full-1.log`, `full-2.log`, `full-3.log`, `audit-after.json`, `local-smoke.log`, `build.log`, `python-scanner.log`, `python-print.log`, `production-dry-run.log`. Loglar Git’e eklenmedi; gizli başarı API payload’ları kaydedilmedi.

## 5. Korunan alanlar ve kalan işler

Wrangler production config, mevcut build/deploy script’leri, print secret prehook’u, scanner ve Windows Agent kaynakları değiştirilmedi. `goc`, production D1/R2 binding’leri, PRINT_ENABLED, PHYSICAL_INTAKE_MODE, print seçenek/limitleri ve cron’lar aynen kaldı. Production veri/secret okuması veya yazımı yapılmadı; yalnız izin verilen salt okunur GitHub repo/branch/ruleset/environment metadata’sı incelendi. Önceki 403 yönetim uçlarına alternatif kimlik/yol ile erişmeye çalışılmadı. Mevcut Vercel deployment mekanizmasına dokunulmadı.

Kalan temel işler:

1. Kullanıcı incelemesi ve ayrıca push/PR onayı; ilk GitHub hosted CI koşusu ve required checks/review ayarları.
2. GitHub Actions/environment onay düzeni ve gerektiği ölçüde hedef repo App izinleri. Tek operatör/ikinci reviewer seçimi netleştirilmeli.
3. Cloudflare account doğrulaması, yalnız Production environment’ına konacak sınırlı deploy token’ı ve kimlikli read-only preflight/dry-run. Mevcut runtime secret değerleri CI’a taşınmamalı.
4. Güncel cloud backup/restore, schema/migration ledger ve güvenli rollback kanıtları. Mevcut JSON backup tam SQL recovery kanıtı değildir. Eski 0018’e özgü migration checker genel güncel kapı olarak kullanılmamalı.
5. Test edilmiş artifact ve onaylanmış exact SHA’yı gerçek deploy’a bağlayan ayrı, gözden geçirilmiş implementation. Mevcut deploy script’inin yeniden build davranışı artifact eşitliği açısından ele alınmalı. Bu görevde publication kilidi açılmadı.

İzinlerin, minimum Cloudflare token kapsamlarının, tablet adımlarının, production sözleşmesinin ve migration/rollback tasarımının ayrıntıları [cloud-ci-release.md](cloud-ci-release.md) dosyasındadır. Python transitif bağımlılıkları tam hash’li lock’a sahip değil; bu tekrarlanabilirlik işi açık kalıyor. CI’ın hosted runner üzerinde ilk çalışması, action/release approval özelliklerinin GitHub planınızda doğrulanması ve canlı Cloudflare yetki kontrolleri henüz yapılmadı.
