# Cloudflare analitik raporu (20 Ekim – 19 Kasım 2026) ve yapılacaklar

- **Tarih:** 2026-11-20 (yapılacaklar bu tarih için planlandı; analiz 2026-11-19'da yapıldı)
- **Kapsam:** `topkapiunigoc.com` zone'unun Cloudflare panelinden alınan 7 analitik raporu: Ziyaretçiler, İstekler, Performans, Güvenlik, Önbellek, Origin, DNS.
- **Kaynak:** Cloudflare panelinden indirilen 7 PDF (ölçüm aralığı 20 Ekim 2026 21:34 – 19 Kasım 2026 21:34, GMT+3). Görsel boyutları depodaki dosyalardan ölçüldü.
- **Durum:** Analiz tamamlandı. Yapılacaklar listesi henüz uygulanmadı ve test edilmedi. Tarihli bir kayıttır, ileride tarihsel kabul edilmelidir.

**Genel not: yaklaşık 78/100.** Yeni bir domain ve yerel bir ofis portalı için iyi bir tablo. Ciddi bir sorun yok. Kazanç en çok iki şişkin görselde ve Cloudflare tarafındaki güvenlik kurallarında.

| Başlık | Not |
| --- | --- |
| Ziyaretçiler | 80 |
| İstekler ve hatalar | 82 |
| Performans | 72 |
| Güvenlik | 70 |
| Önbellek | 74 |
| Origin | değerlendirme dışı (≈85) |
| DNS | 80 |

---

## 1. Ziyaretçiler – 80/100

**Veriler**

| Metrik | Değer |
| --- | --- |
| Sayfa görüntüleme | 10.580 |
| Toplam ziyaret | 2.850 (ziyaret başına ≈3,7 sayfa) |
| Cihaz | Mobil 6.930 · Masaüstü 3.600 · Tablet 50 |
| İşletim sistemi | Android 3.750 · iOS 3.030 · Windows 2.050 · Bilinmeyen 1.060 · macOS 560 · Linux 130 |
| Tarayıcı | Chrome Mobile 3.590 · Mobile Safari 2.480 · Chrome 1.820 · Edge 550 · Samsung Internet 520 · GoogleBot 70 · BingBot 70 · curl 60 |
| Host | topkapiunigoc.com 10.520 · www 30 · :8443 20 · :2053 10 |

| Ülke | Görüntüleme | | Yol | Görüntüleme |
| --- | --- | --- | --- | --- |
| Türkiye | 8.950 | | `/` | 7.820 |
| ABD | 660 | | `/basvurum/` | 1.360 |
| Birleşik Krallık | 150 | | `/basvuru/` | 820 |
| Almanya | 130 | | `/basvuruya-devam-et/` | 290 |
| Hollanda | 70 | | `/yetkili/` | 270 |
| Rusya | 70 | | `/yazdir/` | 20 |

**İyi yönler**
- Ziyaret başına ≈3,7 sayfa düşüyor; insanlar sitede gerçekten iş yapıyor.
- Trafiğin %85'i Türkiye'den geliyor, yani hedef kitle doğru.
- Akış mantıklı: önce ana sayfa, sonra başvurum, başvuru ve başvuruya devam et.
- Ziyaretlerin %65'i mobilden geliyor. Mobil iyileştirmelerin doğru yatırım olduğunu gösteriyor.

**Geliştirilebilir yönler**
- Ana sayfadan başvuruya geçiş yaklaşık %10 (`/` 7.820 → `/basvuru/` 820). Planlanan soru formu ve chatbot bu oranı yükseltebilir.
- ABD trafiğinin ve "Bilinmeyen" cihazların bir kısmı muhtemelen bot ve tarayıcı. Gerçek insan sayısı biraz daha düşük olabilir.

## 2. İstekler ve hatalar – 82/100

**Veriler**

| Metrik | Değer |
| --- | --- |
| Toplam istek | 118.580 |
| Toplam veri aktarımı | 3,78 GB |
| 5xx hata oranı | %0,14 (170) |
| Durum sınıfları | 2xx 73.380 · 3xx 39.540 · 4xx 5.490 · 5xx 170 |
| Durum kodları | 200: 61.680 · 304: 37.260 · 204: 8.880 · 404: 3.040 · 201: 2.810 · 301: 2.280 · 401: 1.260 · 409: 730 · 429: 270 · 500: 160 |
| HTTP sürümü | HTTP/3 82.040 · HTTP/2 31.370 · HTTP/1.1 5.160 · HTTP/1.0 10 |
| Cihaz | Mobil 63.130 · Masaüstü 54.930 · Tablet 520 |
| En çok istek yapan IP | 92.45.114.210: 34.240 (%29, muhtemelen ofis) |
| Host | topkapiunigoc.com 116.550 · www 1.910 · diğer portlar ≈60 |

En çok istek alan yollar: `/cdn-cgi/rum` 8.890 (Web Analytics), `/` 8.350, `/api/staff/scanner/status` 6.810, `/api/public/applications/...` 5.070 + 4.660, `/topkapi_logo.jpg` 5.030, `/assets/pdf.worker.min-...` 4.510, `/assets/modulepreload-...` 4.400, `/api/session` 3.330, `/assets/main-...` 3.030.

Ülkeler (istek): Türkiye 107.750, ABD 2.580, Belçika 1.490, Singapur 880, Birleşik Krallık 880.

**İyi yönler**
- 5xx oranı %0,14 ile çok düşük.
- 37.260 adet `304 Not Modified` var; tarayıcılar dosyaları tekrar indirmek yerine önbelleği kullanıyor.
- Bağlantıların %69'u HTTP/3 ile geliyor.
- `www` adresi 301 ile ana domaine düzgün yönleniyor.

**Geliştirilebilir yönler**
- 160 adet `500` hatası var. Hangi endpoint'ten geldiği Worker loglarından bulunmalı.
- 3.040 adet `404` var. Çoğu muhtemelen bot taraması, ama kırık bir iç link olabilir.
- Ofis IP'si isteklerin %29'unu yapıyor (scanner durum sorgusu, personel ekranları). Bu normal, ama dışarıdan gelen trafik gösterilenden küçük.

## 3. Performans – 72/100

**Veriler**

| Metrik | Değer |
| --- | --- |
| Origin yanıt süresi | Veri yok (site Worker üzerinden çalışıyor, origin yok) |
| TLS | TLS 1.3 117.510 · TLS yok (düz HTTP) 610 · TLS 1.2 460 |

En çok veri aktaran yollar: `/api/public/applicati...` 220,78 MB ve 218,26 MB, **`/icon.png` 198,55 MB**, **`/assets/header_log...` 133,31 MB**, `/api/public/applicati...` 123,28 MB, `/assets/es-...` 78,26 MB, `/api/staff/physical-i...` 71,83 MB, `/api/staff/applicatio...` 70,26 MB.

Depodaki dosya boyutları:

| Dosya | Boyut |
| --- | --- |
| `header_logo.jpg` | **1.024.662 bayt (≈1 MB)** |
| `public/icon.png` | **201.550 bayt (≈200 KB)** |
| `public/icon-192.png` | 21.536 bayt |
| `public/topkapi_logo.jpg` | 20.471 bayt |

**İyi yönler**
- Origin gecikmesi yok, her şey Worker'dan dönüyor.
- TLS 1.3 oranı %99.

**Geliştirilebilir yönler**
- `header_logo.jpg` 1 MB; tek başına 133 MB trafik yaptı.
- `icon.png` 200 KB; bir ikon için çok büyük, 198 MB trafik yaptı.
- `pdf.worker.min` 4.510 kez yüklenmiş. Yalnızca PDF açıldığında yüklenmeli.

## 4. Güvenlik – 70/100

**Veriler**

| Metrik | Değer |
| --- | --- |
| Engellenen istek | 40 (%0,03, tamamı Managed rules → Block) |
| Custom rule / Rate limiting | Veri yok (tanımlı kural yok) |
| Cloudflare'den sunulan | 117.940 |
| Origin'e giden | 600 |
| Engellenen yollar | `/wp-json/batch/v1` 20 · `/wp-config.php` 10 · `/` 10 |
| Engellenen ülkeler | Romanya, Hollanda, Birleşik Krallık, ABD (her biri 10) |

**İyi yönler**
- Saldırı yükü çok düşük.
- WordPress taramaları hazır kurallarla zaten engelleniyor.

**Geliştirilebilir yönler**
- Cloudflare katmanında custom rule ve rate-limit kuralı yok. Uygulamadaki 429 sınırı (270 istek) çalışıyor, ama ilk koruma kenarda olmalı.
- Botlar 8443, 2053 ve 2082 gibi alternatif portları yokluyor.

## 5. Önbellek – 74/100

**Veriler**

| Metrik | Değer |
| --- | --- |
| Önbellek isabet oranı | %53,93 |
| Önbellekten / önbelleksiz istek | 63.950 / 54.630 (Hit 63.950 · None 54.030 · Miss 600) |
| Önbellekten verilen trafik | 1,15 GB / 3,78 GB (tasarruf %30,40) |
| Önbellekteki içerik tipleri | js 31.290 · html 10.520 · css 6.760 · png 5.690 · jpeg 5.230 · json 2.760 |
| Önbelleksiz içerik tipleri | json 36.810 · txt 8.880 · pdf 2.990 · boş 2.960 · html 2.370 |

En çok önbellekten verilenler: `/` 7.790, `/topkapi_logo.jpg` 5.010, `pdf.worker.min` 4.490, `modulepreload` 4.370, `main` 3.020, `manifest.json` 2.600.
En çok önbelleksiz verilenler: `/cdn-cgi/rum` 8.890, `/api/staff/scanner/status` 6.810, `/api/public/applications/...` 5.070 ve 4.660, `/api/session` 3.330, `/api/staff/work-hours` 1.500.

**İyi yönler**
- Statik dosyalar (JS, CSS, görsel) neredeyse tamamen önbellekten geliyor.
- Önbelleksiz isteklerin hepsi API, oturum ve kişisel veri; bunlar önbelleğe alınmamalı. %54'lük oran bu yüzden yanıltıcı ve kabul edilebilir.

**Geliştirilebilir yönler**
- Trafik tasarrufu %30'da kalıyor. Büyük görseller küçülünce bu oran kendiliğinden iyileşir.

## 6. Origin – değerlendirme dışı (≈85/100)

**Veriler:** Origin erişilebilirliği %0. Bağlantı denemelerinin 600'ü başarısız, 0'ı başarılı. Origin'e 37,81 MB veri aktarılmış, yanıt süresi verisi yok.

**Yorum:** Site Worker ile çalıştığı için gerçek bir origin sunucusu yok; bu yüzden %0 bir hata değil. Başarısız 600 bağlantı büyük ihtimalle Worker'a bağlı olmayan host ve port kombinasyonlarına gelen bot istekleri. Kullanıcıya bir etkisi görünmüyor.

## 7. DNS – 80/100

**Veriler**

| Metrik | Değer |
| --- | --- |
| Toplam sorgu | 23.200 (0,01/sn) |
| NOERROR / NXDOMAIN | %82,76 (19.200) / %17,24 (4.000) |
| Ortalama işlem süresi | 3 ms |
| Kayıt tipi | A 11.100 · AAAA 5.300 · HTTPS 1.400 · DNSKEY 1.300 · MX 900 · TXT 900 · CNAME 800 · NS 800 · SOA 300 · CAA 200 |
| IP sürümü | IPv4 18.400 · IPv6 4.800 |
| Veri merkezi | İstanbul 3.900 · Amsterdam 3.600 · Frankfurt 3.600 · Ashburn 2.400 |

Başarısız sorgu adları: `m.`, `cpanel.`, `_domainkey.`, `*.` (her biri 200); `sig1._domainkey.`, `krisha.`, `bak.`, `clab1._domainkey.`, `_mta-sts.` (her biri 100).

**İyi yönler**
- DNS yanıt süresi 3 ms ile çok hızlı.

**Geliştirilebilir yönler**
- NXDOMAIN sorgularının çoğu alt alan adı yoklayan tarayıcılardan geliyor; bu normal.
- `_domainkey`, `_mta-sts` ve MX sorguları e-posta sunucularının bu domaini kontrol ettiğini gösteriyor. Domain e-posta göndermiyor (gönderim Apps Script üzerinden yapılıyor, bkz. [e-posta teslim edilebilirlik kontrol listesi](2026-11-16-reference-mail-deliverability-checklist.md)). Bu durumda sahte mail gönderimine karşı kayıtlar eksik.

---

## Yapılacaklar – 2026-11-20

Sıra, etki ve kolaylığa göre belirlendi. Bölüm A kod değişikliğidir ve proje kurallarına göre bir task branch'inde yapılır. Bölüm B ve C Cloudflare panelinden yapılır, kod gerektirmez. DNS ve WAF değişiklikleri domain sahibinin açık onayıyla yapılmalıdır.

### A. Kod (task branch, yerel test sonrası birleştirme)

- [ ] **Header logosunu küçült.** `header_logo.jpg` (≈1 MB) dosyasını en fazla 150 KB'lık bir WebP veya optimize JPG'ye çevir; gerçek gösterim genişliğine göre yeniden boyutlandır. Beklenen kazanç: ayda ≈120 MB trafik ve mobilde daha hızlı ilk açılış.
- [ ] **`public/icon.png` dosyasını küçült.** 200 KB'tan 20–30 KB'a indir (512×512, optimize PNG). Beklenen kazanç: ayda ≈180 MB trafik.
- [ ] **`pdf.worker.min` yüklemesini ertele.** Yalnızca PDF görüntüleme veya birleştirme ekranı açıldığında yüklensin; ana sayfa ve başvuru akışında preload edilmesin.
- [ ] **500 hatalarının kaynağını bul.** Worker loglarında (`wrangler tail` veya Workers Logs) 160 adet 500 yanıtının hangi endpoint'ten geldiğini belirle; gerekiyorsa `systematic-debugging` ile düzelt.
- [ ] **404'leri kontrol et.** 3.040 adet 404'ün bot taraması mı yoksa kırık iç link mi olduğunu ayır. Kırık link varsa düzelt.
- [ ] Doğrulama: `npm test`, `npm run build:production`, `npm run deploy:dry-run:production`.

### B. Cloudflare güvenlik (panel, ücretsiz plan)

- [ ] **Custom WAF kuralı:** yolu `.php` ile biten veya `/wp-`, `/.env`, `/.git` ile başlayan istekleri **Block** et.
- [ ] **Alternatif port kuralı:** 443 ve 80 dışındaki portlara (8443, 2053, 2082, 2083, 2087, 2096) gelen istekleri **Block** et.
- [ ] **Rate limiting kuralı:** `/api/public/applications/*` için IP başına makul bir sınır (ör. 10 saniyede 30 istek) koy; aşanları kısa süreli engelle. Ofis IP'sini ve scanner ile Print Agent trafiğini etkilemediğini doğrula.
- [ ] Bir hafta sonra Güvenlik raporunda kuralların neyi yakaladığını kontrol et; yanlış pozitif varsa gevşet.

### C. DNS ve e-posta güvenliği (panel)

- [ ] **SPF:** kök (`@`) için TXT kaydı `v=spf1 -all`
- [ ] **DMARC:** `_dmarc` için TXT kaydı `v=DMARC1; p=reject`
- [ ] **Null MX:** `@` için MX kaydı, öncelik 0, hedef `.` (domain e-posta almıyorsa)
- [ ] **DNSSEC:** kapalıysa Cloudflare DNS ayarlarından etkinleştir (registrar'a DS kaydı eklenmesi gerekebilir).
- [ ] Not: İleride `@topkapiunigoc.com` adresiyle e-posta kullanılmak istenirse bu kısıtlayıcı kayıtlar yerine Cloudflare Email Routing ayrıca değerlendirilmeli.

### D. Ürün ve dönüşüm

- [ ] Ana sayfadan başvuruya geçiş oranını (≈%10) soru formu ve chatbot yayına alındıktan sonra yeniden ölç.
- [ ] Bir sonraki raporu 2026-12-20 civarında aynı 7 başlıkla al ve bu dosyadaki rakamlarla karşılaştır.
