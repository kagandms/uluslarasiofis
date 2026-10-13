# Windows Agent v7 — orientation düzeltmesi

settings_protocol: **3** (v6 ile aynı). Worker deploy veya migration gerekmez. PRINT_ENABLED=false kalır. Bu paket Agent'ı başlatmaz ve baskı göndermez.

## Windows'a aktarım

1. ZIP SHA-256 değerini raporla karşılaştırın. ZIP'i ayrı bir klasöre açın; mevcut Windows test dosyalarını düzenlemeyin.
2. Mevcut pinned Python ortamını kullanın; requirements.txt bağımlılıklarını gerektiğinde aynı ortamda kurun.
3. ZIP kökünden aşağıdaki komutu çalıştırın:

```powershell
python -m unittest discover -s scripts\print_agent -p "test*.py"
```

45 Agent testi beklenir. Testler yazıcı erişimini mock eder; fiziksel baskı göndermez ve Agent'ı başlatmaz. Kaynak/normalizasyon ve raster doğrulamaları gerçek PyMuPDF/Pillow kullanır.

4. Yeni scripts/print_agent/print_agent.py ve ilişkili paket dosyalarını kullanın. Mevcut PRINTER_SECRET'ı ve yerel Windows ortam yapılandırmasını koruyun; .env.example yalnız doldurulacak isimlerin şablonudur ve otomatik yüklenmez. Placeholder URL yerine onaylı production origin ayarlanmalıdır.
5. Kurum sorumlusu ayrıca izin vermeden Agent'ı başlatmayın veya fiziksel Test B'yi tekrarlamayın. Public PRINT_ENABLED bayrağını bu paket için değiştirmeyin.

## A/B kanıtı

`docs/print-agent-orientation-v7/same-portrait-source.pdf` aynı sentetik kaynak dosyadır:

- a4-portrait.pdf: yaklaşık 595.276 × 841.890 pt.
- a4-landscape.pdf: yaklaşık 841.890 × 595.276 pt.

İki çıktıda yazı doğrultusu aynı ve ok yukarı yönlüdür. Landscape kağıtta portrait kaynak orantılı küçülür, yatayda ortalanır; kenar çerçevesi ve köşe işaretleri tam görünür. comparison.png ve proof.json buna ait yerel raster kanıtıdır. Kaynak SHA-256 iki çıktı için aynıdır.

Fiziksel Test A/B'de kullanılan gerçek PDF bu görevde verilmedi. Paketteki A/B kanıtı sentetik PDF ile üretildi; fiziksel Kyocera kabulü yerine geçmez.

## Değişiklik ve korumalar

PDF ve JPG/PNG için kağıt boyutlarından türetilen otomatik 90° içerik döndürmesi kaldırıldı. PDF'nin kendi /Rotate ve JPEG EXIF yönü kaynak görünümünü korumak için ayrı ele alınır. PDF içerik akışı yeniden düzenlenmez; hedef sayfaya vektörel Form XObject yerleştirme kullanılır. Kaynak dosya değiştirilmez.

GDI DEVMODE, grayscale, A4/A3, 50 kopya ve 200 toplam baskı bütçesi, duplex, submission_started ve belirsiz sonuçta otomatik tekrar baskıyı engelleyen kod değişmedi. Fiziksel driver davranışı ayrıca UAT gerektirir.
