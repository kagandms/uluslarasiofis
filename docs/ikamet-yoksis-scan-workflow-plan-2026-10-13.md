# İkamet Evraklarını Tarama ve YÖKSİS'e Yükleme Akışı

Tarih: 13 Ekim 2026  
Durum: Tasarım kullanıcı tarafından onaylandı; uygulama başlamadı.

## Amaç

Öğrenci başına tarama, e-posta eki indirme, YÖKSİS'te kayıt bulma, telefon yazma ve PDF yükleme süresini azaltmak. Öğrenci evraklarını yanlış kayıtla eşleştirmemek ve personelin son kontrolünü korumak.

## Anlaşılan mevcut akış

1. Her öğrencinin evrakı birlikte, diğer öğrencilerden ayrı taranıyor.
2. Tarama TASKalfa MZ3501ci'nin üst besleyicisinden yapılıyor ve PDF e-postaya geliyor.
3. PDF'nin 1. sayfasında başvuru/kayıt numarası, 2. sayfasında telefon numarası var.
4. Personel numarayla YÖKSİS kaydını arıyor, telefonu kaydediyor ve aynı öğrenciye PDF yüklüyor.
5. Entegrasyondan beklenen, yazıcı başındaki beklemeyi ve e-posta/YÖKSİS'teki tekrarlı işleri azaltmak.

## Onaylanan tasarım

Yazıcıdan alım ve YÖKSİS otomasyonu birbirinden ayrı iki katman olarak tasarlanır:

- **Tarama katmanı:** TASKalfa MZ3501ci PDF'yi e-posta yerine ofis ağında erişimi sınırlı bir SMB klasörüne kaydeder. İlk sürümde her öğrenci ayrı PDF olarak tutulur.
- **YÖKSİS katmanı:** Chrome'da çalışan, YKN eklentisinden ayrı bir yardımcı araç personelin seçtiği PDF'yi yerel olarak işler. 1. sayfadan başvuru numarasını, 2. sayfadan telefonu çıkarır ve öğrenci kaydıyla PDF ilişkisini aynı işlemde tutar.

Kyocera ürün sayfası bu modelde ağ klasörüne taramayı listeliyor. Aranabilir PDF/OCR seçenek olarak gösteriliyor; kurulu cihazda etkin olup olmadığı kontrol edilmelidir. Belirli belge besleyici seçeneklerine göre üretici föyünde 320 sayfaya kadar ADF kapasitesi ve 300 dpi'de 200 görüntü/dakika belirtiliyor; mevcut besleyici modeli doğrulanmadan bu performans varsayılmamalıdır. Kaynaklar: [Kyocera ürün özellikleri](https://www.kyoceradocumentsolutions.us/en/products/mfp/TASKALFAMZ3501CI.html), [Kyocera teknik föyü](https://www.kyoceradocumentsolutions.be/content/dam/download-center-cf/be/documents/datasheet/TASKalfa_MZ3501ci_DS__EN__pdf.download.pdf).

## Uygulama sonrası günlük personel akışı

1. Personel bir öğrencinin tüm evrakını ADF'ye koyup yazıcıdaki **İkamet Gelen** tarama hedefini seçer.
2. Yazıcı PDF'yi kısıtlı ofis klasörüne bırakır; e-posta eki indirme adımı ortadan kalkar.
3. Personel YÖKSİS'te oturum açar ve ayrı Chrome yardımcısında bu PDF'yi seçer.
4. Yardımcı PDF'nin ilk iki sayfasındaki numara ve telefonu çıkarır, değerleri ve ilk sayfa önizlemesini gösterir. Personel değerleri onaylar veya düzeltir.
5. Yardımcı başvuru numarasıyla YÖKSİS'te arama yapar. Sonuçtaki kayıt numarası beklenen değerle uyuşmazsa işlem durur.
6. Eşleşme doğrulanınca yardımcı telefon alanını doldurur ve o işlemde seçilen PDF'yi ilgili belge alanına yükler.
7. Personel öğrenci/kayıt eşleşmesini ve yüklenen belgeyi kontrol eder, YÖKSİS'teki son kaydetme işlemini kendisi yapar.
8. Personel sonucu doğruladıktan sonra kuyruk öğesini tamamlandı olarak işaretler.

## Hata ve güvenlik davranışı

- PDF metin katmanı varsa önce metin çıkarımı; taranmış sayfalarda gerekiyorsa cihazda/Chrome'da çalışan yerel OCR kullanılır.
- Okunamayan, biçimi beklenmeyen veya birden fazla aday veren değer tahmin edilmez. Personel düzeltmeden YÖKSİS'e aktarılmaz.
- YÖKSİS araması kesin eşleşme vermezse, sayfa/form hazır değilse veya upload alanında dosyanın seçildiği doğrulanamıyorsa işlem durur.
- Otomatik YÖKSİS kaydetme/gönderme yoktur; son onay personeldedir.
- Eklenti YÖKSİS'e özel çalışır; Apply/YKN akışına bağlanmaz. Şifre veya oturum bilgisi okunmaz ve saklanmaz.
- Öğrenci belgesi harici OCR servisine gönderilmez. PDF değerleri ve belge içeriği loglanmaz.
- SMB klasörüne yalnızca yetkili ofis personeli erişir. PDF'lerin saklama süresi belirlenene kadar otomatik silme yapılmaz.

## Aşamalar

### Aşama 0 — cihaz ve ağ uygunluğu

- Yazıcıda SMB hedefi, klasör erişimi, mevcut ADF modeli ve aranabilir PDF/OCR seçeneği doğrulanır.
- Yetkisiz kullanıcıların klasöre erişemediği kontrol edilir.
- Gerçek öğrenci verisi kullanmadan örnek PDF ile yazıcıdan klasöre tarama denenir.

### Aşama 1 — tek öğrenci dosyası

- Ayrı Chrome yardımcısı için YÖKSİS alanları ve numara araması incelenir.
- 1. ve 2. sayfadan yerel numara/telefon çıkarımı, önizleme ve personel düzeltmesi yapılır.
- Tek öğrenci için arama, telefon alanı doldurma, doğru PDF'yi upload alanına koyma ve manuel son kayıt desteklenir.

### Aşama 2 — kontrollü seri kullanım

- Birden çok ayrı PDF kuyrukta sıralı işlenir; her öğrenci tamamlanmadan sonraki öğrenciye geçilmez.
- Gerçek YÖKSİS hesabında personel UAT'si yapılır; alan, numara ve yüklenen PDF her öğrenci için kontrol edilir.

### Aşama 3 — toplu tarama, ayrı karar

- Tek taramada birden fazla öğrenci evrakı alıp ilk sayfalardaki numaralara göre otomatik bölme ancak tekli akış güvenilir çalıştıktan sonra tasarlanır.
- Bölme belirsizse sistem personel onayı ister; otomatik öğrenci eşleştirmesi yapmaz.

## Açık uygulama öncesi kararlar

- Mevcut ADF'nin kesin model/kapasitesi ve OCR seçeneğinin etkinliği.
- SMB klasörünün ev sahibi bilgisayarı, yetki grubu ve yedekleme politikası.
- YÖKSİS'te dosya yüklemesi sonrası gösterilen başarı teyidi ve alanların gerçek tarayıcı DOM'u.
- Yüklenen/saklanan PDF'ler için kurumun saklama ve silme süresi.

Bu maddeler tasarımın onaylanan kapsamını değiştirmez; uygulamadan önce doğrulanması gereken işletim ayrıntılarıdır.

## Karar günlüğü

| Karar | Tercih | Gerekçe |
|---|---|---|
| Tarama hedefi | E-posta yerine kısıtlı ofis SMB klasörü | Ek indirme adımını kaldırır; model ağ klasörüne taramayı destekler. |
| PDF kapsamı | İlk sürümde öğrenci başına ayrı PDF | Yanlış öğrenciye yükleme ve otomatik bölme riskini azaltır. |
| Numara kaynakları | 1. sayfa başvuru numarası, 2. sayfa telefon | Kullanıcı tarafından doğrulandı; her dosyada konum sabit. |
| YÖKSİS aracı | Chrome'da, YKN eklentisinden ayrı | İki iş akışının farklı olduğu kullanıcı tarafından belirtildi. |
| OCR ve veri işleme | Yerel metin çıkarımı/OCR, harici servise belge gönderme yok | Öğrenci belgelerinin gizliliğini korur. |
| Son kayıt | Personel tarafından manuel | Yanlış kayıt/telefon/belge ilişkisinde son kontrol sağlar. |
| Çoklu öğrenci taraması | İlk sürüm dışında | Otomatik ayırma ve eşleştirme tek öğrenci akışı doğrulandıktan sonra ele alınır. |
