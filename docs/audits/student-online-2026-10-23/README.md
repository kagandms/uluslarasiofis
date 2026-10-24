# Online öğrenci başvurusu — açılış öncesi denetim

İnceleme: 23 Ekim 2026, Europe/Istanbul. Hedef açılış: 26 Ekim 2026 Pazartesi.

**Karar: Aşağıdaki P1 sorunları kapatılmadan genel öğrenci kullanımına hazır kabul edilmemeli.** Başarılı derleme ve testler, resmî süreç uyumunu ve canlı ofis kabulünü tek başına kanıtlamıyor.

## 23 Ekim uygulama güncellemesi

Kullanıcının son yönlendirmesiyle fiziksel ve online başvurular için tek ITU kodu sorgusu uygulandı. Online genel sorgu artık öğrenci numarası yerine tahmin edilmesi zor başvuru referansını kullanıyor; kamuya açık yanıtta öğrenci numarası, referans kodu, dosya adı veya oturum bilgisi dönmüyor. Kodla sorgu yalnızca durum/belge durumlarını gösterir; dosya erişimi sahip oturumunda kalır. Öğrenci başvuru iptali desteklenmiyor; Göç İdaresi ret gerekçesinin online başvuruda güvenli şekilde kaydedilip gösterilmesi ise hâlâ açık ürün işidir. Diğer doğrudan yazılım düzeltmeleri bu çalışma klasöründe uygulandı:

- **F02:** Gönderim yazımı artık okunan başvuru kilit sürümünü ve sahip oturumunun hâlâ geçerli olduğunu kontrol ediyor; aynı atomik yazımda her zorunlu belgenin güncel, tamamlanmış yüklemesini ve uygun tarama durumunu da yeniden şart koşuyor. Yarışta gönderim 409/uygun değil sonucu verir.
- **F05:** Başvuru tamamlanınca mevcut sahip oturumları iptal edilmiyor. Süresi dolan öğrenci, referans numarası + öğrenci numarasıyla yeniden giriş yapıp sonucunu okuyabilir; bu kimlik bilgileri yazma veya dosya değiştirme yetkisi vermez.
- **F06–F07:** Beş dildeki rehber, gerçek giriş yöntemini ve koşullu belge listesini anlatıyor; portalda desteklenmeyen geçiş başvurusunu açıkça ofise yönlendiriyor.
- **F08:** Tarama sonucu `unsafe`/`failed` olan dosya “yüklenmedi” görünmüyor; öğrenciye güvenlik kontrolünün tamamlanamadığı ve ofise başvurması gerektiği gösteriliyor. Dosya içeriği açılmıyor.
- **Ortak sorgu:** Fiziksel `ITU-YY-XXXXXXX` ve online `ITU-XXXX-XXXX` kodları tek alanda kabul ediliyor; formatına göre doğru başvuru türü sorgulanıyor.
- **Gönderim sonucu:** Beş dilde, portal tesliminin resmî Göç İdaresi kararı olmadığı ve öğrenciye resmî e-İkamet formundaki süreleri/ofis yönlendirmesini takip etmesi gerektiği bildiriliyor.

**Kapanış durumu:** K01–K03 ile K05 kullanıcı kararı ve resmî öğrenci formuna göre uygulandı. Üniversitenin fiziksel başvuruda özel sağlık sigortası poliçesinin ilk beş sayfasını istediği kullanıcı tarafından teyit edildi; online portalda yükleme istenmesi ayrı bir ürün kararıdır ve bu teyit onu gerektirmez. F03'te öğrenci iptali kapsam dışıdır; Göç İdaresi reddi ve gerekçesinin portala kaydı/gösterimi mevcut online akışta desteklenmiyor. F04 için kısa aydınlatma taslağı hazırlandı; hukuki sebep, saklama süresi, sağlayıcı/aktarımı ve KVKK başvuru kanalı kurumca onaylanmalı. İlk açılış kararı bu teyitler ve canlı ofis kabulüne bağlıdır.

### Sonraki yerel uygulama notu — 23 Ekim 2026

Bu incelemeden sonra F03 için yerel çalışma ağacına, yalnız `sent_to_migration` durumunda yetkili personelin gerekçeli ret verebildiği akış eklendi. Ret gerekçesi öğrenciye başvuru notu olarak gösteriliyor; audit kaydı gerekçe metnini taşımıyor. Sentetik route/repository/UI testleri geçti. Bu, ilk denetim metnindeki “desteklenmiyor” bulgusunu yerel kod açısından kapatır; gerçek ret kaydı, kurum metin onayı ve ofis UAT'si değildir. Güncel release kapıları [26 Ekim hazırlık takibinde](../../release-readiness-2026-10-26.md) tutulur.

### 23 Ekim kullanıcı kararları ve son uygulama durumu

Kullanıcı, parmak izi kodunun zorunlu olmasını; küçüklerde Göç İdaresinin resmî öğrenci formunun esas alınmasını; yaşın doğum tarihi ile e-İkamet başvuru tarihine göre hesaplanmasını; üniversite kayıt tarihinin alınıp GSS için üç aylık sürenin izlenmesini onayladı. Bu kararlar yerel çalışma ağacına uygulandı:

- Küçüklerde öğrenim vizesi istisnası kaldırıldı. 18 yaş altı herkes muvafakat ve Türkiye'deki sorumlu kişinin noter taahhüdü adımını görür; doğum belgesi ve aile durumu belgeleri yalnız resmî koşulları oluştuğunda istenir. UETS küçüklerden istenmez.
- İkamet başvuru tarihi ve üniversite kayıt tarihi zorunlu alanlar oldu. Yaş başvuru tarihinden türetiliyor; GSS bekliyor seçeneği üniversite kayıt tarihinden üç ay sonra gönderimi engelliyor.
- Portal ve ofis tebliğ PDF'si fotoğraf sayısını dört yerine iki gösteriyor. Öğrenci belgesi zorunluluğu, yetişkin uzatmalarda UETS ve konaklama/uzatma adres ekleri resmî forma göre koşullu kalıyor.
- Online sigorta adımı: özel sigorta ve aktif SGK/GSS için portal dosya yüklemesi istemiyor; yalnız ikili anlaşma belgesi isteniyor. Kullanıcı, fiziksel dosyada poliçenin ilk beş sayfasının istendiğini teyit etti. Bu fiziksel evrak uygulaması online portala otomatik dosya gereksinimi eklemez. Üç aylık kayıt penceresindeki GSS beyanı da dosya istemiyor.
- Göç İdaresinin iki resmî sayfası sigorta dosyası için farklı yönlendiriyor: [7 Mayıs 2026 tarihli 2026/02 öğrenci kayıt formu](https://e-ikamet.goc.gov.tr/Ikamet/BasvuruFormuOrnegi/BasvuruFormuBos?tur=5) özel poliçenin ilk sayfasını fiziksel teslim listesine koyuyor; [öğrenci için istenen belgeler sayfası](https://e-ikamet.goc.gov.tr/Ikamet/BasvuruIstenenBelgeler/BasvuruFormuIstenenBelgeler?tur=5) özel sigorta ve SGK/GSS'nin sistemden doğrulandığını, ek dosya verilmediğini söylüyor. Portal, özel sigorta/GSS yüklemesi istemiyor; Topkapı ofisinin fiziksel teslim farkını teyit etmesi gerekir.

Parmak izi kodu e-İkamet formundan alınan zorunlu alan olarak korunuyor; kod doğrulama/uyuşmazlık için personel kabulü gerekir. Üretime deploy yapılmadı.

## Kapsam ve kanıt sınırı

- Git kökü: `uluslarasiofis-main`; dal: `production`; başlangıç HEAD: `2f018395ebb7d58770d202a6fa32c73b2fa9b81e`.
- Mevcut değiştirilmiş çalışma dosyaları incelendi; başka işlere ait değişiklikler korunmuştur. İnceleme sürerken doğum tarihi alanı ve ilgili testlerde de değişiklik görüldü; bu nedenle teslim kontrolleri yeniden çalıştırıldı. Bu rapor saf HEAD değil, çalışma klasörü incelemesidir.
- Canlı portalın ana sayfası, kullanım rehberi ve başvuru başlangıcı tarayıcıda okundu. Mevcut tarayıcı dili Arapçaydı. Gerçek öğrenci aranmadı; üretimde başvuru oluşturulmadı, belge yüklenmedi veya durum değiştirilmedi.
- Sunucu, istemci, SQL korumaları, belge politikaları ve testler incelendi. `replay.mjs` yalnız bellekte çalışan SQLite/D1 bağdaştırıcısında sentetik kayıtlarla çalışır. R2, gerçek scanner, GöçNet ve yazıcı bu betikte çalışmaz.
- `evidence.json` doğrulanmış yeniden üretim sonuçlarını içerir. 2.400 birleşim, yaş/başvuru/konaklama/sigorta/veli/evlilik yanıtlarının politika kontrolüdür; gerçek dünyadaki tüm durumların veya 2.400 tarayıcı akışının testi değildir.

## 1. Doğrulanmış yazılım ve süreç sorunları

### F01 — P1: Genel başvuru sorgusu güçlü başvuru koduna taşındı

**Önceki bulgu:** Oturumu olmayan biri, başka öğrencinin numarasıyla durum sorgulayabiliyordu; yanıt belge türleri ve `student_message` döndürüyordu.

**Güncel uygulama:** Ortak sorgu ITU başvuru kodunu kullanıyor. Online başvuruda kod `ITU-XXXX-XXXX`, fiziksel başvuruda `ITU-YY-XXXXXXX` biçimindedir. Online genel sorgu DTO'su öğrenci numarasını ve referans kodunu döndürmez; dosya adı, sahip oturumu veya belge içeriği de açılmaz. Sorgu halen durum ve belge durumlarını gösterir; kodun başkasıyla paylaşılması erişim verir.

**Kontrol:** Online kod formatı 31 karakterlik karışmayan alfabeden 8 karakter içerir; sorgu IP bazlı rate limit altında çalışır. Online sahip erişimi ayrıca kod + öğrenci numarası ve oturum doğrulamasına bağlıdır.

**Kalan ürün tercihi:** Kullanıcının ortak kod sorgusu tercihi doğrultusunda belge durumları ve ofis mesajları kodu bilen kişiye gösterilebilir; bu sorgu hiçbir dosya veya düzenleme yetkisi vermez.

### F02 — P1: Son kontrol ile gönderim arasında eksik belgeli kayıt gönderilebiliyor

**Senaryo:** Bir sekme başvuruyu gönderirken ikinci cihaz konaklama seçimini kiradan otele değiştirir.

**Sonuç:** Son kontrolün ardından, gönderim SQL'i çalışmadan önce değişiklik enjekte edildi. HTTP 200 ve `submitted` döndü; otel belgesi ile konaklama makbuzu eksikti.

**Kök neden:** `applicationRoutes.js:483` hazırlık durumunu ayrı okuyor. `applicationRepository.js:278` gönderim SQL'i yalnız `status='draft'` kontrol ediyor; okunan `lock_version`, belge revizyonları ve sahip oturumu gönderim yazımında yeniden korunmuyor.

**Düzeltme:** Kontrol edilen başvuru sürümü, oturum geçerliliği ve belge yeterliliğini atomik gönderim koşullarına bağla. Sadece uygulama sürümünü karşılaştırmak, belge değiştirme/silme işlemleri bu sürümü artırmıyorsa tek başına yeterli olmaz.

**Kabul:** Adres/yaş/başvuru türü değişimi, belge silme/değiştirme ve oturum iptaliyle yarışan gönderim yeniden kontrol edilmeli veya 409 vermeli; eksik dosya gönderilmiş kalmamalı.

### F03 — P1: Göç İdaresi ret gerekçesinin online başvuruda kaydı/gösterimi yok

**Senaryo:** Göç İdaresi başvuruyu reddeder; ofis resmî ret gerekçesini öğrenciye portal üzerinden bildirir. Kullanıcının teyidine göre öğrenci iptali mevcut süreçte desteklenmiyor.

**Sonuç:** Veritabanı `rejected`/`cancelled` durumlarını tanıyor; online durum makinesinde ret geçişi yok. Beş farklı kaynak durumdan ret geçişi reddedildi. Fiziksel başvuru takibinde ret nedeni alanı bulunuyor, ancak online başvuru için aynı kayıt ve öğrenciye özel gösterim doğrulanmadı. Göç ret kararı, uygulamadaki dosya onayı ile aynı işlem değildir.

**Kök neden:** `src/server/domain/applicationStateMachine.js:1`. Online geçiş ve ret gerekçesi DTO/kaydı yok. Ret terminal durumu etkin başvuru benzersizlik kuralını da sonlandırır.

**Düzeltme:** Yetkili ofis personeli, yalnız `sent_to_migration` aşamasında, resmî ret gerekçesini zorunlu girerek başvuruyu `rejected` durumuna alabilmeli; gerekçe öğrenciye yalnız kendi güvenli başvuru ekranında gösterilmeli ve işlem audit kaydına yazılmalı. İtiraz hakkı veya süre hakkında sistem metni uydurulmamalı. Öğrenci iptal akışı eklenmemeli.

### F04 — P1: Başvuruya özgü nihai aydınlatma metni öğrenci akışında yok

**Kanıt:** Gösterilen beyan, kendisinin nihai hukuki/KVKK metni olmadığını açıkça söylüyor: `src/public/i18n/messages.js`, `studentInformationAcknowledgement`. İncelenen ana sayfa/başvuru/takip akışlarında bu işlem için erişilebilir nihai metin veya bağlantı bulunamadı.

**Etkisi:** Pasaport, iletişim ve koşula göre aile/sağlık belgeleri toplanıyor. Doğruluk beyanı ve isteğe bağlı WhatsApp izni, aydınlatmanın yerine geçmez. Kurumun başka kanalda usulüne uygun aydınlatma yapıp yapmadığı bu incelemede doğrulanmadı.

**Düzeltme:** Kurumun onayladığı, bu işlemle sınırlı aydınlatmayı veri toplanmadan önce erişilebilir kıl. Veri sorumlusu, amaç, aktarım, yöntem/hukuki sebep ve haklar kurum tarafından kesinleştirilmeli. Aydınlatmayı genel bir zorunlu açık rıza kutusuna dönüştürme. [KVKK açıklaması](https://www.kvkk.gov.tr/Icerik/2033/Aydinlatma-Yukumlulugu-), [Kurum duyurusu](https://www.kvkk.gov.tr/Icerik/6765/AYDINLATMA-YUKUMLULUGUNUN-YERINE-GETIRILMESI-HAKKINDA-KAMUOYU-DUYURUSU).

İnceleme için kurumun mevcut genel metnine ve bu portaldaki gerçek veri akışına dayanarak bir [iç taslak](./aydınlatma-metni-taslak.md) hazırlandı. Taslakta sağlayıcılar, yurt dışı aktarım, saklama süreleri ve işleme şartları özellikle onaya bırakıldı; yayımlanabilir nihai metin değildir.

### F05 — P2: Tamamlanan başvuruda sahip erişimi tamamen kesiliyor

**Senaryo:** Öğrenci işleminin tamamlandığı sonucunu veya ofis notunu güvenli girişle görmek ister.

**Sonuç:** Tamamlama mevcut oturumları iptal ediyor; doğru referans ve öğrenci numarasıyla tekrar giriş de 401. Kamuya açık durum sorgusu çalışabilir; dolayısıyla genel sonucun tümüyle kaybolduğu iddia edilmiyor.

**Kök neden:** `applicationReviewRepository.js:28`, `applicationRoutes.js:555`, `sessionRepository.js:20`.

**Düzeltme:** Sonuçlanmış kayıt için süreli salt okunur sahip erişimi sağla; yeni belge/düzenleme yetkisini ayrı koru. Kamuya açık not sızıntısı kapatılırken öğrencinin kendi sonucunu okuyabilmesi de çözülmeli.

### F06 — P2: Geçiş başvurusu anlatılıyor ancak desteklenmiyor

**Kanıt:** Canlı rehber ilk/uzatma/geçiş diyor. Formda iki seçenek var. `application_type='transfer'` yerel API testinde HTTP 400 verdi. `applicationRoutes.js:20` ve veritabanı iki türle sınırlı.

**Etkisi:** Başka ikamet türünden öğrenci ikametine geçecek kişi yanlış dalı seçebilir; uzatmaya özgü ek belgeler de yanlış uygulanabilir.

**Düzeltme:** Ya geçişin veri modeli, belgeleri ve personel akışı birlikte tamamlanmalı ya da desteklenmediği açıkça belirtilip öğrenci ofise yönlendirilmeli. Geçişi sessizce ilk başvuruya eşleme.

### F07 — P2: Canlı kullanım rehberi gerçek giriş ve sigorta akışıyla çelişiyor

**Kanıt:** `src/public/publicGuideModal.js:7` ve `:15`: rehber takip kodu veya e-postayla sorgu yapılabileceğini, sağlık sigortasının genel olarak yüklenmesini ve geçiş seçilebilmesini söylüyor. Gerçek arayüz genel sorguda öğrenci numarası; sahip girişinde referans + öğrenci numarası istiyor. Sigorta yüklemesi koşullu.

**Düzeltme:** Beş dilde rehber, form ve takip ekranları aynı kurallardan türetilmeli. Bu çelişkiler canlı rehberde de görüldü.

### F08 — P2: Başarısız/güvensiz tarama takipte “henüz yüklenmedi”ye dönüşüyor

**Kanıt:** `applicationTrackingRoutes.js:10–21`, yalnız `pending`/`clean` dosyayı görünür sayıyor. Henüz yeniden gönderim talebi bulunmayan `unsafe`/`failed` dosya, takip DTO'sunda `not_uploaded` olabilir. Taslak sihirbazı daha açıklayıcı tarama durumları gösteriyor.

**Etkisi:** Başvurusunu göndermiş öğrenci dosyasının kaybolduğunu sanabilir; kendi kendine düzeltme yetkisi de yalnız ilgili yenileme akışında var.

**Düzeltme:** Dosya erişimini açmadan “güvenlik kontrolü başarısız/ofis işlemi gerekiyor” gibi doğru durum ve sonraki adımı göster. Bekleyen dosyayı temiz sayma.

## 2. İlk denetim anındaki resmî belge karşılaştırması

Bu bölüm, ilk denetimdeki bulguları saklar. Kullanıcı kararlarından ve 23 Ekim tarihli tekrar kontrolden sonra K01–K03/K05 sonuçları yukarıdaki güncel duruma göre okunmalıdır. Tekrar kontrolde öğrenci kayıt formunun GöçNet 2026/02 sürümü ve 7 Mayıs 2026 üretim tarihi görüldü; bu canlı formun mevcut durumunu gösterir, geçmişte uygulanan tüm yerel prosedürleri kanıtlamaz.

| Alan | İncelenen uygulama | Değerlendirme |
|---|---|---|
| Başvuru formu | İmzalı ilk sayfa | Güncel listeyle örtüşüyor. |
| Pasaport | Kimlik/fotoğraf sayfası, varsa vize sayfası | Kimlik sayfası örtüşüyor; vize ek sayfası güncel temel listede sayılmıyor. Fiziksel asıl ibrazı öğrenciye hatırlatılmalı. |
| Kart bedeli | Makbuz isteniyor | Örtüşüyor; sabit tutar dayatılmıyor. |
| Kira/kendi evi/yurt/otel/başkasının yanı | Beş alternatif ve ilgili ekler | Noter, numarataj, otel makbuzu, yurt onayı ve evli destekleyicinin eş taahhüdü dalları büyük ölçüde örtüşüyor. |
| Uzatma adresi | Yerleşim yeri belgesi + fatura/yeni abonelik | Örtüşüyor. |
| Özel sigorta/GSS | Dosya istenmiyor | Güncel belgede doğrulama resmî sistemdedir; portalın Göç/SGK ile doğrulama yaptığı görülmedi. “Sistemden doğrulanır” ifadesi bu portalın yaptığı kontrol gibi sunulmamalı. |
| İkili anlaşma | SGK kanıtı isteniyor | Örtüşüyor. |

Kaynak: [Güncel öğrenci belge listesi](https://e-ikamet.goc.gov.tr/Ikamet/BasvuruIstenenBelgeler/BasvuruFormuIstenenBelgeler?tur=5).

**23 Ekim kaynak teyidi:** Öğrenci kayıt formunun 7 Mayıs 2026 tarihli GöçNet 2026/02 sürümü; 2 fotoğrafı, öğrenci belgesini, küçükler için koşullu aile evraklarını ve kayıt tarihinden itibaren üç aylık GSS penceresini açıkça sayıyor. Ayrı güncel “istenen belgeler” sayfası ise özel sigorta ve GSS’nin sistemden doğrulandığını ve bunlar için ek belge sunulmayacağını, ikili anlaşma belgesinin ise sunulacağını söylüyor. Kayıt formu özel poliçenin ilk sayfasını ibraz etmeyi ayrıca yazdığı için bu iki resmî kaynak sigorta dosyası konusunda çelişiyor. Portal, öğrenciden özel sigorta/GSS dosyası istemeyecek; yalnız ikili anlaşma belgesini isteyecek. Kurum fiziksel dosya uygulamasında farklı talimat veriyorsa portal metninden ayrı teyit edilmeli. [Öğrenci kayıt formu](https://e-ikamet.goc.gov.tr/Ikamet/BasvuruFormuOrnegiGecis/BasvuruFormuBos?tur=5), [istenen belgeler sayfası](https://e-ikamet.goc.gov.tr/Ikamet/BasvuruIstenenBelgeler/BasvuruFormuIstenenBelgeler?tur=5).

### K01 — Açılış öncesi karar: Küçüklerde öğrenim vizesi istisnası

Kod, `student_visa` yanıtında doğum/velayet/muvafakat ve ilgili ebeveyn belgelerinin tümünü çıkarıyor (`documentPolicy.js:104–109`). Ana sayfadaki açıklama ise muvafakati bütün küçükler için anlatıyor.

Güncel örneğin küçükler bölümünde bu vize istisnası açık değil; üniversitelerin yayımladığı önceki protokol uygulamalarında bulunuyor. Bu kaynak farkı, istisnanın kesin kaldırıldığını kanıtlamaz. **Topkapı/İstanbul İl Göç için geçerli talimat kesinleştirilmeli; öğrenci cevabıyla bütün küçük belgelerini kaldırmak teyitsiz bırakılmamalı.** Teyide kadar belirsiz vaka ofis kontrolüne alınabilir; gereksiz belgeyi herkese zorunlu kılmak da doğru çözüm değildir. [Güncel uzatma örneği, s.4](https://e-ikamet.goc.gov.tr/Ikamet/BasvuruFormuOrnegiUzatma/BasvuruFormuBos?tur=5), [üniversite protokol uygulaması](https://student.ogu.edu.tr/Sayfa/Index/29/kayit-belgeleri).

### K02 — Açılış öncesi karar: Yaşın hangi tarihte hesaplandığı

Portal yaşı e-İkamet başvuru tarihiyle değil, alan güncellendiği İstanbul günüyle hesaplıyor (`applicationRoutes.js:178`). 20.10.2008 doğumlu kişi, 19.10.2026 e-İkamet tarihinde küçük; 23.10.2026 portal tarihinde yetişkin. Eski taslakta yaşın doğum gününde otomatik yenilenmesi de garanti değil.

Resmî başvuru tarihi saklanıp kurumun uyguladığı referans tarihe göre değerlendirme yapılmalı. Bu rapor güncel belge metninden tek başına referans tarih hakkında kesin hukuki hüküm çıkarmıyor. Kabul testleri, bu iki tarih arasına 18. doğum gününün girmesini kapsamalı.

### K03 — Açılış öncesi karar: Gelecekte GSS'ye başvurma beyanı

`gss_pending` seçeneği aktif sigorta, yapılmış GSS başvurusu veya üç aylık süre uygunluğu olmadan gönderime hazır olabiliyor; yerel fixture bunu doğruladı. Eğitim yılı başlangıcı/sigorta kapsam tarihleri saklanmıyor. Resmî üç aylık başvuru olanağı, her öğrencinin süresiz sigortasız kabul edilebileceği anlamına gelmez. Tarih ve ofis kontrolü tanımlanmalı; özel sigorta PDF'ini herkesten istemek çözüm değildir. [Öğrenci belge listesi, sigorta açıklaması](https://e-ikamet.goc.gov.tr/Ikamet/BasvuruIstenenBelgeler/BasvuruFormuIstenenBelgeler?tur=5).

### K04 — Açılış öncesi karar: Fotoğraf, öğrenci belgesi ve UETS'nin dayanağı

Portal iki biyometrik fotoğraf, öğrenci belgesi ve yetişkin uzatmada UETS dosyası istiyor. Güncel 2026/04 örneklerinin belge listesi, önceki proje notundaki iki fotoğraf/öğrenci belgesi/UETS ekleriyle aynı liste değil; UETS alanı formda mevcut. Bu nedenle önceki örneğe dayanarak her dosyayı güncel genel Göç zorunluluğu olarak sunmak yeterince desteklenmiyor. Üniversitenin fiziksel dosya/protokol gereksinimi ayrıca bulunabilir. İki/dört fiziksel fotoğraf ile tek dijital fotoğraf dosyasının amacı ayrılmalı; kesin talimat olmadan belgeler otomatik kaldırılmamalı veya sayı artırılmamalı. [İlk başvuru örneği](https://e-ikamet.goc.gov.tr/Ikamet/BasvuruFormuOrnegi/BasvuruFormuBos?tur=5), [uzatma örneği](https://e-ikamet.goc.gov.tr/Ikamet/BasvuruFormuOrnegiUzatma/BasvuruFormuBos?tur=5).

### K05 — Süreç boşluğu: Parmak izi, e-İkamet ve fiziksel teslim sınırı

Parmak izi var + herhangi bir boş olmayan işlem kodu, belge adımına geçmek için zorunlu (`applicationWizard.js:507`, `submissionReadiness.js:59`). Kodun resmî doğrulaması görülmedi. Kayıtlı olup kodunu bulamayan veya henüz kayıt işlemi tamamlanmamış öğrenci için kontrollü ofis yolu gerekiyor; öğrenci uydurma kod girmeye itilmemeli.

Başarılı gönderim ekranı ofise gönderim ile resmî başvuru/kabul arasındaki sınırı ve fiziksel teslimin sonraki adımlarını yeterince açıklamıyor (`createSubmissionConfirmation`). Resmî e-İkamet bağlantısı, son tarih uyarısı, imzalı evrak/asıl ibrazı ve ofis teslim yönlendirmesi tamamlanmalı. Kampüste hizmet varsa yalnız İl Göç binasına gitme yönlendirmesi güncellenmeli. [İstanbul İl Göç'ün mobil hizmet açıklaması](https://istanbul.goc.gov.tr/goc-idaresi-baskanligi-goc-danisma-araclarini-hizmete-aldi).

## 3. Senaryo kapsamı ve kalan kabul çalışması

| Senaryo grubu | İncelenen / doğrulanan | Açılış için kalan |
|---|---|---|
| İlk/uzatma; beş konaklama; üç sigorta | Politika/SQL ve 2.400 yanıt birleşiminde seçili kurallar | Gerçek form ve fiziksel evrakla ofis kabulü |
| Bekâr/evli destekleyici | Eş taahhüdü doğru koşula bağlı | Ortak belge PDF'sinin iki alanda tekrar istenmesinin kullanım kabulü |
| Küçük; anne-baba belli/belirsiz; boşanma/vefat/gaiplik/tek ebeveyn | Güncel öğrenci formuna göre belge dalları, muvafakat ve UETS istisnası | Gerçek dosyada ofis kabulü ve birden çok aile durumunun birlikte kontrolü |
| Telefon/e-posta/uyruk/doğum tarihi | Alan doğrulama ve mevcut UI testleri | Tek isimli öğrenci, pasaport yerine belge, hatalı öğrenci numarası için kurum destek yolu |
| Geçiş, il/üniversite/bölüm değişimi | Tür desteği eksik; resmî yönlendirme ihtiyacı | Destek kapsamı ve ofise yönlendirme |
| Hazırlık/TÖMER, süre uzatan öğrenci, değişim programı, farklı mevcut statü | Ayrı uygunluk akışı görülmedi | Her birinin aynı öğrenci ikamet akışına uygunluğunu personel değerlendirmeli |
| Yükleme | Mevcut testlerde tip/boyut, intent, finalize, tekrar deneme, cleanup ve sahiplik korumaları | iPhone HEIC/boş MIME, büyük/çok sayfalı PDF, parola korumalı/bozuk dosya ve düşük bağlantıyla gerçek tarayıcı denemesi |
| Scanner pending/clean/unsafe/failed | Bekleyen ile temiz ayrımı; personel onayı ve dosya erişimi temiz taramaya bağlı | Gerçek scanner testi varsayılan pakette atlanıyor; canlı kabul şart |
| Çoklu sekme/cihaz | Kilit sürümü mekanizmaları mevcut; gönderim yarışı yeniden üretildi | F02 sonrası eşzamanlı değiştirme/silme/oturum iptal testi |
| Eksik belge / ikinci yenileme | Sebep ve revizyon korumaları; güvensiz dosya için yeniden yükleme kuralları mevcut | İki defa belge iadesi ve farklı personel işlemleriyle canlı kabul |
| Başvuru sonrası bilgi düzeltme / ilave evrak | Genel bilgiler kilitleniyor; yenileme mevcut belge kodlarına bağlı | Yanlış doğum tarihi/konaklama/sigorta beyanı ve listede olmayan resmî ek belge için kontrollü personel işlemi |
| Olumlu/olumsuz sonuç | Olumlu durum zinciri mevcut; ret/iptal ve tamamlanmış sahip erişiminde sorunlar | Karar kaydı ve öğrenciye doğru sonuç gösterimi |
| Paylaşılan ofis bilgisayarı/ağ | IP kotaları ve tarayıcı oturumu incelendi; iletişim taslağı localStorage'da kalabilir | Öğrenci değişimi, çıkış/geri, taslak temizliği ve kampüs yüküyle kabul |
| TR/EN/RU/TK/AR, erişilebilirlik | Mevcut test kapsamı, beş dil metinleri; Arapça canlı başlangıç | Telefon/Safari, RTL, klavye ve ekran okuyucuyla kabul |
| WhatsApp kapalı/açık/hata | İsteğe bağlı izin ve hata mesajları mevcut | Bildirim gelmese de takip erişimi; gerçek sağlayıcı teslim kanıtı |

## 4. Teslim kontrolleri

Son kontrol: `npm test` — **1.142 test; 1.141 geçti, 1 atlandı, 0 hata**. Atlanan test gerçek MacBook/ClamAV HTTPS protokol denemesi. `npm run build:production` ve `npm run deploy:dry-run:production` başarılı; derlemede yerel yazıcı sırları ve 500 kB üstü bundle uyarısı var. Dry-run üretim binding'lerini gösterdi; hiçbir şey deploy edilmedi. Canlı ofis/öğrenci UAT yapılmadı.

Yeniden üretim:

```sh
node --disable-warning=ExperimentalWarning docs/audits/student-online-2026-10-23/replay.mjs
```

Bu çalışma uygulama davranışını değiştirmedi, migration uygulamadı, commit/push/deploy yapmadı. Üretim D1/R2, sırlar, cron, scanner ve Print Agent ayarlarına dokunulmadı. Eklenenler denetim raporu, yerel yeniden üretim betiği ve kanıt dosyalarıdır.
