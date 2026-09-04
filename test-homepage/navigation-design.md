# Local ana ekran navigasyonu

## Karar

`test-homepage` için tek sayfalı görünüm yönetimi kullanılacak. İlk açılışta yalnızca merkezde üç işlem kartı gösterilecek: YKN, Kapak Hazırla ve Tebliğ Bul.

Bir işlem seçildiğinde ilgili çalışma alanı açılacak. Çalışma alanının üstünde hızlı geçiş için üç sekmeli navigasyon ve ana menüye dönüş düğmesi bulunacak.

## Görünüm eşleşmeleri

- `ykn`: Apply Topkapı öğrenci araması ve YKN sonuç akışı.
- `cover`: İkamet dosyası kapağı hazırlama, OCR/form adımları ve geçmiş işlemler.
- `teblig`: e-Tablo tebliğ arama kutusu ve sonuçları.

## Kapsam

Bu değişiklik yalnızca local prototip dosyaları olan `test-homepage/live-copy.html`, `test-homepage/live-copy.css` ve `test-homepage/app.js` kapsamındadır. Production giriş dosyalarına dokunulmaz.
