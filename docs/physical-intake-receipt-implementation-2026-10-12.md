# Fiziksel teslim ve bilgilendirme A4 — yerel uygulama raporu

Tarih: 12 Ekim 2026. Dal: `production`. Başlangıç ve kapanış HEAD: `1ce8f65d3e54032f252b36b4c6b7be8d539b81c9`.

## Uygulanan davranış

- PDF olmadan öğrenci bilgileriyle fiziksel teslim kaydı; sunucu Türkiye tarihi, açık ilk/uzatma seçimi ve süreli `ITU-YY-XXXXXXX` tahsisi.
- Atomik ve tekrar çağrılabilir kayıt, tüm kayıt yollarında aktif mükerrerlik koruması, gerekçeli kapatma ve yetkili yeniden açma.
- Değişmez bilgi snapshot'undan tek sayfa A4; iki logo, Türkçe/İngilizce/Rusça/Türkmence/Arapça açıklama ve yerel fontlar. Metadata değişimi ve 30 günlük artefact süresi ayrı izlenir.
- Özel R2 saklama, gerçek PDF/A4 doğrulaması, kesinti sonrası devam, süreli indirme koruması ve sınırlı temizlik.
- Mevcut Print Agent üzerinden personel baskısı; aynı denemenin devamı, kalıcı belirsiz sonuç koruması ve açık risk onaylı yeniden baskı.
- `/basvurum/` üzerinde ilk görünür takip kodu alanı; mevcut online sorgulama korunur. Fiziksel sorgu kişisel bilgi veya belge döndürmez; istek boyutu ve hız sınırları uygulanır.
- Kapak oluşturma ve yazdırma yollarında logo yükleme/decode tamamlanmadan çıktı alınması engellenir. Fiziksel form/PDF/QR kaynakları ekran geçişinde temizlenir.

Migration: `migrations/0020_physical_intake_receipts.sql`. Mevcut fiziksel kayıt modelini eklemeli genişletir; eski kayıtlara toplu takip kodu atamaz.

## Doğrulama

| Kontrol | Sonuç |
| --- | --- |
| Çalışma alanında `npm test` | 886 test; 885 başarılı, 0 başarısız, 1 atlandı |
| Git arşivinden temiz geçici kopya, `npm ci` ve `npm test` | Aynı sonuç: 885 başarılı, 0 başarısız, 1 atlandı |
| `npm run build:production` | Başarılı; büyük bundle ve mevcut OCR import uyarıları sürüyor |
| `npm run deploy:dry-run:production` | Başarılı; gerçek deploy yapılmadı |
| `git diff --check` | Başarılı |
| Native Miniflare D1/R2 | Atomik kayıt/replay, koşullu artefact yazımı, kuyruk ve silinen işin belirsiz sonucunu koruma doğrulandı |
| Yerel sentetik SQLite backup/restore ve migration | Restore üzerinde migration ve integrity kontrolü başarılı; üretim DB yedeği değildir |
| 10 bağımsız personel oturumu, 100 sentetik kayıt | Benzersiz takip numaraları doğrulandı; gerçek kullanıcı yük testi değildir |
| Chrome ve gerçek PDF raster kontrolü | Normal/uzun alanlar tek A4, iki logo görünür, beş dil ve Arapça RTL doğrulandı |
| Kapak yazdırma | `window.print` stub ile logoların hazır olduğu ve düğmenin geri açıldığı doğrulandı; fiziksel baskı yapılmadı |

Görsel doğrulama scripti: `scripts/verify-physical-receipt-render.mjs`. Playwright ve Poppler gerektirir. Kapak PDF kanıtı renderer eşdeğerini kullanır; gerçek indirme düğmesi ve yazıcı UAT'si yerine geçmez.

Sentetik kanıtlar:

- [Normal A4 PDF](physical-receipt-local-evidence/receipt-normal-synthetic.pdf)
- [Uzun alanlı A4 PDF](physical-receipt-local-evidence/receipt-long-synthetic.pdf)
- [Normal PDF raster](physical-receipt-local-evidence/receipt-normal-pdf-render.png)
- [Uzun alanlı PDF raster](physical-receipt-local-evidence/receipt-long-pdf-render.png)
- [Kapak PDF raster](physical-receipt-local-evidence/cover-pdf-render.png)
- [Makine tarafından okunabilir görsel sonuçlar](physical-receipt-local-evidence/render-results.json)

## Canlıya geçiş sınırı

Yeni oluşturma kapısı kaynakta `PHYSICAL_RECEIPTS_CREATE_ENABLED=false`: planın C uyumluluk aşaması için hazırdır. `PRINT_ENABLED=true` ve `PHYSICAL_INTAKE_MODE=on` korunmuştur. Public portal origin'i mevcut üretim adresiyle yapılandırılmıştır.

Canlı migration, deploy, feature açma, commit ve push yapılmadı. Üretim D1/R2 verileri, secret değerleri, cron, scanner ve Windows Print Agent v7 değiştirilmedi. Başlangıçtaki scanner betik değişiklikleri ve mevcut yerel teslim dosyaları korundu.

Planın üretim adımları ayrıca yürütülmelidir: üretim yedeği/restore kanıtı, eklemeli migration, C sürümü ve kontrolleri, ardından açık istekle F kapısının açılması. Bu nedenle aktif Worker sürüm kimlikleri ve canlı migration kanıtı bu raporda yoktur.

Oturum açılmış canlı personel/öğrenci UAT'si, telefon/kamera/QR tarayıcı akışı, Windows Agent ve gerçek tek yaprak A4 baskısı henüz doğrulanmadı. Yerel test ve görsel kanıtlar bu kontrollerin yerine geçmez.
