# Production UAT düzeltmeleri — tek takip kaydı

**Amaç:** Canlı testte doğrulanan hataları en küçük güvenli değişikliklerle gidermek. Production branch üzerinde yerel çalışma; deploy, migration veya canlı veri değişikliği yok.

**Kaynak:** 2 Kasım 2026 canlı test raporu; `live-production-test-report.md` (bu chat'in artifact klasörü).

## Uygulama planı

| Bulgu | En küçük çözüm | Korunacak davranış | Kanıt / durum |
|---|---|---|---|
| LIVE-01 P1 yenileme false conflict | Scanner INSERT metadata'sında trigger yazımını kabul et; diğer atomik guard'lar tam 1 kalır | Stale revision, yetki, conflict ve rollback korumaları | Yerelde düzeltildi. Trigger-aware regresyon ve atomik/stale/rollback testleri geçti. |
| LIVE-02 P2 devam ekranı etiketi | Yeni metin eklemek yerine mevcut beş dildeki etiketi kullan | Referans+öğrenci no giriş sözleşmesi | Yerelde düzeltildi. Beş dil testi; TR/EN gerçek tarayıcı kontrolü geçti. |
| LIVE-03 P2 rehber odağı | Açılış/kapanış focus, Tab çevrimi ve arka plan inert; ortak cleanup | Escape/X/alt düğme/singleton davranışı | Yerelde düzeltildi. Escape/X/alt düğme/singleton testleri ve gerçek tarayıcı Tab/odak dönüşü geçti. |
| LIVE-04 P2 UTC oluşturulma saati | SQLite timestamp'i UTC olarak yorumlayan ortak gösterim; İstanbul saat dilimi | Veritabanı değerleri, ISO offset'leri ve yalnız tarih alanları | Yerelde düzeltildi. Öğrenci/yetkili/arşiv/kuyruk/PDF aynı helper; UTC/İstanbul/Los Angeles testleri geçti, date-only alanlar korundu. |
| LIVE-05 güvenlik başlıkları | Uyumluluğu kanıtlı nosniff ve mevcut tarayıcı varsayılanı referrer policy | R2/CORS/PDF/blob/camera/extension davranışı | Güvenli kapsam uygulandı. Worker ve statik asset kuralları, stream/MIME/cache/304 kontrolleri geçti; katı politikalar aşağıdaki ayrı kabul işinde. |

Her davranış düzeltmesi için önce başarısız regresyon, sonra minimum uygulama ve ilgili testler. Sonunda bağımsız diff incelemesi, `npm test`, `npm run build:production`, `npm run deploy:dry-run:production` ve Git değişiklik kontrolü yapılacak.

## Bu sürümde otomatik değiştirilmeyenler

- CSP/frame/permissions/HSTS: hedef kaynak ve frame envanteri tamamlanmadan katı politika eklenmez; PDF, CDN worker, telefon ve dış entegrasyonlar için ayrı kabul testi gerekir.
- Yerel statik build smoke sırasında service worker `header_logo.jpg` için 404 aldı; ana görünür Topkapı logosu yüklendi. Bu turdaki değişikliklerden kaynaklandığı gösterilmedi, ayrı asset/precache kontrolü olarak kaydedildi.
- Mobil RTL/scroll-reveal geçiş taşması, geçici print durum metni, peş peşe dosya seçimi ve ZIP download timeout: canlı raporda araştırma adaylarıdır, kesin kök neden bulunmadan çalışan yollar değiştirilmez.
- İstanbul güncel yazılı evrak teyidi, gerçek cihaz/print/WhatsApp/YÖKSİS ve role matrisi: ayrı kabul işleri, bu yerel düzeltme bunların geçtiği anlamına gelmez.
- Productionda bırakılan iki sentetik kayıt: silinmez; kalıcı temizleme ayrı onay gerektirir.


## Son doğrulama

- `npm test`: **1302 test; 1301 başarılı, 0 başarısız, 1 atlanan**. Son koşu logu: bu chat'in artifact klasöründeki `fix-npm-test-final.log`.
- Atlanan: `real MacBook ClamAV scans via HTTPS job protocol and preserves staff/review/ZIP/replacement gates`. Gerçek ClamAV/donanım UAT'si bu yerel düzeltme turunda çalıştırılmadı.
- İlk tam koşuda telefon aktarımı testindeki sabit 20/30 ms varsayımı altında üçüncü fotoğraf henüz gelmemişti (1300 başarılı, 1 başarısız, 1 atlanan). Üretim mobil kodu değiştirilmedi; test açık promise tamamlama sinyalleriyle düzeltildi. Eşzamanlılık 2, ters tamamlanma ve sıralı içe aktarma kontrolleri korundu. Son tam koşu yeşil.
- `npm run build:production`: başarılı.
- `npm run deploy:dry-run:production`: başarılı; gerçek deploy yapılmadı. Ön adım yalnız mevcut production secret isim/binding metadatasını doğruladı.
- Build çıktısında hedef `goc`, `targetEnvironment=production`, `PRINT_ENABLED=true`, `PHYSICAL_INTAKE_MODE=on` ve kopyalanmış `_headers` kuralları assertion ile doğrulandı. D1/R2 bağları, secret değerleri ve cron yapılandırması değiştirilmedi.
- `git diff --check`: temiz. Çalışmaya başlarken branch production, HEAD 76872ab ve temiz çalışma ağacı doğrulandı. Commit/push yapılmadı.
- Bağımsız çapraz inceleme: backend/time değişiklikleri diğer ajan; modal/headers değişiklikleri diğer ajan tarafından okundu; aksiyon gerektiren regresyon bulunmadı.
- Gerçek tarayıcıyla **yerel statik production build** kontrolü: rehber odağı, Shift+Tab/Tab çevrimi ve Escape sonrası tetikleyiciye dönüş; TR/EN referans etiketi geçti. Bu sunucu testi veya canlı deploy sonrası UAT değildir. Yerel statik sunucuda API/Worker çalıştırılmadı; bu kontrol yalnız build edilmiş arayüz içindir.

## Uyumluluk kararları

- Yeni bağımlılık veya veritabanı migration'ı yok. Eski kayıtlardaki oluşturulma zamanı yerinde korunuyor; yalnız görüntüde SQLite UTC yorumu düzeltiliyor. Açık ISO offset'leri ve doğum tarihi gibi yalnız tarih alanları korunuyor.
- Yenileme fix'i tüm metadata kontrollerini gevşetmiyor: yedi korumalı yazım tam 1 satır kalıyor, yalnız son scanner insert'inde tetikleyici yazımı kabul ediliyor.
- Güvenlik başlıkları mevcut Content-Type, cache, CSP, CORS, Content-Disposition, range, ETag ve gövde stream'ini değiştirmiyor. Daha sıkı mevcut Referrer-Policy korunuyor.
- Statik asset'ler Worker'ı atlayabildiğinden `_headers` dosyası da build'e dahil. Kural davranışı için [Cloudflare static asset headers](https://developers.cloudflare.com/workers/static-assets/headers/), [MDN nosniff](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Content-Type-Options), [MDN Referrer-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy) esas alındı.
- Build'in yerel gerekli secret uyarısı ve mevcut chunk boyutu/dinamik import uyarıları izlendi; production secret metadata kontrolü dry-run'da geçti. Secret değerleri yerel dosyalara taşınmadı.

**Yayın durumu:** Düzeltmeler yalnız yerel çalışma ağacında. Canlı sistemdeki P1 davranışın giderildiği henüz iddia edilmiyor. Açık deploy onayından ve yayından sonra iki sentetik belge yenilemesi, başlıklar ve arayüz kısa regresyonu production üzerinde tekrar kontrol edilmelidir.
