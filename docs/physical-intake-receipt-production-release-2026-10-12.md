# Fiziksel ikamet A4 — üretim yayın raporu

Tarih: 12 Ekim 2026. Üretim hedefi: goc. Yeni kayıt kapısı açık.

- Production commit: 4e54e56cba0ff27a20bfb3e4b76db5a55267bdc6 (normal fast-forward push).
- Deployment: f410ceaf-4e79-4485-88bf-440ef482275f.
- Worker version: d5f725ea-29db-4c77-9dbc-8d0789854a2e; trafik %100.
- Migration: 0020_physical_intake_receipts.sql uygulandı; schema marker version=1.
- C uyumluluk commit: e538d95; son C Worker version: ce9d3caf-f5e5-4562-b1ef-4b39fbe81f7a.
- F commit: 4e54e56; PHYSICAL_RECEIPTS_CREATE_ENABLED=true.

## Kanıt

Temiz geçici Git kopyasında npm ci, npm test (885 pass / 0 fail / 1 skip), build:production ve deploy:dry-run:production başarılı. F sadece gate değişimidir; F build/dry-run ayrıca başarılı. Kaynak ve üretim sayfasının JS/CSS dosya hash'leri karşılaştırıldı.

Üretim D1 export yedeği yerelde SQLite'a geri yüklendi; migration öncesi ve sonrası integrity=ok, foreign key errors=0. Yedekte 36 tablo / 338 satır vardı. Mevcut 1 fiziksel kayıt ve 1 PDF satırı restore provasında ve canlıda korundu. SQL yedeği özel dış klasörde tutuluyor, Git'e alınmadı.

Canlı yetkili/öğrenci sayfaları 200, yetkisiz staff config 401, geçersiz public fiziksel sorgu found=false. PRINT_ENABLED=true ve PHYSICAL_INTAKE_MODE=on korundu. Önceki 29 binding aynen korundu; yalnız üç planlı plain-text config binding'i eklendi. Secret değerleri görüntülenmedi/rotate edilmedi. İki cron aynı kaldı; scanner ve Windows Agent ayarlarına müdahale edilmedi.

5 YKN dağıtım dosyasının canlı hash'i başlangıç dosyalarıyla eşleşiyor. İlk temiz kopya C yayınında ignored tarihî paketler eksikti; kaynak paketler korunarak C yeniden yayımlandı ve F öncesinde 5 dosyanın tamamı hash ile doğrulandı. Release replay için bu immutable dağıtım dosyalarının koruma kopyası kanıt klasöründedir.

Yerel production HEAD uzaktaki F commit'iyle eşitlendi; task dosyaları temiz release içeriğiyle aynı olduğu doğrulandı. Önceden var olan scanner betik değişiklikleri ve ilgisiz untracked teslim/kanıt dosyaları korundu.

## Kullanım ve kalan UAT

Yetkili ekranını yenileyin: İkamet Başvuruları → Fiziksel → Fiziksel Dosya Gir → bilgi/tarih/tür → Başvuru No Ata → Oluştur ve Yazdır. Gerçek A4 çıkışı sonrasında öğrencinin kodla sorgulamasını doğrulayın. Sonra kaydı Düzenle → PDF Ekle ile kullanın.

Yayın otomatik bir fiziksel baskı yaratmadı; gerçek kullanıcı/öğrenci verisi eklenmedi. Yetkili üretim kayıt/A4 zinciri, gerçek Windows kâğıt çıkışı ve fiziksel telefon kamera/QR UAT bu yayın turunda yapılmadı. Yerel testler bu kontrollerin yerine geçmez.

Son canlı printer health: ready, settings protocol 3, heartbeat 2026-10-12T06:37:36.495Z. Print status available=true.

Son canlı scanner health: signature_stale, heartbeat 2026-10-12T06:37:33.496Z. Scanner imza güncelliği hazır değildir. Yeni kayıt ve A4 yayınlanmış olsa da dosya PDF'lerinin güvenlik taraması/onayı hazır sayılmaz; scanner kontrolü ayrı tamamlanmalıdır. Güvenlik tarama gate'i gevşetilmedi.

## Geri dönüş

İlk seçenek mevcut sürümde yalnız PHYSICAL_RECEIPTS_CREATE_ENABLED=false yapıp üretime deploy: mevcut kod sorgulaması, dosyalar ve güvenli receipt devam korunur. Alternatif son C Worker version'ına kontrollü dönüş. C öncesi Worker'a rollback veya migration down işlemi yapılmaz. Belirsiz print işleri otomatik yeniden gönderilmez.

Kanıt klasörü: /Users/kagansmtdms/Documents/uluslarasiofis-backups/2026-10-12-receipts-release
