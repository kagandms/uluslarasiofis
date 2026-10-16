# Tabletten günlük yayın

PR #6 sade modelle revize edildi. Production yayın kilidi açıkça korunur. Gerçek export, restore, rollback veya deploy bu dalın parçası olarak çalıştırılmaz.

## Günlük tek release akışı

`production-release.yml`: manuel exact production HEAD SHA → required CI → test edilmiş immutable artifact → GitHub Production reviewer onayı → Cloudflare account/goc/binding/runtime secret metadata/cron/vars ve D1 ledger → güncel backup sağlığı + geçerli periyodik restore + Worker rollback uyumu → aynı artifact ile dry-run → koşulsuz publication lock.

Mevcut CI artifact upload/download round-trip, dosya listesi, boyut/SHA-256 ve commit SHA doğrulaması korunur. İkinci deployment sistemi yoktur. Backup/export/restore release'de çalışmaz. Bakımın tek imzalı metadata kaydı son 24 saatlik backup, son 30 günlük drill ve gerçek provenance gerektirir; dört authority/controller yoktur. Gerçek bakım işleri, kaynaklar, kimlikler ve başarılı kanıtlar henüz yoktur: gate geçmez.

## Exact-artifact teknik hazırlığı

`scripts/ci/artifact-dry-run.mjs` sadece dry-run destekler:

1. İndirilmiş artifact SHA/manifest bütünlüğünü doğrular.
2. `dist/uluslarasiofis_local/wrangler.json` için Worker `goc`, production target, `main:index.js`, `no_bundle:true`, `assets.directory:../client`, vars/cron/secret metadata/D1/R2/config uyumunu doğrular; build hook veya env override'ı reddeder.
3. Flatten edilmiş config ile `wrangler deploy --config <artifact-config> --no-bundle --dry-run --outdir <temp>` çalıştırır. `--env production` kullanılmaz: generated config zaten production'dır. npm/Vite build çağrısı yoktur. Kaynak dosyalar yerine paketteki Worker+client kullanılır.
4. Artifact'ın değişmediğini tekrar doğrular. CI gerçek download sonrası aynı kimliksiz provayı çalıştırır; release'de mevcut print secret metadata guard'ı da korunur.

**Hazırlanan, etkin olmayan yayın implementasyonu:** `exact-artifact-release.mjs` kaynak/manifest/config, canlı preflight/ledger/recovery ve aktif sürümü tekrar doğrular; aynı paketi `--no-bundle --keep-vars --message release:<SHA>` ile bir kez yayımlama, sürüm/source annotation doğrulama, salt okunur health ve metadata kaydı sırasını içerir. Aynı SHA yeniden yayımlanmaz; hatada otomatik retry/restore/rollback yoktur. Pinned Wrangler upload kodunda `keepSecrets:true` davranışı kontrol edildi. CLI, `config/production-publication.json` içindeki `enabled:false` nedeniyle credential/I/O erişiminden önce durur. Workflow eski koşulsuz `exit 1` adımını korur; hazırlanmış sonraki adım `if:success()` ile erişilemez. Hiçbir yayın izni eklenmedi.

**Ayrı onayda kalanlar:** Aynı config ve artifact doğrulamasını kullan; yayın anında production SHA'yı ve canlı drift'i tekrar kontrol et; reviewed değişiklikle yalnız `--dry-run` sınırını gerçek deploy'a dönüştür. Doğrulanmış release için account/Worker sabit kalmalı; runtime secret değerlerini silmeyen/değiştirmeyen Wrangler davranışı gözden geçirilmeli (secret bulk/put/delete yok). Source ve generated config değişmez kalmalı. Başarılı deployment'ın immutable version ID'sini ve aynı kaynak/config/asset hash'lerini metadata olarak kaydet, sonra mevcut `post-deploy-healthcheck.mjs` ile altı sabit public GET çalıştır. Hata otomatik veri restore/rollback veya print requeue başlatmaz. Gerçek publish implementasyonu iki kilidin arkasında hazırdır; canlı health çağrısı veya kilidi aşan bir workflow yolu çalıştırılmadı.

## Ayrı bakım

`recovery-preparation.yml` bugün sentetik test için manuel giriş noktasıdır; approved gerçek günlük backup, periyodik restore ve gerekirse yalnız metadata yenilemesi aynı bakım sürecine eklenir. Schedule henüz etkin değil. Süre, kapsam, provenance, erişim ve maliyet seçenekleri mevcut [kurtarma envanterinde](recovery-readiness.md) bulunur. Aynı backup'ı her release'te restore şartı ve her deploy'da üretimi durdurma şartı kaldırıldı. İlk gerçek backup'ta D1/R2 referans tutarlılığı yine çözülmeli; consistency report gereklidir.

## İlk güvenli deployment'a en kısa sıra

1. Başlangıç seçimi: aynı hesapta ayrı private kaynaklar; tam SQL + DOCUMENTS (`backups/` dışlanır) + şimdilik PRINT_FILES; 30 gün, günlük backup/aylık restore. Dashboard kapasite/plan/lifecycle/usage bilgilerini al; retention uyumu ve maliyeti doğrula. Resource ID, gerçek işlem ve bütçe onaylarını varsayma.
2. Onay sonrası aynı bakım workflow'unda gerçek backup + ilk izole restore + tek güvenilir imzalı metadata üretimini tamamla; gerçek storage/hash/reference/no-job-replay sonuçlarını doğrula. Günlük backup ve aylık/değişiklik sonrası restore otomasyonunu kur; hata alarmını ekle. Gerçek sonuç olmadan policy enable etme.
3. Bu PR'ın gerçek CI/dry-run sonucunu incele; exact-artifact publish + version kaydı + salt okunur health bağlantısını ayrı reviewed değişiklikte tamamla. Publication lock değişikliği, merge ve ilk deploy için ayrıca onay al.

Sonraki kullanım: tablet/Codex → PR ve CI → incelenmiş merge → manuel exact-SHA release → GitHub onayı. Şema migration'ı, destructive işlem, secret rotation ve binding/cron değişikliği ayrı onaylı bakım/değişiklik süreci gerektirir; günlük release otomatik migration içermez.
