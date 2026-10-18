# Fiziksel kayıt durumları ve YKN aktarımı — inceleme ve çözüm önerileri

Tarih: 17 Ekim 2026. İncelenen dal: `production`, HEAD: `813cecbbf51f5c6dd0ccefe1df40cdcc4b81262b`.
Bu belge ilk incelemeyi ve önerileri kaydeder. Kullanıcı sonraki mesajında kontrol ederek yerel uygulamaya başlanmasını onayladı. Canlı kaynaklar değiştirilmedi.

## Kullanıcının bildirdiği işler

1. Fiziksel ikamet kaydının detayında, hiçbir dosya yüklenmeden personel durum seçebilmeli.
2. Öğrenci makbuzdaki `ITU-…` takip koduyla sorguladığında personelin seçtiği güncel durum görünmeli.
3. YKN 2. adımda fotoğraf kırpılıp “Her şeyi YÖKSİS’e aktar” seçildiğinde fotoğrafla birlikte diğer alanlar da aktarılmalı.
4. İlk öğrenciden sonra başka öğrenciyle devam etmek için YÖKSİS’i yenilemek ve YKN ekranına yeniden geçmek gerekmemeli.
5. Çalışan ilk kabul kodu bulma/yazma/arama akışı korunarak gereksiz beklemeler azaltılmalı.

Kullanıcı son canlı eklenti sürümünü kullandığını bildirdi. Canlı indirme metadatası yerel paketle aynı: `1.2.98`, fingerprint `6272bb83f96f`.
Bu, kullanıcının tarayıcısındaki yürütülen dosyaların bağımsız tespiti değildir. Sorun eski sürüm varsayımıyla açıklanmadı.

## 1. PDF olmadan durum seçimi

**Kesin bulgu:** `src/staff/physical-intake-view.js` içindeki `renderDetail`, `approved_for_processing` için doğrudan `continue` kullanıyor. “Onaylandı” düğmesi API izin verse bile oluşturulmuyor.

`src/server/domain/physical-intake-policy.js:listPhysicalTransitions` PDF olmadan ofis onayına zaten izin veriyor; yalnızca `sent_to_migration`, `migration_approved`, `completed` için finalized PDF istiyor. Dolayısıyla tüm durumların PDF yüzünden kapalı olması şeklinde tek bir neden yok:

- Yeni kayıt zaten `under_review` ile başlıyor; “İncelemede” mevcut durum olduğu için tekrar seçilemiyor.
- “Onaylandı” arayüzden gizlenmiş.
- Göç ve tamamlanma durumları sunucu politikasıyla PDF’ye bağlanmış.
- Ayrı bir “İncelendi” durumu mevcut değil; mevcut etiket “İncelemede”.

`test/physical-receipt-ui.test.js` onay düğmesinin gizlenmesini özellikle doğruluyor. Test başarısı mevcut ürün hatasını engellemiyor.

**Önerilen çözüm:** Bütün mevcut personel durumlarını detayda göster. Fiziksel evrakın iş akışı durumunu dijital kopyanın varlığından ayır; bu istek kapsamında mevcut durum geçişlerindeki PDF şartını kaldır. PDF var/yok bilgisini ayrıca göster. Yeni “İncelendi” durumunu gereksiz yere şemaya ekleme; ayrı bir aşama istenirse ayrıca tanımla.

Silinmiş/işlemi kapalı kayıt kısıtları, ret gerekçesi, yetkilendirme, `lock_version`, denetim kaydı ve mevcut PDF düzenleme kısıtları korunmalı. Durum değişince dijital dosya otomatik oluşturulmamalı veya silinmemeli. Uygulama sırasındaki çapraz kontrol, `0021` migration’ındaki `physical_migration_pdf_guard` trigger’ını da ortaya çıkardı. Kolon/tablo değişikliği gerekmiyor ancak bu trigger için yeni `0024_physical_status_without_pdf.sql` migration’ı gerekli; yalnızca yerelde test edildi.

**Kabul kontrolü:** PDF’siz yeni kayıt → onay → göçe gönderildi → göç onayladı → tamamlandı; her adımda API, detay, liste ve takip ekranı aynı durumu göstermeli. Ret için gerekçe ve eşzamanlı personel güncellemelerinde sürüm çakışması ayrıca kontrol edilmeli.

## 2. ITU takip kodunda personelin seçtiği durum

**Kesin bulgu:** `src/server/domain/physical-tracking-policy.js:readPhysicalTrackingStatus` bazı durumları doğrudan döndürüyor; kalan durumda `current_pdf_id` varsa `under_review`, yoksa `received` üretiyor. Veritabanında `under_review` olan PDF’siz kayıt öğrenciye “Teslim alındı” olarak görünüyor. Personel durumu ile dosya varlığı birbirine karışıyor.

`physical-tracking-routes.js` zaten doğru fiziksel kaydı takip koduyla buluyor. Yeni öğrenci numarası sorgusu veya başka kimlik eşleştirme gerekmiyor. Ret durumu bugün `contact_office` olarak sunuluyor; birebir personel durumunu göstermek için bu eşleme de düzeltilmeli.

**Önerilen çözüm:** Kamuya açık izinli durumları saklanan `intake.status` üzerinden açık bir eşlemeyle üret; PDF’yi sorgulama durumu hesabından çıkar. “Reddedildi” durumuna beş dilde açık etiket ekle; mevcut ret gerekçesi gösterimi korunsun. Eski kapalı kayıtların özel davranışı ve tanınmayan durumlarda güvenli yanıt korunsun. Başlangıç durumu mevcut `under_review` olarak tutulursa PDF’siz ilk kayıt da “İncelemede” görünür.

Takip kodu normalizasyonu, IP/kod hız sınırları, silinen kaydı göstermeme ve kişisel alanları kamuya açmama kuralları korunmalı.

**Kabul kontrolü:** Her personel durumu için PDF var/yok matrisi; aynı ITU koduyla kayıt tekrar sorgulandığında son kaydedilen durum ve doğru çeviri; ret gerekçesinin güvenli metin olarak gösterilmesi.

## 3. Kırpma sonrası yalnızca fotoğraf aktarımı

**Kesin kod bulgusu:** İki farklı aktarım hattı var:

- Portal kırpma olayı → `startManualYoksisFillAfterCrop` → `FILL_YOKSIS_FORM`: MAIN yazımı, ZK sonrası alan doğrulaması, eksik alan fallback’i ve son doğrulama içeriyor.
- Ayrı eklenti `cropper.js` → `CROPPED_PHOTO_CONFIRMED`: arka planda yalnızca `syncYoksisFormInMainWorld` çalıştırılıyor. Yukarıdaki alan doğrulaması ve eksik alan fallback’i kullanılmıyor. `FILL_YOKSIS_WITHOUT_PHOTO` da aynı ayrışmayı taşıyor.

MAIN yazımı alanlara değer yazıp ZK olaylarını gönderiyor ve aynı çalışmada fotoğraf yüklemesini başlatıyor. Dönen sonuç sunucu yanıtından sonra bütün alanların korunduğunu kanıtlamıyor. Ayrı kırpma hattı bu ham sonucu kullanıcıya tamamlandı diye sunabiliyor; `partial` bilgisini de ortak hat gibi hesaplamıyor. Bu yol, fotoğraf gelirken diğer alanların eksik kalabilmesini açıklayan somut bir mimari boşluk.

**Kanıt sınırı:** Kullanıcının kırpma ekranının portal içi mi ayrı pencere mi olduğu henüz belirlenmedi. Canlı oturumdaki olay sırası ve hangi alanların silindiği görülmedi. Bu nedenle bu boşluğun bildirilen olayın tek kesin nedeni olduğu ileri sürülmüyor. Portal hattında da fotoğraf postback’i/alan güncellemelerinin sıralaması incelenmeli.

**Önerilen çözüm:** Her iki giriş noktasının kullandığı tek bir doğrulanmış aktarım işlemi çıkar. Önce doğru öğrenci/hedef sekme ve taze arama bağını doğrula; alanları kontrollü yaz, ZK güncellemesi tamamlanınca değerleri doğrula; ardından fotoğrafı bir kez yükle, yükleme güncellemesi sonrası alanları yeniden doğrula. Yalnızca gerçekten eksik kalan alanları bir kez tamamla ve son doğrulamayı yap. DOM düğümleri yenilenirse yeniden bul; eski referansa yazma.

`photoUploaded` bugün çoğunlukla `fileInput.files.length > 0` kanıtıdır; sunucunun fotoğrafı kabul ettiğinin kanıtı değildir. Kullanıcıya tamamlandı sonucu için hedefte yükleme sonucunu da doğrula. Eksik alanları isimleriyle göster; kısmi başarıda öğrenci verisini koru. Aynı fotoğrafı yeniden yükleme ve belirsiz sonucu kör tekrar etme. Final YÖKSİS kaydetme işlemi personelde kalmalı.

**Kabul kontrolü:** Portal ve ayrı eklenti kırpması; fotoğraf postback’inin alan DOM’unu yenilemesi; yavaş sunucu, eksik alan, yükleme hatası ve tekrar tıklama. Fotoğraf başarılı/alan başarısız sonucu “tamamlandı” olmamalı. Yeni öğrencinin verisine eski öğrencinin fotoğrafı eklenmemeli.

## 4. İkinci öğrenci için sayfayı yenileme ihtiyacı

**Tekrar üretilen hata:** `content.js:prepareYoksisSearchControls` önce `tryResetOrNewRecord` ile Temizle’yi tetikliyor. Sonra `resetStudentForm:true` ile MAIN katmana geçiyor. `zk-form-controls.js:settleAndSyncSearch` orada yeniden Temizle `onClick` gönderiyor. MAIN katmanın `attemptedSelections` koruması ilk content-script tıklamasını kapsamıyor.

Mevcut fonksiyonlar JSDOM’da gerçek kaynaklarından çalıştırılarak, ilk komutun hızlı tamamlandığı sentetik ZK ortamında tekrar üretildi: `clicked:true`, `mainWorldSuccess:true`, **`resetEvents:2`**. Canlı sunucunun zamanlamasına göre ikinci temizleme yeni arama veya form yenilenmesiyle çakışabilir. İlk öğrenci boş formdan başladığı için bu dala girmez.

Ek risk: `clearLeftoverYoksisStudentFormInputs` eski ad/soyad/belge değerlerini DOM’da boşaltıyor; bu, ZK sunucu durumunun temizlendiğini kanıtlamaz. `waitForActiveProcessing` AU kuyruğunu tam boşaltmayı beklemiyor ve süre dolunca da başarı döndürüyor. Bunlar sıradaki öğrenciye geçişte güvenilir bir sıfırlama kanıtı sağlamıyor.

**Önerilen çözüm:** Temizleme komutunun tek sahibi MAIN katman olsun; content katmanı komut göndermek yerine bu işlemi talep etsin. Aynı işlem kimliği için en fazla bir temizleme komutu; ilgili yanıt/form değişimi ve güncel arama kontrolleri doğrulandıktan sonra yeni kabul kodunu yaz. Ardından yeni öğrenci kimliğini doğrulayıp aktarım izni ver. Sunucu sıfırlaması yerine DOM’u elle boşaltarak başarılı görünme yolunu kaldır. Kaydedilmemiş kullanıcı değişiklikleri varsa bunları sessizce kaybetme.

**Kabul kontrolü:** Aynı oturum/sekmede en az 10 öğrenci; hızlı ve yavaş reset yanıtları, DOM yenilenmesi, kuyrukta bekleyen AU ve hata penceresi. Her öğrenci geçişinde en fazla bir reset ve bir arama; F5 gerekmemesi, önceki kişinin hiçbir alan/fotoğrafının kalmaması. Yerel iki komut tekrar üretimi ayrıca kalıcı regresyon testine dönüşmeli.

## 5. Kabul kodu aramasının hızlandırılması

**Bulgular:** Akışta belge okuma/OCR, YKN ekranına geçiş, kod yazma, arama ve yeni form bekleme için süre ölçümü zaten var. Açık kabul arama ekranını yeniden kullanma desteği de mevcut. Canlı oturum ölçümü olmadan toplam gecikmenin hangi adımda baskın olduğu henüz bilinmiyor; hız hedefi uydurulmamalı.

**Önerilen çözüm:** Önce aynı oturumda aşama sürelerini, öğrenci bilgisi içermeyen ölçümlerle karşılaştır. PDF metniyle bulunan kod için OCR çalıştırma; doğru YKN ekranını yeniden kullan. Çift reseti kaldır. Sabit beklemeleri ve uzun fallback zincirlerini ilgili ZK yanıtı/yeni form kanıtı gelir gelmez bitir; timeout ise başarısızlık sayılsın. Arama ve reset olaylarını çift göndererek hız kazanma. Öğrenci kimliği, form tazeliği ve hedef sekme kontrollerini kaldırma.

## Doğrulama ve sınırlar

- Başlangıç çalışma ağacı temizdi; doğru Unicode Git kökü, dal, HEAD ve worktree listesi kontrol edildi.
- Canlı `/downloads/ykn-eklentisi.json` salt okunur olarak kontrol edildi; yerelle sürüm/fingerprint aynı.
- Doğrudan Node test çalıştırması: `test/physical-receipt-ui.test.js`, `test/physical-receipts.test.js`, `test/yknLiveContract.test.js`, `test/yknZkControls.test.js`: **124 geçti, 0 başarısız**.
- Testlerin bir kısmı istenmeyen mevcut davranışı doğruluyor; bir kısmı content ve MAIN katmanlarını gerçek ZK yaşam döngüsüyle birlikte çalıştırmıyor. Mevcut başarı, bildirilen canlı hataların yokluğunu göstermiyor.
- Yeni kod/paket üretmemek için paketlemeyi tetikleyen `npm test` ön adımı, build ve deploy dry-run bu salt incelemede çalıştırılmadı. Uygulama onaylanırsa proje politikasındaki üç kontrol tamamlanmalı.
- Oturum açık gerçek Apply/YÖKSİS akışı bu incelemede çalıştırılmadı. Yerel kanıt ile canlı UAT birbirinden ayrı.

## Önerilen uygulama sırası

1. Durum düğmelerini, PDF bağımsız geçiş politikasını, takip eşlemesini ve ilgili test beklentilerini birlikte düzelt.
2. Çift reseti tek komuta indir ve iki katmanı birlikte kapsayan regresyon testi ekle.
3. Kırpma/alan aktarım girişlerini ortak doğrulanmış işleme bağla; fotoğraf ve alan güncelleme sırasını düzelt.
4. Yerel test/build/dry-run sonrasında kurulu paket kimliği doğrulanmış oturumda seri öğrenci UAT ve süre ölçümü yap.
5. Deploy yalnızca ayrıca istendiğinde. D1/R2, secret/binding, cron, scanner, Print Agent v7 ve üretim bayraklarına dokunma.
