# Agent v7 orientation düzeltmesi — 8 Ekim 2026

## Sonuç

Yerel orientation hatası düzeltildi ve Windows Agent v7 ZIP'i oluşturuldu. settings_protocol **3** korunuyor. Bu görevde Worker deploy, migration, fiziksel baskı veya Agent başlatma yapılmadı. Scanner/ClamAV kaynakları ve çalışan süreçleri değiştirilmedi; staging kullanılmadı.

Kullanıcı fiziksel Test A/B PDF'sinin MacBook'ta bulunmadığını teyit etti. Bu nedenle aynı sentetik portrait PDF üzerinde iki yön doğrulandı; fiziksel Kyocera Test B'nin başarılı olduğu iddia edilmez.

## Kök neden

v6 `normalize_pdf` kaynak ve hedef en-boy yönlerini karşılaştırıp farklıysa `rotate=90` uyguluyordu. `image_to_pdf` aynı durumda görüntüyü `ROTATE_90` ile döndürüyordu. Böylece landscape seçimi kağıt/GDI yönünü değiştirmeye ek olarak kaynak metin ve okları da döndürüyordu. Eski testler sayfa geometrisini doğrularken PDF'de ters düşey işaret sırasını kabul ediyor; JPG için döndürülmüş içeriğin en-boy oranını bekliyordu.

Yeni raster testleri eski kodda 12 alt senaryoda başarısız oldu. Boyuta bağlı rotasyon kaldırıldıktan sonra aynı koşullar geçti. Bu, normalizasyon katmanındaki gereksiz rotasyonu doğrudan doğrular. Kyocera sürücüsüyle iki dönüşümün fiziksel çıktıdaki etkileşimi makul bir açıklamadır; bu görevde fiziksel ölçüm yapılmadığından donanım kök nedeninin tamamı doğrulanmış sayılmaz.

## Değişen kod

- `scripts/print_agent/print_agent.py`: yalnız image_to_pdf ve normalize_pdf değişti. Hedef kağıdın portrait/landscape boyutları korunuyor; içerik oranını koruyan ölçekle hedef sayfaya ortalanıyor. Kaynağın en-boy oranına bağlı 90° rotasyon kaldırıldı.
- PDF'nin kendi /Rotate metadata'sı ayrı ele alınır. PyMuPDF'nin show_pdf_page yerleştirmesi kaynak dikdörtgenini hesaplamak için unrotated koordinatları kullandığından, yerel açık source page metadata'sı işlem süresince 0 yapılıp mevcut kaynak yönü placement matrix'e bir kez uygulanır. finally içinde metadata geri yüklenir; kaynak dosya kaydedilmez ve byte eşitliği test edilir. Bu işlem PDF metin/çizim içerik akışını yeniden düzenlemez. Varsayılan /Rotate=0 kaynakta ek rotasyon yoktur.
- JPEG/PNG'de EXIF display yönü korunur; kağıt yönüyle ikinci dönüşüm yapılmaz.
- `test_print_agent.py`: eski yanlış yön beklentileri düzeltildi; dokuz raster/metaveri testi eklendi. Asimetrik F, yatay yazı, yukarı ok, kenar çerçevesi ve farklı köşe işaretleri gerçek raster üstünden bağımsız, döndürülmeyen kaynak referansıyla karşılaştırılır. Raster kenar sınırları merkezleme, tam görünürlük ve orantılı ölçeği de doğrular.
- `README.md`: yön sözleşmesi ve v7 paket/test kullanımı güncellendi.
- `.env.example`: staging örneği kaldırılıp production placeholder ve mevcut secret için names-only şablon kullanıldı. Gerçek credential içermez; otomatik yüklenmez.

A4/A3 boyut sabitleri, settings_protocol=3, GDI DEVMODE, grayscale, copies, duplex, sayfa/baskı bütçesi, submission_started ve duplicate-print korumalarının bulunduğu diğer runtime kodları v6 ile byte eşdeğeridir. Worker/public/staff/scanner kaynaklarında bu görev için değişiklik yok.

## Aynı portrait PDF ile A/B kanıtı

Kaynak: `same-portrait-source.pdf` (sentetik), SHA-256:

`bbb32becd02165be13ef8f62075741ed5999a46cdb1c4495c7c40c30177b4d0d`

| Çıktı | Boyut | Metin doğrultusu | Raster / yerleşim |
| --- | --- | --- | --- |
| A — a4-portrait.pdf | 595.276 × 841.890 pt | (1, 0), yatay/upright | Tam çerçeve ve köşeler görünür; ok yukarı. |
| B — a4-landscape.pdf | 841.890 × 595.276 pt | (1, 0), yatay/upright | Portrait içerik landscape sayfaya orantılı küçülüp ortalanır; ok yukarı, çerçeve/köşeler tam. |

İki çıktı aynı kaynak byte'larından üretilmiştir. Target PDF rotation=0; hedef kağıt yönü genişlik/yükseklikle temsil edilir. comparison.png, ayrı PNG'ler ve proof.json pakette bulunur. Dikey kaynak yatay kağıdı tamamen doldurmak için döndürülmez; yanlarda beyaz boşluk kalması beklenen davranıştır.

## Test sonuçları

- RED: eski kodla 6 yeni raster testi, toplam 12 başarısız alt senaryo. red.log.
- GREEN: orientation raster matrisi düzeltmeyle geçti; PDF/JPG/PNG × portrait/landscape kaynak × A4/A3 × iki hedef yön, ayrıca PDF /Rotate 90/180/270, CropBox ve JPEG EXIF dahil 34 alt senaryo.
- Tam Agent Python paketi: **45/45**. Aktif checkout ve ZIP'ten çıkarılmış pakette ayrı doğrulandı.
- Tam Node paketi: **669 test; 668 pass, 0 fail, 1 skip**. Skip mevcut opt-in gerçek ClamAV entegrasyon testi; bu görevde çalıştırılmadı.
- Mevcut scanner Python unit testleri: **14/14**; yalnız mock/unit regresyonu, gerçek scanner/ClamAV çalıştırılmadı.
- ZIP CRC testi ve iç dosyaların kaynakla SHA-256 eşitliği başarılı.
- Production salt okunur kontrol: PRINT_ENABLED=false; görülen Worker version `8de7bdca-990f-4977-83d5-a39975ad77c6`. Bu görev bu sürümü deploy etmedi.

## Windows paketi

Dosya: `print-agent-windows-v7.zip`, 51,296 byte.

SHA-256:

`f732c59ca6d04b49bfd450553e890d2359ad0efb5e47c8e04d6c5417103b6a9f`

Paket yalnız güncel Agent kaynaklarını, tam Python testlerini, pinned requirements, README, names-only config örneğini, AGENT_UPDATE.md, SHA256SUMS.txt ve sentetik A/B kanıtlarını içerir. Worker/config/migration/scanner dosyası veya gerçek credential bulunmaz. Eski v6 ZIP korunmuştur. Kaynak v6 arşiviyle karşılaştırılarak eşzamanlı dosya değişiklikleri dışlanmıştır; ana dirty repodaki diğer çalışmalar korunmuştur.

Windows'ta ZIP ayrı klasöre çıkarılıp paket içindeki testler çalıştırılabilir; Antigravity'nin mevcut yerel test dosyalarını düzenlemesi gerekmez. Agent başlatılması ve fiziksel Test B tekrarı kurum sahibinin ayrı iznine bağlıdır. Yerel test başarısı fiziksel baskı kabulü değildir; PRINT_ENABLED=false kalır.

## Referans

PyMuPDF [show_pdf_page](https://pymupdf.readthedocs.io/en/latest/page.html#Page.show_pdf_page) API'si kaynak sayfayı rasterize etmeden yerleştirir; keep_proportion ve placement rotation ayrı parametrelerdir. Kurulu PyMuPDF 1.27.2 implementasyonunun kaynak dikdörtgen/transform davranışı ayrıca incelendi.
