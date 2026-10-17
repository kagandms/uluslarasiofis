# Fiziksel durum ve YKN 1.2.99 — production yayın doğrulaması

Tarih: 17 Ekim 2026. Kullanıcı canlıya alma ve farklı senaryolarla kontrol talimatı verdi.

## Yayın

- Worker: `goc`, ortam: `production`, trafik: %100.
- Kaynak commit: `c7e9e8a5c4d0111661ac31c93ca5cd864a423efe`; kod düzeltmeleri `0fda10c`, ek iş akışı testleri `c7e9e8a`.
- Son Worker version: `125284a4-1414-4d77-ab46-9ea5628fb566`.
- Son deployment: `93e38088-2f58-4069-9a6f-c18bd0cfa946`.
- Önceki Worker version: `0a300a96-53a9-4ae0-bc68-cad3f1e26645`.
- İlk yayın ardından sekiz tarihî ZIP son pakete eklenerek aynı kaynak kod tekrar yayımlandı; son sürüm yukarıdadır.
- Canlı eklenti: `1.2.99`, fingerprint `2cc8e33d7d0f`.
- Yeni ZIP ve latest SHA-256: `99f96c73cff24dd151352b8520131653090fc20360e3a22fff5cb624c52d86d5`.

## Testler ve ek kontrol sonucu

Temiz kopya: `/private/tmp/ulof-release-20261017.piLLcU`. `npm ci`, `npm test`, `npm run build:production` ve `npm run deploy:dry-run:production` başarılı. Test sonucu: **1.058 geçti, 0 başarısız, 1 atlandı**; toplam 1.059. Tarihî arşivler eklendikten sonra eklenti paket testleri ve production dry-run tekrar geçti.

Kullanıcı YKN verildikten sonra Tamam'a basıldığını; kabul kodu aramasının ad, soyad, doğum tarihi ve pasaport numarasını getirdiğini, kalan alanları eklentinin tamamlaması gerektiğini açıkladı. Bu bilgiye göre dolu kabul kutusundaki eski kodun yenisiyle değiştirilmesi ve bu dört alan salt okunur/dolu iken diğer alanlar ile fotoğrafın tamamlanması test edildi; geçti. Yeni kod, eski değeri native inputta temizleyip yeni kodu yazar ve tek arama gönderir.

Kontrol edilen başlıca durumlar:

- PDF olmadan mevcut personel durumları; ITU kodunda aynı durum; ret gerekçesi ve mevcut veri korumaları.
- 10 ardışık öğrenci; aynı sekmede F5 olmadan arama, alan ve fotoğraf aktarımı; her geçişte tek reset.
- Eski form, eski kabul kodu, sonuç penceresini kapatma, yinelenen istek ve yanlış/kapanmış hedef sekme.
- Fotoğraf postback'i sonrası alan kaybı; eksik alan tamamlama; doğrulama yoksa fotoğraf/fallback başlatmama.
- Geç gelen eski öğrenci aktarımı: bir ek hata önce başarısız testle üretildi. Öğrenci verisinin saklanması taze form doğrulamasından sonraya taşınarak güncel öğrencinin geçici verisinin bozulması engellendi.

## Migration ve kaynakların korunması

Yalnızca `0024_physical_status_without_pdf.sql` bekliyordu ve uygulandı. Şema nesneleri karşılaştırıldığında tek fark `physical_migration_pdf_guard` trigger'ının kaldırılmasıdır. Başka trigger, index, tablo veya kolon değişmedi.

Migration öncesi/sonrası sayılar aynı: 154 fiziksel kayıt, 27 dosya, 153 makbuz. D1 Time Travel bookmark: `000000a2-000002d5-00005107-9d364d4a1435dbe334bb4e2fe3a503e3`. Gerçek öğrenci kaydı test amacıyla değiştirilmedi veya oluşturulmadı.

34 binding ve Worker runtime yapılandırması birebir aynı. 13 secret'ın ad/tür metadatası aynı; değerleri incelenmedi veya değiştirilmedi. D1/R2 bağlantıları aynı. Cron'lar aynı: `* * * * *`, `0 0 * * *`. `PRINT_ENABLED=true`, `PHYSICAL_INTAKE_MODE=on` ve mevcut diğer print ayarları korundu. Scanner ve Windows Print Agent v7 değiştirilmedi.

Sekiz eski eklenti ZIP'i hashleriyle son build'de ve canlı HTTP indirmelerinde doğrulandı. Eski worktree/dal/klasör veya Cloudflare kaynakları silinmedi.

## Canlı HTTP doğrulaması

- `/`: 200; `/yetkili/`: 200.
- Girişsiz `POST /api/staff/physical-intakes/query`: 401.
- Geçersiz takip kodu sorgusu: 200, `found:false`.
- Canlı staff bundle SHA-256 temiz production build ile aynı.
- Eklenti metadata, fingerprint'li ZIP, latest ZIP ve sekiz tarihî ZIP: 200; bütün hashler beklenenle aynı.
- Deployment API son Worker sürümüne %100 trafik doğruladı.

## Açık kalanlar

Gerçek, oturum açık Apply/YÖKSİS hesabında seri öğrenci ve YÖKSİS sunucusunun fotoğrafı kabul etmesi henüz doğrulanmadı. Yerel 10 öğrenci testi gerçek hesap UAT'si değildir. Eklenti otomatik güncellenmez: yeni 1.2.99 paketi kurulmalı/yenilenmeli; portal, Apply ve YÖKSİS sekmeleri güncelleme sonrası bir defa yenilenmeli.

Normal `git push origin production`, GH013 ile reddedildi: production değişiklikleri PR ve Validate kontrolü istiyor. Force push, kural değişikliği veya kullanıcı istemeden yeni dal yapılmadı. Kaynak commitler yerelde kayıtlı; GitHub production senkronu bekliyor. Cloudflare yayını doğrulanmış temiz kaynak commitinden tamamlandı.

Kanıt dosyaları: `/tmp/ulof-release-clean-tests.log`, `/tmp/ulof-release-final-assets-dry-run.log`, `/tmp/ulof-release-final-deploy.log`, `/tmp/ulof-release-preservation-check.json`, `/tmp/ulof-release-live-probes.json`, `/tmp/ulof-release-live-archives.json`, `/tmp/ulof-release-before-schema-objects.json`, `/tmp/ulof-release-after-schema.json`.
