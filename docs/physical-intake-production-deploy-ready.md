# Minimal fiziksel başvuru aktarımı

**MINIMAL PHYSICAL FEATURE PORT READY**

Bu rapor önceki scanner tabanlı yayın planının yerine geçer. Production deploy/migration yapılmadı; gerçek production telefon UAT'si henüz yapılmadı. Yeni fiziksel ClamAV kuyruğu, scanner servisi ve clean-verdict zorunluluğu kapsamdan çıkarıldı.

## İnceleme tabanı ve 57 dosyanın kararı

Branch: `codex/physical-intake-production-port`. Özellik inceleme tabanı: `6123ec3` (mevcut production çalışma dosyalarının byte içeriklerini koruyan snapshot). Snapshot'ın 63 dosyası fiziksel özellik değişikliği değildir; doğrudan remote production HEAD ile karşılaştırmada bunlar ve önceden mevcut YKN commit'i ayrıca görünür. Kör merge yapılmamalıdır.

57 dosyalık feature farkı **53 dosyaya** indi:

- 40 runtime/build/config dosyası: mevcut staging özelliği, production bağlantıları ve dosya/oturum korumaları.
- 9 test/fixture dosyası: fiziksel davranış, veri ayrımı ve production regresyonları.
- 3 tarihsel migration: production'da zaten uygulanmış 0011/0012/0013; byte içerikleri değiştirilmedi, tekrar uygulanmayacak.
- 1 küçültülmüş migration: 0018.

Dosya bazında 57 kararın tamamı: [scope-audit.json](minimal-physical-port-evidence/scope-audit.json). Güncel 53 dosya: [feature-files.json](minimal-physical-port-evidence/feature-files.json). Rapor/evidence dosyaları bu sayıya dahil değildir.

Çıkarılan gereksiz parçalar:

- `combined-scanner-repository.js` ve `staff-document-scanner-repository.js` kaldırıldı.
- `scanner-routes.js` production snapshot içeriğine birebir döndürüldü. Worker scanner çağrısı da özgün çağrıdır.
- Fiziksel/mobil scan-job oluşturma, lease/retry/verdict bağlantıları kaldırıldı.
- 0018'den `staff_document_scan_jobs`, iki index, `staff_scan_files` view ve iki fiziksel scan/onay trigger'ı çıkarıldı.
- Mobil `scan_status`, `pairing_code_hash`, `phone_approved_at` kolonları çıkarıldı.
- Fiziksel PDF erişimi/onayı ve QR fotoğraf importundan `clean` zorunluluğu çıkarıldı. Bekleyen tarama mesajları kaldırıldı.
- Staging'de olmayan altı haneli PC onayı, approval/status endpoint'leri ve telefon kontrol düğmesi kaldırıldı.
- İptal edilen mimariye ait fiziksel gerçek ClamAV testi ve fixture scanner helper'ı kaldırıldı. Önceki scanner içeren hazır patch arşivi kaldırıldı.

## Staging arayüzü ve production koruması

Telefon sayfası JS'i, PC QR paneli ve fiziksel detay görünümü staging kaynaklarıyla byte düzeyinde aynıdır. Kamera/galeri, bilgisayardan dosya seçimi, liste, PDF düzenleme/sayfa sıralama/silme/birleştirme ve kayıt akışı korunur. Manager farkı mevcut sunucu gate kontrolü ve staging görünümünün çağırdığı eksik PDF ayırma handler'ını tamamlayan küçük düzeltmedir. Yetkili → İkamet Başvuruları → ONLINE/FİZİKSEL seçimi production çalışma alanlarına bağlanır.

Online manager, online scanner route/repository/policy, online belge erişimi/review ve mevcut print/scanner agent kaynakları production snapshot ile aynıdır. Asıl production checkout'ındaki 174 dosyanın hash'i değişmedi. `PRINT_ENABLED`, `/yazdir/`, scanner görevleri ve mevcut cron tanımları değiştirilmedi. Worker'ın mevcut cron'una yalnız geçici fiziksel fotoğraf temizliği eklenir; yeni scanner/provider görevi yoktur. Wrangler fiziksel gate'i varsayılan `off` tutar.

## Veri modeli ve 0018 kararı

Online veriler mevcut `applications`/`document_*` tabloları ve API'lerinde kalır. Fiziksel veriler mevcut `physical_intakes`/`physical_intake_files` tablolarındadır. İsteğe bağlı online bağlantı yalnız doğrulanmış bir referanstır; fiziksel kayıt online satırları güncellemez.

Yeni fiziksel kayıt/tablo modeli gerekmiyor. **0018 yine gereklidir, fakat yalnız üç ek içerir:**

1. Mobil fotoğraf `upload_status`: uploading/finalized/failed/consumed; eşzamanlı yükleme, başarısız yükleme tekrarı ve tekrar import korunur.
2. Mobil fotoğraf `sha256`: aynı ID ile farklı içerik gönderimini ve saklama sırasında içerik değişimini reddeder.
3. `mobile_transfer_rate_limits`: claim/upload isteklerini sunucuda atomik sınırlar.

Bunlar ClamAV kuyruğu veya tarama kararı değildir. D1 rezervasyonu R2 yazımından önce yapılır; aynı fotoğraf tekrarları kota tüketmez veya kazanan objeyi silmez. Kalıcı fiziksel PDF sürümleme/optimistic lock mevcut yapıyla korunur.

0018 hiçbir application/physical kaydına UPDATE/DELETE/DROP uygulamaz. Mevcut yedeğin yerel kopyasındaki 33 tabloda (SQLite iç tablosu dahil) eski kolon/satırlar aynen kaldı. Eski fotoğraflara digest uydurulmaz; digest'i olmayan geçici fotoğraf indirilemez, TTL temizliğine bırakılır.

Tarihsel 0012'deki `physical_document_scan_jobs` tablosu ve fiziksel `scan_status` kolonu production'da zaten vardır: bu görev bunları silmez veya değiştirmez. Yeni akış bunları kullanmaz; fiziksel dosyaların tarihsel `pending` alanına `clean` yazılmaz. ONLINE pending/unsafe/failed erişim ve onay kuralları korunur.

SQL raw replay idempotent değildir; ikinci yürütme duplicate column ile durur. Desteklenen yol tam dosya adıyla izlenen Wrangler migrations apply'dır. Yeni yerel Wrangler provasında ilk uygulama başarılı, tekrar `No migrations to apply`. Kısmi uygulanmış/önceki scanner şeması drift sayılır; migration geçmişine elle kayıt eklenmez. Read-only production preflight: `READY_PENDING`, yalnız 0018 bekliyor.

## QR, doğrulama ve özel depolama

Staging'deki tek claim'li 256 bit QR korunur; ilk claim yapan telefon HttpOnly/Secure/SameSite=Strict cookie alır. QR en fazla 15 dakika geçerlidir. URL fragment'i claim sonrası kaldırılır. Fotoğrafları yalnız QR'ı oluşturan aktif personelin aynı PC oturumu alabilir; başka PC oturumu erişemez. Logout, inactive staff, idle timeout, session/QR expiry ve gate kapanması telefon yüklemesini de keser.

Ek PC onayı kaldırıldığı için QR ilk claim öncesi bir erişim yetkisidir: paylaşılmamalıdır. Tek kullanımlık claim sonrasında başka telefona taşınamaz; hiçbir claim fotoğrafların başka bilgisayara yönlendirilmesini sağlamaz.

Görüntüler istemcide canvas ile JPEG'e normalize edilir; sunucuda gerçek JPEG konteyneri/sonu, boyut ve piksel sınırı doğrulanır. Tek fotoğraf 8 MiB/36 MP; aktarım 30 fotoğraf/120 MiB. PDF sunucuda parse edilir: 10 MiB ve 300 sayfa sınırı; erişimde byte/digest/ETag ve staff yetkisi kontrol edilir. Bu dosya doğrulamasıdır; antivirüs taraması yapıldığı iddia edilmez. Fiziksel kodun mevcut SHA-256 yardımcı fonksiyonunu kullanması herhangi bir scanner queue/verdict çalıştırmaz.

Geçici fotoğraflar mevcut private `DOCUMENTS` R2 bucket'ında immutable `quarantine/<UUID>` objeleridir; public URL yoktur. PC receipt/ack sonrası obje hemen silinir; consumed metadata TTL sonuna kadar tekrarları engeller. Pencere kapanması objeleri temizler; expiry cleanup mevcut cron'da 20 oturumluk partilerle çalışır. 15 dakika erişim sınırıdır; fiziksel silme cron/backlog/provider başarısına bağlıdır. Kaydedilen PDF sürümleri bu geçici fotoğraf TTL'sinden ayrıdır; soft delete geçmişi korur.

## UAT ve ilerideki yayın/rollback sırası

Bu bölüm hazırlık planıdır; production mutation komutları çalıştırılmadı.

1. Snapshot tabanını ve sadeleştirilmiş farkı incele; ayrı yayın kararı al. Gate OFF kalsın.
2. Cutover öncesi private dizinde yeni D1 export ve restore point al; mevcut Worker/asset sürümünü ve print/env ayarlarını kaydet. Mevcut özel export'un yerel migration provası geçti; cutover yedeği yerine geçmez. D1 export R2 gövdelerini kapsamaz.
3. `node scripts/check-physical-production-migration.mjs uluslarasiofis-production` yalnız metadata okur. READY_PENDING ise yalnız bekleyen 0018'i Wrangler üzerinden uygula; ALREADY_APPLIED_SKIP ise tekrar uygulama; drift varsa dur.
4. Build/dry-run sonrası Worker + asset'leri gate OFF ile, mevcut env/secret değerlerini koruyarak yayımla. Online ve mevcut QR print/scanner smoke kontrollerini yap. Fiziksel scanner testi/aktivasyonu gerekmiyor.
5. Önceden istenen kontrollü UAT gate'i korunur: seçilen PC'de oturum açıp aynı-origin POST `/api/staff/physical-access/session` ile candidate digest al. Operator `PHYSICAL_INTAKE_MODE=uat`, seçili `PHYSICAL_INTAKE_UAT_SESSION_HASH`, UTC `PHYSICAL_INTAKE_UAT_STARTS_AT` ve en fazla bir saatlik `PHYSICAL_INTAKE_UAT_EXPIRES_AT` ayarlarını hazırlar. Bu endpoint kendiliğinden izin vermez; mevcut secret'lar değiştirilmez.
6. Seçili PC ve gerçek telefonda sentetik belgelerle kamera/galeri → doğrudan PC import → PDF düzenleme/birleştirme/kayıt/indirme/revision kontrolü yap. İkinci PC, claim tekrarları, logout/expiry ve private erişim reddini doğrula. ONLINE pending belge halen erişilemez olmalı; online scanner normal çalışmalı.
7. UAT sonunda gate OFF; kabul sonrası normal yetkili kullanımını açma ayrı operator kararıdır.

İleride onaylı yayın penceresinde kullanılacak komutlar:

```sh
npx wrangler d1 export uluslarasiofis-production --remote --env production --output /private/backup/production-pre0018.sql
node scripts/check-physical-production-migration.mjs uluslarasiofis-production
npx wrangler d1 migrations apply uluslarasiofis-production --remote --env production
node scripts/check-physical-production-migration.mjs uluslarasiofis-production
npm run build:production
npx wrangler deploy --env production --dry-run --keep-vars
npx wrangler deploy --env production --keep-vars
```

İlk rollback: fiziksel gate OFF. Kod rollback: doğrulanmış production snapshot `6123ec3` için temiz checkout/build/dry-run, mevcut print/env/secret ayarları korunarak baseline Worker+asset yayını. Additive 0018 yerinde kalır; DROP/down migration yapılmaz. Eski Worker'a dönüldüğünde geçici fotoğraf cleanup'u bulunmayacağından fiziksel transferleri önce kapat/temizle veya dar kapsamlı temizlik kodunu koru. Tam DB restore yalnız veri hasarı halinde ayrıca değerlendirilir; sonraki online başvuruları kaybettirebilecek bir migration rollback yöntemi olarak kullanılmaz.

## Kanıt

- Node: **741 test; 740 başarılı, 0 hata, 1 mevcut online gerçek ClamAV opt-in skip**.
- Native D1/R2; staging navigation, PC fotoğraf seçimi, QR camera/gallery; migration koruma/tekrar/rollback testleri geçti.
- Mevcut scanner Python: 14 başarılı. Mevcut print agent Python: 45 başarılı.
- Production build ve production dry-run başarılı; gerçek deploy yok. Build'in mevcut chunk uyarıları yayın davranışı değişikliği değildir.
- Read-only production şema kontrolü READY_PENDING. Yerel migration ilk uygulama ve tekrar provası başarılı.
- [Güncel kanıtlar](minimal-physical-port-evidence/): kaynak koruması, migration, test ve redakte edilmiş dry-run çıktıları.

Önceki `physical-deploy-evidence` test/engine logları geçmiş mimarinin kanıtlarıdır; güncel fiziksel yayın kabul kriteri veya çalışma talimatı değildir.
