# PDF birleştirici belge galerisi

## Onaylanan karar

Küçük önizleme, tıklayınca büyük önizleme ve sürükle-bırak sıralama eklendi. Mevcut yukarı/aşağı ve silme kontrolleri korundu. Dosyaya ait kısa ad taşıma sırasında sabit kalır; PDF sırası ayrı numara ile gösterilir. “Sıraya taşı” girdisi bu ilk kapsamda yoktur.

## Performans ve gizlilik

- Önizleme için mevcut yerel File nesneleri kullanılır; ek belge/D1/R2 API isteği yapılmaz.
- PDF önizlemesi ilk sayfayı gösterir; mevcut PDF.js çalışma zamanı gerekirse bir kez yüklenir.
- Görünür kartların küçük önizlemeleri sırayla üretilir. Decode edilmiş bitmap ve PDF yükleme görevi temizlenir.
- Kartlar ve önizlemeler sıralamada yeniden kullanılabilir; liste kaydırma konumu korunur.
- Dosya kaldırıldığında ve modal kapandığında oluşturulan blob URL'leri serbest bırakılır.
- Önizleme hatası belgenin silinmesine veya PDF kaydının değişmesine yol açmaz.
- Sıralama değişirse eski oluşturulmuş PDF sonucu geçersizleşir; yeniden oluşturma gerekir.
- PDF oluşturma/kaydetme sürerken sürükleme ve belge ekleme/silme engelleri korunur.
- Başlangıçtaki mevcut PDF varsayılan olarak ilk sırada korunur. Belge baytları ve aktarım doğrulama işaretleri değiştirilmez.

## Doğrulama — 14 Ekim 2026

- Tam test paketi: 963 başarılı, 1 atlanan, 0 hata.
- Yerel tarayıcı: fotoğraf ve PDF küçük önizleme, büyük fotoğraf önizleme, kapatma/fokus, gerçek fare olaylarıyla sürükle-bırak, yukarı/aşağı sıralama.
- Dar ekran: 390 px genişlikte tek sütun, document scrollWidth 390 px; yatay taşma yok.
- Birleştirme: 5 sentetik fotoğraf ve mevcut tek sayfalık PDF ile çıktı 6 sayfa. Fotoğraf başa taşındığında A4 fotoğraf sayfası birinci, orijinal 420 pt genişliğindeki PDF sayfası ikinci. Dosya başlığı %PDF-.
- Sentetik örnek %40 sıkıştırma hedefine ulaşmadığında kaydetme engeli korundu; başarısız hedef hazır/kaydedilebilir gibi gösterilmedi.
- Production build ve deploy dry-run tamamlandı. Bu özellik için canlı deploy yapılmadı; gerçek kullanıcı/telefon testi yeni galeri için henüz yapılmadı.
