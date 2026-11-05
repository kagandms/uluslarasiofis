# Staging başvuru iş akışı değişiklikleri

5 Kasım 2026 tarihli kullanıcı talebi. Hedef goc-staging.topkapiuni.workers.dev. Önceki tek girişle belge yükleme planı bu çalışmaya dahildir.

- Başvuru gönderimi doğrudan incelemede durumuna geçer. Dosya güvenlik taraması ve onay korumaları sürer.
- Yeniden istenen belgelerin tümü yeniden yüklenince başvuru incelemeye döner. Birden çok belge ve başarısız tarama durumları test edilir.
- Göç İdaresi filtre etiketi Göç İdaresine Gönderildi olur.
- Tamamlanan ve Terminal filtre seçenekleri kaldırılır. Geçmiş kayıtların kalıcı durum değerleri ve verileri korunur. Onaylandı ile tamamlandı farklı veri değerleridir, bu değişiklik verileri birleştirmez.
- Personel araması ITU takip kodunu destekler. Yazarken arama ve durum seçiminde otomatik filtreleme çalışır. Önceki isteğin geç gelen yanıtı yeni aramanın sonucunu ezemez.
- Önceki ve sonraki sayfa düğmeleri bordo olur. Sayfa değişimi mevcut kaydırma konumunu korur.
- Uygulama üç bağımsız kapsamda yürütülür. Öğrenci arayüzü, personel arayüzü ve sunucu iş akışı. Birleşik testler ve derleme sonrasında yalnızca staging dağıtımı yapılır.

Doğrulama kapsamı ilgili regresyon testleri, npm test, üretim derlemesi, staging kuru dağıtımı ve staging URL kontrolüdür. Gerçek öğrenci verisiyle yükleme kabul testi ayrıca açıkça raporlanır. Production dağıtımı sonraki kullanıcı değerlendirmesine bağlıdır.

## Uygulama ve doğrulama sonucu

- Kaynak tabanı güncel origin/production 77b94dc ile birleştirildi. İlgisiz ana çalışma kopyası değişikliklerine dokunulmadı.
- npm test sonucu 1376 başarılı, 0 başarısız, 1 atlanan test. Production derlemesi, production kuru dağıtımı ve staging kuru dağıtımı başarılı.
- Staging dağıtım sürümü 8059beeb-9eba-4d63-ad07-4d2472fd76a9. Kod revizyonu 6bcb20f.
- Canlı staging sorgulama ekranında takip kodu, öğrenci numarası ve açık salt durum seçimi tarayıcıda doğrulandı.
- Gerçek öğrenci dosyasıyla uçtan uca yükleme, canlı scanner ve oturumlu personel sayfalama kabul testi yapılmadı. Eski, tüm belgeleri temiz olan yeniden yükleme kayıtları için mevcut incelemeye alma işlemi kullanılabilir. Yeni otomatik dönüş son temiz tarama sonucunda gerçekleşir.
- Tamamlanan ve Terminal filtreleri kaldırıldı. Tamamlandı veri durumu ve geçmiş aşama işlemleri korundu. Production dağıtımı yapılmadı.
