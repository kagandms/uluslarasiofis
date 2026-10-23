# Çalışma Saatleri Özelliği Tasarımı

## Amaç ve kapsam

Yetkili panelinde beş sabit personelin günlük çalışma süresini kaydetmek ve geçmiş toplamlarını görüntülemek:

- Kağan Samet
- Asaf
- Eyüp
- Oğuz
- Eray

Mevcut ortak yetkili oturumu kullanılacaktır. Oturum açan yetkili, beş kişinin de kayıtlarını düzenleyebilir.

## Kullanıcı akışı

“Çalışma Saatleri” ekranı bugünün tarihini ve beş kişiyi tablo halinde gösterir. Her kişi için 0–24 saat aralığında, 0,5 saat adımlı bir seçim ve Kaydet düğmesi bulunur. 0–9 saat aralığı hızlı seçeneklerle sunulur. Kayıt yok durumu ile 0 saat kaydı ayrı gösterilir.

Hafta içi yalnızca bugünün kaydı oluşturulabilir veya güncellenebilir. Cumartesi ve pazar giriş/düzenleme kapalıdır; tatil açıklaması gösterilir. Geçmiş kayıtlar görüntülenebilir fakat düzenlenemez. Aylık görünüm kişi ve gün kayıtlarını, kişi başına aylık toplamı gösterir.

## Veri ve güvenlik kuralları

- Mevcut D1 veritabanında kişi ve tarih başına bir kayıt tutulur.
- Süre dakika olarak saklanır; yarım saat 30 dakikadır.
- Boş kayıt ile 0 dakika açıkça ayrılır.
- Personel listesi sunucuda sabittir; listede olmayan kişi reddedilir.
- Kayıt işlemi mevcut ortak yetkili oturumunu gerektirir.
- Sunucu güncel tarihi Türkiye saatine göre belirler; istemcinin gönderdiği tarih yetkili kabul edilmez.
- Sunucu geçmiş/gelecek tarihleri, hafta sonunu, 0–24 saat dışındaki değerleri ve yarım saat adımına uymayan değerleri reddeder.
- D1 kişi+tarih tekilliği aynı güne yapılan yeni kaydın güncellenmesini sağlar.
- Gece yarısından önce açılmış bir sayfa, gün değiştikten sonra eski gün için kayıt yapamaz.

## Hata davranışı

Başarılı kayıtta ilgili satır yeni değer ve kayıt durumuyla güncellenir. Hata halinde seçilen değer korunur, anlaşılır mesaj gösterilir ve yeniden deneme mümkündür. Gün değişmişse kullanıcıdan bugünkü ekranı yenilemesi istenir. Hafta sonu engeli arayüzde ve sunucuda uygulanır.

## İlk sürüm dışında

Resmî tatil takvimi, Excel dışa aktarımı ve geçmiş kayıt düzeltme yetkisi ilk sürümde yoktur.

## Karar kaydı

| Karar | Seçim | Gerekçe |
|---|---|---|
| Erişim | Mevcut ortak yetkili girişi | Beş sabit kişi için ayrı hesap gerektirmeyen mevcut oturum akışı |
| Ekran | Beş kişinin birlikte göründüğü tablo | Günlük durumu tek ekranda görme ve hızlı giriş |
| Süre | 0–24 saat, 30 dakika adım | Kullanıcının belirttiği aralık ve yarım saat hassasiyeti |
| Düzenleme | Yalnızca Türkiye saatine göre bugünkü hafta içi kaydı | Geçmiş kayıtların değişmesini ve tatil günlerinde işlem yapılmasını önleme |
| Geçmiş | Görüntüleme ve aylık toplam | Kayıtları inceleme ihtiyacını karşılayıp düzeltmeyi kapsam dışında tutma |

## Uygulama ve doğrulama planı

1. D1 şeması/migration, repository ve yetkili API uçlarını mevcut backend düzenine ekle.
2. API'de oturum, sabit kişi listesi, Türkiye tarihi, hafta sonu, saat aralığı ve adım kurallarını uygula.
3. Yetkili paneline tablo, hızlı saat seçimi, kaydetme durumu ve salt okunur aylık geçmiş görünümünü ekle.
4. Kayıt sınırları, sıfır/boş ayrımı, güncelleme, geçmiş tarih reddi, hafta sonu reddi ve aylık toplam için test yaz.
5. Proje talimatındaki `npm test`, `npm run build:production` ve `npm run deploy:dry-run:production` kontrollerini çalıştır.

Canlıya dağıtım bu planın kapsamında değildir; ayrı kullanıcı talimatı gerektirir.
