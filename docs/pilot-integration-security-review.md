# Pilot A+B entegrasyon ve güvenlik incelemesi

2 Ekim 2026. **Birleşik aday yerel incelemeye hazır. Uzak pilot için şu aşamada NO-GO:** staging etkinleştirmesi ve aşağıdaki uzak UAT kapıları çalıştırılmadı. Uzak deploy/migration/secret provisioning, push veya main merge yapılmadı. Oracle araştırması kapalı kaldı.

## Kaynak ve izolasyon

İlk olarak scanner `9864c33dabf0ad3ea0ccaaa7175c2a90612b0ebc` kaynak kodu, teslim raporu ve runbook okundu. Scanner worktree `codex/pilot-local-clamav` üzerinde temizdi. Ortak ancestor `a9304568d7484244f05ad65101086d5c7bfdfbaf`. Ayrı managed worktree `pilot-integration-review`, branch `codex/pilot-integration-review`, scanner HEAD'den temiz oluşturuldu. Başlangıç durumu kullanıcıya bildirildi.

Prompt A kaynak checkout'u `feat/pilot-cross-device-access`, HEAD ancestor ve dirty durumundaydı. Bu checkout'a checkout/reset/stash/commit uygulanmadı. Hazır `pilot-access-review.zip` sabit kopyası doğrulandı:

- SHA-256: `ff5550003ff4b1f3f73988f5cb186539f5fe67c44c031e26100fffe6bbbe5f3b`.
- 19 ZIP girdisi, 18 manifest hash'i, 11 tracked dosya + 4 yeni kaynak dosya. Absolute/traversal/backslash/symlink/duplicate yollar ve boyut sınırları kontrol edildi.
- `tracked_changes.patch`, ancestor'dan 11 tracked dosyanın tam paket kopyalarını birebir üretti. 0008 migration, auth modülü ve iki yeni test ayrıca alındı.
- Yalnız bu dondurulmuş teslim uygulandı. Ortak wizard test çatışmasında her iki ajanın testleri korundu. İlk birleşik import commit'i `94259e49c34e399d57932e4cbb14d3d4a5ee705f`.
- Final birleşik commit, ZIP içindeki `GIT_INFO.json` ve dış teslim mesajında kayıtlıdır. ZIP'in `combined.patch` dosyası ancestor'a, `corrections.patch` dosyası import commit'ine göre farkı içerir.

Eski Phase 8H scanner tasarımı kanonik `uluslarasiofis-phase8h-live-staging-uat` worktree'sinde bulundu ve okundu. Oradaki Oracle/Queue önerileri bugünkü MacBook/D1 pull kararıyla değiştirilmiş geçmiş bağlamdır; yeniden uygulanmadı.

## Kanıtlanan bulgular ve düzeltmeler

P0 bulunmadı. Bu, incelenmeyen uzak ortamın güvenli olduğu iddiası değildir. Aşağıdaki 5 P1 ve 4 P2 bulgu yalnız entegrasyon worktree'sinde düzeltildi.

| Kimlik | Öncelik / teslim | Somut tetikleyici ve etki | Kaynak / düzeltme | Kanıt / kalan etki |
| --- | --- | --- | --- | --- |
| A-01 | P1 / A | Owner regenerate auth kontrolünden sonra staff reset oturumu iptal eder; eski owner işlemi reset hash'ini yeniden değiştirir. Önce 200 dönüyordu. | `applicationRoutes.regenerateCurrentAccessCode`, `applicationRepository.updateAccessCode`, yeni `application-access-statements.js`: UPDATE, audit ve revocation aynı batch; observed code version, actor ve geçerli owner session DB'de guard edilir. | Batch sınırına reset enjekte eden regresyon artık 409; hash korunur, plaintext kod dönmez. Normal owner regenerate diğer owner oturumlarını iptal etmez; staff reset tümünü iptal eder. |
| A-02 | P1 / A | Aynı code version'ı görmüş ikinci staff reset ilk reseti ezip tekrar revoke/audit yapabiliyordu. | Aynı rotation helper'da version CAS; değişmeyen UPDATE için audit/revocation yok; staff route 409 verir. | İkinci stale reset null; ilk hash korunur, ilave audit/revocation yok. Audit insert hatasında hash/version/session değişimleri birlikte rollback olur. |
| A-03 | P1 / A | PATCH body'de `lock_version` yok, null, string veya geçersiz sayı olduğunda koruma atlanabiliyor; stale client yeni alanları ezebiliyordu. | `applicationRoutes.updateCurrentApplicationFields`: pozitif safe integer zorunlu, aksi durumda 400 `LOCK_VERSION_REQUIRED`. Mevcut API testleri edit öncesi GET'ten gerçek sürümü okur. | Beş geçersiz sürüm testi: hiçbir alan/sürüm değişmez. UI PATCH/autosave/type/address aynı owner writer üzerinden sürüm gönderir. |
| A-04 | P1 / A | Type switch önkontrolünden sonra başka cihaz v2 yazarsa remap batch'i stale v1 alanlarını/type'ı yazabiliyordu. | `applicationRepository.updateDraft`: document remap ve son application UPDATE'e draft/version guard; başarısız CAS conflict. | Gerçek SQLite batch sınırında v2 edit enjekte edilir: 409 exception, yeni isim/type/version ve belge type korunur. Deferred FK ve mevcut history/audit rollback testleri korunur. |
| A-05 | P1 / A | İlk autosave sürerken kullanıcı yeni alan girerse `onSaved` ertelenir; ikinci save eski `lock_version` ile kendi yazısıyla çatışır. | `applicationWizard.createAutosave`: her başarılı yanıtın sürümü sonraki serialized save'den önce güncellenir; pending kullanıcı alanları korunur. Phone fallback sürümü de taşır. | Kontrollü in-flight UI testi sürümleri [1,2], son v3 ve en yeni girdiyi doğrular. 409 testi form girdisinin kaldığını ve tek save denemesini doğrular; otomatik stale overwrite yok. |
| A-06 | P2 / A | Terminal duruma geçmiş başvuruya kodla yeni oturum alınabiliyor; status kontrolü INSERT guard'da yoktu. | Login ve `sessionRepository.createApplicationSessionGuarded` terminal durumları reddeder. | Terminal transition insertion testi session oluşturmaz; native completed login 401 ve cookie yok. Mevcut read-only terminal owner oturumu politikası genişletilmedi. |
| A-07 | P2 / A | Başarılı girişler de reference/IP limitini tüketiyordu: aynı başvuruya altıncı doğru giriş 429; ortak NAT'ta 60 başarılı giriş kotayı bitiriyordu. | `rejectAccessCredentials`: reference 5/15 dakika, IP 60/15 dakika sayaçları başarısız credential denemelerine uygulanır. Geçerli sahibi yanlış tahmin kotası kilitlemez. | Node ve native aynı NAT'tan 65 doğru giriş geçer; guessed-reference flood ardından doğru giriş geçer. Yanlış giriş kota/window testleri korunur. Hash/DB doğrulaması kota kararından önce yapılır; fiziksel üniversite NAT kapasite testi henüz yok. |
| A-08 | P2 / A | Staff identity-check/reset ekranı referansı beklerken detail DTO alanı atlıyordu; ekranda `-` görülüyordu. | `staffApplicationRoutes.createApplicationDetailDto` güvenli `reference_number` ekler. | Staff detail testi referansı doğrular; access hash/plaintext alanları yok. Checkbox gerçek kimlik kontrolünün kanıtı değildir. |
| B-01 | P2 / B | Invalid/stale signature timestamp veya eksik engine metadata ile `ready` heartbeat 200 kabul edilir; operasyon ekranı yanlış hazır görünebilir. | `scanner-routes.heartbeat`: parse edilen UTC timestamp; ready için engine/signature zorunlu, en fazla 24 saat yaş / 30 saniye ileri sınırı. | RED 200→GREEN 400 regresyonları; gerçek runner ready heartbeat native 200. Belge clean result kapısı zaten ayrıca katıydı; false-clean açığı gözlenmedi. |

İlk RED turları erişim/race/type/NAT/terminal, eksik sürüm/in-flight UI, heartbeat ve staff DTO kusurlarını üretti. Login/reset teslim testinin eski hali reset sonra login sıralı senaryoydu; isim/yorum düzeltildi ve hash doğrulama ile INSERT arasına reset enjekte eden gerçek interleaving testi eklendi. Zaman geciktirme ile race düzeltilmedi; güvenlik kararları DB commit sınırındadır.

## Bulgusuz yerel kontroller ve sınırlar

**Erişim:** 32 sembol × 26 bağımsız random byte, `byte & 31` uniform dağılım → **130 bit**. Referans ayrı 31 sembol × 8, rejection sampling `<248` → yaklaşık 39.63 bit; public identifier tek başına owner yetkisi değildir. SHA-256 yalnız normalize edilmiş yüksek entropili kodun hash'ini saklar. Normalizasyon delimiter/non-alphabet karakterlerini kaldırır; üretilen 26 sembolün entropisini azaltmaz.

Plaintext kod yalnız create/owner regenerate/yetkili staff reset cevabı ve kullanıcının açık eylemiyle indirilen metin dosyasında bulunur. DTO/tracking/audit/URL ve otomatik persistent browser storage'a eklenmez. HttpOnly/Secure/SameSite=Strict `application_session` cookie, hash olarak D1'de tutulur. Native workerd `crypto.subtle.timingSafeEqual` gerçek function, eşit=true/farklı=false ve gerçek kodla login PASS. Node shim/fallback tek başına hedef runtime kanıtı sayılmadı; JS XOR fallback için VM düzeyinde sabit zaman garantisi ileri sürülmüyor.

Owner/session, cross-application IDOR, lifecycle ve requested replacement yetkileri; staff reviewer/admin + same-origin reset ve diğer mutation kapıları kaynak/testte korunur. Reset UI, fiziksel kimlik kontrolü yönlendirmesi ve yalnız bellekte kod modalı var. Create response kaybında mevcut owner session üzerinden regenerate; legacy kayıtta referans backfill, hash null ve mevcut oturumdan kod edinme; submit confirmation ve beş dil UI testleri mevcut. Kimlik kontrolünün fiilen yapıldığını testler kanıtlamaz.

Gerçek giriş sözleşmesi: başvuru/form ve kodla erişim **`/basvuru/`**, public takip **`/basvurum/`**. `POST /api/public/applications/access`; draft edit `PATCH /api/public/applications/current`; autosave **PATCH** `/api/public/applications/current/autosave`; owner regenerate POST `/current/regenerate-access-code`; staff reset POST `/api/staff/applications/:id/reset-access-code`. Access paketindeki autosave POST notu yanlış; kaynak PATCH'tir.

**Tarama:** initial/replacement finalize job insert'i kendi atomic D1 batch'inde. UNIQUE file ve reconciliation historical/current pending boşluklarını kapatır. Atomik claim, 300 saniye lease, 3 deneme, expired/stale revision/result/replay sınırları testli. Result authority yalnız scanner bearer + exact lease/job/file/revision/object/key/size/hash/ETag; staff cookie yetmez. Download claim'den sonra 120 saniye içinde, tek object için başlar; bütün bucket credential runner'a verilmez.

Worker conditional R2 GET ve result öncesi tekrar object kontrolü, runner exact length/SHA-256; sınırlı içerik, official signatures, warning/skipped/encrypted/parse error/timeout non-clean davranışı incelendi. İlk write-once signed PUT `If-None-Match: *`; historical upload capability için job beklemesi normalde **10 dakikaya kadar** olabilir. Clean staff review/preview/download/archive gate'leri korunur. Pending ile öğrenci submit'in mevcut davranışı değiştirilmedi.

MacBook portable foreground runner, özel 0700 state / 0600 credential ve geçici dosya, bounded subprocess/parser, crash residue cleanup, update retry ve restart akışı var. Sürekli service kurulmadı; global uyku ayarı değiştirilmedi; public clamd/TCP/tünel açılmadı. Secret sonuç yazabilen güvenilir makine kimliğidir; compromise olursa sahte sonuç riski kalır. Signature güncellemesi ve host açık/uyanık/internet sorumluluğu operasyon kabulünün parçasıdır. Windows fiziksel çalıştırması doğrulanmadı.

## Son doğrulama

Eski branch PASS sayıları birleşik aday için kullanılmadı. Scanner-only baseline 477 PASS/1 SKIP; frozen A+B ilk import 503 PASS/1 SKIP idi. Aşağıdaki sonuçlar birleşik düzeltmeler üzerindedir; sonraki test yorum/ad düzeltmeleri ayrıca focused 22/22 geçti.

| Kontrol | Sonuç / exit code |
| --- | --- |
| `npm test` | **516 PASS, 0 FAIL, 1 SKIP / toplam 517**, 18.45 s, exit 0 |
| Python unittest discovery | **13/13**, exit 0 |
| `npm audit --json` | **0** info/low/moderate/high/critical, exit 0; bağımlılık kodunun eksiksiz güvenlik denetimi değildir |
| `npm run build:staging` | PASS, exit 0; önceden var olan `ocrService` static/dynamic import chunk uyarısı |
| `git diff --check` | PASS, exit 0 |
| Fresh local D1 | Native Wrangler **0001–0009** PASS, exit 0 |
| Upgrade / fresh regression | 0001–0007 legacy session + finalized pending fixture → 0008/0009: referans backfill, hash null, session korunur, job queued/pending; FK clean. 2/2 PASS |
| Ayrı opt-in gerçek ClamAV | **1/1 PASS**, 59.16 s, exit 0; aynı test varsayılan Node koşusunda SKIP |
| Native acceptance | **PASS**, exit 0; native workerd + local D1/R2 + gerçek MacBook ClamAV |

Atlanan testin tam adı: `real MacBook ClamAV scans via HTTPS job protocol and preserves staff/review/ZIP/replacement gates` (`test/scannerReal.test.js`). Ayrı `RUN_REAL_CLAMAV=1` koşusunda hiçbir skip yok. Gerçek HTTPS/ClamAV var; bu testin D1/R2'si SQLite/R2 adaptörüdür. PDF/PNG/JPEG/WebP clean; EICAR unsafe; encrypted/broken non-clean; initial/replacement, restart/outage, gerçek 1 saniye timeout üç deneme sonra failed ve ZIP içeriği doğrulanır.

Native `test/scanner/native-acceptance.py` ayrıca gerçek workerd/D1/R2 üzerinde çalıştırıldı: 65 geçerli ortak NAT girişi, bağımsız owner cookies, wrong/reference-only denial, PATCH 409, staff reset/revocation, owner regenerate, terminal denial, scanner-auth denial; **initial PDF clean, replacement PDF clean, replacement EICAR unsafe**. Pending/unsafe download/preview/archive 404, approve 409; clean download/archive-file exact bytes. ClamAV **1.5.4**, daily **28141**, build time **2026-10-02T06:26:12Z**; gerçek scan timestamps [native evidence](pilot-integration-evidence/native-acceptance.json) içinde.

Native harness local R2 CLI PUT, sentetik staff session ve under_review fixture, yalnız queue available_at hızlandırması kullanır. Scan verdict elle atanmaz. Fiziksel browser PUT/CORS, gerçek staff bootstrap/identity check, public submit tam zinciri ve uzak servis değildir. Sır değerleri/body/cookies kayıtlı kanıta konmadı. [Validation](pilot-integration-evidence/validation.json), [son çıktı özetleri](pilot-integration-evidence/test-summary.txt), [gerçek engine sonuçları](pilot-integration-evidence/real-clamav.json), [source provenance](pilot-integration-evidence/source-provenance.json).

## Teslim ve kalan kapılar

Review ZIP: tam tracked candidate source, combined/corrections patch, bu rapor, staging/UAT planı, sırsız evidence, frozen A kaynak ZIP ve checksum manifesti. `.git`, `.wrangler`, `.dev.vars`, node_modules/dist, venv/signature database, özel cert/key/secret veya test belge fixture dosyaları içermez. Commit/hash pakette kayıtlıdır; source ZIP'in daha sonra değişen worktree dosyaları alınmaz.

Yerel geçici HTTPS Worker, runner, clamscan ve test server süreçleri durduruldu. Owned private harness credentials, yerel D1/R2 test namespace'leri ve EICAR/sentetik fixture dosyaları temizlendi; scanner tmp boş. ClamAV, official signatures ve venv kurulu, sürekli runner etkin değil. Kaynak scanner/access worktree'leri korunur.

**Review adayı GO; 5 Ekim gerçek belge kabul pilotu koşullu NO-GO.** Açık kapılar: onaylı staging migration/deploy + private scanner credential, güncel signature/ready heartbeat ve gerçek uzak ilk/replacement scan; fiziksel iki cihaz/üniversite NAT/CSRF/kimlik reset UAT; private R2 browser write-once/CORS; gerçek staff review/ZIP zinciri; MacBook hafta sonu işletim sorumlusu ve Windows yedeği. Ayrıntılı adımlar [staging ve UAT planında](pilot-integration-staging-plan.md); tüm uzak kabul satırları **NOT EXECUTED**. Yerel PASS uzak scanner etkinliği anlamına gelmez.
