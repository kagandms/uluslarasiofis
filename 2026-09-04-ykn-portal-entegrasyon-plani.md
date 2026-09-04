# YKN Portal Entegrasyon Planı

## Amaç

İkamet portalında pasaport numarasıyla arama yaparak Apply Topkapı’daki öğrenci bilgilerini almak, kabul mektubu kodunu ve pasaport tarihlerini mümkün olan en az manuel işlemle YÖKSİS’e aktarmak.

## Kesinleştirilen kullanıcı akışı

1. Kullanıcı Vercel üzerinde çalışan İkamet portalına öğrencinin pasaport numarasını girer.
2. Portal, Chrome eklentisi üzerinden Apply Topkapı’da arama başlatır.
3. Eklenti Apply’daki öğrenci profilini bulur ve portale öğrencinin adını gönderir.
4. Portalda öğrenci adı ve şu butonlar gösterilir:
   - **Bilgileri Kopyala**
   - **Kabul Mektubu Kodunu Kopyala**
5. **Bilgileri Kopyala** mevcut eklentideki işlevle aynı çalışır:
   - Apply profilindeki gerekli bilgiler okunur.
   - Pasaport belgesinden düzenlenme ve son geçerlilik tarihleri de alınır.
   - Eklentinin geçici verisine kaydedilir.
   - Başarılıysa portalda “Bilgiler kopyalandı” mesajı gösterilir.
   - Alanlar bulunamazsa anlamlı bir hata gösterilir.
6. Kullanıcı **Kabul Mektubu Kodunu Kopyala** butonuna basar.
7. Eklenti Apply profilindeki Yüklenen Belgeler bölümünde bulunan Kabul Mektubu butonuna otomatik tıklar.
8. Kabul mektubu yeni sekmede PDF olarak açılır.
9. Eklenti PDF içindeki kabul mektubu kodunu okumayı dener.
10. Kod başarıyla okunursa saklanır ve portalda “Kabul mektubu kodu kopyalandı” mesajı gösterilir.
11. Kod okunamazsa PDF açık bırakılır ve portalda hata/manuel kontrol mesajı gösterilir.
12. Kod başarılı şekilde alındığında portalda **YÖKSİS’e Aktar** butonu görünür.
13. Kullanıcı bu butona bastığında eklenti:
   - YÖKSİS sekmesini bulur veya açar.
   - Kabul mektubu kodunu ilgili alana yazar.
   - YÖKSİS’te **Ara** butonuna tıklar.
   - Öğrenci bilgi giriş ekranının açılmasını bekler.
   - Kullanıcıyı YÖKSİS sekmesine geçirir.
14. Portalda **Bilgileri YÖKSİS’e Yapıştır** butonu bulunur.
15. Bu butona basıldığında Apply’dan alınan bilgiler YÖKSİS’teki ilgili alanlara otomatik doldurulur.
16. Kullanıcı YÖKSİS’te bilgileri son kez kontrol eder ve kalan işlemleri tamamlar.

## Paralel çalışma

Öğrenci profili Apply’da bulunduktan sonra **Bilgileri Kopyala** ve **Kabul Mektubu Kodunu Kopyala** işlemleri birbirini beklemeden çalışabilir.

Önerilen davranış:

1. Apply profilindeki öğrenci bilgileri, Pasaport bağlantısı ve Kabul Mektubu bağlantısı önce aynı anda tespit edilir.
2. Öğrenci bilgileri ve pasaport PDF’i için kopyalama işlemi başlatılır.
3. Kabul mektubu kodu için okuma işlemi aynı anda başlatılır.
4. Her işlemin portalda ayrı durumu gösterilir: “Bilgiler alınıyor”, “Pasaport tarihleri okunuyor” ve “Kabul kodu okunuyor”.
5. İşlemlerden biri başarısız olsa bile diğeri iptal edilmez.

İki belge butonuna peş peşe basılması da desteklenmelidir. Aynı işlem ikinci kez başlatılırsa yeni bir paralel işlem açmak yerine mevcut işlem sonucu kullanılmalıdır.

Paralel çalışma sırasında Apply profilinin aynı sekmede iki kez yönlendirilmesi beklenmemelidir. Önce belge bağlantıları alınmalı; PDF işlemleri bağımsız sekmelerde veya arka planda yürütülmelidir. Böylece Kabul Mektubu ve Pasaport işlemleri birbirinin sekme durumunu bozmaz.

## Pasaport tarihleri için ek akış

YÖKSİS’te otomatik doldurulamayan iki alan:

- Pasaportun düzenlenme tarihi
- Pasaportun geçerlilik/bitiş tarihi

Bu bilgiler Apply profilinin ana bilgilerinde bulunmuyorsa, aynı öğrenci profilindeki **Yüklenen Belgeler → Pasaport** butonu kullanılacaktır.

Önerilen işlem:

1. Kullanıcı veya otomasyon pasaport belgesini ayrıca açar.
2. Pasaport yeni sekmede PDF olarak yüklenir.
3. Eklenti PDF içindeki pasaport alanlarını okur.
4. Düzenlenme tarihi ve bitiş tarihi ayıklanır.
5. Tarihler portalda gösterilir ve Apply’dan alınan diğer öğrenci bilgileriyle birlikte saklanır.
6. **Bilgileri YÖKSİS’e Yapıştır** butonuna basıldığında bu iki tarih de YÖKSİS’teki alanlara doldurulur.

## Pasaport tarihlerini alma yöntemi

Öncelik sırası:

1. PDF metin tabanlıysa doğrudan metin analiziyle tarihleri bulmak.
2. PDF’de alan adları ve değerleri sabit konumdaysa etiket/değer eşleşmesiyle okumak.
3. PDF taranmış görüntüyse yalnızca pasaporttaki ilgili bölgeye OCR uygulamak.
4. Tarih doğrulanamazsa otomatik yanlış değer yazmamak; kullanıcıya manuel kontrol istemek.

Pasaport üzerindeki tarih formatları farklı olabileceği için tarih değerleri YÖKSİS’e yazılmadan önce doğrulanmalıdır. Gelecekteki bir tarihin düzenlenme tarihi olarak okunması veya bitiş tarihinin düzenlenme tarihinden önce olması hata kabul edilmelidir.

## Otomasyon seviyesi

Normal akışta kullanıcının yapacağı işlemler:

1. Pasaport numarasını girmek.
2. **Bilgileri Kopyala** butonuna basmak.
3. **Kabul Mektubu Kodunu Kopyala** butonuna basmak.
4. **YÖKSİS’e Aktar** butonuna basmak.
5. **Bilgileri YÖKSİS’e Yapıştır** butonuna basmak.
6. YÖKSİS’te son kontrolü yapmak.

Bilgiler, pasaport tarihleri ve kabul kodu paralel olarak başlatılırsa toplam bekleme süresi yaklaşık olarak en uzun süren işlemin süresine yaklaşır.

Kabul mektubu ve pasaport PDF’leri okunabiliyorsa belge sekmelerini açma, tarihleri alma, kabul kodunu alma ve YÖKSİS’e geçme işlemleri otomatik yapılacaktır.

## Hata durumları

Portal aşağıdaki durumları açıkça göstermelidir:

- Apply Topkapı sekmesi bulunamadı.
- Apply oturumu açık değil.
- Pasaport numarasıyla öğrenci bulunamadı.
- Birden fazla öğrenci bulundu.
- Öğrenci profili açıldı ancak gerekli alan bulunamadı.
- Kabul mektubu bulunamadı.
- PDF açıldı ancak kabul kodu okunamadı.
- Pasaport PDF’i açıldı ancak tarihler okunamadı.
- YÖKSİS sekmesi bulunamadı.
- YÖKSİS alanı bulunamadı veya doldurulamadı.

## Teknik ve güvenlik varsayımları

- Kullanıcı Apply Topkapı ve YÖKSİS’e aynı tarayıcıda giriş yapmış olacaktır.
- Portal, Apply veya YÖKSİS şifrelerini görmeyecek ve saklamayacaktır.
- Eklenti, yalnızca yetkili Apply ve YÖKSİS alan adlarında çalışacaktır.
- YÖKSİS’te son kayıt/gönderme işlemi otomatik yapılmayacak, kullanıcı onayı gerektirecektir.
- Öğrenci verileri işlem tamamlandıktan sonra gereksiz şekilde kalıcı depolamada tutulmayacaktır.
- PDF okuma başarısız olduğunda sistem tahminî tarih veya kod yazmayacaktır.

## Karar günlüğü

| Karar | Tercih | Gerekçe |
|---|---|---|
| Apply entegrasyonu | Mevcut eklenti üzerinden | Apply için API yok ve web portalı başka sekmenin DOM’una doğrudan erişemez. |
| Ana kullanıcı arayüzü | İkamet portalı | Kullanıcı tüm süreci tek merkezden takip eder. |
| Kabul mektubu | Yeni PDF sekmesini eklentinin izlemesi | Apply mevcut akışta belgeyi yeni sekmede açıyor. |
| PDF okuma | Metin analizi, sonra OCR fallback | Hız ve doğruluk açısından OCR yalnızca gerektiğinde kullanılmalı. |
| YÖKSİS aktarımı | Kodla arama ve alan doldurma otomatik, son kontrol manuel | Hatalı otomatik kayıt riskini azaltır. |
| Pasaport tarihleri | Aynı belge akışıyla alınması | YÖKSİS’te eksik kalan iki alan da tek işlem zincirine dahil edilir. |
| Paralel işlemler | Öğrenci bilgileri, pasaport ve kabul kodu işlemlerinin bağımsız yürütülmesi | Toplam bekleme süresini azaltır; bir belgedeki hata diğer işlemi engellemez. |

## İlk teknik doğrulama aşaması

Kodlamaya başlamadan önce gerçek örneklerle şu üç nokta doğrulanmalıdır:

1. Kabul mektubu PDF’i metin tabanlı mı, taranmış görüntü mü?
2. Kabul mektubu kodu PDF metninde hangi biçimde bulunuyor?
3. Pasaport PDF’inde düzenlenme ve bitiş tarihleri metin olarak okunabiliyor mu?

Bu üç cevap, kabul kodu ve pasaport tarihleri için doğrudan PDF metin okuyucu mu, yoksa OCR destekli çözüm mü kullanılacağını belirleyecektir.
