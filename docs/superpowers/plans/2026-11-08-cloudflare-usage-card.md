# Yetkili ana sayfası Cloudflare kullanım kartı Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Tarih:** 8 Kasım 2026. **Kapsam:** yalnızca yetkili ana sayfası kartı ve onu besleyen salt okunur uç nokta. **Doğrulama durumu:** plan yazıldı; hiçbir kod uygulanmadı, canlıda hiçbir şey denenmedi. Cloudflare limit değerleri 8 Kasım 2026'da resmi dokümanlardan okundu (aşağıdaki kaynaklar); uygulamadan önce yeniden doğrulanmalı.

**Goal:** Mevcut tek metrikli "D1 günlük okuma" sayacını kaldırıp, yetkili ana sayfasının sol üstünde küçük bir kart koymak; karta basınca Cloudflare ücretsiz plan kullanımı (D1, Workers, R2) çubuklarla açılsın.

**Architecture:** Mevcut `d1-usage-metrics.js` servisi çoklu metrikli `cloudflare-usage-metrics.js` olur: tek Worker isteği, Cloudflare GraphQL Analytics API'ye birkaç alt istek, 5 dakikalık edge önbelleği (D1'e yazma yok). Her metrik bağımsız başarısız olabilir. Arayüz tek bir `cloudflare-usage-card.js` modülüdür; kapalıyken özet, açıkken tüm çubuklar.

**Tech Stack:** Cloudflare Worker (`src/server/worker.js`), Cloudflare GraphQL Analytics API, vanilla JS (Vite), `node:test` + jsdom.

**Spec:** Yok; bu belge ve 8 Kasım 2026 tarihli kullanıcı talebi: "mevcut kart kaldırılsın, ana sayfada sol üstte küçük yeni bir kart olsun, basınca bu metriklerin barları açılsın; şu anki kart için bir tuş var, onun gibi".

## Global Constraints

- Üretim D1/R2 verisi, gizli anahtar bağlamaları, cron, tarayıcı entegrasyonu, Windows Print Agent v7, `PRINT_ENABLED=true` ve `PHYSICAL_INTAKE_MODE=on` korunur (AGENTS.md).
- Kart **hiçbir D1 yazması veya okuması yapmaz** (D1 kotasını tüketen bir kart olmaz); yalnızca Cloudflare Analytics'e dışarıdan istek atar.
- Mevcut `D1_ANALYTICS_API_TOKEN` (Account Analytics:Read) ve `D1_ANALYTICS_ACCOUNT_ID` yeniden kullanılır. Yeni gizli anahtar adı eklenmez; eklenecekse `scripts/ci/runtime-secret-metadata.mjs` ve `docs/deployment/runtime-secret-baseline.md` birlikte güncellenir ve bu ayrı bir üretim değişikliği olarak onaylanır.
- Uç nokta personel oturumu ister (`requireStaff`); herkese açık sayfalarda kart bulunmaz.
- Günlük limitler **00:00 UTC**'de sıfırlanır (Türkiye'de 03:00); aylık R2 limitleri ayın ilk gününden sayılır. Arayüz bunu açıkça yazar.
- Kullanıcıya gösterilen metinler Türkçedir. Sayılar `tr-TR` biçiminde yazılır.
- Limit sabitleri tek dosyada tutulur ve her değerin yanında kaynak URL ile doğrulama tarihi bulunur.
- Teslimden önce `npm test`, `npm run build:production`, `npm run deploy:dry-run:production`. Yayın yalnızca **Production release (manual)** iş akışıyla, tam SHA ve kullanıcının ayrı açık isteğiyle yapılır; otomatik tetiklenmez.
- Çalışma klasörü başka bir oturumla (yetkili tasarım oturumu) paylaşılır: `yetkili/index.html` ve `src/staff/home.css` düzenlenmeden önce `git status` bakılır; başkasının commitlenmemiş değişikliği üzerine yazılmaz.

## Review Focus

1. **Token eksik veya yetkisiz:** kart sıfır göstermez, "alınamıyor" der (mevcut davranış korunur).
2. **Tek veri seti hatası:** Workers sorgusu başarısız olsa bile D1 ve R2 satırları gösterilir; bozuk satır "alınamıyor" olur.
3. **UTC gece yarısı:** önbellek anahtarı tarihi içerir; gün değişince eski gün gösterilmez.
4. **Hesap geneli toplam:** staging ve production D1'leri aynı hesap limitini paylaşır; toplam gösterilir, veritabanı kırılımı ikincil bilgi olur.
5. **%100'ü aşan değer:** çubuk taşmaz (sınırlanır), yüzde gerçek değeri gösterir ve kırmızı olur.

---

## File Structure

- Create `src/server/services/cloudflare-usage-limits.js` — limit sabitleri ve metrik tanımları (sadece veri).
- Create `src/server/services/cloudflare-usage-metrics.js` — GraphQL sorguları, önbellek, kısmi başarısızlık.
- Delete `src/server/services/d1-usage-metrics.js` ve `src/ui/d1-usage-counter.js` (Task 5'te).
- Modify `src/server/worker.js:105` — yeni uç nokta `/api/staff/admin/usage`.
- Create `src/ui/cloudflare-usage-card.js` — kart arayüzü.
- Modify `yetkili/index.html` (satır ~99 başlık düğmesi ve ~166 kart), `src/staff/home.css`, `src/index.css` (eski `.d1-usage-*` kuralları), `src/staff/main.js:23,67`.
- Tests: Create `test/cloudflareUsageMetrics.test.js`, `test/cloudflareUsageCardUi.test.js`; Delete `test/d1UsageMetrics.test.js`, `test/d1UsageCounterUi.test.js` (içerikleri yeni testlere taşınır).
- Docs: Create `docs/cloudflare-usage-card.md` (eski `docs/d1-usage-counter.md` yerine), `docs/README.md` bağlantısı.

---

### Task 0: Token kapsamını ve alan adlarını doğrula (kod yok)

Mevcut token'ın hangi veri setlerini okuyabildiğini bilmiyoruz; kodlamadan önce bilinmeli.

**Files:** yok.

- [ ] **Step 1:** Cloudflare GraphQL şemasında şu alanların güncel adlarını resmi dokümandan doğrula ve Task 2'deki sorgu sabitlerine yaz: Workers istek sayısı (`workersInvocationsAdaptive`, `sum.requests`), D1 okuma/yazma (`d1AnalyticsAdaptiveGroups`, `sum.rowsRead`, `sum.rowsWritten`), D1 depolama (`d1StorageAdaptiveGroups`), R2 işlemleri (`r2OperationsAdaptiveGroups`, `dimensions.actionType`) ve R2 depolama (`r2StorageAdaptiveGroups`). Adlar öğrenilmiş bilgidir; **dokümandan teyit edilmeden kullanılmaz**.
- [ ] **Step 2:** R2 işlem türlerinin Class A / Class B sınıflandırmasını R2 fiyat sayfasından kopyala; `cloudflare-usage-limits.js` içinde `R2_CLASS_A_ACTIONS` ve `R2_CLASS_B_ACTIONS` olarak sakla (ListBuckets, PutObject, ListObjects vb. A; GetObject, HeadObject vb. B — tam liste dokümandan).
- [ ] **Step 3 (kullanıcı):** Mevcut token'ın bu alanları okuyabildiğini doğrula: staging'de uç nokta yayınlandıktan sonra her satır "alınamıyor" yerine sayı gösteriyorsa kapsam yeterlidir. Yetersizse kullanıcı Cloudflare panelinde yalnızca **Account Analytics:Read** yetkili yeni bir token üretir ve `npx wrangler secret put D1_ANALYTICS_API_TOKEN --env production` ile aynı ada yazar (ad değişmez, baseline değişmez).
- [ ] **Step 4:** Workers istek sayısının statik varlık isteklerini içerip içermediğini dokümandan öğren ve Task 1'deki Workers satırının notuna yaz (limit 100.000/gün ile karşılaştırılan sayı doğru olmalı).

### Task 1: Limit kataloğu

**Files:**
- Create: `src/server/services/cloudflare-usage-limits.js`
- Test: `test/cloudflareUsageMetrics.test.js`

**Interfaces:**
- Produces: `export const USAGE_METRICS: ReadonlyArray<{ key: string, label: string, period: 'day'|'month'|'now', limit: number, unit: 'count'|'bytes', note?: string }>` sırası kartta gösterilen sıradır.
- Produces: `export const LIMITS_VERIFIED_ON = '2026-11-08'`.

Değerler (8 Kasım 2026, kaynaklar belgenin sonunda):

| key | label | period | limit |
|---|---|---|---|
| `workers_requests` | Workers istekleri | day | 100000 |
| `d1_rows_read` | D1 okunan satır | day | 5000000 |
| `d1_rows_written` | D1 yazılan satır | day | 100000 |
| `d1_largest_db_bytes` | D1 en büyük veritabanı | now | 500 MB (524288000) |
| `d1_total_bytes` | D1 toplam depolama | now | 5 GB (5368709120) |
| `r2_class_a` | R2 yazma/listeleme (A) | month | 1000000 |
| `r2_class_b` | R2 okuma (B) | month | 10000000 |
| `r2_storage_bytes` | R2 depolama | now | 10 GB (10737418240) |

- [ ] **Step 1: Failing test** — `catalog keeps the reviewed free-tier limits and order`: `USAGE_METRICS.map(m => m.key)` yukarıdaki sırada eşit; `find(k => k.key==='d1_rows_written').limit === 100000`; her kayıt pozitif tamsayı `limit` ve `['day','month','now']` içinden `period` taşır; `LIMITS_VERIFIED_ON` ISO tarihidir.
- [ ] **Step 2:** `node --test test/cloudflareUsageMetrics.test.js` — FAIL (modül yok).
- [ ] **Step 3:** Katalogu `Object.freeze` edilmiş dizi olarak yaz; her kayıt için `sourceUrl` alanı ekle (doküman bağlantısı).
- [ ] **Step 4:** aynı komut — PASS.
- [ ] **Step 5:** Commit `feat: add Cloudflare free-tier limit catalog`.

### Task 2: Çoklu metrik servisi

**Files:**
- Create: `src/server/services/cloudflare-usage-metrics.js`
- Test: `test/cloudflareUsageMetrics.test.js`

**Interfaces:**
- Consumes: `USAGE_METRICS`, `R2_CLASS_A_ACTIONS`, `R2_CLASS_B_ACTIONS` (Task 0/1).
- Produces:
  `readCloudflareUsage({ environment, cache, fetcher = fetch }): Promise<{ date: string, month: string, retrievedAt: string, metrics: Array<{ key: string, value: number|null, limit: number, period: string, status: 'ok'|'unavailable', detail?: Array<{ name: string, value: number }> }> }>`
  Başarı yalnızca `environment.D1_ANALYTICS_ACCOUNT_ID` ve `D1_ANALYTICS_API_TOKEN` varsa; yoksa `ApiError(503, 'USAGE_METRICS_UNAVAILABLE', …, true)`.

- [ ] **Step 1: Failing tests** (enjekte edilmiş `fetcher` ve bellek içi `cache`):
  - `returns every catalog metric in catalog order with values from separate datasets`: sahte yanıtlar Workers=1234, D1 okuma=2400+3600, D1 yazma=300+200, R2 A=10, R2 B=40 (Class A/B toplamları işlem türünden hesaplanır); beklenen `metrics[0].value===1234`, `d1_rows_read.value===6000`, `d1_rows_written.value===500`.
  - `one failing dataset marks only its metrics unavailable`: Workers sorgusu `errors` döner; `workers_requests.status==='unavailable'`, `value===null`, diğerleri `ok`.
  - `missing token throws USAGE_METRICS_UNAVAILABLE without calling fetch`.
  - `caches per UTC date and month for five minutes and never touches a database`: ikinci çağrı `fetcher` sayısını artırmaz; `environment.DB` verilmez ve erişilirse test patlar; önbellek anahtarı `https://portal-cache.invalid/cloudflare-usage/<YYYY-MM-DD>`.
  - `Authorization header is Bearer token and body carries accountTag and date`.
- [ ] **Step 2:** testleri çalıştır — FAIL.
- [ ] **Step 3:** Servisi yaz. Veri setleri `Promise.allSettled` ile paralel sorgulanır; her sorgu `AbortSignal.timeout(10_000)`; tek GraphQL gövdesinde birden çok `accounts` alanı yerine metrik grubu başına ayrı istek (hata yalıtımı için). Önbellek TTL 300 sn. Gün ve ay UTC'den hesaplanır.
- [ ] **Step 4:** testler — PASS.
- [ ] **Step 5:** Commit `feat: read daily and monthly Cloudflare usage with per-dataset isolation`.

### Task 3: Uç nokta

**Files:**
- Modify: `src/server/worker.js:105-109` (eski `/api/staff/admin/d1-usage` bloğu yerine)
- Test: `test/cloudflareUsageMetrics.test.js`

**Interfaces:**
- Consumes: `readCloudflareUsage`.
- Produces: `GET /api/staff/admin/usage` → Task 2 yanıtı; oturumsuz istek 401/403 (mevcut `requireStaff` davranışı).

- [ ] **Step 1: Failing test** — `usage endpoint requires a staff session and rejects non-GET`: oturumsuz `GET /api/staff/admin/usage` başarısız; `POST` 405. Kimlik doğrulamalı çağrı testi mevcut `d1UsageMetrics.test.js` içindeki `worker.fetch` kalıbını izler (o dosya silinmeden önce kalıp kopyalanır).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Rotayı ekle; `/api/staff/admin/d1-usage` **kaldırılır** (eski sayfa önbelleğindeki eski JS bir yayın boyunca "alınamıyor" gösterebilir; kabul edildi).
- [ ] **Step 4:** PASS. Commit `feat: expose staff Cloudflare usage endpoint`.

### Task 4: Kart arayüzü modülü

**Files:**
- Create: `src/ui/cloudflare-usage-card.js`
- Test: `test/cloudflareUsageCardUi.test.js`

**Interfaces:**
- Consumes: `GET /api/staff/admin/usage` (Task 3).
- Produces: `initCloudflareUsageCard({ root = document, fetcher = fetch }): void`. Beklenen DOM: `#cloudflare-usage-card` içinde `button#cloudflare-usage-toggle[aria-expanded][aria-controls="cloudflare-usage-panel"]` ve `#cloudflare-usage-panel[hidden]`; panel her metrik için `[role="progressbar"]` satırı üretir.

Davranış (karar verilenler): kapalı kartta tek satır özet: en yüksek yüzdeli metriğin adı ve yüzdesi. Tıklayınca panel açılır ve **ilk açılışta** veri istenir; kapalıyken istek atılmaz. Tercih `localStorage` anahtarı `cloudflare-usage-card-open`. Renk: <%70 normal, %70–89 sarı, ≥%90 kırmızı. Panel altında "00:00 UTC (03:00 TR) sıfırlanır · Yenile" ve alınma saati yer alır. "Yenile" düğmesi önbelleği atlamaz (5 dk sunucu önbelleği yeterli); düğme 30 sn'de bir kez basılabilir.

- [ ] **Step 1: Failing tests** (jsdom, `fetcher` enjekte):
  - `card stays collapsed and does not request data until opened`.
  - `opening renders one progressbar per metric with tr-TR numbers`: örnek `d1_rows_written` 50000/100000 → `aria-valuenow="50000"`, `aria-valuemax="100000"`, metin `50.000 / 100.000` ve `%50,00`.
  - `summary shows the highest-percentage metric`.
  - `threshold classes are applied at 70 and 90 percent` (`is-warning`, `is-danger`).
  - `value above limit clamps the bar width to 100 percent but shows the real percent`.
  - `unavailable metrics render "alınamıyor" and never zero`.
  - `fetch failure shows the unavailable state without throwing`.
  - `storage preference survives when localStorage throws`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Modülü yaz; sayı biçimi için `Intl.NumberFormat('tr-TR')`; bayt değerleri MB/GB olarak biçimlendirilir; DOM yalnızca `textContent` ile yazılır (HTML enjekte edilmez).
- [ ] **Step 4:** PASS. Commit `feat: add collapsible Cloudflare usage card`.

### Task 5: Yerleşim, eski sayacın kaldırılması

**Files:**
- Modify: `yetkili/index.html` (başlıktaki `#d1-usage-toggle` düğmesi ve `.d1-usage-counter-shell` kaldırılır; sol üstte yeni kart eklenir), `src/staff/home.css` (`.d1-usage-*` kuralları silinir, yeni kart kuralları eklenir), `src/index.css:314-336` (eski `.d1-usage-counter*` silinir), `src/staff/main.js:23,67` (içe aktarma ve çağrı yeni modüle).
- Delete: `src/server/services/d1-usage-metrics.js`, `src/ui/d1-usage-counter.js`, `test/d1UsageMetrics.test.js`, `test/d1UsageCounterUi.test.js`.
- Test: `test/cloudflareUsageCardUi.test.js`

**Interfaces:** Consumes `initCloudflareUsageCard` (Task 4).

- [ ] **Step 1: Failing test** — `usage card lives only on the staff home, top-left, and the old counter is gone`: `yetkili/index.html` içinde `#home-screen #cloudflare-usage-card` var, `#d1-usage-counter` ve `#d1-usage-toggle` yok; `index.html` (herkese açık) içinde `#cloudflare-usage-card` yok. Karta DOM sırasında `#home-screen` içinde ilk öğe olarak sol üstte konumlanır (CSS `position:absolute; inset-inline-start`, `inset-block-start` ile; pozisyon doğrulaması CSS metninde aranır).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** İşaretlemeyi ve CSS'i uygula; mobil (≤ 480 px) için panel tam genişlik olur ve diğer ana sayfa öğelerinin üstüne taşar (örtüşme olmaması için panel `z-index` ve `max-height` + kaydırma). Koyu mod `var(--card-bg)` ve `var(--accent)` değişkenlerini kullanır (mevcut tema).
- [ ] **Step 4:** `npm test` tamamı geçer; `npm run build:production` geçer. Yerelde (`npm run dev`) kart: kapalı, açık, token yokken "alınamıyor" ekran görüntüsüyle doğrulanır; telefon genişliği dahil.
- [ ] **Step 5:** Commit `feat: replace D1 counter with top-left usage card`.

### Task 6: Dokümantasyon

**Files:**
- Create: `docs/cloudflare-usage-card.md`; Delete: `docs/d1-usage-counter.md`; Modify: `docs/README.md` (bağlantı), `docs/deployment/runtime-secret-baseline.md` ve `scripts/ci/runtime-secret-metadata.mjs` yorumundaki eski belge adı.

- [ ] **Step 1:** Yeni belge: hangi metrikler, limit kaynakları ve doğrulama tarihi, sıfırlanma saatleri, token kapsamı, "analitik gecikebilir; gösterge gerçek zamanlı garanti değildir", token yoksa davranış.
- [ ] **Step 2:** `docs/README.md` ve diğer referanslardaki `d1-usage-counter.md` bağlantılarını güncelle; `grep -rn "d1-usage-counter" docs scripts src test` sonuç vermemeli.
- [ ] **Step 3:** Commit `docs: describe the Cloudflare usage card`.

### Task 7: Teslim ve yayın

- [ ] **Step 1:** `npm test`, `npm run build:production`, `npm run deploy:dry-run:production` — hepsi başarılı; çıktılar plan sahibine raporlanır.
- [ ] **Step 2:** Commit'ler `production` dalına push edilir (koruma izin verirse); yayın yapılmaz.
- [ ] **Step 3:** Plan sahibi açıkça istediğinde: **Production release (manual)** → `preflight`, sonra `publish` (aynı tam SHA). Kod-only yayındır; gizli anahtar veya yapılandırma değişmez (Task 0'daki yeni token senaryosu hariç).
- [ ] **Step 4:** Canlı kontrol: yetkili girişinden sonra kartın açılması, satırların sayı göstermesi, token kapsamı yetersizse hangi satırların "alınamıyor" olduğu; sonuç bu oturuma geri bildirilir.

---

## Kaynaklar (8 Kasım 2026'da okundu)

- Workers limitleri: https://developers.cloudflare.com/workers/platform/limits/ ve https://developers.cloudflare.com/workers/platform/pricing/ (100.000 istek/gün, istek başına 10 ms CPU)
- D1: https://developers.cloudflare.com/d1/platform/limits/ ve https://developers.cloudflare.com/d1/platform/pricing/ (günde 5 milyon okuma, 100.000 yazma; 500 MB/veritabanı, 5 GB toplam; sıfırlanma 00:00 UTC; dizin başına ek yazma sayılır)
- R2: https://developers.cloudflare.com/r2/pricing/ (10 GB-ay, 1 milyon Class A, 10 milyon Class B/ay)

## Self-review notları

- **Kapsam:** kullanıcı isteğinin her parçası bir göreve bağlı: eski kart kaldırma (Task 5), sol üst küçük kart (Task 5), tıklayınca çubuklar (Task 4), düğme davranışı (Task 4, `aria-expanded` düğmesi).
- **Tür tutarlılığı:** `USAGE_METRICS` anahtarları Task 1, 2 ve 4'te aynıdır; yanıt şekli yalnızca Task 2'de tanımlanır.
- **Açık risk:** Task 0 doğrulanmadan Task 2'nin sorgu alanları kesin değildir; bu yüzden Task 0 ilk sırada.
- **Beklenen yan etki:** Kart her yeni sayfa yüklemesinde 1 Worker isteği ve en fazla 3–5 Cloudflare API alt isteği üretir; önbellek nedeniyle 5 dakikada bir. Workers günlük 100.000 isteğin yanında ihmal edilebilir.
