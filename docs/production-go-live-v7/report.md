# Production v7 GO-LIVE — tamamlandı

**GO-LIVE SUCCESS** — 8 Ekim 2026, son kontrol 2026-10-08T14:09:05.861386+00:00.

Production Worker: `goc`. Deployment version ID: **cf84967e-e813-4e09-9146-17e3109c52c5**, trafik %100. Deployment ID: `5d1689a2-4ed4-471a-bd18-1fe649e25183`.

## Aktivasyon

Canlı Worker SHA-256 `4b0e72eeb2346ff5cf3f1687f126d4a4507bb8bfe2228856628b7faf0958a045`, önceki 701-testlik regresyondan geçen inceleme adayıyla birebir aynıydı. İncelenen source dosyalarının SHA değerleri de aynıydı. Kod ve asset değişikliği gerekmedi; mevcut Worker modülü korunarak **yalnız PRINT_ENABLED: false → true** binding değişikliği production'a deploy edildi.

`PRINT_UAT_ENABLED=false` kaldı. Özel staff UAT pencere/fixture ayarı açılmadı. Yerel `wrangler.jsonc` production anahtarı da onaylı canlı durumla eşlendi; staging bölümü değiştirilmedi.

Upload sırasında mevcut asset'ler `keep_assets`, secret binding'ler `keep_bindings` ile korundu; secret değerleri alınmadı/gösterilmedi/değiştirilmedi. Bu mekanizma [Cloudflare Upload Worker Module API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/) sözleşmesine dayanır. Deploy sonrası bütün binding metadata'sı, asset sayfa hash'leri, Worker byte'ları ve cron metadata'sı karşılaştırıldı.

## Canlı sonuçlar

| Kontrol | Sonuç |
|---|---|
| Public status | **HTTP 200 / available:true** |
| Gerçek öğrenci sayfası | **“Yazıcı kullanıma hazır.”**; 50 kopya / 200 toplam sayfa; eski 3 kopya sınırı ve unavailable uyarısı kalktı |
| Printer heartbeat | `Uluslararası Ofis`, **ready / settings_protocol:3**, `2026-10-08T14:09:02.175Z`; server kontrolünde 3.69 saniyelik kayıt; önceki kontrolden sonra ilerledi |
| Scanner heartbeat | **ready**, `2026-10-08T14:08:47.983Z`; engine 1.5.4, signature 28147 |
| Kuyruk / toplam print satırı | **0 / 0**; bu görev job veya fiziksel baskı oluşturmadı |
| Özel UAT | **Kapalı** |
| A3 / color / duplex | **false / false / false** |

Windows pythonw.exe, yazıcı portu ve Agent sürümü Antigravity'nin bildirimidir; bu görevde bağımsız olarak production D1 ready/protocol-3 heartbeat ve devamlı güncellenmesi doğrulandı.

## Öğrenci seçenekleri

- PDF, JPG, PNG.
- A4, Portrait / Landscape; siyah-beyaz, tek taraflı.
- 1–50 kopya; **page_count × copies ≤ 200**. Örneğin 20 sayfalık PDF için en fazla 10 kopya.
- Dosya en fazla **10 MiB (10 × 1024 × 1024 byte)**; PDF en fazla **20 sayfa**.
- A3, renkli ve çift taraflı baskı kapalı kalır.

Kaynak limitleri, magic-byte/actual-size doğrulaması, rate-limit, same-origin, upload/tracking/lease token kontrolleri ve duplicate-print/submission korumaları değişmedi. Belirsiz submission_started işi otomatik yeniden basılmaz.

## Güvenlik ve korunan sistemler

- [x] D1 `uluslarasiofis-production`, PRINT_FILES `uluslarasiofis-print-production`, DOCUMENTS `uluslarasiofis-documents-production` değişmedi; iki bucket ayrı kaldı.
- [x] Tüm mevcut secret binding ad/tipleri aynı; yalnız PRINT_ENABLED değişti.
- [x] Dakikalık `* * * * *` cleanup ve günlük `0 0 * * *` cron metadata'sı aynı.
- [x] `/`, `/basvuru/`, `/basvurum/`, `/yetkili/`, `/yazdir/`, extension download metadata: **HTTP 200 ve aynı asset hash**.
- [x] Scanner/ClamAV servisleri, kodu veya ayarları değiştirilmedi; taze scanner sağlık kaydı ready.
- [x] Anonymous printer/staff/UAT API erişimleri **401**; cross-origin intent **403**; geçersiz intent/finalize **400**. Sadece geçersiz metadata ve var olmayan job ID kullanıldı; dosya yüklenmedi.
- [x] Aktivasyon regresyonu **39/39 PASS**. Deploy edilen aynı kodun önceki tam Node regresyonu 700 PASS / 1 gerçek-ClamAV opt-in SKIP; Agent Python 45/45 ve scanner mock 14/14 PASS.
- [x] Staging kaynakları ve Windows yazıcı varsayılanları değiştirilmedi; staging kaynakları silinmedi.

Bir varsayılan Python user-agent sağlık GET'i 403 döndü. Aynı endpoint özel sağlık UA'sı ve browser UA'sıyla 200/available:true döndü; gerçek öğrenci tarayıcı sayfası da hazır. Bu ölçüm [final-health.json](final-health.json) içinde kayıtlıdır; herhangi bir güvenlik/edge kuralı gevşetilmedi.

## Hızlı kapatma

Cloudflare Dashboard → Workers & Pages → **goc** → Settings → Variables and Secrets: yalnız **PRINT_ENABLED** değerini tam string **false** yapıp deploy edin. **PRINT_UAT_ENABLED=false** kalsın. Secret alanlarına dokunmayın.

Sonrasında public status `200 / available:false`, yeni intent/finalize/claim `503 PRINT_DISABLED` beklenir. Heartbeat, reconcile ve result gibi authenticated recovery yolları korunur. Belirsiz işleri reset etmeyin veya otomatik yeniden göndermeyin. Gate, Windows spooler'a zaten teslim edilmiş işi geri çekmez.

Bu oturumda aynı kapatma yolunu sağlayan, secret değerlerini almadan mevcut kod/assets/binding'leri koruyan kontrol aracı `/private/tmp/ulof-golive-v7.py` oluşturuldu (`--action disable`); kapatma bu başarı durumunda çalıştırılmadı.

## Kanıtlar

- [Aktivasyon ve koruma karşılaştırması](activation.json)
- [Son public/Agent/scanner sağlık kontrolü](final-health.json)
- [Gerçek browser DOM kontrolü](browser-proof.json)
- [Canlı güvenlik probe sonuçları](security-probes.json)
- [39 test regresyon logu](activation-regression.log)
- [Öğrenci sayfası ekran görüntüsü](student-page.jpg)

Yeni fiziksel test baskısı gönderilmedi. Sistem kullanıcıların kendi belgeleriyle normal kullanımı için açıktır.
