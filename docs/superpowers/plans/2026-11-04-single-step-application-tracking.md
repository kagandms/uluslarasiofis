# Tek adımda başvuru sorgulama ve belge yükleme uygulama planı

> Uygulayıcılar görevleri sırayla tamamlamalı ve her görevde önce regresyon testini yazmalı. Adımlar işaretlenebilir.

**Hedef.** Öğrenci `/basvurum/` ekranında ITU takip kodunu ve öğrenci numarasını bir kez girer. Bilgiler doğrulanınca, ofisin yeniden istediği belgelerin yükleme alanları aynı ekranda açılır.

**Mimari.** Online sorgu mevcut başvuru sahibi oturumunu açar ve oturumlu takip verisini okur. Belge kartları ve yükleme API’leri yeniden kullanılır. Fiziksel makbuz ve salt durum sorguları kendi mevcut uçlarına gider.

**Teknoloji.** Vanilla JavaScript, Cloudflare Worker, D1, HttpOnly başvuru oturumu, mevcut R2 yükleme akışı ve Node testleri.

**Kapsam.** Bu plan 4 Kasım 2026 tarihli tek giriş talebini kapsar. Veritabanı şeması, oturum yetkileri, personelin yeniden yükleme talebi, dosya taraması ve yükleme sözleşmesi korunur.

## Mevcut akış

1. `src/public/applicationTracking.js` ilk açılışta yalnızca takip kodu ister. Online kodla anonim `POST /api/public/applications/tracking-lookup` çağrılır. Bir oturum varsa ancak bu sorgudan sonra okunur ve kod eşleşirse kullanılır. Anonim belge kartı güvenli girişe bağlantı verir.
2. `src/public/homeResumeForm.js` takip kodunu ve öğrenci numarasını `POST /api/public/applications/access` üzerinden doğrulatır. Sunucu HttpOnly oturum çerezini ayarlar. Taslak dışındaki başvurular `/basvurum/` sayfasına döner ve ilk adımdaki form yeniden açılır. Tekrar istenen değer takip kodudur. API’deki ayrı `access_code` seçeneği bu arayüz akışında kullanılmaz.
3. Oturum doğrulanınca `GET /api/public/applications/current/tracking` takip verisini, `GET /api/public/applications/current/documents/resubmission-eligibility` yüklenebilir belge kodlarını döndürür. `src/public/resubmissionUpload.js` bu kodların kartlarında dosya seçme, yükleme ve sonlandırma kontrollerini açar.

## Kısıtlar ve inceleme odağı

- Online başvuruda varsayılan form iki alanlıdır. Fiziksel `ITU-YY-XXXXXXX` biçimi algılanınca öğrenci numarası gizlenir ve zorunluluğu kalkar.
- **Yalnızca durum sorgula** ayrı, açık bir seçim olarak kalır. Mevcut erişim rotası `completed`, `cancelled` ve `rejected` kayıtlarına yeni oturum açmadığı için bu yol kapanmış başvuruların ve ret gerekçesinin görüntülenmesini korur. Hatalı kimlik bilgisi otomatik olarak anonim sorguya düşmez.
- Takip kodu ve öğrenci numarası URL’ye, tarayıcı depolamasına veya yeni loglara yazılmaz. Yükleme yetkisi oturum ve sunucu uygunluk yanıtından gelir.
- Yanlış numara, önceki bir oturum, oturum süresinin dolması, fiziksel koda geçiş ve birden fazla eksik belge aşağıdaki testlerde ayrı ayrı kapsanır.

## Görev 1 — Online sorgudan aynı ekranda yükleme

**Dosyalar:** `src/public/applicationTracking.js`, `src/public/i18n/messages.js`, `src/public/i18n/pilotUxMessages.js`, `test/applicationTrackingUi.test.js`. Mevcut API sözleşmesi `src/public/applicationApi.js` içinden kullanılır.

- [ ] Testleri önce yaz. Doğru çift gönderildiğinde çağrı sırası `accessApplicationWithReference({ reference_number, student_number })` → `readCurrentApplicationTracking()` → `readCurrentResubmissionEligibility()` olur. Tek form gönderimiyle yalnızca uygun belgenin kartında dosya seçici görünür. Anonim API çağrısı ve sayfa geçişi gerçekleşmez.
- [ ] Hata ve uyumluluk testlerini ekle. Yanlış çift, 429 ve ağ hatası yerelleştirilmiş geri bildirim verir. Önceki oturum farklı bir takip koduna aitse sahibi verisi ve yükleme kontrolü gösterilmez. Anonim mod aynı tarayıcıda oturum bulunsa bile sahibi verisi okumaz. Ret gerekçesi anonim sonuçta korunur. Fiziksel koda geçiş öğrenci numarası zorunluluğunu kaldırır ve yalnızca fiziksel sorguyu çağırır.
- [ ] `node --test test/applicationTrackingUi.test.js` komutuyla yeni beklentilerin mevcut davranışta başarısız olduğunu doğrula.
- [ ] `createLookupForm(document, state, messages, submitLookup)` içinde mevcut `studentNumber` çevirisiyle metin alanı ekle. `submitLookup(referenceNumber, studentNumber)` iki değeri kırpar, kodu büyük harfe çevirir ve fiziksel biçim, açıkça seçilmiş salt durum modu veya online oturum açma yolundan birini çalıştırır. Bekleyen istekte ikinci gönderimi engelle. Dil değişiminde girilen değerler formda kalsın. Yeni metinler mevcut beş dilde yer alsın.
- [ ] Mevcut sahip oturumu işleme kodunu online erişimin başarısından sonra kullan. Oturumdan dönen takip kodunu girilen kodla karşılaştır. Uygunluk isteği başarısızsa nedenine göre tekrar deneme veya oturum açma geri bildirimi göster. Taslak sonucunu mevcut başvuru sihirbazına yönlendir. Yükleme sırasında oturum sona ererse kontrolleri kaldır ve giriş formunu açıklamayla geri getir. Başarılı yükleme sonrası durum ve kalan uygun belgeler mevcut sonlandırma akışıyla yenilensin.
- [ ] `node --test test/applicationTrackingUi.test.js test/applicationTracking.test.js test/applicationCrossDeviceAccess.test.js test/resubmissionUploadApi.test.js test/publicUxAccessibilityI18n.test.js` ile doğrula. İki eksik belge senaryosunda ilk yüklemenin ardından yalnızca diğer belgenin yüklenebildiğini kontrol et.

## Görev 2 — Mevcut güvenli girişten tekrarsız dönüş

**Dosyalar:** `src/public/homeResumeForm.js`, `src/public/applicationTracking.js`, `test/homeResumeForm.test.js`, `test/applicationTrackingUi.test.js`.

- [ ] Başarılı taslak girişinin `/basvuru/` sayfasına, diğer başarılı girişin `/basvurum/?view=current` sayfasına yönlendiğini test et. İşaretli sayfa geçerli çerezle doğrudan takip sonucunu ve uygun yükleme alanlarını açar. Çerez yoksa veya süresi dolmuşsa iki alanlı forma döner. Düz `/basvurum/` bağlantısı kendiliğinden sahibi bilgilerini açmaz.
- [ ] `node --test test/homeResumeForm.test.js test/applicationTrackingUi.test.js` ile yeni beklentilerin uygulama öncesinde başarısız olduğunu doğrula.
- [ ] `view=current` işaretini yalnızca görünüm tercihi olarak kullan. Takip sayfası bu girişte oturumlu takip API’sini çağırır ve Görev 1’deki sonuç işleme kodunu kullanır. URL’de takip kodu veya öğrenci numarası taşıma. Taslak yönlendirmesini koru.
- [ ] Aynı test komutunu yeniden çalıştır. Ardından `npm test`, `npm run build:production` ve `npm run deploy:dry-run:production` çalıştır.
- [ ] Üretim dışı test verisiyle temiz tarayıcıda tek formdan dosya seçmeye, yüklemeye ve güncellenen belge durumuna kadar akışı kontrol et. Aynı senaryoyu mobilde, Arapça sağdan sola düzende, yanlış öğrenci numarasıyla ve fiziksel makbuzla dene. Üretime geçiş için ayrıca açık dağıtım onayı gerekir.
