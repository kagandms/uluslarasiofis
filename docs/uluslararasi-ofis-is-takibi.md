# Uluslararası Öğrenci Ofisi Portalı — İş Takibi

**Son güncelleme:** 7 Kasım 2026 (plan v2)
**Aktif proje klasörü:** `/Users/kagansmtdms/Downloads/Проекты/uluslarasiofis-clean-workspace-20261105`
**Canlı portal:** https://goc.topkapiuni.workers.dev/
**Kapsam:** Yerel kod ve dokümanlar. Canlı sistem yalnızca salt okunur kontrollerle incelenir; canlı değişiklik her biri için ayrıca onaylanır.
**Doğrulama durumu:** Canlı Worker sürümü doğrulanmadı. Yerel `production` ile canlı sürümün aynı olduğu varsayılmaz.

## Genel kurallar

- Her değişiklik önce yerelde yapılır ve test edilir. Test sonucu sahibine bildirilir, sonra canlıya alma kararı verilir.
- Teslim öncesi: `npm test`, `npm run build:production`, `npm run deploy:dry-run:production`.
- Normal `production` push ve CI ayrı adımdır. Canlı yayın yalnızca açık talep ve tam SHA ile, manuel workflow üzerinden yapılır.
- Öğrenci verisi (ad, numara, pasaport/YKN, belge içeriği, erişim kodu, token, dosya bağlantısı) raporlara, loglara ve bu dosyaya yazılmaz. Raporlar toplulaştırılır.
- Canlı D1/R2'den silme, taşıma veya migration yalnızca her parti için ayrı onayla yapılır.

## Sıra

| Sıra | İş | Tür |
|---|---|---|
| 1 | Taramada başarısız belgeler: öğrencinin okula gelmeden çözmesi | Kod + ofis süreci |
| 2 | Sıkıntılı belge listesi (ekran görüntüsündeki kayıtlar) | Operasyon, salt okunur özet |
| 3 | Mobil veride `goc` ve `/yazdir/` erişimi: kök neden | Araştırma |
| 4 | Yazma kotası (D1), Cloudflare ücretsiz sınırları, yoğunluk simülasyonu | Ölçüm + yerel simülasyon |
| 5 | Göç'e gönderilen dosyaların okul PC'sine taşınıp Cloudflare'den silinmesi | Kod (yerel) + ofis onayı |
| 6 | Telefon ve bilgisayar başvuru tasarımları | Tasarım, en son |

## 1. Taramada başarısız belgeler: öğrenci kendi çözsün

**Ekran bulgusu:** Yetkili panelinde "20 Doğrulanamayan Dosya" ve her satırda `unsupported_content` uyarısı var. Uyarı, başvuru sahibinin "replacement akışından" desteklenen dosyayı yüklemesini, aynı dosyanın yeniden taranmamasını söylüyor.

**Kod bulgusu (salt okunur):**
- `src/server/repositories/d1/scanner-repository.js` satır 182: başarısız iş listesi `LIMIT 20` ile okunuyor. Yani "20" gerçek sayı değil, üst sınır. Gerçek sayı canlıda daha yüksek (önceki ölçüm: 66 başarısız iş, 25 güncel belge).
- `src/staff/scanner-manager.js` satır 116/126: rozet ve özet bu sınırlı listeden sayıyor. Düzeltme: toplam sayıyı ayrı `COUNT` sorgusuyla al, metni "ilk 20 / toplam N" olarak göster.
- Öğrenci yeniden yükleme yolu (`src/public/applicationTracking.js` satır 380): yalnızca başvuru durumu `resubmission_required` iken açılıyor. Taslakta belge değiştirme ayrı çalışıyor (README). Yani inceleme veya gönderilmiş durumda öğrenci kendi kendine yükleyemez; personelin önce talep açması gerekiyor.
- `unsupported_content` ve `policy_blocked` sonuçları yeniden denenmez (`scanner-repository.js` satır 21). Tarama başarısızlığında dosya `scan_status='failed'` olarak kalır (`scanner-repository.js` satır 34–35).

**Adım 1.1 sonucu (salt okunur, 7 Kasım 2026):**
- Öğrenci yeniden yükleme ekranı üç koşulu birlikte ister (`src/server/domain/resubmissionUploadPolicy.js`):
  1. Başvuru durumu `resubmission_required` olmalı.
  2. Bu belge için personelin öğrenciye gönderdiği belge notu/mesajı olmalı (`hasStudentMessageForDocument`).
  3. Belge durumu uygun olmalı: ya eksik yükleme (`missing_upload`), ya ilk değişim (kayıt ve revizyon `resubmission_required`, tarama `clean`/`unsafe`/`failed`), ya da güvensiz tarama tekrarı (kayıt `pending`, revizyon `submitted`, tarama `unsafe`/`failed`).
- Gönderilmiş veya inceleme durumundaki başvuruda öğrenci kendi başına yükleyemez. Personel önce başvuruyu `under_review`'a alır, sonra belge talebi açar (`applicationReviewRepository.js` `requestCurrentDocumentResubmission`, durum `under_review` veya `resubmission_required` iken çalışır).
- Personel talebi arayüzde `applicationsManager.js` satır 945'teki `request-resubmission` çağrısıyla açılıyor.
- Taslakta öğrenci belgeyi kendisi değiştirebiliyor (README).
- **Sonuç:** Hedef ("öğrenci okula gelmeden çözsün") bugün yalnızca personelin talep açmasıyla mümkün. Öğrenci tarafında tek başına bir başlangıç noktası yok. Eksik parçalar: (a) gönderilmiş başvurular için tek adımlık talep, (b) öğrenciye talebi duyuran kanal.
- Bildirim kanalı (adım 1.2 ön bulgusu): kod varsayılanında WhatsApp ve e-posta sağlayıcıları yapılandırılmamış; WhatsApp için ayrıca öğrenci izni ve onaylı şablon gerekiyor (`notificationService.js`). Canlıda yapılandırma olup olmadığı doğrulanmadı.

**Hedef:** Öğrenci yalnızca `/basvurum/` sayfasına referans ve erişim kodu ile girerek eksik belgeyi yükleyebilsin. Okula gelmesi gerekmesin.

**Adımlar:**
1. Durum bazlı haritayı çıkar: taslak, inceleme, gönderilmiş, `resubmission_required` için öğrencinin ne gördüğü ve ne yapabildiği (salt okunur kod okuma).
2. Eksikleri belirle. Öncelikli aday: personelin tek tıkla belge bazlı talep açabilmesi ve öğrenciye sayfada görünen bir uyarı. Bildirim (SMS/WhatsApp) sağlayıcıları yapılandırılmamış olabilir; bu, ofisin kararını gerektirir.
3. Yerelde sentetik başvuruyla uçtan uca dene: taramada başarısız → talep → öğrenci yükler → yeni revizyon taranır.
4. Test ekle, `npm test` geçmeli.

**Karar güncellemesi (7 Kasım, sahip onayı):**
- Bildirim kanalı yok ve kurulmayacak. Öğrenci talebi yalnızca portaldan (`/basvurum/`, referans + erişim kodu) görür; gerekirse ofis bilgiyi kendisi iletir. Otomatik bildirim işi bu planın kapsamı dışındadır.
- Sıra: önce "kurtarma" denemesi, olmazsa personel öğrenci detayından belge talebi açar.
  1. **Kurtarma (mevcut araç):** Yalnızca yeniden denenebilir sonuçlar için mevcut "Taramayı yeniden dene" düğmesi kullanılır (`scanner-repository.js` satır 61: `unsupported_content` ve `policy_blocked` hariç). Bu, taramanın bir geçici hata yüzünden başarısız olduğu dosyaları kurtarır. Taramayı atlatmak veya zorlamak için kod yazılmaz.
  2. **Kurtarılamayanlar:** Dosyanın yanlış belge olduğu kontrol edilir. Yanlışsa öğrenci detayından belge talebi açılır ve öğrenci portaldan yeniden yükler.
- Ön adım (salt okunur): Başarısız işlerin `result_code` dağılımı toplulaştırılmış sayılarla çıkarılır. Bu, kaç dosyanın yeniden denenebilir olduğunu gösterir. Öğrenci kimliği içermeyen sorgu kullanılır.
- Talep kapsamı kararı: **tek tek.** Personel her belge için ayrı talep açar (mevcut yol). Kod değişikliği gerekmez. Gönderilmiş başvuruda personel önce `under_review` geçişini yapar, sonra belge talebini açar.
- Ekrandaki 20 kayıtın hepsi `unsupported_content` görünüyor. Bu sonuç yeniden denenemez; bu kayıtlar talep yoluna gider.
- Hazırlanan toplu SELECT (kişisel veri içermez): `scratchpad/scan-failure-aggregate.sql`.

**Canlı toplu sayım sonucu (7 Kasım 2026, yalnızca SELECT, `rows_written: 0`):**
- Başarısız tarama işi: 66. Sonuç kodu: `unsupported_content` 64, `policy_blocked` 2.
- Güncel (is_current) ve taranamamış belge: 25. Başvuru durumuna göre:
  - Taslak: 4 (öğrenci kendisi değiştirebilir)
  - İnceleme: 9 `unsupported_content` + 1 `policy_blocked` (personel talebi)
  - Gönderilmiş: 10 (önce `under_review`, sonra talep)
  - Göç'e gönderilmiş: 1 (mevcut akışta talep yolu yok, ayrı karar gerekir). Belge türü sağlık sigortası, yaklaşık 832 KB, sonuç `unsupported_content`, 2 Kasım'da başarısız. Portal üzerinden tek belge önizleme/indirme ve arşiv ZIP'i yalnızca `scan_status='clean'` olan dosyalara izin veriyor (`staffDocumentAccessRoutes.js` satır 79, `documentRepository.js` satır 333). Yani bu dosya portaldan indirilemez. Cloudflare panelinden doğrudan R2 erişimi tarama kapısını atlar; bu yol kullanılmayacak.
- **Yeniden denenebilir (geçici hata) belge: 0.** Yani "Taramayı yeniden dene" ile kurtarılabilecek belge yok. Tüm 25 belge için yeniden yükleme gerekiyor.
- Göç'e gönderilmiş 1 başvurudaki belge: durum makinesi `sent_to_migration` durumundan `under_review`'a geri dönüşe izin vermiyor (`applicationStateMachine.js`), dolayısıyla talep yolu kapalı. Bu kayıt için ofis kararı gerekli.

## 2. Sıkıntılı belge listesi

- Yalnızca toplulaştırılmış özet: durum (taslak / inceleme / gönderilmiş / Göç), belge türü sayısı, sonuç kodu sayısı.
- Her başvuru için ofis personeli kendi ekranından talep açar. Liste bu dosyaya veya sohbete yazılmaz.
- Politika engeli (`policy_blocked`) olan 1 kayıt ve Göç'e gönderilmiş 1 başvuru ayrıca değerlendirilir.
- Bu adım kod değişikliği gerektirmez; 1. adımın yerel doğrulamasından sonra ofis uygular.

## 3. Mobil veride `goc` ve `/yazdir/` erişimi: kök neden

**Durum:** Genel web kontrolünde sayfalar açıldı, sorun yeniden üretilemedi.

**Hipotez listesi (doğrulanmadı):**
- Okul ağında `*.workers.dev` alan adının filtrelenmesi (DNS veya güvenlik duvarı).
- Mobil tarayıcıda önbellek, eski servis çalışanı (`public/sw.js`) veya HTTP/TLS sürümü farkı.
- `/yazdir/` sayfasının belirli bir cihaz veya tarayıcıda kaynak yüklemesi.

**Adımlar:**
1. Sorun tekrarlandığında kayıt formu: cihaz, tarayıcı, ağ (mobil veri / okul Wi-Fi), saat, ekran hatası, sayfa adresi.
2. Aynı adresi üç ağdan aç (mobil veri, okul Wi-Fi, ev) ve sonucu karşılaştır.
3. Hangi katmanda kesildiğini belirle. DNS ve güvenlik ayarlarına kök neden bulunana kadar dokunulmaz.

**Kod değişikliği:** Kök neden bulunmadan yapılmaz.

## 4. D1 yazma kotası, Cloudflare sınırları ve yoğunluk simülasyonu

**Cloudflare sınırları (resmi kaynak, 7 Kasım 2026 erişimi; [değişiklik kaydı](https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/), [fiyatlandırma](https://developers.cloudflare.com/d1/platform/pricing/), [limitler](https://developers.cloudflare.com/d1/platform/limits/)):**
- **1 Eylül 2026'dan beri zorunlu:** Ücretsiz planda günlük okuma (5 milyon satır) veya yazma (100.000 satır) sınırı aşılınca D1 sorguları gece yarısı UTC'ye kadar hata döner. Veri silinmez, ama portal veritabanına bağlı her işlem başarısız olur.
- Ücretsiz plan depolama: hesap başına 5 GB, veritabanı başına 500 MB. Depolama dolunca yeni yazma ve tablo/indeks oluşturma engellenir (fiyatlandırma SSS).
- Günlük limit sıfırlanması 00:00 UTC. Hesap sınır aşımında e-posta uyarısı alır.
- Workers ücretsiz plan günlük istek sınırı 100.000 (ikincil kaynak, resmi sayfa doğrulanmadı).
- **Hesap planı: Free** (sahip doğruladı, 7 Kasım 2026).
- **Yazma kaynakları (kod okuma, sayım değil):**
  - `public_rate_limits`: her genel istek bu tabloya yazıyor (`rateLimitRepository.js` satır 10–12, upsert). Bu, her sayfa yüklemesi ve sorgusunda yazma demek; en olası en büyük yazıcı.
  - `staff_sessions.last_seen_at`: aktif personel kullanımında en fazla 5 dakikada bir yazılır (`sessionRepository.js` satır 61).
  - Yazıcı ve tarayıcı heartbeat'leri (`printer_heartbeats`, `scanner_heartbeats`): sürekli polling ile tekrarlı yazma.
  - `audit_events`: 34 ayrı ekleme noktası; 4. işin ilk ölçümü günde yaklaşık 2.179 ek yazma (indeks kaynaklı).
  - Cloudflare D1 paneli ölçümü (7 Kasım 2026, 19:56 yerel saat, ekran görüntüsü):
    - Son 24 saat: 31.000 satır yazma (limitin yaklaşık %31'i), 56.000 sorgu, 2 milyon satır okuma, depolama 35,55 MB.
    - Son 7 gün: 421.000 satır yazma, yani günlük ortalama yaklaşık 60.000. Bu, zirve günlerin limite yakın olabileceğini gösteriyor.
    - Son 7 gün "Rows written" grafiği (7 Kasım 20:00 yerel): toplam 428.960 satır. Çubuklar 6 saatlik dilimler (ipuçlarında 03:00, 09:00, 15:00, 21:00). Tek dilim tepe değeri yaklaşık 40–44.000 satır.
    - Görsel okumaya göre dört dilimlik günlük toplamlar yaklaşık 70.000–95.000 satır arasında. Bu, okuma tahmini; kesin günlük toplam için Cloudflare'in günlük kırılımı ya da dilim değerleri gerekli. En yüksek tahmini gün limitin %90–95'i.
    - Haftalık değişim: yazma artışı ekranda %55,96 (önceki 7 güne göre). Bu eğilim sürerse bir sonraki haftada limit aşılabilir.
    - Depolama 35 MB, 5 GB sınırının çok altında. Depolama bu aşamada risk değil.
  - Yazma miktarı tablo bazında sayılamıyor: D1 bunu tablo bazında vermiyor, ve satır sayıları upsert yazmalarını göstermiyor. Gerçek ölçüm için Cloudflare panelinde D1 metriklerinde saatlik "rows written" grafiği gerekiyor.
- **Kod analizi sonucu (8 Kasım öncesi, kod değişikliği yapılmadı):**
  - Her genel istek (`consumePublicRateLimit`, `shared.js` `enforceRateLimit`) `public_rate_limits` tablosuna bir upsert yazıyor. Yazma miktarı istek sayısıyla doğru orantılı; güvenlik sınırının sayacı buna bağlı.
  - Öğrenci yazdırma izleme döngüsü (`src/public/print.js` `monitorJob`) her 8 saniyede bir durum sorgusu yapıyor, iş başına en fazla 90 kez. Her sorgu bir rate-limit yazımı üretiyor.
  - Yazıcı ajanı heartbeat'i 20 saniyede bir gönderiyor (`HEARTBEAT_SECONDS = 20`), yani gün başına yaklaşık 4.300 yazma. Bu, tahmini toplamın küçük bir kısmı; aralığı artırmak tazelik eşiğini (60 saniye) riske atar, o yüzden önerilmez.
  - Taslak otomatik kaydı debounce ile çalışıyor; yazma sıklığı öğrenci davranışına bağlı.
  - Hangi uç noktanın günlük yazmanın büyük kısmını oluşturduğu kod okumayla kesin belirlenemiyor. Yerel D1 üzerinde uç nokta bazlı `rows_written` ölçümü gerekli.
- **Yerel ölçüm (8 Kasım 2026, sentetik veri, yerel bellek içi D1 benzeşimi, her uç nokta 40 istek):**
  - Ölçüm betiği proje dışında duruyor (scratchpad), canlı D1'ye bağlanmaz. Yöntem: `sqlite total_changes()` farkı. Bu, D1 `rows_written` değerinin alt sınırı olabilir (indeks yazımları ve tetikleyiciler tam yansımayabilir).
  - `GET /api/public/print/status`: 1 yazma/istek (rate-limit).
  - `GET /api/public/print/jobs/status` (yazdırma izleme yoklaması): 1 yazma/istek (rate-limit).
  - `POST /api/printer/heartbeat`: 1 yazma/istek.
  - `POST /api/printer/claim` (boş kuyruk): 0 yazma/istek.
  - `GET /api/staff/print/status` (personel): 0 yazma/istek.
  - **Yorum:** Genel uç noktalar isteği başına 1 yazma üretiyor. Günlük toplamı belirleyen şey, bu uç noktalara gelen istek sayısı. Günlük 82.000 sorgu ve 61.000 yazma gözleminin, büyük ölçüde bu tür isteklerden geldiği düşünülüyor; ama uç nokta bazlı istek sayısı henüz ölçülmedi.
  - **goc Metrics (son 7 gün, 8 Kasım 2026 20:34 yerel):** Invocations 235,94 bin (+%20,1), asset requests 93,52 bin, subrequests 4,42 bin, errors 17 (iki spike). Çağrı başına ortalama yaklaşık 1,8 satır yazma (429 bin yazma / 236 bin çağrı). Yazma, statik dosyalardan değil Worker çağrılarından geliyor.
  - **Observability kapalı** (goc, 8 Kasım 20:30). Yol bazlı kırılım için açmak gerekir; bu, canlı Worker ayarını değiştirir ve Free planda günlük 200 bin olay sınırı var. Karar sahibinde; açılmadı.
  - **Tahmin tablosu (8 Kasım 2026, salt okunur tablo sayıları + Metrics; tahmindir):**
    - Denetim kaydı (`audit_events`): 6 Kasım'da 4.403 ekleme. En büyük kalem `application.draft_updated` (öğrenci taslak kaydı): 2.243 ekleme. 7 günde 12.415. Her ekleme birincil anahtar ve ikincil indekslere de yazıyor; yaklaşık 4 satır yazma. Tahmini 6 Kasım yazması: 15.000–18.000.
    - Taslak kaydı denetim kaydı, yazmanın en büyük tek kalemi olabilir. Bu bir kayıt tasarımı kararı; denetim gereksinimine göre değişir.
    - **Uygulandı (yerel, canlı değil):** `recordDraftUpdateAudit` (`src/server/routes/applicationRoutes.js`). Aynı başvuru için son 10 dakikada `application.draft_updated` kaydı varsa yeni kayıt yazılmıyor (`auditRepository.hasRecentEvent`, salt okunur kontrol). Pencere sabiti `DRAFT_AUDIT_WINDOW_SECONDS = 15` (9 Kasım 2026 güncellemesi; önceki değerler 600, sonra 60 idi). 15 sn için canlı sayım (6 Kasım): 674 kayıt, yaklaşık %70 azalma.
    - **Pencere seçeneklerinin canlı salt okunur sayımı (6 Kasım, ham 2.243 kayıt):** 30 sn → 454; 60 sn → 308; 120 sn → 211; 300 sn → 139; 600 sn → 113. 60 sn seçildi: yaklaşık %86 azalma, dakika bazında ayrıntı korunuyor.
    - **Etki (canlı salt okunur sayım, 6 Kasım):** 2.243 ham kayıt, 10 dakikalık pencereye göre yaklaşık 113 kayda iniyor (yaklaşık %95 azalma). Her kayıt birkaç indeks satırı da yazdığı için günlük tasarruf tahmini yaklaşık 8.000 satır (toplamın yaklaşık %14'ü, tahmin).
    - **Ödünleşim (sahip onayı gerekir):** Pencere içindeki sonraki kaydetmeler artık denetim satırı bırakmıyor. Bir pencerede ilk kaydın alanları (`changedFields`) kaydediliyor; sonraki değişen alanlar ayrı kaydedilmiyor. Denetim izi "hangi dakikada taslak değişti" bilgisini koruyor, ama "her kaydetmede hangi alan değişti" bilgisini kaybediyor.
    - **Test:** `test/draftUpdateAuditCoalescing.test.js` (yeni, önce başarısız, sonra geçti). `npm test`: 1435 test, 1434 başarılı, hata yok.
    - **Commitlenmedi.** Canlı yayın için ayrı onay ve tam SHA gerekir.
    - Tarama işleri (`document_scan_jobs`): ekleme 612, güncelleme 468–1.106 (gün başına). Durum sayacı tetikleyicileri de yazıyor. Tahmini: 2.000–3.000.
    - Yazıcı heartbeat'i: 4.320/gün (20 sn). Tahmini: 4.300.
    - Genel istek rate-limit'i: Worker çağrısı 34.000/gün; herkese açık uç noktalarda istek başına 1 yazma ölçüldü. Tahmini: 20.000–34.000. En büyük belirsizlik kalemi.
    - Toplam tahmin: 45.000–60.000/gün, 7 günlük ortalama (61.000) ile uyumlu.
    - **Yorum:** En büyük iki kalem: genel istek rate-limit'i ve taslak kaydı denetim satırları. Bunlardan biri ölçülmeden kesin değil. Bu bulgu, "kod: yazıyı azalt" kararında önceliği belirliyor.
    - Denetim kaydı yazımı (`staff.application_archive_document_stream_authorized`) 1.000/gün. Personelin belge indirmesi; küçük bir kalem.
  - **Sonraki adım:** Yol bazlı kırılım olmadan hangi uç noktanın azaltılacağı kesinleşmez. Seçenekler: Observability'yi kısa süre açmak (karar sahibinde), ya da uç noktaların bilinen poll sıklıklarından (yazdırma izleme 8 sn, yazıcı heartbeat 20 sn) tahmin yapmak.
- **Önerilen önlemler (henüz uygulanmadı, onay gerekir):**
  1. Saatlik yazma grafiğini al; en yoğun saatlerde hangi işlem tetikleniyor, onu gör.
  2. `public_rate_limits` yazmalarını azalt (ör. pencere başına bir kez yaz, ya da sayacı bellekte tut).
  3. Heartbeat'leri D1 yerine başka bir depoya taşı ya da polling aralığını uzat.
  4. Ücretli plana geçiş: en hızlı güvence, ama maliyet ve kararı sahibinde.
- **Risk:** Zirve gün 93.966 yazma, yani limitin %94'ü. Bu günden daha yoğun bir gün, o gün portalın veritabanına bağlı işlemlerinin tamamını durdurabilir. Bu yüzden 4. işin ilk adımı yazma miktarını işlem bazında çıkarmak.

**Mevcut veri:** Günlük ücretsiz yazma sınırı 100.000 satır. En yüksek gün 93.966, 6 Kasım 80.649. Audit tablosundaki `idx_audit_events_actor_created` (`migrations/0001_backend_foundation.sql:222`) günde yaklaşık 2.179 ek yazma üretiyor (yerel sentetik ölçüm).

**Adımlar:**
1. **Hangi işlem ne kadar yazıyor:** Kod okuma ile her API işleminin yazdığı satır sayısını çıkar (başvuru oluşturma, otomatik kayıt, belge, bildirim, tarama, yazdırma, cron). Tahmin değil, yerel D1'de sayarak doğrula.
2. **Cloudflare sınırlarını kontrol et:** Hesabın planı (ücretsiz mi, ücretli mi) ve güncel sınırlar (D1 yazma/okuma, Worker istek sayısı, CPU, R2 depolama ve işlem sayıları). Bu kontrol Cloudflare panelinden salt okunur yapılır; değerler doğrulanmadan kullanılmaz.
3. **Ayrıca:** Cron tetiklemelerinin (`*/5 * * * *`) istek ve yazma tüketimini hesapla.
4. **Yoğunluk simülasyonu:** Yerel workerd/D1 üzerinde artan kullanıcı sayısıyla kademeli senaryolar (ör. 1x, 2x, 5x, 10x mevcut yük). Çıktı: işlem başına yazma, günlük tahmini toplam, hangi sınırın ilk aşılacağı.
5. Sonuç bir tahmin olarak raporlanır; yerel simülasyon canlı yükü birebir yansıtmaz. Canlı saatlik D1 verisi ile karşılaştırılır.

**Karar:** İndeks kaldırma yalnızca (a) aktör bazlı audit raporu kullanılmadığı ve (b) saatlik verinin doğrulanmasından sonra düşünülür.

## 5. Göç'e gönderilen dosyaların okul PC'sine taşınması ve Cloudflare'den silinmesi

**Hedef:** Göç'e gönderilmiş başvuruların belgeleri okulun onaylı, şifreli PC/USB ortamına alınsın, doğrulansın, sonra Cloudflare R2 ve D1 kaydından silinsin.

**Ofis kararları:**
- Hangi durumdaki başvurular: `sent_to_migration` / `migration_approved` / `completed`.
- Saklama süresi ve okul PC'sinin KVKK ve kurum politikasına uygunluğu.
- Silme sonrası geri alınamazlık: yedek tutulacak mı.

**Adımlar:**
1. **Yerel tatbikat:** Sentetik veriyle dışa aktarma aracı: listele → kopyala → SHA-256 manifest → geri aç ve doğrula → yalnızca doğrulanmış dosyaların silinmesi (yerelde). Mevcut R2 temizlik akışı (`cleanup_status`) kullanılabilir mi, incelenir.
2. Küçük bir sentetik parti ile uçtan uca tatbikat.
3. Ofisin kararlarıyla parti planı. Her parti için canlı silme öncesi ayrı açık onay, parti listesi toplulaştırılmış tutulur.
4. Canlı işlem sonrası: silinen dosya sayısı ve doğrulama özeti raporlanır.

**Kapsam dışı:** Eski yazdırma bucket'ındaki 878 nesne (kaynağı kanıtlanmadı) bu adımda silinmez. Ayrı karar gerekir.

## 6. Telefon ve bilgisayar başvuru tasarımları (en son)

- Yukarıdaki işler bittikten sonra başlanır. Yerelde iki tasarım, sentetik veriyle.
- Karşılaştırma: başvuru başlatma, belge yükleme hatasından dönüş, taslağa devam.

## Önceki sürümdeki düzeltmeler

- Önceki sürümde "20" yalnızca liste sınırı olarak tanımlanmıştı. Kod doğruladı: `LIMIT 20` nedeniyle üst sınır. Metin arama sırasında bulunamamıştı; sebebi büyük/küçük harf aramasıydı, metin `scanner-manager.js` içinde.

## Gizlilik notu

Bu dosyaya öğrenci adı, numarası, pasaport/YKN, belge adı veya içeriği, erişim kodu, token veya doğrudan dosya bağlantısı eklenmez. Tarama ve depolama raporları toplulaştırılmış olmalıdır.

## Ek iş: "Nasıl Kullanılır?" ekran görüntüsü rehberi (ertelendi, 8 Kasım 2026)

**Durum:** Ertelendi. Öğrenci tarafındaki tasarım tamamlanmadan önce yapılmayacak.

**Kapsam:**
1. Yerel Worker ve yerel D1 kurulumu (`npm run dev:worker` ve migrasyonlar). Yalnızca sentetik veri.
2. Akışın ekran görüntüleri: başvuru başlatma, iletişim, kişisel bilgiler (öğrenci numarası ve pasaport için örnek değerler), belgeler, gönderim, sorgulama, yeniden yükleme isteği.
3. Her görüntünün üstüne kısa açıklama notları. Bu notlar öğrenciye hangi alana ne yazacağını söyler.
4. Notların "Nasıl Kullanılır?" sayfasında kullanılacak şekilde toplanması.

**Kısıtlar:** Gerçek öğrenci verisi kullanılmaz. Ekran görüntüleri kişisel bilgi içermez. Depoya eklenmeden önce kapsamı ve yayın yerini sahip onaylar.

## Durum özeti (8 Kasım 2026)

| Alan | Tamamlanan | Kalan |
|---|---|---|
| 1. Taramada başarısız belgeler | Panelde gerçek toplam (68) ve "ilk N kayıt" notu. Öğrenci tarafında belge yeniden yükleme, önizleme, giriş ve ana sayfada "Başvuruma Devam Et". | Ofis tek tek belge talebi açacak (25 belge). Göç'teki 1 belge için ofis kararı. Bildirim kanalı yok, karar: portal + ofis. Personel panelindeki 5 kayıt sınırı commit edilmedi. |
| 2. Sıkıntılı belge listesi | Canlı salt okunur sayım: 66 başarısız iş, 25 güncel belge (4 taslak, 10 inceleme + 1 politika, 10 gönderilmiş, 1 Göç). | Ofis talepleri. |
| 3. Mobil erişim | Yerel LAN denemesi için çerez istisnası (yalnızca APP_ENV=local, düz HTTP). Gerçek sorun tekrarlanmadı. | Tekrarlanırsa kayıt alınacak. |
| 4. D1 yazma kotası | Hesap Free, sınırlar doğrulandı. Taslak denetim kaydı 15 sn gruplama (canlıda, 38ff02d). Yazdırma durumu yoklaması 15 sn (0df11cc, henüz canlıda değil). | Genel istek sayacı (güvenlik kararı). Yazıcı heartbeat'i. Observability açma kararı. Ücretli plan kararı. |
| 5. Göç dosyaları | Kapsam ve tatbikat planlandı. | Ofis kararı (saklama, KVKK, USB). Canlı silme her parti için ayrı onay. |
| 6. Tasarımlar | Öğrenci tarafı PC ve telefonda denendi, push edildi (0df11cc). Başvuruma devam, sorgulama (zorunlu öğrenci numarası) ve belge yükleme tamam. | Personel (yetkili) tarafı tasarımı sıradaki. Ekran görüntüsü rehberi ertelendi. |

**Yayın durumu:** 0df11cc commit'i GitHub'da ve ön kontrolü geçti. Yayın #97 iki kez, GitHub'ın actionlint indirme adresindeki 504 hatası yüzünden durdu. Canlı hâlâ 42fe7751 sürümünde. Adres düzelince aynı SHA ile yeniden denenecek.

