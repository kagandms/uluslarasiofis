# 14 uç durum: uygulama ve doğrulama

Çalışma yeri: `uluslarasiofis-main`, dal: `production`, başlangıç HEAD: `911d403dddcbc572100f4938de9f132e0c64c88d`.
Başlangıçtaki değiştirilmiş ve izlenmeyen dosyalar korundu. Canlı deploy, push, migration veya veri değişikliği yapılmadı.

| Madde | Sonuç ve sınır | Doğrulama |
| --- | --- | --- |
| 1 | Fiziksel takip kodu input olayında belleğe alınır. Çevrimiçi takip mevcut öğrenci numarası/yanıt durumunu korur; dil değişimi tekrar takip isteği yapmaz. Statik placeholder çevirisi eklendi. | `applicationTrackingUi.test.js`: tr/en/ar, gönderilmemiş kod ve önceden yüklenmiş sonuç. |
| 2 | Alt belge listesi kenarlığı/padding ve kalan yön kuralları mantıksal özelliklere çevrildi. Timeline zaten `inset-inline-start` kullanıyordu; sayfada yön belirten ok ikonu bulunmadı. LTR kimlik/kod alanları korundu. | Yerel production çıktısı: Arapça, `dir=rtl`, timeline çizgisi sağda 15.2 px. |
| 3 | 29 Şubat için 18. yaş günü artık olmayan yılda 28 Şubat. Gelecek/geçersiz tarih `null` sözleşmesini korur; form ilerlemesi bunu artık engeller. Sunucu normal güncellemede zaten reddediyordu; eksik autosave alanları tamamlanmamış kalır. | `applicationAge.test.js`, `applicationWizard.test.js`. |
| 4 | Ortak saat ofseti HTTP Date ve istek orta noktasıyla hesaplanır. Header HEAD isteği ve öğrenci API yanıtları örnek sağlar; yaş hesabı aynı saati kullanır. Header saat/tarih açıkça Europe/Istanbul kullanır. | `clock.test.js`: yanlış istemci günü ve UTC/Istanbul gün sınırı. |
| 5 | Görünmez yön/zero-width karakterleri temizlenir. Uluslararası numaralar `libphonenumber-js/max` ile doğrulanır; düzenlenen numara seçili ülkeye göre kontrol edilir. Ülkesi kayıtlarda bulunmayan eski yerel numaralarda mevcut 7–15 rakam kabulü korunur. | `phone-number.test.js`, `pilotUatUxComponents.test.js`. |
| 6 | Derin değer karşılaştırması gereksiz yamaları engeller; snapshotlar dışarıdaki nesne mutasyonundan korunur. `online` olayı bekleyen yamayı yeniden gönderir; dispose listener kaldırır. | `draftAutosave.test.js`: nested değerler, mutasyon, yeniden bağlantı ve seri yazma. |
| 7 | OCR öncesinde kaynak canvas değiştirilmeden 2048 px uzun kenarlı JPEG hazırlanır. Null blob ve geçersiz boyutlar upload öncesi hata verir; geçici canvas bırakılır. Genel belge/PDF kalite profili değiştirilmedi. | `optimize-document-image.test.js`. |
| 8 | YKN profil metinleri güvenli string sarmalayıcıdan geçer; eksik profil alanlarında string metotları çökmez. Eklenti parser seçenekleri açıkça null verildiğinde optional chaining kullanır. | `edge-cases-ui.test.js`, YKN parser/profil/orientation/transport sözleşme testleri. |
| 9 | Tebliğ uzak arama debounce 250 ms. Her istek kendi controllerını tutar; eski response veya hata yeni aramayı render edemez. ISO date-only sayfa tarihleri doğrudan takvim parçalarıyla sıralanır, UTC dönüşümü kullanılmaz. | `edge-cases-ui.test.js`: abortu yok sayan taşıma ve geç gelen JSON, ISO tarih sırası. |
| 10 | Mevcut kapak üretimi HTML → canvas → jsPDF.addImage kullanır; WinAnsi text encoding yoluna girmez. Yeni font bağımlılığı gerekmedi. | `pdfRenderSecurity.test.js`: Kiril/Arapça/Türkçe adlar PDF ve print markup içinde korunur. Gerçek raster font/glyph sonucu fiziksel UAT kapsamında. |
| 11 | Vektör yolu zaten `ignoreEncryption: true` ve dosya bazlı hata içeriyordu. Raster yoluna dosya adıyla hata ve başarısız yüklemede loading task cleanup eklendi. Bozuk veya parola isteyen dosyada eksik birleşim teslim edilmez; parola çözme yapılmaz. | `edge-cases-ui.test.js`, `physical-pdf-editor.test.js`. Parola gerektiren yol PDF.js sınır mockuyla test edildi. |
| 12 | Ofis önizlemesi global polling/4 saniye sınırı yerine paylaşılan bundled bootstrap Promise bekler. Render sırasında filtre değişirse sonraki render yürütülür. CMap/fontlar aynı origin ve pinli sürümden alınır, eval kapalıdır. | Build/dry-run, `documentsManagerUi.test.js`, `pdfJsSupplyChain.test.js`. Gerçek 9 thumbnail için personel oturumu UAT yapılmadı. |
| 13 | Genel cropper açılışında eski instance destroy edilir. Pasaport cropper bu korumayı zaten sağlıyordu. İkisinde slider sıfırlaması test edildi. | `edge-cases-ui.test.js`. |
| 14 | Ortak kuyruk butonu async işlem boyunca kilitli, `finally` ile serbest. Gerçek çevrimiçi kuyruk yöneticisi arşivleme sırasında DOM'u korur ve kontrolleri kilitler; geç kuyruk sonuçları request ID ile elenir. Review/scan lock cleanup `finally`; işlem sürerken scan poll yenilemesi ertelenir. `staff/main.js` tebliğ add/remove yolundaki mevcut finally korunur. | `staffApplicationsUi.test.js`: DOM kimliği, çift tıklama, API reddinden sonra unlock; staff workflow testleri. |

## Doğrulama sınırı

Tam çalışma ağacıyla `npm test`, `npm run build:production`, `npm run deploy:dry-run:production` çalıştırıldı.
Test ve build mevcut başlangıç WIP değişikliklerini de içerir; bu kayıt yalnız bu görevdeki düzeltmeleri açıklar.
Build'in mevcut chunk boyutu ve OCR dynamic/static import uyarıları sürer.
Canlı, oturum açılmış personel, fiziksel iOS Safari, gerçek tarayıcı/yazıcı ve telefon-PC UAT yapılmadı.
D1/R2, secret binding, cron, PRINT_ENABLED, PHYSICAL_INTAKE_MODE ve Windows Print Agent v7 değiştirilmedi.

Son zincir sonucu: **984 test / 983 başarılı / 0 hata / 1 opt-in atlandı**; production build ve deploy dry-run çıkış kodu 0.
Dry-run hedefinde `PRINT_ENABLED=true`, `PHYSICAL_INTAKE_MODE=on` doğrulandı; herhangi bir deploy yapılmadı.
Yerel production browser kontrolü ayrıca iki gönderilmemiş takip alanının en/ar geçişinde korunduğunu doğruladı.
[Ekran kanıtı](validation/edge-cases-rtl.png) yalnız sentetik test değerleri içerir.
