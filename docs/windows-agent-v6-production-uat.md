# Windows Agent v6 — kontrollü production UAT planı

Durum: BEKLİYOR. Agent başlatılmadı, production'a bağlanmadı, fiziksel baskı gönderilmedi.
Production Worker `goc` sunucu gate'i `PRINT_ENABLED=false` kalır.

## 1. İzin ve hazırlık

- Kurum sorumlusu fiziksel test, kağıt tüketimi ve Windows Agent'ın foreground başlatılması için izin verir.
- Mevcut v6 paketi, `settings_protocol=3`, Python/Windows sürümü, PyMuPDF/Pillow/pywin32 ve yazıcı sürücüsü sürümleri kaydedilir.
- `PRINT_AGENT_BASE_URL` production origin `https://goc.topkapiuni.workers.dev` olmalıdır; `/yazdir/` yolu dahil edilmez.
- Mevcut `PRINTER_SECRET` onaylı yerel gizli depodan alınır; konuşmaya, loga veya repoya yazılmaz. Anahtar değişmez.
- Tek runner ve doğru Windows yazıcı kuyruğu seçilir. Diğer Agent süreçleri durdurulmadan veya çakışma olmadığı doğrulanmadan yeni runner başlatılmaz.
- Print kuyruğu boş, print gate kapalı ve scanner heartbeat ready olmalıdır.

## 2. Gate kapalı bağlantı kontrolü

İzin sonrasında Agent yalnız foreground başlatılır. Worker heartbeat/reconcile/result uçlarını yetkili Agent'a açık tutar; claim/content/validation-result/submission-started kapalıdır. Bu aşamada job basılamaz. D1'da taze, ready, protocol-3 heartbeat doğrulanır. Gate kapalı public status yine available:false kalmalıdır.

## 3. Öğrenci yazdırmasını açmadan fiziksel test

API üzerinden print başlatmak kapalı gate ile mümkün değildir. Fiziksel yön/kopya testleri için önce, kurum sorumlusu gözetiminde production API'ye iş göndermeyen yerel sentetik driver testi yapılmalıdır. Test, v6'nın gerçek `validate_document`, job-scoped DEVMODE ve GDI spool fonksiyonlarını kullanmalıdır. Mevcut unittest'ler Windows sürücüsünü mock eder; fiziksel UAT yerine geçmez. Yerel test harness'inin çalıştırılması ayrıca yetkilendirilmelidir; bu görevde harness çalıştırılmadı.

Sentetik PDF/JPG/PNG üzerinde:

| Test | Kabul ölçütü |
| --- | --- |
| A4 portrait ve landscape; PDF/JPG/PNG | Fiziksel yön doğru, içerik kırpılmıyor, ölçek/oran korunuyor. |
| Bir sayfa, 1 ve 3 kopya | Çıktı sayısı ve Windows spool job sayısı beklenenle aynı. |
| Bir sayfa, 50 kopya | Yalnız kağıt tüketimi onaylanırsa: tam 50 çıktı, tek spool job. |
| 20 sayfa × 10 kopya sınırı | 200 baskı bütçesi doğrulaması geçer; 200 sayfayı fiziksel basmak şart değildir. |
| 20 sayfa × 11; 51 kopya; değiştirilmiş ayarlar | Spool öncesi reddedilir; fiziksel çıktı oluşmaz. |
| Monochrome ve mevcut Kyocera sürücüsü | Sentetik renkli kaynak grayscale olur; cihazın toner/sayaç sınıflandırması ayrıca gözlenir. |
| Driver yönü reddeder / printer offline | Yazdırma başlamaz; anlaşılır hata oluşur. |
| submission_started sonrası belirsiz sonuç | unknown durumu; otomatik tekrar baskı yok. |

A3/color/duplex bayrakları false kalır. İzin verilmemiş yetenekler açılmaz. Queue defaults değiştirilmez. Fiziksel test için gerçek öğrenci belgesi kullanılmaz.

## 4. Fiziksel kabul ve production uçtan uca test

Kurum sorumlusu tarih, Windows/driver sürümü, dosya tipi, yön, istenen/gerçek kopya ve sonuçları onaylar. Bu kabulden önce public PRINT_ENABLED=true yapılamaz.

Fiziksel yön/kopya kabulünden sonra ayrıca açık production etkinleştirme izni alınır. Gözetimli sentetik upload → finalize → claim → validation → submission → result → retention cleanup akışı test edilir. Windows kimlik bilgileri gösterilmez; kuyruk ve R2 artıkları doğrulanır. Herhangi bir başarısızlıkta gate false yapılır ve kontrollü Agent durdurulur; belirsiz baskı tekrar gönderilmez.

## 5. Staging silme kapısı

Production doğrulaması + başarılı fiziksel UAT + staging'deki gerekli değişikliklerin korunduğu kanıtı + bağımsız kaynak envanteri tamamlandıktan sonra silinecek her kaynak tekrar raporlanır. Son silme onayı alınmadan branch/D1/R2/Worker veya staging çalışma klasörleri kaldırılmaz.
