# Prompt B teslim ve gerçek tarama kanıtı

Tarih: 2 Ekim 2026. Sonuç: **MacBook gerçek ClamAV hattı ve yerel backend kabulü PASS. Uzak staging/pilot etkinleştirme NOT EXECUTED.** Prompt A ve son entegrasyon/güvenlik incelemesi ayrı görevdir. Oracle/hosting araştırması yapılmadı.

## Başlangıç ve izolasyon

- Kaynak checkout: `/Users/kagansmtdms/Downloads/Проекты/uluslarasiofis-production-readiness-assessment`.
- Başlangıç branch: `codex/production-readiness-assessment`; HEAD `a9304568d7484244f05ad65101086d5c7bfdfbaf`; çalışma ağacı temizdi.
- Kod baseline `b29f1d5a6fb848912decf3b5f3d9fe3fae1c911c` ile aday HEAD arasında yalnız beş doküman farkı doğrulandı.
- İzole managed worktree: `/Users/kagansmtdms/.codex/worktrees/pilot-local-clamav/uluslarasiofis-production-readiness-assessment`; branch **`codex/pilot-local-clamav`**, aynı başlangıç HEAD.
- Envanter 0001–0007 idi. **0008 erişim ajanına bırakıldı, 0009 tarama için kullanıldı.** Başka branch merge edilmedi; push, remote migration ve deployment yapılmadı.
- Son durum kontrolünde kaynak checkout diğer ajanın `feat/pilot-cross-device-access` branch'inde, aynı başlangıç HEAD üzerinde Prompt A değişiklikleri/0008 ile dirty idi. Bu değişiklikler bu tarama worktree'sine alınmadı ve üzerine yazılmadı.
- İncelenen proje yollarında AGENTS.md ve mevcut managed worktree'lerde `phase8h-scanner-design.md` bulunmadı; içeriği varsayılmadı. Sohbetteki AGENTS kuralları uygulandı. Mevcut production assessment ve finalize/R2/staff/review/ZIP kaynakları baseline üzerinden okundu.

## Değişiklik kapsamı

| Dosya / grup | Son davranış |
| --- | --- |
| `migrations/0009_document_scanner.sql` | Durable jobs, UNIQUE file, due/lease index, heartbeat ve historical current-pending backfill; trigger yok |
| `src/server/repositories/d1/scanner-job-statement.js` | Finalize batch'lerine koşullu atomik job insert |
| `documentRepository.js`, `resubmissionUploadRepository.js` | Her iki finalize yolunda aynı transaction ile job oluşur; mevcut rollback/satır sayısı guard'ları korunur |
| `scanner-repository.js` | Reconciliation, CAS claim, 300 saniye lease, 3 deneme, stale revision, guarded result, kontrollü audit'li retry/status |
| `src/server/domain/scanner-policy.js` | Yetkili sonucu tam job/object/content kimliğine ve taze engine/signature metadata'ya bağlayan doğrulama |
| `src/server/routes/scanner-routes.js` | HTTPS machine auth, claim/content/result/heartbeat/status; staff status/retry |
| `src/server/worker.js` | Üç dar router kayıt satırı; erişim ajanıyla entegrasyonda birlikte kontrol edilecek |
| `applicationDocumentRoutes.js` | Initial upload signed PUT write-once `If-None-Match: *` |
| `scripts/scanner/*.py`, `requirements.txt` | Portable outbound HTTPS runner, gerçek clamscan, freshclam/health, private temp cleanup, bounded child parser |
| `src/staff/scanner-manager.js`, `main.js` | Backlog/host/son scan görünürlüğü ve failed job retry |
| `src/public/applicationWizard.js`, `i18n/messages.js` | Pending davranışı korunur; unsafe/failed anlaşılır error durumları; TR/EN/RU/TK/AR metinleri |
| `.dev.vars.example`, `.gitignore` | Yalnız secret adı ve Python generated cache ignore |
| `test/scanner*.test.js`, `test/helpers/scanner-real-fixture.js`, `test/scanner/test_runner.py` | Queue/API/UI/runner ve opt-in gerçek engine kabulü; mevcut iki test dosyasında focused regresyon |
| Bu rapor, plan ledger, runbook ve `docs/evidence/pilot-local-clamav/` | Tasarım, işletim, sırsız gerçek kanıtlar, UAT ve rollback |

Öğrenci submit'in pending ile mevcut davranışı değiştirilmedi. Staff preview/download/review/archive clean kapıları değiştirilmedi. Kullanılan scanner secret güvenilir sonucu yazabilen makine kimliğidir; runner'a staff cookie veya tüm bucket R2 credential verilmez. Protokol ve kaynak maliyetleri [işletim kılavuzunda](pilot-local-clamav-runbook.md) ayrıntılıdır.

## Son doğrulama sonuçları

| Kontrol | Sonuç / sınır |
| --- | --- |
| Fresh checkout baseline `npm test` | PASS 464/464 |
| Son `npm test` | **PASS 477; fail 0; 1 opt-in gerçek test skip; toplam 478** |
| Python unittest discovery | **PASS 10/10** |
| Opt-in gerçek MacBook ClamAV acceptance | **PASS 1/1**, 55.99 saniye; aşağıdaki senaryolar gerçek engine ile |
| `npm run build:staging` | **PASS**; mevcut `ocrService` static/dynamic import chunk uyarısı devam ediyor |
| `git diff --check` | PASS |
| Wrangler local D1 migrations, fresh namespace | **PASS 0001–0007 + 0009**; tüm işlem `--local` |
| Native HTTPS workerd + local D1 + local R2 | **PASS** ilk clean, replacement clean, EICAR unsafe ve staff erişim kapıları |
| Uzak staging migration/deploy / gerçek browser presigned PUT | **NOT EXECUTED** |
| Gerçek Windows/Linux, iki fiziksel host, yeni cihaz erişimi | **NOT EXECUTED**; sonuncusu Prompt A'nın kapsamı |

Raw tam test logları yerel `/tmp/pilot-clamav-final-{npm,python,real,build}.log` dosyalarında; repo içindeki güvenli özetler: [Node](evidence/pilot-local-clamav/node-tests-summary.txt), [Python](evidence/pilot-local-clamav/python-tests.txt), [gerçek runner](evidence/pilot-local-clamav/real-runner-acceptance.txt), [build](evidence/pilot-local-clamav/staging-build-summary.txt), [local migration](evidence/pilot-local-clamav/local-d1-migrations.txt).

### Gerçek MacBook / motor kanıtı

- Doğrulanan fiziksel ortam Darwin 27 arm64 / macOS 27.0.1; uzak Linux kurulumu kullanılmadı.
- ClamAV **1.5.4**, daily **28141**, main **63**, bytecode **339** resmi freshclam ile alındı. Explicit certificate diziniyle update tekrar başarılı; daily detached signature `sigtool --verify` ile doğrulandı.
- Temiz sentetik PDF: 3,628,114 known signatures, scanned files 1 / infected files 0; 5.97 saniye, 1,590,345,728 bayt RSS, 1,679,361,680 bayt peak footprint. [Gerçek engine/resource çıktısı](evidence/pilot-local-clamav/engine-resources.txt), [freshclam çıktısı](evidence/pilot-local-clamav/freshclam.txt).
- Clamd özel Unix socket ile start/PING/VERSION/stop gerçek makinede doğrulandı. Socket 0600; TCP listener oluşturulmadı. Üretilecek runner clamscan policy kullanır, clamd bağımlılığı yoktur.

### Gerçek runner + yerel HTTPS/backend adaptörü

`RUN_REAL_CLAMAV=1 SCANNER_REAL_STATE="$HOME/.local/share/uluslarasiofis-scanner" node --disable-warning=ExperimentalWarning --test test/scannerReal.test.js` final kaynak üzerinde çalıştırıldı. Engine, imzalar ve HTTPS transport gerçektir; D1/R2 bu testte SQLite/R2 adaptörüdür. Sonuç:

- Sentetik temiz PDF/PNG/JPEG/WebP → gerçek `clean`.
- İlk ve replacement PDF → iki ayrı gerçek tarama; staff preview yetkisi, birebir download, review approve ve ZIP içinden birebir dosya kanıtı.
- EICAR eklenmiş sentetik PNG → gerçek `unsafe`; preview/download/review/ZIP reddi.
- Şifreli PDF ve broken image → gerçek `failed` sonucu; clean yok, otomatik deneme bekleyen job `queued/pending` kalır.
- Engine executable yok → heartbeat `engine_unavailable`, job durable queued; executable tekrar seçilince aynı job clean olur.
- Gerçek clamscan process için 1 saniye hard timeout, üç deneme → `failed/scan_timeout`; access/review/ZIP kapıları kapalı.
- Test sonunda private `tmp/job-*` dosyası yok. Her scan engine/signature/build zamanı ve scanned_at kanıtıyla kaydedildi.

Bu test yalnız mock verdict'e dayanmaz; [tam sırsız metadata](evidence/pilot-local-clamav/real-runner-acceptance.txt) bulunur. İmzalar 24 saatlik kabul penceresi dışında ise yeni freshclam update olmadan test/runner clean üretmemelidir.

### Native Worker / D1 / R2 kabulü

Wrangler'ın gerçek local HTTPS workerd, local D1 ve local R2 bağlarıyla ek kabul yapıldı. Fresh `.wrangler/scanner-final` namespace'e migration'lar uygulandı. Initial/replacement upload-intent ve finalize API'leri gerçek Worker üzerinden çalıştı; bytes local R2'ye Wrangler CLI ile kondu. Runner HTTPS üzerinden gerçek object'i aldı ve gerçek ClamAV sonuçlarını aynı local D1'ye yazdı.

1. İlk PDF → `clean/scanned`, 1 deneme, `2026-10-02T17:48:50.328Z`.
2. Replacement PDF → ikinci `clean/scanned`, 1 deneme, `2026-10-02T17:49:01.395Z`.
3. İkinci replacement EICAR PNG → `unsafe/malware`, 1 deneme, `2026-10-02T17:49:12.313Z`; staff download 404.

Üçünde de engine 1.5.4 / daily 28141 / signature build `2026-10-02T06:26:12Z`. Exact download/archive-file bytes ve preview authorization da PASS. [Native sonuç JSON'u](evidence/pilot-local-clamav/native-workerd-d1-r2.json).

Kabul sürücüsü yalnız sentetik queue `available_at` zamanını ilerletti; **scan_status veya clean verdict elle atanmadı**. Staff/session ve under_review yaşam döngüsü local test fixture olarak seed edildi; tam öğrenci browser submit UAT kanıtı değildir. Local PUT CLI kullanıldığından uzak signed PUT/CORS kabulü bu kanıtın parçası değildir.

Native D1 önemli bir farkı ortaya çıkardı: ilk trigger tasarımında `meta.changes` replacement finalize için `[1,1,1,1,1,2,1]` döndü; SQLite adaptörü yalnız doğrudan değişikliği sayıyordu. Trigger kaldırıldı; iki finalize batch'ine explicit conditional job insert eklendi. Mevcut strict guard'lar gevşetilmedi. No-trigger/row-count regresyonu ve native yeniden çalışma PASS.

### Kaynak/API doğrulaması — gerçek iki host kabulüyle karıştırılmamalı

Behavioral SQLite/API testlerinde atomic finalize/job rollback, dedupe/backfill/reconciliation, iki bağımsız claim, expired lease/üç deneme, failed kontrollü retry, unauthorized/replayed/expired result, farklı object/key/hash/revision ve stale signature reddi PASS. R2 I/O sırasında lease expiry için 200→409 RED→GREEN regresyonu eklenip database-clock commit guard uygulanmıştır. Bunlar gerçek iki fiziksel scanner host testi değildir.

Python döngüsü için ayrıca update failure + heartbeat network failure birlikte test edildi: ilk davranış update yeniden denemeden claim'e geçiyordu (RED); retry işareti heartbeat'ten önce ayarlandı (GREEN), başarılı update olmadan claim yapılmıyor. Son Python toplamı 10/10.

## Kalan işler ve pilot engelleri

1. **Ayrı entegrasyon/güvenlik görevi:** Prompt A/B commit'leri, 0008/0009 sırası, ortak worker/public i18n/finalize etkileşimleri ve birleşik HEAD test/build incelemesi. Bu branch tek başına birleşik ürün kabulü değildir.
2. **Owner tarafı staging activation:** D1 backup/migration, yeni Worker deployment ve özel `SCANNER_SECRET` provisioning. Değer sohbetten istenmedi; özel dosyada tutulmalıdır. Remote işlemler bu görevde yetki kapsamı dışındadır.
3. **Gerçek staging/browser UAT:** initial/replacement write-once PUT ve R2 CORS, gerçek object integrity, staff review/ZIP, host outage/restart, replay/stale revision; runbook sırayı verir. Mevcut yerel PASS uzak servisin çalıştığını kanıtlamaz.
4. **Operasyon:** MacBook çalışma saatlerinde açık/uyanık/internete bağlı tutulmalı; foreground runner yeniden başlatılmalı. Windows yedek host üzerinde aynı protocol için gerçek installation/scan testi yapılmalı. Otomatik launchd/service kurulmadı.

Yerel test Worker, clamd ve runner süreçleri teslimde durduruldu. Ephemeral test credential/TLS dosyaları ve synthetic local D1/R2/fixture içerikleri temizlendi; resmi signature/venv/private config MacBook'ta tutuldu. Gerçek öğrenci belgesi kullanılmadı veya diskte arşivlenmedi. Uzak pilot halen **NOT EXECUTED**; son entegrasyon incelemesi ayrıca yapılmalıdır.

İşletim, config adları, rotation, Windows/Linux taşıma, staging UAT ve geri alma: [pilot-local-clamav-runbook.md](pilot-local-clamav-runbook.md). Commit kimliği Git HEAD'den alınır; rapor commit'in içine kendine referans veren SHA koymaz.
