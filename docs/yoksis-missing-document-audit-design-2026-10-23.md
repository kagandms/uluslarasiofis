# YÖKSİS Eksik Evrak Kontrolü Tasarım Planı

Tarih: 23 Ekim 2026
Durum: Plan olarak kaydedildi; mevcut optimizasyon çalışması sürerken uygulama ertelendi.

## Anlaşılan istek

- `/yetkili` personel ana sayfasından başlatılan, mevcut YKN aktarımından ayrı bir YÖKSİS evrak kontrol aracı.
- YÖKSİS'te açık olan kayıt listesinin iç kaydırma alanındaki bütün kayıtları yukarıdan aşağı tarar. “Seç & Yükle” yeni sayfa açmıyor; sonraki sayfa adımı yok.
- Her kayıt seçildikten sonra başvuru kimliği doğrulanır; YÖKSİS başvuru durumu ve talep edilen eksik evrak satırları okunur.
- Site içindeki sonuç listesi başvuru numarası, ad soyad, öğrenci numarası, telefon, başvuru durumu ve eksik evrak bilgilerini gösterir.
- Kayıt okunamazsa “Kontrol edilemedi” olarak işaretlenir ve güvenli biçimde devam edilebiliyorsa tarama sürer.

## Mevcut proje bağlamı

- `yetkili/index.html` personel ana sayfası ve YKN çalışma alanını içeriyor.
- `ykn_eklenti-main/bridge.js`, yetkili oturumu doğrulandıktan sonra `/yetkili` ile eklenti arka planı arasında aynı-origin mesaj köprüsü kuruyor.
- `ykn_eklenti-main/manifest.json`, YÖKSİS ve portal kökenlerine içerik betikleri bağlıyor.
- Bu tasarım, mevcut uzantıyı kullanır; YKN aktarım akışına yeni eylem eklemez. YÖKSİS kontrol komutları ve portal sonuç arayüzü ayrı modüller olur.
- Depo `production` dalında çok sayıda mevcut düzenleme içeriyor. Bu belge dışında bu çalışma sırasında dosya değiştirilmedi.

## Son kullanıcı akışı

1. Personel `/yetkili` ana sayfasındaki **YÖKSİS Eksik Evrak Kontrolü** düğmesine basar.
2. Panel eklenti bağlantısını, personel oturumunu ve açık YÖKSİS sekmesinde uygun kayıt listesini doğrular. Hazır olmayan koşulları açıkça gösterir.
3. Panel, kayıt seçiminin YÖKSİS formunu değiştireceğini ve kaydedilmemiş bir işlem olmaması gerektiğini bildirir. Kullanıcı başlatır veya vazgeçer.
4. Eklenti listeyi iç kaydırma alanında tarar ve E-İkamet başvuru numarasına göre tekrarsız bir kuyruk oluşturur.
5. Eklenti kayıtları sırayla seçer. Sayfanın değişmesini bekler ve başvuru numarası/öğrenci numarası eşleşmesini doğrular.
6. Eşleşme doğrulanınca YÖKSİS durumunu, öğrenci kimlik alanlarını ve 4. bölümde gösterilen belge satırlarını okur.
7. İlerleme ve kayıt sonuçları `/yetkili` içindeki listede görünür. Kullanıcı taramayı durdurabilir; durdurma geçerli kayıt okuması tamamlandıktan sonra uygulanır.
8. Tarama bitince, mümkünse başlangıçta seçili kayıt yeniden seçilir. YÖKSİS'te herhangi bir kayıt veya evrak gönderilmez.

## Okuma ve sınıflandırma

- Kayıt kuyruğu, listede görünen E-İkamet başvuru numarasıyla tekilleştirilir. Öğrenci numarası ikinci eşleşme değeri olarak kullanılır.
- YÖKSİS formundaki başvuru kimliği ve öğrenci numarası kuyruk öğesiyle eşleşmeden öğrenci veya belge bilgisi rapora bağlanmaz.
- Belge satırlarından kod, ad, zorunluluk, not/açıklama ve yükleme durumu alınır.
- Başvuru durumu **Eksik Belge Bekliyor** ise 4. bölümdeki “talep edilen eksik belgeler” listesi eksik evrak kaynağıdır. Örnekte zorunlu **Diğer Belge** satırı **Yüklenmedi**, açıklama **AKTİF ÖĞRENCİ BELGESİ** olarak görünür.
- Açıkça `Yüklenmedi` yazan zorunlu evrak eksik olarak gösterilir. Yalnızca boş tabloya bakarak “eksik yok” sonucu çıkarılmaz.
- Başvuru eksik evrak bekliyor görünüyor ancak belge tablosu boşsa veya bölüm/kimlik doğrulanamıyorsa sonuç `Kontrol edilemedi` olur.
- Telefon alanı eklentinin sayfada okuyabildiği gerçek değerle raporlanır; ekran görüntüsünde maskeli görünse de kullanıcı gerçek değerin YÖKSİS sayfasında okunabildiğini doğrulamıştır.

## Site ve eklenti iletişimi

- Personel ana sayfasındaki düğme, mevcut portal–eklenti köprüsünden yeni ve dar kapsamlı bir tarama komutu gönderir.
- Eklenti arka planı komutu doğrulanmış YÖKSİS sekmesindeki içerik betiğine iletir.
- Uzun tarama tek bir yanıt bekleyen çağrı olarak değil, iş kimliği olan başlangıç/ilerleme/sonuç/durdurma olaylarıyla yürütülür; böylece site paneli ilerlemeyi gösterebilir ve kullanıcı durdurabilir.
- Köprü yalnızca mevcut `/yetkili` yetkili oturumu ve tanınan YÖKSİS/portal sekmeleri için çalışır. Yeni mesaj türleri eylem allowlist'i ve istek kimliğiyle sınırlandırılır.
- İçerik betiği yalnızca YÖKSİS DOM'undan okur ve tanımlı `Seç & Yükle` düğmelerine tıklar. Belge yükle/sil, işlem başlat/kaydet ve işlemi kapat kontrollerini çağırmaz.

## Gizlilik, hata ve güvenilirlik

- Başvuru bilgileri ve sonuçlar açık portal sekmesinin belleğinde geçici tutulur. Sunucu API'sine, D1/R2'ye, eklenti kalıcı depolamasına veya harici servise gönderilmez.
- Öğrenci bilgileri console/log tanılamalarına yazılmaz; belge dosyaları açılmaz veya içeriği işlenmez.
- Sayfa değişimi sabit `setTimeout` gecikmeleriyle değil, beklenen DOM durumunun gözlemlenmesi ve sınırlı zaman aşımıyla doğrulanır.
- Kayıt kimliği uyuşmazsa o kaydın verileri raporlanmaz. Tarayıcı listesi hâlâ doğrulanabiliyorsa kayıt başarısız olarak işaretlenip devam edilir; liste/oturum durumu güvenilir değilse tarama durur.
- Extension bağlantısının veya YÖKSİS sekmesinin kaybolması taramayı durdurur; tamamlanmış, kontrol edilememiş ve sırada kalan kayıt sayıları panelde gösterilir.

## Uygulama aşamaları

1. **DOM keşfi:** YÖKSİS liste satırları, iç kaydırma alanı, “Seç & Yükle” düğmesi, seçili kayıt kimliği, durum alanları ve eksik evrak tablosu için gerçek DOM işaretlerini yetkili test oturumunda doğrula. Tahmin edilen metin/selector ile uygulamaya geçme.
2. **YÖKSİS okuyucu:** Eklenti içinde ayrı modül olarak listeyi tekilleştir, kaydı seç, kimliği doğrula, yalnızca alanları oku ve durdur/devam durumunu yönet.
3. **Portal arayüzü:** `/yetkili` ana sayfasına düğme, ön koşul/uyarı alanı, ilerleme göstergesi, durdurma ve sonuç listesi ekle. Sonuçları backend'e kaydetme.
4. **Kontrollü kabul:** Mock DOM/fixture'larda kaydırma, tekilleştirme, eksik evrak, kimlik uyuşmazlığı, boş/belirsiz tablo, zaman aşımı ve durdurmayı doğrula. Sonrasında personel gözetiminde az sayıda gerçek kayıtta yalnızca okuma UAT'ı yap; hiçbir belge yükleme/kaydetme eylemi çalıştırma.
5. **Üretim hazırlığı:** Proje yönergelerindeki test, production build ve production dry-run kontrollerini çalıştır; exact diff ve paket içeriğini gözden geçir. Canlı deploy yalnızca ayrıca istenirse yapılır.

## Kabul ölçütleri

- Kullanıcı `/yetkili` ana sayfasından taramayı başlatır, ilerlemeyi görür ve durdurabilir.
- İç kaydırmadaki her kayıt en fazla bir kez işlenir; sıra/kimlik eşleşmesi doğrulanır.
- Eksik evrak kayıtları belge adı ve YÖKSİS açıklamasıyla raporlanır; sonuç öğrenci kimliğiyle doğru eşleşir.
- Okunamayan kayıt, yanlış eşleştirme yapmadan görünür hata durumuna alınır.
- Tarama hiçbir evrak yükleme/silme veya işlem kaydetme/kapama yapmaz.
- Öğrenci bilgileri backend'e veya loglara çıkmaz.

## Varsayımlar ve açık uygulama öncesi doğrulamalar

- Hedef ana sayfa `/yetkili` personel ekranıdır.
- Personel YÖKSİS'te oturum açmış ve uygun kayıt listesini hazırlamış olacaktır.
- E-İkamet başvuru numarası, liste ve seçilmiş form arasında kararlı eşleşme anahtarıdır; gerçek DOM incelemesinde doğrulanmalıdır.
- YÖKSİS DOM değişiklikleri, tasarımda birincil bakım riskidir. Selector'lar yapısal bağlamla ve okunur etiketlerle doğrulanır; belirsiz eşleşmede işlem durur.
- Kullanıcı tarama sonunda sonuçların yalnızca ekranda kalmasını kabul etti; CSV/Excel dışa aktarımı bu tasarım kapsamında değildir.

## Karar günlüğü

| Karar | Seçim | Gerekçe |
|---|---|---|
| Başlatma yeri | `/yetkili` personel ana sayfası | Kullanıcı işlemi kendi sitesinden başlatmak ve siteye bağlı çalıştırmak istedi. |
| Eklenti dağıtımı | Mevcut eklentide ayrı YÖKSİS aracı | Kullanıcı ayrı eklentiyi değil, YKN'den bağımsız ayrı aracı seçti. |
| Tarama yöntemi | Önce kuyruk oluştur, sonra kayıtları sırayla doğrulayarak tara | İç kaydırma/yenilenen liste yüzünden kayıt atlama ve tekrar riskini azaltır. |
| Evrak kapsamı | YÖKSİS'in 4. bölümde gösterdiği talep edilen eksik evraklar | Eksik evrak bekleyen başvuruda yalnızca listelenen eksiklerin yüklenmesi gerekiyor. |
| Sonuç sunumu | Site içindeki geçici sonuç listesi | İstenen bilgiler personelin başlattığı işlemde görüntülenir; kalıcı veri kopyası oluşmaz. |
| Hata davranışı | Okunamayan kaydı işaretle; sayfa güvenilir kaldıkça devam et | Tarama tamamlanma oranını korurken belirsiz veriyi başka kayıtla eşleştirmez. |
| Yan etkiler | Evrak yükleme/silme ve işlem kaydetme yok | İstenen iş kontrol ve raporlamadır; YÖKSİS işlem kararı personelde kalır. |
