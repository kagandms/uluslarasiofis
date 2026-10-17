# Fiziksel durum ve YKN düzeltmeleri — yerel uygulama

17 Ekim 2026. Kullanıcının inceleme raporunu kontrol ederek uygulamaya başlama talimatıyla, mevcut `production` dalında hazırlandı. Başlangıç HEAD: `813cecbbf51f5c6dd0ccefe1df40cdcc4b81262b`. Commit, push, canlı migration veya deploy yapılmadı.

## Uygulanan değişiklikler

- Fiziksel kayıtta “Onaylandı” düğmesi görünür. Mevcut personel durumları dijital dosya olmadan seçilebilir; mevcut durum seçili olarak gösterilir.
- Personel/API durum geçişlerinden PDF şartı çıkarıldı. Silinmiş ve işlemi kapatılmış kayıt korumaları, sürüm çakışmaları ve ret gerekçesi korunur.
- ITU takip kodu sorgusu saklanan personel durumunu gösterir. PDF varlığı durum üretmez. “Reddedildi” beş dilde gösterilir; ret gerekçesi güvenli düz metin olarak kalır.
- Portal, ayrı eklenti kırpması ve fotoğrafsız aktarım aynı doğrulanmış doldurma işlemine bağlıdır.
- MAIN katmanda alan yazımı ve fotoğraf ataması ayrıdır. Alan güncellemeleri sakinleşip doğrulandıktan sonra fotoğraf başlatılır; fotoğraf sonrasında alanlar yeniden doğrulanır. Gerekirse tek eksik alan tamamlama turu ve son doğrulama yapılır.
- Alan doğrulaması yanıt vermezse veya güncelleme bitmezse rakip fotoğraf/fallback işlemi başlatılmaz. Kısmi aktarımda eksikler raporlanır ve geçici veri korunur.
- Fotoğraf eski geçici öğrenci verisinden otomatik ödünç alınmaz. Aktarım için doğrulanmış hedef sekme ve taze arama bağı gerekir.
- Seri öğrenci geçişindeki Temizle komutunun tek sahibi MAIN katmandır. İlgili ZK yanıtı ve boşalan işlem kuyruğu beklenir. Aynı requestId ikinci reset üretemez.
- Eski öğrenci alanlarını yalnızca DOM’da boşaltarak sunucu sıfırlanmış gibi gösteren yol kaldırıldı.
- Sonuç penceresini kapatma aynı düğmeye iki kez tıklamaz. Eski kabul aramasının tekrar teslimi sonraki öğrencinin saklanan verisini değiştirmez.
- Mevcut kabul kodu okuma, OCR, YKN ekranını yeniden kullanma ve son manuel kaydetme davranışı korundu. Tekrarlanan komutlar azaltıldı; canlı hız artışı ölçülmedi.

## Gerekli migration

`migrations/0024_physical_status_without_pdf.sql` yalnızca `physical_migration_pdf_guard` trigger’ını kaldırır. Önceki migration dosyaları değiştirilmedi. Kolon, tablo, öğrenci kaydı veya PDF nesnesi değiştirmez.

İlk raporda bu veritabanı trigger’ı atlanmıştı; API regresyon testi ortaya çıkardı ve rapor düzeltildi. Migration’ın satırları ve kalan şema nesnelerini koruduğu, ret gerekçesi ve tamamlanan kayıt metadata korumasının çalıştığı yerelde test edildi.

İleride canlıya alma istendiğinde uygulama kodundan önce bu migration uygulanmalıdır. Bu çalışmada yalnızca test veritabanlarına uygulandı.

## Doğrulama

- `npm test`: **1.057 geçti, 0 başarısız, 1 atlandı**; toplam 1.058 test.
- `npm run build:production`: başarılı.
- `npm run deploy:dry-run:production`: başarılı; yalnızca dry-run çalıştı.
- `git diff --check`: başarılı.
- Yerel eklenti: **1.2.99**, fingerprint **b8f252f95281**. ZIP SHA-256: `6f79e2de49ea05e7a2a5a381a7c1df5fd659a76386be816910e8af3ab183901d`; `latest` ZIP ile aynı. Paketleme adımıyla üretildi; canlı indirme/kurulu eklenti güncellenmedi.

Çift reset ve çift pencere kapatma önce hata veren testlerle tekrar üretildi. Testler ayrıca PDF’siz bütün durumların kodla sorgulanmasını, gerçek MAIN fonksiyonunda ayrı alan/fotoğraf fazlarını, fotoğraf sonrası eksik alanları, doğrulama hatasını, bağsız aktarımın reddini ve eski arama tekrarını kapsıyor.

## Canlı doğrulama sınırı

Gerçek Apply/YÖKSİS hesabında en az 10 ardışık öğrenciyle aynı sekmede deneme henüz yapılmadı. `photoUploaded` mevcut entegrasyonda dosya girdisine atama kanıtıdır; YÖKSİS sunucusunun fotoğrafı kabul ettiğini bağımsız olarak kanıtlamaz. Gerçek fotoğraf kabulü ve alanların son kayıtta korunması UAT sırasında kontrol edilmeli.

Build mevcut OCR dynamic-import ve büyük chunk uyarılarını veriyor. Dry-run yerel print secret değerlerinin ortamda bulunmadığına dair uyarı verebilir; secret değerleri okunmadı, değiştirilmedi veya rapora yazılmadı.

Wrangler ayarları, D1/R2 verileri, secret/binding yapılandırması, cron, scanner, Windows Print Agent v7, `PRINT_ENABLED` ve `PHYSICAL_INTAKE_MODE` değiştirilmedi. Tarihî worktree ve paketler korundu.
