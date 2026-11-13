# Şifreli belge deposu (ofis PC'si): kurulum ve geçiş rehberi

Durum (2026-11-13): kod hazır ve yerel testlerden geçti; **canlıya alınmadı**. Canlı Worker'da secret, değişken ve VPC bağlaması henüz yok. Plan ve gerekçeler: [plans/2026-11-12-office-pc-document-storage-plan.md](plans/2026-11-12-office-pc-document-storage-plan.md).

Özet: öğrenci belgeleri (`quarantine/` anahtarları) AES-256-GCM ile Worker'da şifrelenip ofis PC'sindeki SeaweedFS'e (S3 uyumlu) yazılır. Worker, depoya Cloudflare Tunnel + Workers VPC servisi (`goc-document-store`, `127.0.0.1:9000`) üzerinden ulaşır; depo internete açık değildir. Şifreleme anahtarı yalnızca Worker secret'ında durur. `receipts/`, `print/` ve D1 yedekleri R2'de kalır.

## Ayarlar

| Ad | Tür | Değer |
| --- | --- | --- |
| `DOCUMENT_STORAGE_BACKEND` | değişken | `r2` (pasif) → `dual` → `remote` |
| `DOCUMENT_ENCRYPTION_KEY_ID` | değişken | `1` |
| `DOCUMENT_STORE_ENDPOINT` | değişken | `http://127.0.0.1:9000` |
| `DOCUMENT_STORE_BUCKET` | değişken | `documents` |
| `DOCUMENT_STORE` | VPC bağlaması | servis `goc-document-store` (kimlik `wrangler.jsonc` içinde) |
| `DOCUMENT_STORE_ACCESS_KEY_ID` | secret | PC'de `C:\Goc\config\worker-s3.txt` |
| `DOCUMENT_STORE_SECRET_ACCESS_KEY` | secret | aynı dosya |
| `DOCUMENT_ENCRYPTION_KEYS` | secret | `{"1":"<base64, 32 bayt>"}` |

## Sıra (yayın kuralları gereği önemli)

1. Bu değişiklik repoda commit edilir (`runtime-secret-metadata.mjs` onaylı listesi, `wrangler.jsonc`, `worker-settings.mjs`).
2. **Yayından önce**, yayın çalışmıyorken, production Worker `goc` için Cloudflare'de ekleyin: 3 secret, 4 değişken, 1 VPC bağlaması. Yayın öncesi kontrol canlı secret adlarını onaylı listeyle birebir karşılaştırır.
3. Baseline ilerletme commit'i, push, ardından GitHub **Production release (manual)** (ayrı onayla). Bu yayında `DOCUMENT_STORAGE_BACKEND=r2` olduğu için davranış değişmez.
4. Yedeği doğrulayın (aşağıda), sonra `DOCUMENT_STORAGE_BACKEND` değerini `dual` yapın.

### Şifreleme anahtarı (Mac'te üretin, önce yedekleyin)

Anahtar kaybolursa uzak depodaki belgeler geri gelmez. Aşağıdaki komut anahtarı üretir, ekrana yazar ve secret'a yazar. Ekrandaki değeri **hemen** parola yöneticinize ve çevrimdışı bir kopyaya kaydedin:

```bash
KEY=$(openssl rand -base64 32) && echo "SAKLAYIN: $KEY" && printf '{"1":"%s"}' "$KEY" | npx wrangler secret put DOCUMENT_ENCRYPTION_KEYS --env production
```

### S3 anahtarları

PC'de yönetici olarak `C:\Goc\config\worker-s3.txt` dosyasını açın. Mac'te (değerler istenince yapıştırılır, görünmez; sohbete yazmayın):

```bash
npx wrangler secret put DOCUMENT_STORE_ACCESS_KEY_ID --env production
npx wrangler secret put DOCUMENT_STORE_SECRET_ACCESS_KEY --env production
```

Değişkenleri ve bağlamayı panelde `Workers & Pages > goc > Settings` altından ekleyin (`Variables and secrets`; `Bindings > Add > VPC service > goc-document-store`, değişken adı `DOCUMENT_STORE`).

## Geçiş (R2'den şifreli depoya)

`DOCUMENT_STORAGE_BACKEND=dual` olduktan sonra: yeni yüklemeler şifreli depoya gider, eski belgeler R2'den okunmaya devam eder. Taşıma yalnızca **yönetici** oturumuyla yapılır; R2'ye hiçbir şey yazılmaz ya da silinmez.

Yönetici olarak personel portalında oturum açıkken tarayıcı konsolunda önce kuru çalıştırma:

```js
const call = body => fetch('/api/staff/storage-migration/batch', { method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
let r = await call({ dry_run: true, limit: 8 }); console.log(r);
```

Sonuç beklenen gibiyse gerçek taşıma (her çağrı en fazla 20 nesne; bitene kadar `next_cursor` ile devam):

```js
let cursor = null, total = { copied: 0, already_present: 0, failed: [] };
do {
    const r = await call({ limit: 8, ...(cursor ? { cursor } : {}) });
    total.copied += r.copied; total.already_present += r.already_present; total.failed.push(...r.failed);
    cursor = r.next_cursor; console.log(r.scanned, r.copied, r.failed.length);
} while (cursor);
console.log(total);
```

Her kopya şifreli depodan geri okunup SHA-256 ile karşılaştırılır; uyuşmayan kopya silinir ve `failed` listesinde görünür. `failed` boş değilse nedenini inceleyin, R2'yi **silmeyin**.

## Geri dönüş

`DOCUMENT_STORAGE_BACKEND` değerini `r2` yapmak yeni yüklemeleri R2'ye döndürür. Şifreli depoya yazılmış belgeler (taşınan ve yeni yüklenen) `r2` modunda **okunmaz**; geri dönmeden önce `dual` modda iken yeni yüklenenleri R2'ye geri kopyalamak gerekir. Bu yüzden `remote`'a geçmeden ve R2'yi boşaltmadan önce UAT yapılmalıdır. R2'yi boşaltma ayrı, açık onay gerektirir.

## Güvenlik notları ve açık riskler

- Ofis PC'sinde madenci tespit edildi (2026-11-13, PC oturumu raporu, doğrulanmadı) ve PC'nin yeniden kurulmayacağı kararlaştırıldı. PC'deki S3 anahtarları ve tünel token'ı saldırganın erişimine açık sayılmalı. Belgeler şifreli olduğu için sızıntı değil, silme/değiştirme ve kesinti riski vardır. Temiz bir makine bulununca anahtarları ve tünel token'ını yenileyin.
- Okul bulutuna yedek: şifreli kopyalar alınır; **şifreleme anahtarı ayrıca çevrimdışı saklanmalıdır**. Geri yükleme bir kez denenmeden depo ana depo olarak kabul edilmemelidir.
- Virüs tarayıcı (scanner) belgeyi çözülmüş hâlde işler; tarama sırasında düz belge geçici olarak tarayıcı PC'sine gelir.
