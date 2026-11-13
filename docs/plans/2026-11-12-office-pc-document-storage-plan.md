# Plan: store uploaded documents on an office Windows PC (instead of Cloudflare R2)

- **Date:** 2026-11-12
- **Scope:** planning only. No code, Cloudflare, or production change has been made.
- **Source:** owner request on 2026-11-12; code facts taken from commit `2a44596` (see "Code facts").
- **Validation status:** unvalidated plan. The tunnel, storage service and signed-upload design have not been tried, even in staging.
- **Institution permission:** stated by the owner as granted for this approach (not independently verified here).

## Decisions made by the owner (2026-11-12)

- The PC is under the owner's control. Downtime risk is judged minimal.
- Backup: after files land on the PC they are copied to the school's cloud account. Still open: whether that copy is encrypted and versioned, and a tested restore (see Phase 1).
- Existing R2 documents are copied to the PC; R2 is **not** deleted. UATs run first; R2 is emptied only if no problem appears, and only on the owner's explicit approval.
- Every production publication needs the owner's explicit approval (AGENTS.md workflow).

## PC inventory and decisions (2026-11-13)

Source: read-only inventory run by the PC agent, reported by the owner; not independently verified here.

- Lenovo ThinkPad, Windows 10 Pro 19045, 8 GB RAM, one `C:` volume of 237 GB (about 144 GB free). BitLocker is off.
- Power plan is already set to never sleep and "do nothing" on lid close.
- "Scanner" is the ClamAV document-scan daemon (not a physical scanner). It runs from `C:\Users\User\.uluslarasiofis-scanner` but imports code from a repo copy at `C:\Users\User\.gemini\antigravity\scratch\uluslarasiofis\scripts\scanner`. That copy must not be deleted or updated casually.
- Print Agent v7 runs from `C:\Users\User\.topkapi-print-agent` via a Startup script. Its `prod_secret.dpapi` is bound to this machine and the `User` account, so it cannot be moved or copied.
- Both agents start in the user session (Startup / Registry Run), not as Windows services.
- Owner decisions: Windows 10 still receives security updates (owner's statement, unverified here); **automatic sign-in will be used**.
- Auto sign-in risk: the password is stored on the machine. Enable BitLocker first, use Sysinternals Autologon (stores the password as an LSA secret) and have the owner type the password; the agent must never handle it.

Folder layout: `C:\Goc\storage` is a real folder; `C:\Goc\print` and `C:\Goc\scan` are junctions to the existing agent folders. Nothing existing is moved. Junction creation is reversible.

Revised Prompt A (supersedes the older Prompt A below):

```text
Rol: Bu Windows PC'de belge deposu için hazırlık yapıyorsun. Mevcut Print Agent ve Scanner çalışıyor; onları bozmamak en önemli kural.

Kesin kurallar:
- Hiçbir belge dosyasını açma/okuma/yükleme.
- Mevcut klasörleri TAŞIMA, SİLME, yeniden adlandırma; Startup/Registry/zamanlanmış görev kayıtlarına, scanner.secret ve prod_secret.dpapi'ye, C:\Users\User\.gemini\antigravity\scratch\uluslarasiofis klasörüne DOKUNMA.
- Şifre/token/anahtar isteme, yazma, rapora koyma. Giriş gerektiren her adımı (Cloudflare girişi, otomatik oturum açma şifresi) bana bırak ve bekle.
- Güvenlik duvarına GELEN bağlantı kuralı ekleme.
- Her değişikliği geri alma komutuyla birlikte C:\Goc\degisiklik-gunlugu.txt'ye yaz.
- Emin olmadığın veya yönetici izni gereken adımda dur ve sor.

Yapılacaklar (sırayla, her adımdan sonra raporla):
1. C:\Goc\storage klasörünü oluştur. İzinler: yalnızca yeni, yönetici olmayan yerel "svc-gocdepo" hesabı ve yöneticiler; diğer kullanıcıların erişimini kaldır.
2. C:\Goc\print ve C:\Goc\scan için junction oluştur (mklink /J): print -> C:\Users\User\.topkapi-print-agent, scan -> C:\Users\User\.uluslarasiofis-scanner. Hedeflerin içeriğine ve izinlerine dokunma. Print Agent ve Scanner'ın hâlâ çalıştığını doğrula.
3. BitLocker'ı C: için açma adımlarını hazırla; kurtarma anahtarını nereye kaydedeceğimi sor, kendin saklama. Otomatik oturum açmayı BitLocker açıldıktan SONRA kur (Sysinternals Autologon; şifreyi ben gireceğim).
4. Windows güncelleme durumunu raporla (son yama tarihi). Değiştirme.
5. MinIO'yu Windows servisi olarak, svc-gocdepo ile, yalnızca 127.0.0.1'e bağlı, veri klasörü C:\Goc\storage olacak şekilde kur. Erişim anahtarlarını yerelde üret, yalnızca svc-gocdepo okuyabilen bir dosyaya yaz; bana yazma.
6. cloudflared'i servis olarak kur. Cloudflare giriş/tünel oluşturma adımını bana bırak ve bekle. Tüneli yalnızca MinIO'nun yerel adresine yönlendir.
7. Doğrulama: yeniden başlatmada MinIO ve cloudflared oturum açılmadan başlıyor mu; otomatik oturum açılınca Print Agent ve Scanner normal başlıyor mu; dışarıdan doğrudan erişim kapalı mı?
8. Rapor: yapılanlar, sürümler, açık riskler ve geri alma adımları.
```

## Agent prompts (give these to the PC agent tomorrow)

Rules for both prompts: the agent never receives passwords, API tokens or keys inside a prompt; the owner types or pastes secrets only into the tool that needs them. The agent must not open, read, upload or summarize any student document. If something is unclear, it stops and asks.

### Prompt A - PC preparation (Phase 2)

```text
Rol: Bu Windows PC'yi, bir web portalının belge deposu olacak şekilde hazırlıyorsun. Bu PC'de öğrenci belgeleri tutulacak; bu yüzden ihtiyatlı ol.

Kesin kurallar:
- Hiçbir belge dosyasını açma, okuma, özetleme, yükleme. Yalnızca klasör/servis/ayar işleri yap.
- Şifre, API anahtarı, token isteme ve hiçbir yere yazma. Giriş gerektiren her adımı (Cloudflare giriş, token) bana bırak ve bekle.
- Mevcut tarayıcı (scanner) yazılımına, yazdırma ajanına (Print Agent) ve mevcut klasörlere dokunma.
- Güvenlik duvarında GELEN bağlantı kuralı ekleme. Tüm dış erişim yalnızca cloudflared tüneli üzerinden olacak.
- Her değişikliği, geri alma komutuyla birlikte "degisiklik-gunlugu.txt" dosyasına yaz.
- Emin olmadığın veya yıkıcı bir adım varsa dur ve sor.

Yapılacaklar (sırayla; her adımdan sonra sonucu bana raporla):
1. Durum tespiti (salt okuma): Windows sürümü, disk bölümleri ve boş alan, BitLocker durumu, güç planı (uyku ayarı), yönetici hesapları.
2. Veri klasörü: Tarayıcı çıktılarından ayrı bir klasör/bölüm oluştur (örn. D:\GocDepo). Yalnızca "svc-gocdepo" adlı, yönetici olmayan yeni yerel hesaba ve yöneticilere izin ver; diğer kullanıcıların erişimini kaldır.
3. Güvenlik: Veri diskinde BitLocker açık değilse bunu bana bildir (kurtarma anahtarını bana göster, kendin saklama). Uyku ve hazırda bekletmeyi kapat. Otomatik yeniden başlatmayı çalışma saatlerinde engelle.
4. Depolama servisi: MinIO'yu (ya da benim seçeceğim alternatifi) Windows servisi olarak, svc-gocdepo hesabıyla, YALNIZCA 127.0.0.1'e bağlı olacak şekilde kur. Erişim anahtarlarını yerelde üret ve yalnızca svc-gocdepo'nun okuyabildiği bir dosyaya yaz; bana sohbete yazma.
5. Tünel: cloudflared'i Windows servisi olarak kur. Tünel oluşturma/giriş adımını bana bırak ve bekle. Tünelin yalnızca depolama servisinin yerel adresine gitmesini sağla.
6. Doğrulama: Servislerin yeniden başlatmadan sonra kendiliğinden açıldığını, 127.0.0.1 dışından doğrudan erişimin kapalı olduğunu ve PC yeniden başlayınca her şeyin geri geldiğini kanıtla.
7. Rapor: Yapılan her şey, kullanılan sürümler, açık kalan riskler ve geri alma adımları.

Bitirdiğinde "Tamamlandı" demeden önce 6. adımın çıktısını göster.
```

### Prompt B - Code work (Phase 3; run on a development machine with the repo, not on production)

```text
Rol: Bu repoda (uluslarasiofis) belge depolamayı Cloudflare R2'den, tünel arkasındaki S3 uyumlu bir sunucuya taşıyacak kodu yazıyorsun.

Önce oku: AGENTS.md ve docs/plans/2026-11-12-office-pc-document-storage-plan.md. Kurallar AGENTS.md'de bağlayıcıdır.

Kesin kurallar:
- Production'a yayın yapma, workflow tetikleme, wrangler deploy çalıştırma, push etme. Yalnızca yerelde çalış ve commit et; push ve yayın benim onayımla.
- Production D1/R2, secret, cron, scanner, Print Agent v7, PRINT_ENABLED=true ve PHYSICAL_INTAKE_MODE=on korunacak.
- Hiçbir secret'ı koda, teste, log'a yazma. Değerler Worker secret/binding olarak okunacak.
- Gerçek öğrenci belgesi kullanma; yalnızca sahte test verisi.
- Mevcut testleri bozma; her değişiklik testle birlikte gelsin.

Hedef: Worker, belgeleri bir "depolama adaptörü" üzerinden okuyup yazsın; adaptörün iki uygulaması olsun: mevcut R2 ve yeni "uzak S3 uyumlu sunucu (tünel + Access servis tokenı)". Hangisinin kullanılacağı yapılandırmayla seçilsin, böylece geri dönüş mümkün olsun.

Yapılacaklar:
1. src/server/storage/ altında arayüz tanımla: get, put (write-once), head, delete, list ve yükleme yetkisi (upload grant). Storage key düzeni değişmesin.
2. Doğrudan environment.DOCUMENTS kullanan her yeri (grep ile bul: scanner-routes, physical-*, mobile-*, staffApplicationDeletionRoutes, physical-receipt-* vb.) adaptöre geçir.
3. createUploadCapability / createWriteOnceUploadCapability yerine, Worker'ın verdiği kısa ömürlü, tek kullanımlık, boyut sınırlı bir yükleme yetkisi tasarla; write-once ve SHA-256 (object_identity) doğrulamasını koru. Tasarım seçeneklerini yazıp bana sun, onay almadan uygulama.
4. Depolama erişilemezse: yükleme ve önizleme anlaşılır bir hata/yeniden dene mesajı versin; kayıt yarım kalmasın.
5. Taşıma aracı: R2'deki nesneleri listeleyip PC deposuna kopyalayan, her nesnenin SHA-256'sını D1'deki object_identity ile karşılaştıran, SİLME YAPMAYAN, tekrar çalıştırılabilir bir betik yaz (scripts/ altında, README'siyle). Önce kuru çalıştırma (dry-run) modu olsun.
6. Okuma sırası: önce yeni depo, bulunamazsa R2 (geçiş dönemi), yapılandırmayla kapatılabilsin.
7. Testler: yükleme, hash uyuşmazlığı, tarama kapısı (scan_status='clean'), önizleme, depo erişilemez, yeniden deneme, eski R2 yolu hâlâ çalışıyor.
8. Çalıştır: npm test, npm run build:production, npm run deploy:dry-run:production. Sonuçları olduğu gibi raporla.

Teslim: yerel commit(ler), değişen dosyaların listesi, açık sorular ve riskler. Emin olmadığın tasarım kararlarında dur ve sor.
```

## Goal

1. Files uploaded to the portal are stored on the office PC, not in R2.
2. Staff can preview and view those files from other devices through the portal (existing staff login and scan gate).
3. Cloudflare keeps only the Worker, D1 and small backups.

## Known inputs (from the owner)

- PC runs Windows and is normally on (it is used for the physical scanner). Downtime tolerance: not a problem.
- PC disk: 256 GB or 500 GB. Current R2 usage: roughly 10 GB. Disk space is therefore ample; **backup and availability are the real risks, not capacity.**
- The exact Cloudflare limit that blocked bulk export is **not yet identified** (see Phase 0).

## Code facts (verify before relying on them)

- Worker reads/writes documents through the `DOCUMENTS` R2 binding (`get`, `put`, `head`, `list`) in at least `scanner-routes.js`, `physical-pdf-routes.js`, `physical-registration-routes.js`, `mobile-transfer-routes.js`, `mobile-photo-upload.js`, `physical-receipt-*.js`.
- Browser uploads use signed R2 PUT URLs: `createWriteOnceUploadCapability` in `src/server/storage/r2DocumentStorage.js`, used by `applicationDocumentRoutes.js` and `resubmissionUploadRoutes.js`.
- Print files use a separate `PRINT_FILES` bucket. The nightly D1 backup writes to R2 (`d1BackupService.js`).
- The Göç bulk export and staff previews stream files through the Worker, so Worker request/CPU limits apply regardless of where files live.

## Target design

```
Student browser --(signed, short-lived upload grant)--> Worker --(Cloudflare Tunnel + Access service token)--> storage service on office PC
Staff browser   --(staff login, scan gate)-----------> Worker --(tunnel)--> storage service --> bytes streamed to browser
```

- The PC connects outward with `cloudflared`; no inbound port is opened.
- No direct file URLs are handed to browsers. Previews always go through the Worker.
- Files are write-once; SHA-256 of each stored file is compared with `object_identity` before a record is finalized.

## Security incident and encrypted-storage design (2026-11-13)

Source: report from the PC agent session (not independently verified): a renamed signed `SbieSvc.exe` started from `Run\GoogleUpdateTaskMachineQC` in `AppData\Roaming\Sandboxie`, an unsigned 75 MB `SbieDll.dll` beside it (DLL side-loading pattern), Defender disabled by policy and Windows Update blocked since 2024-07-22. The PC is school property and cannot be reinstalled; the owner decided to clean it and keep using it.

Consequences accepted in this plan:
- Treat the PC as potentially compromised until the cleanup (quarantine, Defender re-enabled, full + offline scan, Windows Update) is verified. Even then, residual risk remains.
- Rotate the Print Agent and Scanner secrets **after** cleanup is verified, and change passwords used on the PC from another device.
- Do not enter BitLocker recovery key or Autologon password until the cleanup is verified.
- Documents on the PC must be **encrypted at rest with a key the PC never holds**.

### Encrypted remote storage design (to be reviewed before code)

Findings in the current code (commit `2a44596`):
- `src/server/storage/r2DocumentStorage.js` already exposes a provider-neutral shape: `put`, `putIfAbsent`, `get`, `head`, `delete`, `createQuarantineKey`, plus signed capabilities. `createReadCapability` is unused; student uploads use `createWriteOnceUploadCapability` (signed PUT, `If-None-Match: *`).
- A Worker-mediated upload path already exists for local development (`uploadLocalStudentDocument`: `readBoundedUploadBody` then `putIfAbsent`). Documents are limited to 10 MB (`MAX_DOCUMENT_BYTES`), so whole-object encryption in the Worker is feasible.
- Finalization trusts `head()` for size and content type, and several routes use ETag preconditions.
- `aws4fetch` is already a dependency and can sign S3 requests to SeaweedFS.

Design:
1. New adapter `createRemoteDocumentStorage` with the same interface. Config selects R2 or remote; both can be active (dual read, remote first, R2 fallback) during migration.
2. Object format: `magic | version | key id | 12-byte IV | AES-256-GCM ciphertext+tag`. Per-object data key derived with HKDF from a master key (Worker secret) and the storage key; the storage key is also the GCM additional data so objects cannot be swapped. Master key is never on the PC.
3. `head()` reports the plaintext size (stored size minus overhead) and the plaintext content type, kept in S3 object metadata (not secret). The stored object content type is `application/octet-stream`. ETag stays the opaque store ETag.
4. Upload: Worker-mediated PUT (existing local-upload pattern) replaces browser-to-R2 signed PUT for the remote store. Replay protection stays in D1 (`intent_status = pending`) plus conditional write if the store supports it; otherwise HEAD-then-PUT with unique UUID keys.
5. Transport: Worker to the PC through Cloudflare Tunnel with SigV4 (`aws4fetch`). Reaching the tunnel without a domain needs Workers VPC services or a domain; unresolved.
6. Staff preview/download and the bulk export keep streaming through the Worker, which decrypts; no direct URLs.
7. Scanner: ClamAV needs plaintext, so the scanner PC still receives decrypted documents into `tmp\job-*` while scanning. Encryption at rest does not protect that window; it is only as safe as the scanner PC.
8. Backup to the school cloud copies ciphertext only. The master key must be escrowed separately offline; losing it loses all documents.
9. Migration: a Worker-side batch (admin-only) reads R2 objects through the binding, encrypts, writes to the remote store, reads back and compares SHA-256 with the plaintext. It runs in small batches to respect Worker limits. No key or R2 token on the PC. No R2 deletion in this phase.
10. D1 backups and `PRINT_FILES` stay on R2.

To verify before coding: SeaweedFS S3 support for conditional writes, ETag/metadata behavior and SigV4 compatibility; Workers VPC availability on the account; Worker CPU/memory for 10 MB AES-GCM.

### Implementation status (2026-11-13, local, uncommitted, not deployed)

Done and tested (`npm test` 1497 passed, 1 skipped, 0 failed; `npm run build:production` ok):
- `src/server/storage/encryptedObject.js`: AES-256-GCM format, HKDF per-object key bound to the storage key, key ids for rotation.
- `src/server/storage/remoteDocumentStorage.js`: S3-compatible adapter (SigV4 via `aws4fetch`) with the R2 adapter's object shape; host sees ciphertext only; write-once check does not trust the host's conditional support.
- `createDocumentStorage` selects it only when `DOCUMENT_STORAGE_BACKEND=remote`; R2 stays the default.
- `test/remoteDocumentStorage.test.js` with an in-memory fake host.

Also done: `scanner-routes.js`, `physical-pdf-routes.js`, `physical-registration-routes.js`, `mobile-photo-upload.js`, `mobile-transfer-routes.js`, `mobile-transfer-batches.js` and `staffApplicationDeletionRoutes.js` now use `createDocumentStorage(environment)`. With the default R2 backend their behavior is unchanged (full suite green). The adapter key check now accepts any UUID-shaped `quarantine/` key because physical registration derives keys from a digest; `deleteMany` was added to both adapters. Purge only resolves storage when the application has stored files.

Decision: `receipts/` objects (generated physical receipts), `print/` objects (separate `PRINT_FILES` bucket) and D1 backups (`worker.js`) stay on R2. Only the `quarantine/` student-document namespace moves, so the `DOCUMENTS` R2 binding must remain configured.

Also done (2026-11-13): with `DOCUMENT_STORAGE_BACKEND=remote`, student uploads use the existing Worker-proxied PUT (`local-upload` route, now gated by `isWorkerProxiedUploadEnabled`), and a new `resubmission-upload/{intentId}` route (`uploadResubmissionDocument`) does the same for replacement uploads. `test/remoteDocumentUpload.test.js` covers the student path end to end (intent, PUT, ciphertext on host, replay 409, finalize, auth, outage 503 then retry). The resubmission route is only covered for gating and authentication, not a full replacement flow.

Incident update (2026-11-13, PC agent report, not verified here): an active cryptominer runs as SYSTEM (`explorer.exe` to a mining pool), re-creates its files within seconds of quarantine and re-applies the Windows Update block at boot. The owner decided not to involve the school IT office and to keep using the PC. The encrypted design is the mitigation; no documents are on the PC yet. Secrets present on the PC (scanner, Print Agent, `s3.json`, Claude login) must be treated as exposed and rotated from another device.

Also done (2026-11-13, later): `DOCUMENT_STORAGE_BACKEND=dual` (`dualDocumentStorage.js`: new objects to the encrypted remote store, reads fall back to R2, deletes remove both, a remote outage is never reported as "not found"); `documentMigrationService.js` and the administrator-only route `POST /api/staff/storage-migration/batch` (body: optional `cursor`, `limit` 1 to 20, `dry_run`). It reads R2 only, copies with `putIfAbsent`, reads each copy back decrypted and compares SHA-256, removes a copy that fails, and never deletes from R2. Tests in `test/documentMigration.test.js` (full suite 1508 passed, 1 skipped, 0 failed, build ok).

SeaweedFS 4.53 behavior measured on the office PC by the PC agent with dummy bytes (agent report, not verified here): PUT returns a quoted ETag (MD5 of the stored bytes) and no `x-amz-meta-*`; `If-None-Match: *` on an existing key returns 412; HEAD returns `Content-Length`, ETag and `X-Amz-Meta-goc-content-type`; `If-Match` with the right ETag returns 200 and a wrong one 412; DELETE then HEAD returns 404; path-style 1 KB and 5 MB objects work. A Worker identity limited to the `documents` bucket exists (`ListBuckets` is allowed and returns names only). These match the adapter's assumptions. Credentials are in `C:\Goc\config\worker-s3.txt` on the PC and must be copied into Worker secrets by the owner; treat them as exposed while the miner is present.

Not done (the feature is **not** end to end yet):
- Move `staffDocumentAccessRoutes.js`/`documentRoutes.js` checks that still require the `DOCUMENTS` binding only if the binding is ever removed (not planned).
- Student and resubmission uploads still issue browser-signed R2 PUT URLs; the remote backend needs a Worker-mediated upload route (pattern: `uploadLocalStudentDocument`).
- Admin-only batch migration job (R2 to encrypted remote, read-back SHA-256 check).
- Dual read (remote first, R2 fallback) during migration.
- Real SeaweedFS check of ETag, `If-Match` and metadata behavior, and Workers VPC availability.
- Encryption key generation, Worker secret setup and offline key escrow.

## Phases

### Phase 0 - Identify the limit (before any build)
- Cloudflare dashboard: R2 storage (GB), R2 Class A/B operations, Worker requests and CPU for the failure window; correlate with the HTTP 503 times in the export summary.
- Outcome decides whether moving storage solves the problem or whether Worker limits (export throttling) are the real issue.

### Phase 1 - Decisions (mostly resolved, see top)
- Resolved: PC owner/administrator is the owner; backup goes to the school cloud account; PC-off behavior is accepted.
- Still open: how the school-cloud copy is made (scheduled sync vs per-upload), whether it is encrypted and versioned, and a **tested restore** before cutover.
- Still open: whether `PRINT_FILES` and D1 backups stay on R2 (recommended: yes, they are small).
- Dedicated non-admin Windows service account runs the storage service (in Prompt A).

### Phase 2 - PC preparation
- BitLocker on the data disk; storage in a dedicated folder/partition separate from scanner output.
- Disable sleep; controlled Windows updates; restrict to local admin accounts only.
- Install `cloudflared` as a service; create a tunnel and an Access policy (service token for the Worker only).
- Storage service as a Windows service (S3-compatible such as MinIO, or a small custom HTTP service). Choose in a staging spike; the deciding factor is how write-once signed uploads are handled.

### Phase 3 - Code (staging first)
- Storage adapter in `src/server/storage/` with `get/put/head/list` and an upload grant; same key scheme as today.
- Move direct `DOCUMENTS` users to the adapter.
- Replace signed R2 PUT with a Worker-issued short-lived upload grant honoring write-once and size limits.
- Tests for: upload, hash mismatch, scan gate, preview, PC unreachable, retry behavior.
- `npm test`, `npm run build:production`, `npm run deploy:dry-run:production` before delivery.

### Phase 4 - Migration of existing R2 documents
- Inventory R2 objects (count, bytes); copy to the PC; verify each SHA-256 against `object_identity`; reconcile with D1 records.
- Transition period: read from the PC first, fall back to R2. No R2 deletion in this phase.

### Phase 5 - Release
- Push to `production`, then the manual **Production release** workflow for the exact SHA, with separate explicit approval and Production environment review (AGENTS.md).
- Preserve D1/R2 data, secrets, cron, scanner, Print Agent v7, `PRINT_ENABLED=true`, `PHYSICAL_INTAKE_MODE=on`.

### Phase 6 - Cleanup (later, separate approval)
- After a stable period and a verified offsite backup, delete migrated documents from R2 only with the owner's explicit approval.

## Risks to watch

- PC outage, disk failure or accidental deletion: mitigated only by tested backups. Test a restore before cutover.
- The office PC is shared with scanner work: keep the storage folder permissions separate.
- Moving storage does not remove Worker request/CPU limits for bulk exports.

## Next step (planned for 2026-11-13)

Phase 0 numbers, then a staging spike of tunnel + storage service without touching production code.
