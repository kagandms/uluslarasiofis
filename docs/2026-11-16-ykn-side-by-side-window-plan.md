# YKN eklentisi: YÖKSİS penceresini portal yanında açma planı

- **Tarih:** 2026-11-16
- **Kapsam:** `ykn_eklenti-main/` (background.js, bridge.js, gerekirse popup), `test/` altında yeni bir test dosyası
- **Kaynak:** Mevcut kod incelemesi (background.js sekme/pencere odağı, bridge.js mesaj iletimi, `yknLiveContract.test.js` mock yapısı)
- **Durum:** Plan. Kod yazılmadı, test çalıştırılmadı. Yayın kapsamında değil.
- **Not (2026-11-16):** Bu belge üç bölüm içerir. Bölüm 1: YKN pencere yerleşimi (yukarıdaki görev). Bölüm 2: erişim kodu kurtarma, e-posta teslimi ve Telegram botu. Bölüm 3: "GöçNet'e aktar" hatası düzeltmesi (Görev E). Beş görev eşzamanlı, ayrı worktree/dalda yürütülür.

## Neden

Kabul kodu YKN portalında aratılıp YÖKSİS'e aktarılırken kullanıcı iki sekme arasında gidip geliyor. Hedef: portal ve YÖKSİS penceresi ekranda yan yana görünsün; YÖKSİS'te giriş ve kayıt kontrolü normal tarayıcı penceresinde yapılsın. Iframe yaklaşımı reddedildi (YÖKSİS oturum çerezi üçüncü taraf bağlamda gönderilmez; eklenti tab tabanlı çalışır).

## Kapsam dışı (değiştirilmeyecek)

- Iframe veya gömme yaklaşımı.
- Eklentinin sekme/çerçeve (frame) tabanlı doldurma ve arama mantığı.
- `manifest.json` izinleri ve host izinleri. `chrome.windows` için yeni izin gerekmez; `system.display` eklenmeyecek.
- `manifest.json` içindeki `version` alanı (sürüm artırımı yayın kararıdır, bu görevde yapılmaz).
- `public/downloads/` altındaki üretilmiş dosyalar.
- Sunucu tarafı: `migrations/`, `wrangler.jsonc`, `package.json`, `package-lock.json`, `config/production-publication.json`, `docs/README.md`.
- `yetkili/index.html` ve portal sayfası kodu.

## Tasarım kararları (önerilen varsayılan, kullanıcı değiştirebilir)

1. **Ekran alanı:** `bridge.js` (eklentinin kendi içerik betiği) runtime mesajına `screenArea` ekler: `{ availLeft, availTop, availWidth, availHeight }` (`window.screen` değerleri). Arka plan bu değeri kullanır. Değer yoksa (popup'tan gelen istek vb.) yerleştirme atlanır ve mevcut davranış aynen korunur.
2. **Yerleşim:** Portal penceresi ekranın sol yarısına, YÖKSİS penceresi sağ yarısına. Her iki pencere de `state: 'normal'` yapılır (maksimize/tam ekran pencere bounds değişikliğini yok sayar). Yükseklik `availHeight`.
3. **Aynı pencerede ise:** YÖKSİS sekmesi portal ile aynı pencereye aitse, sekme `chrome.windows.create({ tabId, state: 'normal', ... })` ile kendi penceresine taşınır. Yeni pencere kimliği oturum belleğinde (`chrome.storage.session`) tutulur; sonraki aramalarda yeniden taşıma yapılmaz.
4. **YÖKSİS kapalıysa:** Mevcut `getBackgroundYoksisTab` akışı `createTab` ile sekmeyi açıyor. Bu durumda sekme doğrudan sağ yarıda yeni bir pencerede açılır (`chrome.windows.create({ url, focused: false, ... })`). Giriş gerekiyorsa kullanıcı bu pencerede girer; eklenti giriş ekranını otomatik doldurmaz.
5. **Aç/kapat ve YKN bağlamı:** Popup'a "YÖKSİS'i portal yanında aç" onay kutusu eklenir ve varsayılan **açık** olur (kullanıcı kararı: YKN bölümü açıkken açık olabilir). Tercih `chrome.storage.local`'da tutulur. Yerleştirme yalnızca iki koşul birlikte sağlanınca yapılır:
   - Onay kutusu açık.
   - İstek YKN bölümünden gelmiş: `bridge.js`, `yetkili/index.html` içindeki `#view-ykn` öğesinin `hidden` olmadığını kontrol edip `yknViewOpen` bayrağını `screenArea` ile birlikte gönderir. Bayrak `false` ise (YKN bölümü kapalıysa) hiçbir pencere taşınmaz.
   - Böylece YKN bölümünden çıkıldığında eklenti pencereleri kendiliğinden taşımaz. `yetkili/index.html`'e dokunulmaz; bayrak yalnızca DOM okunarak alınır.
6. **Hata davranışı:** Pencere bilgisi alınamazsa, pencere kapanmışsa veya yerleştirme başarısız olursa işlem durdurulmaz; `console.warn` ile loglanır ve arama/aktarım normal devam eder. Yerleştirme asla doldurma veya aramanın başarısını etkilemez.
7. **Odak:** Mevcut `windows.update(..., { focused: true })` çağrıları değişmez. Pencereler yan yana olduğu için odak değişimi her iki pencerenin de görünür kalmasını bozmaz.

## Ekip kaydı

- **Görev dalı:** `task/ykn-side-by-side-window` (production'dan, ayrı worktree).
- **Worktree yolu:** ana klasörün yanında, örn. `../uluslarasiofis-ykn-side-window`. Oluşturma komutu Claude tarafından, delege etmeden önce çalıştırılır.
- **Birleştirme:** Test ve kullanıcı kararından sonra `production`'a merge commit ile alınır (squash/rebase yok). Yayın ayrıca istenir.

## Agent (agy) görev tanımı

Çalıştırmadan önce Claude şunları yapar: `agy -p "/usage"` ile kota kontrolü; model: `gemini-4-hydrogen-high` (limit yoksa `gemini-4-argon-high`). Tek agent yeterli; görev tek dosya setine bağlı, paralel iş yok.

**GOAL**
YKN eklentisinde, YÖKSİS aktarımı ve arama akışı sırasında YÖKSİS penceresini portal penceresinin yanına (sağ yarı) yerleştiren, popup'ta açılıp kapatılabilen, hata durumunda akışı bozmayan bir yerleşim mantığı eklemek.

**YOU OWN** (yalnızca bu dosyaları düzenleyebilirsin)
- `ykn_eklenti-main/background.js` (yalnızca yeni yardımcı fonksiyonlar ve mevcut `transferToYoksisOperation`, `getBackgroundYoksisTab`, `returnToPortalTab` çağrı noktalarına ekleme)
- `ykn_eklenti-main/bridge.js` (yalnızca `screenArea` alanının eklenmesi)
- `ykn_eklenti-main/popup.html` ve `ykn_eklenti-main/popup.js` (yalnızca onay kutusu)
- `test/yknSideBySideWindow.test.js` (yeni dosya)

**DO NOT TOUCH**
- `ykn_eklenti-main/manifest.json` (izin ve sürüm dahil)
- `ykn_eklenti-main/` içindeki diğer dosyalar (`content.js`, `yoksis-*.js`, `gocnet-*.js`, `portal-security.js`, `document-parser.js`, `cropper*`, `storage-lifecycle.js`, `pdf*`)
- `package.json`, `package-lock.json`, `migrations/`, `wrangler.jsonc`, `config/`, `docs/README.md`, `public/`, `scripts/`, `src/`, `yetkili/`
- Mevcut testler (`test/yknLiveContract.test.js` dahil). Yeni test dosyası yazabilirsin; mevcut testlerdeki beklentileri değiştirme.
- Git: commit, push, merge, branch silme, worktree silme yapma.

**CONTEXT**
- Mevcut akış: `transferToYoksis` → `transferToYoksisOperation` (background.js ~2300+) YÖKSİS sekmesini `resolveYoksisTab` ile bulur veya `getBackgroundYoksisTab` ile açar; `updateTab(..., {active: true})` ve `chrome.windows.update(windowId, {focused: true})` çağırır (~satır 1752, ~2108). `returnToPortalTab` (~1908) portal penceresini öne getirir.
- YÖKSİS sekme sorgusu: `queryTabs({ url: '*://yoksis.yok.gov.tr/*' })`. Oturum saklama: `readSessionYoksisTabId` / `writeSessionYoksisTabId` (`chrome.storage.session`).
- Portal istekleri `bridge.js` içinde `chrome.runtime.sendMessage({ source: 'IKAMET_PORTAL', action, ...payload })` ile iletilir (~satır 100-110).
- `chrome.windows.update` izni manifestte ayrıca istenmez (`tabs` ve `storage` mevcut). Yeni izin ekleme.
- Test altyapısı: `test/yknLiveContract.test.js` içinde `chrome` mock'u var; `windows.update` mock'ta `calls` dizisine kaydediliyor (~satır 417). Yeni mock'lar aynı desende yazılmalı.
- Windows bounds: pencere `state` değeri `normal` değilse `left/top/width/height` yok sayılır.

**DONE WHEN**
1. `screenArea` bridge'den gelince, YÖKSİS penceresi sağ yarıya, portal penceresi sol yarıya taşınır; hem `state: 'normal'` hem bounds çağrılır.
2. YÖKSİS aynı pencerede ise sekme yeni pencereye taşınır; ikinci aramada tekrar taşınmaz.
3. YÖKSİS sekmesi yoksa yeni pencere açılır ve arama akışı mevcut şekilde devam eder.
4. Onay kutusu kapalıyken hiçbir `chrome.windows.*` yerleştirme çağrısı yapılmaz (mevcut `focus-window` çağrıları dışında yeni çağrı yok).
5. `chrome.windows.get/update/create` hata verdiğinde işlem başarısız olmaz; sadece uyarı loglanır.
6. Yeni test dosyası yukarıdaki maddeleri kapsar (en az: kapalı/açık, aynı pencere taşıma, tekrar taşımama, pencere yok, API hatası).
7. Kodda yalnızca "Ekran" ve "Pencere" yardımcıları var; mevcut fonksiyon imzaları değişmez.

**RULES**
- Bu ortamda headless `accept-edits` modunda shell komutu çalışmaz. **Hiçbir komut çalıştırma**: test, build veya dry-run yapma. Testleri ve build'i Claude çalıştıracak.
- Dosya dışına çıkma. "DO NOT TOUCH" listesindeki dosyaya dokunma.
- Sürüm numarası, `package.json` ve migration değiştirme.
- Commit, push veya git komutu çalıştırma.
- Mevcut `focused: true` odak çağrılarını kaldırma.
- Pencere/sekme kimliklerini, kullanıcı verisini, çerezleri, şifreleri veya token'ları kodda, testte veya rapor'da yazma. Test verisi sentetik olsun.
- Doğrulanmamış bir Chrome API davranışını kesin varsayma; belirsiz noktayı raporda belirt.
- Kod yorumları Türkçe, tanımlayıcılar İngilizce (mevcut dosyalarla uyumlu).

**REPORT**
- Değiştirilen dosyalar ve her biri için kısa açıklama (satır aralığı ile).
- Eklenen fonksiyon adları ve imzaları.
- Yazılan test dosyasının kapsadığı senaryolar.
- Belirsiz kalan noktalar (özellikle: yerleşimin Chrome sürümleri arasındaki davranışı, `availLeft` değerinin çoklu monitörde durumu).
- Çalıştırılmayan komutlar: "Test çalıştırılmadı" diye açıkça yaz; başarı iddia etme.

## Claude'un doğrulaması (agent raporu kanıt değildir)

1. Diff'i oku; yalnızca "YOU OWN" dosyalarında değişiklik olduğunu doğrula (`git status`, `git diff --stat`).
2. `npm test` (pretest paketlemeyi de çalıştırır).
3. `npm run build:production`.
4. `npm run deploy:dry-run:production` (yayın değildir).
5. Hata varsa sorunu agent'a somut defect ve düzeltme direktifiyle geri gönder; Claude ürün kodunu kendisi düzeltmez.

## Yerel manuel test (kullanıcı tarafı)

Bu adımı kullanıcı kendi tarayıcısında yapar. Giriş bilgilerini Claude'a vermez, giriş yapmaz.

1. Chrome'da `chrome://extensions` → geliştirici modu → "Paketlenmemiş öğe yükle" → görev worktree'sindeki `ykn_eklenti-main` klasörü.
2. Portal `http://localhost` üzerinde açık olsun (manifestte izinli) veya test ortamı.
3. Popup'ta "YÖKSİS'i portal yanında aç" kutusunu işaretle.
4. Kabul kodunu ara; YÖKSİS penceresinin sağ yarıda açıldığını ve portalın sol yarıda kaldığını kontrol et.
5. YÖKSİS sekmesini kapat, aramayı tekrarla: yeni pencerenin sağda açıldığını ve giriş ekranının göründüğünü kontrol et. Girişi kendin yap.
6. Kutuyu kapat, aramayı tekrarla: hiçbir pencerenin taşınmadığını doğrula.
7. Ekran değişikliği (çoklu monitör) durumunu not et.

## Açık sorular (kullanıcı kararı)

- Karar alındı: popup onay kutusu varsayılan **açık**; yerleştirme yalnızca YKN bölümü açıkken yapılır (bkz. madde 5).
- Ekran alanı yoksa (örn. popup tetiklemesi) bir fallback gerekiyor mu? Öneri: hayır, yerleştirme atlanır.
- Kullanıcı YKN bölümünü açık tutup YÖKSİS penceresini elle kapatırsa, bir sonraki aramada pencere yeniden açılmalı mı? Öneri: evet (mevcut `getBackgroundYoksisTab` akışı zaten sekme açar).

---

# Bölüm 2: Başvuru erişim kodu kurtarma, e-posta teslimi ve Telegram (eşzamanlı görevler)

- **Tarih:** 2026-11-16
- **Kapsam:** Ana sayfaya "Başvuru kodumu unuttum" akışı (e-posta ve Telegram kanalları), e-posta kotası/spam kontrolü. Yukarıdaki YKN penceresi görevinden bağımsızdır; YKN görevinin "YOU OWN" kapsamı değişmez.
- **Kaynak:** 2026-11-16 oturumunda kod okuması (`applicationRoutes.js`, `application-access-statements.js`, `referenceMailService.js`, `homeResumeForm.js`, `docs/reference-mail-setup.md`) ve kullanıcı kararları.
- **Durum:** Plan. Kod yazılmadı, test çalıştırılmadı, hiçbir şey yayınlanmadı. Meta/WhatsApp ve Telegram sağlayıcı davranışları doğrulanmadı; görev sırasında resmi belgeden teyit edilmelidir.

## Kullanıcı kararları

- Eşzamanlı çalışma: bu bölümdeki 3 görev ve Bölüm 1'deki YKN görevi ayrı worktree/dalda aynı anda yürütülür.
- **WhatsApp ertelendi:** Ofis numarası normal (kişisel) WhatsApp'ta; coexistence yalnızca WhatsApp Business uygulaması numaraları için geçerli ve ayrı numara yok. Numara sorunu çözülene kadar WhatsApp kanalına kod yazılmayacak. Kodda zaten `metaWhatsAppProvider.js`, `metaWhatsAppWebhook.js`, `/api/webhooks/whatsapp` ve rıza kaydı var; bunlara dokunulmaz.
- **SMS yok:** Ücretsiz ve güvenilir sağlayıcı bulunamadı (doğrulanmamış bilgi). Şimdilik kapsam dışı.
- **Telegram botu Cloudflare Worker içinde çalışır** (webhook). Okul PC'sinde barındırılmaz: PC'nin ele geçirildiği 2026-11-13 notlarında yazılı, temizlik doğrulanmadı.
- Bot token'ı ve webhook gizli anahtarı yalnızca kullanıcının elinden Cloudflare secret'ına girilir. Hiçbir agent, rapor, test veya dosya bu değerleri görmez.
- Kullanıcı e-posta spam/gereksiz klasörü kontrolünün gerekli olduğunu istedi: hem öğrenciye gösterilen metin hem teslim edilebilirlik kontrolü planlandı (Görev C).
- **Karar (2026-11-16): yeni kod isteğinde eski kod hemen iptal olur.** Yeni tablo/migration yok.
- **Karar (2026-11-16): e-posta, öğrencinin sistemde kullandığı dilde (tr/en/ru/tk/ar) tek dilli gönderilir.** Dil bilgisi sunucuda saklanmadığı için istekle birlikte gelir (aşağıdaki "Mevcut durum" ve sözleşme).

## Mevcut durum (kod okumasından, doğrulandı)

- Giriş (başka cihaz) `POST /api/public/applications/access` ile başvuru numarası + öğrenci numarası + erişim kodu ister (`accessApplicationWithReference`, `applicationRoutes.js`). Erişim kodu 26 karakterdir, yalnızca SHA-256 hash'i saklanır; eski kod yeniden gönderilemez, yeni kod üretilmelidir.
- Taslak oluşturulunca öğrenciye ekranda bir kez kod gösterilir. Giden e-posta (`referenceMailService.js`) başvuru numarasını, öğrenci numarasını ve portal bağlantısını içerir, **erişim kodunu içermez**. Gönderim Apps Script üzerinden, ücretsiz Gmail hesabıyla, günde 100 alıcı sınırıyla yapılır; kota dolunca `quota_deferred` işaretlenir ve sonraki gönderimde 20'lik gruplar halinde yeniden denenir.
- Kod döndürme: `createAccessCodeRotationStatements` (`application-access-statements.js`) versiyon korumalı döndürme yapar; `actorType` yalnızca `student` (açık oturum şart) ve `staff` kabul eder. Personel sıfırlaması `resetStaffApplicationAccessCode`, öğrenci yenilemesi `regenerateCurrentAccessCode` olarak var.
- Hız sınırı altyapısı: `security/requestRateLimit.js`, `security/application-rate-limits.js`, `repositories/d1/rateLimitRepository.js`.
- Son migration `0042_application_reference_mails.sql`. Bu bölümdeki planlar **yeni migration gerektirmez** (aşağıdaki tasarım mevcut tablolarla çalışır).
- Telefon normalizasyonu `src/shared/phone` altında; başvuruda `student_phone` ve `student_email` alanları var.
- **Dil sunucuda saklanmıyor.** Arayüz dili tarayıcıda tutulur (`document.documentElement.lang`, `main.js` içinde `localStorage` anahtarı). Başvuru kaydında dil alanı yoktur; sunucuda yalnızca isteğe bağlı WhatsApp rıza dili (`whatsapp_consent_language`) vardır. Bu yüzden e-posta dili, isteğin yapıldığı andaki arayüz dilinden alınır: taslak oluşturma isteği ve kurtarma isteği isteğe bağlı `language` alanı taşır (migration gerekmez).
- Mevcut e-posta (`buildReferenceMail`) beş dili tek gövdede birleştiriyor ve sabit iki dilli konu satırı kullanıyor.

## Ortak sözleşme (görevler birbirini beklemeden paralel yazılabilsin diye sabit)

1. **Servis:** `src/server/services/accessRecoveryService.js` (Görev A yazar). İmzalar:
   - `findRecoverableApplication(database, { studentNumber })` → `{ applicationId, referenceNumber, studentEmail, studentPhone, language } | null`. Yalnızca öğrenci numarasının aktif (completed/cancelled/rejected olmayan) tek başvurusu döner.
   - `rotateAccessCodeForRecovery(database, { applicationId, channel, requestId, now })` → `{ accessCode } | null`. `channel` değeri `'email'` veya `'telegram'`; denetim kaydı (`audit_events`) ve `access_code_version` korumasıyla atomik döndürme yapar. Öğrenci oturumlarını iptal etmez.
2. **API:**
   - `GET /api/application-recovery/options` → `{ email: true, telegram: { enabled: boolean, url: string | null } }` (Görev A yazar; `TELEGRAM_BOT_USERNAME` ortam değişkeni doluysa `enabled: true`, `url: https://t.me/<kullanıcıadı>?start=recover`; arayüz geçerli dili ekleyerek `?start=recover_<dil>` biçiminde açar, `<dil>` değeri `tr|en|ru|tk|ar`).
   - `POST /api/application-recovery/email` gövde `{ "student_number": "...", "language": "tr|en|ru|tk|ar" }` → her zaman aynı `202 { "ok": true }` (kayıt var/yok ayrımı sızmaz, yanıt süresi benzer tutulur). `language` isteğe bağlıdır; geçersiz veya eksikse yok sayılır ve geri dönüş metni kullanılır.
   - `POST` taslak oluşturma isteği (mevcut uç nokta) isteğe bağlı `language` alanı kabul eder; yalnızca taslak e-postasının dilini seçmek için kullanılır, kaydedilmez.
3. **Telegram** görevi (C yerine D) bu servisi içe aktarır; Görev A birleştirilene kadar test çifti (stub) kullanır, birleştirme sonrası gerçek servise bağlanır.
4. Bu sözleşme değişirse önce bu belge güncellenir, sonra görevlere haber verilir.

## Dosya sahipliği ve ortak dosyalar

| Görev | Dal | Worktree (örnek) | Sahip olduğu dosyalar |
| --- | --- | --- | --- |
| Bölüm 1: YKN pencere | `task/ykn-side-by-side-window` | `../uluslarasiofis-ykn-side-window` | `ykn_eklenti-main/` (belirtilen dosyalar), `test/yknSideBySideWindow.test.js` |
| A: Erişim kodu kurtarma (e-posta + ana sayfa) | `task/access-recovery-email` | `../uluslarasiofis-recovery-email` | `src/server/services/accessRecoveryService.js` (yeni), `src/server/routes/applicationRecoveryRoutes.js` (yeni), `src/server/services/referenceMailService.js`, `src/server/repositories/d1/application-access-statements.js`, `src/server/repositories/d1/applicationRepository.js` (yalnızca kurtarma sorgusu), `index.html`, `src/public/home.js`, `src/public/main.js`, `src/public/homeRecoveryForm.js` (yeni), `src/public/public.css`, `src/public/i18n/recovery-messages.js` (yeni) ve `messages.js` içinde bu dosyanın kaydı, `src/server/routes/applicationRoutes.js` (yalnızca taslak oluşturma işleyicisinin `language` alanını alıp `sendDraftReferenceMail`'e geçirmesi), `src/public/applicationApi.js` ve taslağı oluşturan istemci çağrısı (`language` alanı), `test/referenceMailService.test.js` (yalnızca yeni dil testleri eklenir; mevcut beklentiler değişmez), `test/` altında yeni testler |
| C: E-posta teslimi / spam | `task/mail-deliverability` | `../uluslarasiofis-mail-deliverability` | `docs/reference-mail-setup.md`, Apps Script gönderici betiği (bu belgenin işaret ettiği kısım; `apps_script.txt` tebligat proxy'sidir, dokunulmaz), `docs/` altında yeni bir teslim edilebilirlik kontrol belgesi |
| D: Telegram kurtarma botu | `task/telegram-recovery` | `../uluslarasiofis-telegram-recovery` | `src/server/routes/telegramWebhookRoutes.js` (yeni), `src/server/services/telegramBot.js` (yeni), `src/server/worker.js` (yalnızca webhook yolu kaydı), `wrangler.jsonc`, `scripts/ci/runtime-secret-metadata.mjs`, `test/` altında yeni testler |

Kurallar:
- `worker.js` A ve D için sıcak dosyadır: her görev yalnızca kendi yolu için bir import ve bir kayıt bloğu ekler. Önce A birleştirilir, D çakışmayı çözüp testleri yeniden çalıştırır.
- `package.json`, `package-lock.json`, `migrations/`, `config/production-publication.json`, `docs/README.md` bu bölümde hiçbir görevin değildir. `docs/README.md` indeks bağlantısını ve baseline ilerletmeyi Claude son adımda tek başına yapar.
- Görev D, `wrangler.jsonc` ve `scripts/ci/runtime-secret-metadata.mjs` değiştirdiği için tam yayın yolunu (preflight) gerektirir. Görev A ve C (kod yok) hızlı yoldan yayınlanabilir; A'da migration, `wrangler.jsonc` veya secret yoktur.
- Her görev agy ile `--mode accept-edits` çalıştırılır: agy shell komutu çalıştıramaz, testleri ve build'i Claude çalıştırır. Çalıştırmadan önce `agy -p "/usage"`; model `gemini-4-hydrogen-high` (ağır işler) veya `-medium`; limit biterse `gemini-4-argon-high`. `/swarm` kullanılmaz. Dört paralel agent kota harcar: önce kullanılabilir limitler kontrol edilir.

## Görev A: Erişim kodu kurtarma (e-posta) ve ana sayfa

**GOAL**
Ana sayfada, mevcut "başvuruya devam et" formunun yanında "Başvuru kodumu unuttum" bağlantısı/formu eklemek. Öğrenci numarasını girince, o öğrencinin aktif başvurusu varsa kayıtlı e-postasına başvuru numarası, öğrenci numarası ve **yeni** erişim kodu gönderilir. Kanal seçenekleri `GET /api/application-recovery/options` ile gelir (Telegram açıksa buton gösterilir).

**TASARIM KARARLARI**
1. Yeni kod üretilir ve eski kodun yerine geçer; eski kod hemen geçersiz olur (kullanıcı kararı; hash saklandığı için eskisi zaten gönderilemez). Bu, başkasının numarasıyla kodunu sıfırlatma riski doğurur: etkisi, kodu e-postadaki yeniye çevirmek zorunda kalmaktır. Önlemler: (a) açık oturumlar iptal edilmez, (b) başvuru başına günde en fazla 3 kurtarma, IP başına 15 dakikada 5 istek, (c) yanıt hep aynı (`202`), (d) e-postada "siz istemediyseniz yok sayın" uyarısı.
2. `createAccessCodeRotationStatements`: `actorType` değerlerine `'recovery'` eklenir; bu türde açık oturum şartı aranmaz ve denetim olayı `application.access_code_recovered` yazılır. Mevcut `student` ve `staff` davranışı aynen korunur (mevcut testler bozulmaz).
3. Kota payı: Apps Script sınırı günde 100 alıcıdır. İlk kayıt (taslak) e-postaları kayan 24 saatte en fazla 70 gönderim yapar; 30 gönderim kurtarma e-postalarına ayrılır. Sayım mevcut `application_reference_mails.sent_at` ve `audit_events` kayıtlarından yapılır (yeni tablo yok). Kota dolunca kurtarma isteği `quota_deferred` mantığıyla ertelenmez; öğrenciye "daha sonra tekrar deneyin" mesajı yerine genel yanıt döner ve yeniden deneme kuyruğuna alınır.
4. **Dil (kullanıcı kararı):** E-posta, öğrencinin sistemde kullandığı dilde tek dilli gönderilir. Dil, isteğin yapıldığı andaki arayüz dilidir (`document.documentElement.lang`) ve isteğe `language` alanıyla eklenir: kurtarma formu (ana sayfa) ve taslak oluşturma çağrısı. Geçersiz veya eksik değerde geri dönüş, mevcut beş dilli birleşik gövdedir (mevcut davranış ve mevcut test beklentileri aynen korunur). Konu satırı da seçilen dilde olur (5 dil için konu metinleri eklenir). Gövdede kısaltılmış bağlantı kullanılmaz, yalnızca `PORTAL_CANONICAL_ORIGIN` adresi. Arapça (RTL) metin ve Kiril yazı için düz metin biçimi ve satır sonları bozulmamalıdır. Kurtarma e-postasının metni (kod, uyarı, spam klasörü notu) 5 dilde yeni eklenir.
5. **Spam klasörü uyarısı** (kullanıcı isteği): hem taslak kaydedildi ekranında hem "kodumu unuttum" onay ekranında 5 dilde (tr/en/ru/tk/ar) "E-posta birkaç dakika içinde gelmezse gereksiz (spam) klasörünü kontrol edin" metni gösterilir.
6. Telegram butonu `options` yanıtına göre görünür/gizli olur. Telegram kapalıyken arayüz hata vermez.

**YOU OWN** Yukarıdaki tabloda A satırı.
**DO NOT TOUCH** `migrations/`, `package.json`, `package-lock.json`, `wrangler.jsonc`, `config/`, `docs/README.md`, `scripts/`, `ykn_eklenti-main/`, `src/server/services/metaWhatsApp*`, `notificationService.js`, `notificationDispatcher.js`, `src/staff/`, mevcut testlerin beklentileri (yeni test dosyası yazılabilir).

**CONTEXT**
- Giriş doğrulaması: `accessApplicationWithReference` (`applicationRoutes.js` ~satır 695), hız sınırları `rejectAccessCredentials` (~satır 672); kod üretimi `generateAccessCode` ve `hashAccessCode` (`auth/applicationAccessCode.js`); personel sıfırlaması örnek alınabilir (`resetStaffApplicationAccessCode` ~satır 817).
- Ana sayfa formu: `src/public/homeResumeForm.js`, `index.html`.
- Gönderim: `postToMailer`/`deliverReferenceMail`/`sendDraftReferenceMail`.

**DONE WHEN**
1. Sözleşmedeki iki uç nokta çalışır; yanıtlar kayıt var/yok durumunda aynıdır.
2. Aktif başvurusu ve geçerli e-postası olan öğrenci için yeni kod döndürülür, e-posta kuyruğa/gönderime girer, eski kod artık geçersizdir, denetim olayı yazılır.
3. Hız sınırları ve kota payı testlerle doğrulanır.
4. Ana sayfada 5 dilli arayüz, spam uyarısı ve (açıksa) Telegram butonu vardır; RTL (Arapça) bozulmaz.
5. Sentetik veriyle yazılmış testler: kayıtlı/kayıtsız öğrenci, sınırlar, kota dolu, `actorType: 'recovery'` ve mevcut `student`/`staff` yolu değişmedi.
6. Hiçbir yanıt, günlük, test çıktısı veya rapor gerçek kod/e-posta/öğrenci verisi içermez.
7. Dil: `language` değeri `tr|en|ru|tk|ar` olan taslak ve kurtarma e-postaları yalnızca o dilde konu ve gövde üretir; değer eksik/geçersizse mevcut beş dilli birleşik gövde ve mevcut konu korunur. Her dil için sentetik testler yazılır. Taslak oluşturma çağrısı arayüz dilini gönderir.

**RULES / REPORT** YKN görevindeki kurallar aynen geçerlidir (hiçbir komut çalıştırma, commit/push yok, yorumlar Türkçe, tanımlayıcılar İngilizce, doğrulanmamış davranışı kesin varsayma, "Test çalıştırılmadı" yaz).

## Görev C: E-posta teslimi ve spam kontrolü

**GOAL**
Taslak ve kurtarma e-postalarının gelen kutusuna düşmesini ölçmek ve iyileştirmek. Büyük kısmı kod değil, doğrulama ve belgedir.

**KONTROL LİSTESİ (agy belgeyi hazırlar, testleri kullanıcı yapar)**
1. Gönderici kimliği: Apps Script gönderiminde görünen ad "İstanbul Topkapı Üniversitesi Uluslararası Öğrenci Ofisi" ve izlenen bir `replyTo` adresi (ofis e-postası) ayarlanır. `noReply` kullanılmaz.
2. Test dağıtım matrisi (kullanıcı kendi test hesaplarıyla yapar): Gmail, Outlook/Hotmail, Yandex, Mail.ru, iCloud ve bir Türk e-posta sağlayıcısı. Her sağlayıcıda en az tr, ru ve ar dilindeki e-posta ayrı ayrı denenir (tek dilli gönderim). Her birinde sonuç yazılır: gelen kutusu / spam / hiç gelmedi. Gmail'de "Orijinali göster" ile SPF, DKIM, DMARC sonuçları not edilir.
3. İçerik: konu ve gövde tek dilli (kullanıcı kararı: öğrencinin sistemde kullandığı dilde), düz metin, ek yok, yalnızca kanonik alan adı bağlantısı, URL kısaltıcı yok. Kiril (ru) ve Arapça (ar, RTL) konu/gövde kodlaması bozuk karakter veya yön hatası olmadan gelmeli; Türkmence özel harfleri de kontrol edilir.
4. Alan adı itibarı: `topkapiunigoc.com` yeni bir alan adı ve üzerinde gönderim yapılmıyor. Cloudflare "Email cannot reach @topkapiunigoc.com addresses and could be spoofed" öneri uyarısı veriyor. Öneri (kullanıcı onayı gerekir, DNS kalıcı değişikliktir): e-posta gönderilmeyen alan adı için `v=spf1 -all` TXT ve `v=DMARC1; p=reject` TXT. Ofis adresi alan adında kullanılacaksa Cloudflare Email Routing ayrıca değerlendirilir.
5. Kota: günlük 100 alıcı sınırı (ücretsiz Gmail). Kota ve Google Workspace hesabı seçeneğinin sınırı güncel Google belgesinden doğrulanır; bu belgedeki sayı doğrulanmış kabul edilmez.
6. Öğrenciye gösterilen spam klasörü uyarısı Görev A'nın kapsamındadır; bu görev yalnızca metnin yeterliliğini gözden geçirir.
7. Sonuç belgesi: test tarihi, sağlayıcı, sonuç, uygulanan düzeltme. Sonuç gelen kutusunda değilse yeni deneme yapılır.

**YOU OWN** Yukarıdaki tabloda C satırı. **DO NOT TOUCH** `src/`, `test/`, `migrations/`, `wrangler.jsonc`, `package*.json`, `apps_script.txt`, `docs/README.md`.
**DONE WHEN** `docs/reference-mail-setup.md` güncellenmiş gönderici ayarlarını ve test matrisini içerir; yeni belge kontrol listesini ve sonuç tablosunu içerir; Apps Script betiğinde `name`/`replyTo` ayarı yapılmıştır (kullanıcı betiği kendi Apps Script projesine elle dağıtır).
**RULES** Gerçek e-posta adresi, token veya öğrenci verisi yazılmaz.

## Görev D: Telegram kurtarma botu (Worker içinde)

**GOAL**
Telegram botu aracılığıyla, telefon numarası paylaşarak erişim kodunu kurtarmak. Bot yalnızca Cloudflare Worker webhook'u ile çalışır; sunucu/PC yok.

**AKIŞ**
1. Öğrenci ana sayfadaki Telegram butonuna basar (`https://t.me/<bot>?start=recover_<dil>`; `<dil>` arayüzde seçili dildir).
2. Bot "Telefon numaranı paylaş" düğmesi gösterir (Telegram bu numarayı doğrulanmış olarak verir).
3. Bot öğrenci numarasını sorar. Paylaşılan telefon (normalize edilmiş) ve öğrenci numarası **aynı** aktif başvuruyla eşleşirse `rotateAccessCodeForRecovery(channel: 'telegram')` çağrılır; başvuru numarası ve yeni kod aynı sohbete yazılır.
4. Eşleşmezse veya kayıt yoksa aynı genel mesaj: "Bilgiler eşleşmedi; e-posta yolunu deneyin veya ofisle iletişime geçin." Sebep belirtilmez.
5. Sohbet kimliği (`chat_id`) veritabanına yazılmaz; yalnızca bu istekte yanıt vermek için kullanılır. Bildirim gönderimi bu görevin kapsamı dışındadır.

**GÜVENLİK**
- Webhook yalnızca `X-Telegram-Bot-Api-Secret-Token` başlığı `TELEGRAM_WEBHOOK_SECRET` ile eşleşirse işlenir (sabit zamanlı karşılaştırma), aksi halde `401`.
- Token ve gizli anahtar yalnızca Cloudflare secret olarak okunur; günlüklere, hata mesajlarına ve test çıktılarına yazılmaz.
- Telegram'ın aynı güncellemeyi tekrar göndermesine (retry) karşı işlem kimliği ile idempotans veya hız sınırı uygulanır (migration yok: mevcut hız sınırı altyapısı).
- Hız sınırı: Telegram kullanıcısı başına ve başvuru başına günlük sınır; Görev A'daki kurtarma sınırlarıyla aynı mantık.
- Mesajlar tr/en/ru/tk/ar. Dil önceliği: `start` yükündeki dil (`recover_<dil>`), yoksa Telegram kullanıcısının `language_code` değeri, yoksa tr. Geçersiz yük yok sayılır ve komut yine de çalışır.

**YOU OWN** Yukarıdaki tabloda D satırı. **DO NOT TOUCH** Görev A'nın dosyaları, `metaWhatsApp*`, `notificationService.js`, `notificationDispatcher.js`, `migrations/`, `package*.json`, `config/production-publication.json`, `docs/README.md`, `src/public/`, `index.html`.
**Yeni yapılandırma:** secret `TELEGRAM_BOT_TOKEN`, secret `TELEGRAM_WEBHOOK_SECRET`, değişken `TELEGRAM_BOT_USERNAME`. Bunlar `wrangler.jsonc` ve `scripts/ci/runtime-secret-metadata.mjs` ile birebir eşleşmelidir (yayın koruması). Baseline ilerletmeyi agent yapmaz.
**DONE WHEN**
1. Sahte (mock) Telegram güncellemeleriyle akışın tüm adımları testle doğrulanır: doğru eşleşme, yanlış eşleşme, kayıt yok, geçersiz gizli anahtar, tekrarlanan güncelleme, hız sınırı.
2. Token/gizli anahtar hiçbir çıktıda görünmez.
3. Eşleşme mantığı hem `student_phone` normalizasyonunu hem öğrenci numarasını zorunlu kılar; yalnızca telefonla kod verilmez.

## Çalıştırma sırası ve eşzamanlılık

1. Claude dört worktree/dalı açar, her görev için `agy -p "/usage"` kontrolü yapar ve kullanıcıya agent sayısını, sahip dosyaları ve worktree yollarını bildirir.
2. Dört agent aynı anda çalışır (kullanıcı kararı). Paylaşılan dosya sahipliği yukarıdaki tabloyla sabittir.
3. Birleştirme sırası: YKN (bağımsız), C (yalnızca belge), A, D. Her dal kendi testi ve `npm run build:production` ile doğrulanır; D, A'dan sonra birleşip testleri yeniden çalıştırır.
4. Her birleştirme merge commit ile yapılır (squash/rebase yok). Yayın, kullanıcının her görev için ayrı isteği ve tam SHA ile yapılır. D tam yol (preflight) ister; A ve C hızlı yol kullanabilir.
5. Agent raporları kanıt sayılmaz: Claude diff'i okur, `git status`/`git diff --stat` ile sahiplik dışı değişiklik olmadığını doğrular, `npm test`, `npm run build:production`, `npm run deploy:dry-run:production` çalıştırır; sorun varsa somut hata ve düzeltme direktifiyle agent'a geri gönderir.

## Kullanıcının yapacakları

- Telegram'da `@BotFather` ile botu oluşturmak, token'ı **yalnızca kendi terminalinde** Cloudflare'e girmek:
  `npx wrangler secret put TELEGRAM_BOT_TOKEN --env production` ve aynı şekilde `TELEGRAM_WEBHOOK_SECRET`. Token Claude'a veya agent'a verilmez.
- Yayından sonra webhook'u Telegram'a tanıtmak (komut yayın aşamasında hazırlanır; token ortam değişkeninden okunur, ekrana yazılmaz).
- E-posta test matrisini kendi hesaplarıyla çalıştırmak, Apps Script betiğini kendi projesine dağıtmak.
- DNS kayıtlarını (SPF/DMARC) onaylamak.
- Okul PC'sinin temizliğini ve `SCANNER_SECRET`/`PRINTER_SECRET` döndürmesini ayrıca ele almak (bu planın parçası değil).

## Açık sorular (kullanıcı kararı)

- **Karar alındı (2026-11-16):** Kod yenilemede eski kod hemen iptal olur (migration yok).
- **Karar alındı (2026-11-16):** E-posta, öğrencinin sistemde kullandığı dilde tek dilli gönderilir; dil istekle birlikte gelir, saklanmaz.
- Açık kalan: Öğrenci kurtarma formunu farklı bir cihazda varsayılan dille (tr) açarsa e-posta Türkçe gelir. Bu kabul edilebilir mi, yoksa formda dil seçimi öne mi çıkarılsın? Öneri: form yanında geçerli dil gösterilir, öğrenci değiştirebilir.

---

# Bölüm 3: "GöçNet'e aktar" hatası: `zk_command_failed: GöçNet kayıt listesi belirsiz veya filtreleri kısıtlı` (Görev E)

- **Tarih:** 2026-11-16
- **Kapsam:** `ykn_eklenti-main/zk-form-controls.js`, `ykn_eklenti-main/gocnet-transfer-controller.js`, `src/staff/applicationsManager.js` (yalnızca GöçNet geçmiş aşaması mesajı), yeni bir test dosyası.
- **Kaynak:** Kullanıcının bildirdiği ekran görüntüsü ve hata metni (2026-11-16, yaklaşık 10:54) ve kod okuması. Gerçek YÖKSİS ekranının DOM'u incelenmedi (giriş gerektirir, Claude giriş yapmaz).
- **Durum:** Plan. Kod yazılmadı. **Kök neden doğrulandı (2026-11-16 11:02, kullanıcı):** Hata anında YÖKSİS sekmesi GöçNet iletim ekranında değildi. Kullanıcı sekmeyi iletim ekranına getirip aynı başvuruda "GöçNet'e aktar"ı yeniden deneyince hata kayboldu ve sistem "Mevcut GöçNet kaydı bulundu; otomatik işlem durdu." sonucunu verdi. Bu, doğru ve beklenen bir sonuçtur (aynı başvuru numarası için GöçNet'te kayıt zaten var; yinelenen kayıt açılmaz). Yani kod hatalı değildi: ekran doğruyken mevcut bulucu gerçek YÖKSİS sayfasında çalıştı; sorun, yanlış ekranda verilen hata mesajının neden ve çözümü söylememesiydi.
- **Kapsam güncellemesi:** Kanıt nedeniyle yalnızca E1 (ekran kapısı), E4 (doğru mesaj), E5 (tanılama) ve ilgili testler yapılır. E2 (sağlam bulucu) ve E3 (tutarlı tarama) kapsam dışıdır: fail-closed güvenlik koduna gerekçesiz dokunmamak için. Aşağıdaki E2/E3 maddeleri, "DONE WHEN" madde 3 ve 5 ile bunlara ait test senaryoları uygulanmaz.
- **Görev E, Bölüm 2'deki görevlerden bağımsızdır** ve YKN pencere görevinin dosyalarına (`background.js`, `bridge.js`, `popup.*`) dokunmaz; Bölüm 1 ve Bölüm 2 görevleriyle eşzamanlı çalışabilir (beşinci agent).

## Belirti

İkamet Başvuruları ekranında "GöçNet'e aktar" düğmesine basınca: "Sonuç doğrulanamadı. YÖKSİS'i kontrol edin; otomatik tekrar yapılmadı. Neden: zk_command_failed: GöçNet kayıt listesi belirsiz veya filtreleri kısıtlı. [docs=2/0 h0,h0]". Başvuru örneği: "Göç İdaresine gönderildi" durumunda bir uzatma başvurusu.

## Hata kodunun anlamı (kod okumasından, doğrulandı)

- Akış: portal → eklenti `CHECK_GOCNET_TRANSFER` (`phase: 'history'`, `background.js` ~2215) → YÖKSİS sekmesinde `queryGocnetRecordList` (`gocnet-transfer-controller.js` ~382) → ZK komutu `queryGocnetRecords` (`zk-form-controls.js` ~517-579).
- Komut, ana belgeyi ve aynı kökenli çerçeveleri tarar ve **görünür** "Kayıtlı İkamet İşlemleri Listesi" başlığını arar (`h1-h5, legend, .z-caption, .z-groupbox-legend` içinde).
- `[docs=2/0 h0,h0]` şu demektir: 2 belge tarandı, uygun hedef 0, **her iki belgede de görünür başlık sayısı 0** (`h0`). Yani filtre ve liste kontrolüne hiç geçilmedi; hata, başlığın hiçbir belgede bulunamamasıdır.
- Hata **kayıt açılmadan önce**, geçmiş sorgusu aşamasında oluşur (`applicationsManager.js` ~1553 `check('history')`). Bu aşamada GöçNet'te hiçbir kayıt açılmaz ve belge yüklenmez. Ancak mesaj "otomatik tekrar yapılmadı" der; bu, kayıt sonrası belirsizlik mesajlarıyla aynı görünür ve görevliyi yanlış yönlendirebilir.
- Eklenti YÖKSİS sekmesini GöçNet ekranına **götürmez**: `resolveGocnetYoksisTab` (`background.js` ~550) açık tek YÖKSİS sekmesini veya kayıtlı sekmeyi seçer ve o sekmenin GöçNet iletim ekranında olduğunu varsayar. Kullanıcı ekran görüntüsünde YÖKSİS sekmesi `yoksis.yok.gov.tr/menu/...` yolunda görünüyor; GöçNet iletim ekranında olup olmadığı doğrulanmadı.
- Sonuç okuması (`readGocnetRecordListResult`) yalnızca üst belgeye bakar, komut ise çerçeveleri de tarar; bölüm bir çerçevedeyse komut başarılı olsa bile okuma başarısız olabilir (tutarsızlık, bu hata için neden değil ama düzeltilmeli).

## Nedenler (neden 1 doğrulandı, diğerleri elendi)

1. **DOĞRULANDI (2026-11-16):** Bağlı YÖKSİS sekmesi "İkamet İzni Başvuru Belgelerinin GöçNet'e İletilmesi Ekranı" üzerinde değildi. Ekran düzelince hata kayboldu.
2-4 aşağıdakiler bu olayda elendi (ekran doğruyken mevcut bulucu çalıştı); yalnızca gelecekte benzer belirti için not olarak kalır:
2. Ekran doğru ama "Kayıtlı İkamet İşlemleri Listesi" bölümü görünür değil (kapalı/gizli ZK bölümü, ekran yüklenmemiş).
3. YÖKSİS ekranı değişti: başlık artık aranan öğe türlerinin dışında (`span`, `div`, `.z-label`) ya da metni farklı.
4. Bölüm, taranmayan veya farklı kökenli bir çerçevede.

## Kesin teşhis (kullanıcı, yaklaşık 5 dakika, öğrenci verisi içermez)

1. Hata anında YÖKSİS sekmesinin hangi ekranda olduğuna bakın. Menüden GöçNet iletim ekranına gidin ve "Kayıtlı İkamet İşlemleri Listesi" bölümünün göründüğünü doğrulayın, sonra aynı başvuruda "GöçNet'e aktar"ı yeniden deneyin. Çalışırsa neden 1 veya 2 kanıtlanmış olur.
2. Çalışmazsa, YÖKSİS sekmesinin geliştirici konsolunda şu salt-okunur kod çalıştırılıp çıktısı paylaşılır. Yalnızca belge sayısı, başlık metinleri (filtrelenmiş, 80 karaktere kısaltılmış) ve sayaçlar döner; ağ isteği yapmaz, sayfayı değiştirmez:

```js
(() => {
  const docs = [document];
  for (const frame of document.querySelectorAll('iframe, frame')) {
    try { if (frame.contentDocument) docs.push(frame.contentDocument); } catch (e) {}
  }
  return docs.map((d, i) => ({
    doc: i,
    headings: [...d.querySelectorAll('h1,h2,h3,h4,h5,legend,.z-caption,.z-groupbox-legend,.z-label')]
      .map((e) => e.textContent.trim().replace(/\s+/g, ' ').slice(0, 80))
      .filter((t) => /kayıtlı ikamet|göçnet'e iletilmesi/i.test(t)),
    listboxes: d.querySelectorAll('.z-listbox').length,
    historyHeaders: [...d.querySelectorAll('.z-listbox-header th')]
      .filter((e) => /e-ikamet başvuru no|öğrenci no|göçnet kayıt no/i.test(e.textContent)).length
  }));
})()
```

Çıktı yorumu: iki belgede de `headings` boş ve `historyHeaders` 0 ise ekran yanlış (neden 1). `historyHeaders` 3 ama `headings` boş ise başlık biçimi değişmiş (neden 3). `headings` dolu ama kod hata veriyorsa görünürlük sorunu (neden 2).

## Çözüm (Görev E, katmanlı)

- **E1 Ekran kapısı:** Başlık bulunamayınca komut nedeni ayırt eder: (a) "GöçNet iletim ekranı" başlığı da yok → `not_on_gocnet_screen`; (b) ekran başlığı var, liste bölümü yok → `history_section_missing`. Neden metni kısa tutulur (ilk 110 karakter komuttan çıkar, `background.js` ek olarak 160 karaktere keser; kod ilk sırada olmalı).
- **E2 Sağlam bulucu:** Listeyi önce kimlik başlıklarıyla bul (`e-ikamet başvuru no`, `öğrenci no`, `göçnet kayıt no`; kodda zaten kullanılıyor), başlık metnini ek doğrulama olarak kullan ve başlık öğe türlerini `span`, `div`, `.z-label` ile genişlet. Sıfır veya birden fazla eşleşme hâlâ `unknown` (fail-closed). Tam numara eşleşmesi, tek satır, boş durum metni ve "tümü" filtresi kuralları aynen korunur.
- **E3 Tutarlı tarama:** `readGocnetRecordListResult` ile komut aynı belge kümesini (ana belge ve aynı kökenli çerçeveler) kullanır; ortak bir belge toplama yardımcısı paylaşılır.
- **E4 Doğru mesaj:** `applicationsManager.js` geçmiş aşaması hatasında, neden `not_on_gocnet_screen` veya `history_section_missing` ise: "Kayıt açılmadı. YÖKSİS sekmesini GöçNet iletim ekranına getirip tekrar deneyin." Bilinmeyen nedende mevcut mesaj korunur. "Tekrar deneyin" ifadesi yalnızca geçmiş aşamasında (hiçbir şey kaydedilmediği kesin) kullanılır; kayıt ve yükleme aşamalarındaki "otomatik tekrar yapmayın" mesajları değişmez.
- **E5 Tanılama:** `[docs=N/M ...]` yerine anlaşılır, kişisel veri veya adres içermeyen bir özet: belge sayısı, başlık sayısı, liste sayısı, ekran başlığı var/yok.
- **E6 Geriye uyumluluk:** Eski eklenti + yeni portal (neden kodu yok → eski mesaj) ve yeni eklenti + eski portal (yeni neden kodu bilinmeyen sayılır) bozulmaz; eklenti ve portal bağımsız yayınlanabilir.

## Kapsam dışı

- YÖKSİS menüsünde otomatik gezinme (ZK menü, oturum ve yanlış kayıt riski).
- `manifest.json` sürümü (yayın kararı, Claude yapar), sunucu tarafı, YKN pencere görevinin dosyaları.

## Ekip kaydı ve agent (agy) görev tanımı (Görev E)

- **Görev dalı:** `task/gocnet-history-guard` (production'dan, ayrı worktree, örn. `../uluslarasiofis-gocnet-guard`).
- **Kota ve model:** `agy -p "/usage"`; `gemini-4-hydrogen-high` (limit yoksa `gemini-4-argon-high`). Tek agent.

**GOAL**
GöçNet "geçmiş sorgusu" aşamasında "Kayıtlı İkamet İşlemleri Listesi" bulunamadığında nedenin açık ve eyleme dönük çıkmasını, listenin başlık biçimi/çerçeve farklarına dayanıklı bulunmasını ve görevliye kayıt açılmadığının doğru söylenmesini sağlamak. Fail-closed güvenlik kuralları değişmez.

**YOU OWN**
- `ykn_eklenti-main/zk-form-controls.js` (yalnızca `queryGocnetRecords` ve gerekirse küçük yardımcılar)
- `ykn_eklenti-main/gocnet-transfer-controller.js` (yalnızca `readGocnetRecordListResult`, `queryGocnetRecordList` ve ortak belge toplama yardımcısı)
- `src/staff/applicationsManager.js` (yalnızca GöçNet geçmiş aşamasındaki başarısızlık mesajı, ~satır 1613-1618)
- `test/gocnetHistoryScreenGuard.test.js` (yeni dosya)

**DO NOT TOUCH**
`ykn_eklenti-main/background.js`, `bridge.js`, `popup.html`, `popup.js`, `manifest.json` ve `ykn_eklenti-main/` içindeki diğer dosyalar; `test/fixtures/` içindeki mevcut fixture dosyaları (yeni fixture yeni dosya olarak eklenebilir); mevcut testlerin beklentileri; `package*.json`, `migrations/`, `wrangler.jsonc`, `config/`, `docs/README.md`, `scripts/`; Git komutları.

**CONTEXT**
- Bu belgedeki "Hata kodunun anlamı" ve "Çözüm" bölümleri. Fixture: `test/fixtures/gocnet-transfer/dom-contract.html` (başlık "Kayıtlı İkamet İşlemleri Listesi (Veritabanı Geçmişi & Takip)", liste başlıkları, boş durum metni). Mevcut testler: `test/gocnetZkControls.test.js`.
- Tüm sonuçlar `unknown` ile fail-closed kalır: tam numara eşleşmesi, tam olarak bir satır veya açık boş durum metni, filtre "tümü", sayfalama yok.

**DONE WHEN**
1. Doğru ekranda mevcut davranış aynen çalışır (mevcut testler değişmeden geçer).
2. Yanlış ekranda neden `not_on_gocnet_screen`, bölüm yoksa `history_section_missing` olarak ilk sırada döner; portal bu nedenle "Kayıt açılmadı…" mesajını gösterir.
3. Başlık `span`/`div`/`.z-label` içindeyse veya başlık yok ama üç kimlik başlığı varsa liste bulunur.
4. Liste birden çok yerde veya hiç yoksa `unknown`; belirsizlikte kayıt açılmaz.
5. Komut ve sonuç okuması aynı belge kümesini tarar (çerçeve içindeki liste için test var).
6. Yeni test dosyası: doğru ekran, yanlış ekran, bölüm yok, farklı başlık öğesi, başlıksız liste, iki liste, çerçevede liste, kayıt sonrası aşamaların mesajlarının değişmediği senaryo. Tüm veri sentetik.
7. Tanılama metninde öğrenci verisi, URL, çerez veya belge numarası yoktur.

**RULES**
- Bu ortamda `accept-edits` modunda shell komutu çalışmaz: hiçbir komut çalıştırma, testleri ve build'i Claude çalıştırır.
- Sürüm numarasını, izinleri ve başka dosyaları değiştirme; commit/push yok.
- Gerçek YÖKSİS DOM'u hakkında varsayım yapma; yalnızca fixture ve bu belgedeki bilgiyle çalış. Belirsiz kalan noktayı raporda yaz.
- Kod yorumları Türkçe, tanımlayıcılar İngilizce. Kişisel veri, token veya gerçek numara yazma.

**REPORT**
Değiştirilen dosyalar ve satır aralıkları, eklenen işlev adları, test senaryoları, belirsiz noktalar, "Test çalıştırılmadı" ifadesi.

## Claude'un doğrulaması ve yayın

1. `git status` ve `git diff --stat` ile yalnızca "YOU OWN" dosyalarının değiştiğini doğrula.
2. `npm test` (pretest eklenti paketlemesini çalıştırır), `npm run build:production`, `npm run deploy:dry-run:production`.
3. Portal mesajı Worker yayınıyla gider (kod yalnızca; hızlı yol uygun). Eklenti değişikliği ayrıca sürüm artırılıp paketlenir (`npm run package:extension`, sürüm kararı kullanıcıda) ve kullanıcı `chrome://extensions` üzerinden yeni sürümü yükler.
4. Gerçek ortam doğrulaması kullanıcıdadır (giriş yapılması gerekir): (a) doğru ekranda çalıştığını, (b) YÖKSİS'i başka menü sayfasında bırakınca "Kayıt açılmadı… GöçNet iletim ekranına getirin" mesajını gördüğünü ve GöçNet'te hiçbir kayıt açılmadığını kontrol eder.

## Açık sorular (kullanıcı kararı)

- **Yanıtlandı (2026-11-16):** Hata anında YÖKSİS sekmesi GöçNet iletim ekranında değildi; ekran düzeltilince sonuç "Mevcut GöçNet kaydı bulundu; otomatik işlem durdu." oldu.
- Bu hata ilk kez mi çıktı, yoksa aynı akış daha önce çalışıyordu? Hangi tarihten beri? (11 Kasım değişiklikleri ve YÖKSİS tarafındaki bir güncelleme ayırt edilir.)
- Birden fazla YÖKSİS sekmesi açık mı? (Ayrı bir hata iletisi: "Birden fazla YÖKSİS sekmesi açık…".)
- Ofis için alan adı üzerinde bir e-posta adresi (Cloudflare Email Routing) açılsın mı?
- WhatsApp: ayrı numara bulunursa ya da numara Business uygulamasına taşınırsa (coexistence) ayrı plan yazılacak.
