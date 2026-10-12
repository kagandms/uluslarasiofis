# Fiziksel ikamet teslimi, takip numarası ve bilgilendirme A4 — nihai uygulama planı

Tarih: 12 Ekim 2026. Durum: tasarım kararları tamamlandı; uygulamaya başlangıç için hazır. Uygulama ve üretim doğrulaması henüz yapılmadı. Bu belge kod değişikliği, migration, gerçek baskı veya deploy yapıldığı anlamına gelmez.

## 1. Amaç ve kapsam

Ofis fiziksel ikamet dosyasını teslim alırken öğrenciye hemen takip bilgisi verebilmeli. Belgeleri fotoğraflayıp PDF hazırlamak teslim kaydının ön koşulu olmayacak. Yeni sıra: öğrenci bilgileri → takip numarası → kalıcı kayıt → bilgilendirme A4 → listeden dosya/PDF işlemleri.

Kullanıcı tarafından belirlenenler:

- Tarih değiştirilebilir; varsayılan Türkiye saatine göre o gün.
- İlk ekranda ad, soyad ve pasaport numarası.
- Başvuru No Ata ardından Oluştur ve Yazdır.
- Numara `ITU-26-XXXXXXX` biçiminde; yıl + yedi rastgele harf/rakam.
- Tek A4'te öğrenci bilgileri, tarih, takip numarası, beş dilde çok basit sorgulama açıklaması.
- Üniversite logosu sol üstte, Göç İdaresi logosu sağ üstte.
- Kayıt listeden düzenlenebilir; mevcut kamera/QR/PDF sürümleme kullanılır.
- Kapak Hazırla çıktılarındaki iki logo da düzeltilir.

Ofis takip numarası resmî e-İkamet başvuru numarası değildir. Online başvuruların kapatılması, otomatik YÖK/YÖKSİS gönderimi, yeni bildirim kanalları ve toplu tarihî kayıt dönüşümü kapsam dışıdır. Mevcut YÖK/YÖKSİS personel işlemi korunur.

## 2. Mevcut kaynak ve seçilen yaklaşım

İnceleme kökü `/Users/kagansmtdms/Downloads/Проекты/uluslarasiofis-main`; dal `production`; HEAD `1ce8f65d3e54032f252b36b4c6b7be8d539b81c9`. Başlangıçta Git durumu yeniden doğrulanacak. Scanner betiklerindeki mevcut değişiklikler ve yerel teslim/kanıt dosyaları korunacak.

**Karar: mevcut fiziksel kayıt modeli genişletilecek.** Online `applications` tablosuna taşıma, onun iletişim/oturum/belge gereksinimlerini gereksiz yere yeni akışa bağlar. Ayrı sistem kurmak da mevcut PDF/QR altyapısını kopyalar. Mevcut `current_pdf_id` zaten nullable; yeni öğrenciye boş/sahte PDF üretilmez.

| Mevcut kaynak | Uygulama görevi |
| --- | --- |
| `src/staff/physical-intake-manager.js`, `physical-intake-view.js`, `physical-intake-client.js` | Bilgi-önce kayıt, düzenleme, A4 ve kurtarma ekranları |
| `src/server/routes/physical-intake-routes.js`, `physical-registration-routes.js` | Yeni JSON kayıt ve tahsis; eski multipart yoluyla uyumluluk |
| `src/server/repositories/d1/physical-registration-repository.js`, `physical-intake-repository.js` | Atomik kayıt, yaşam döngüsü, mükerrerlik ve optimistic lock |
| `src/public/applicationTracking.js`, `src/public/i18n/messages.js` | Kodla fiziksel takip; mevcut online yolları koruma |
| `src/server/routes/staffPrintRoutes.js`, `printRoutes.js`, `printerRoutes.js` | Yetkili receipt devam/iptal; ortak Agent iş servisleri |
| `src/server/repositories/d1/printRepository.js`, `printCleanupService.js` | Atomik iş ilişkisi, kalıcı durum, purge öncesi güvence |
| `src/services/pdfGenerator.js` | İki logo, kaynak hazır olma, kapak PDF/print doğrulaması |

Yeni sorumluluklar kebab-case modüllerde ayrılır: physical-tracking-policy, physical-receipt-repository, physical-receipt-print-service, physical-receipt-template, physical-receipt-pdf, document-logo-loader. İş mantığı renderer/framework bağımlılığı taşımaz.

## 3. Personel ve öğrenci akışı

1. İkamet Başvuruları → Fiziksel → Fiziksel Dosya Gir.
2. Üstte Başvuru / Teslim Tarihi; altında Ad, Soyad, Pasaport No.
3. İlk / Uzatma seçimi açıkça yapılır; mevcut öğrenci no alanı isteğe bağlı ikincil alanda kalır.
4. Başvuru No Ata sunucudan numara ayırır; henüz listeye öğrenci eklenmez.
5. Oluştur ve Yazdır kaydı kalıcılaştırır, A4 sürümünü oluşturur/saklar, tek baskı işini gönderir.
6. Listeye dönülür. “Öğrenci eklendi” kayıt başarısını; “A4 kuyruğa gönderildi” baskı adımını ayrı bildirir. Hatalarda öğrenci kaydı korunur.
7. Düzenle → PDF Ekle / PDF Düzenle ile fotoğraf, mevcut QR aktarımı ve dosya seçimi kullanılabilir. Güncel PDF sayfaları korunarak yeni revizyon hazırlanır.

Listede takip no, öğrenci adı, teslim tarihi, ofis durumu, PDF durumu, A4 durumu yer alır. Bilgiler değişince takip numarası değişmez; eski A4'in güncel olmadığı gösterilir. Yeni A4 yalnızca personel eylemiyle hazırlanır. Bir öğrenciden diğerine geçişte form/PDF/QR state'i ve event kaynakları temizlenir.

Öğrenci ana sayfadaki Başvurumu Sorgula üzerinden `/basvurum/` sayfasına girer. Takip numarası alanı ilk görünür sorgulama alanıdır; fiziksel/online seçimi için ek adım gerekmez. Mevcut online öğrenci numarası ve oturum yolları ayrı seçenek olarak çalışır. Eski online oturum, fiziksel kod formunu gizlemez.

## 4. Tarih ve numara

- `application_date` takvim tarihidir: YYYY-MM-DD. `submitted_at` gerçek kayıt oluşturma UTC timestamp'idir.
- Varsayılan sunucunun Europe/Istanbul günüdür; bilgisayar saatine güvenilmez. Boş/geçersiz tarih reddedilir. Geçmiş ve ileri takvim tarihleri kabul edilir; ileri gün seçilirse yanlışlığı fark etmek için ekranda uyarı gösterilir. Kullanıcının istediği tarih düzenleme hakkına sessiz kısıt konmaz.
- `ITU-YY-XXXXXXX`: YY tahsis sırasında seçilen tarihin son iki yıl hanesidir. Son yedi karakter `23456789ABCDEFGHJKMNPQRSTUVWXYZ` alfabesinden kriptografik rastgelelikle üretilir; alfabenin gerçek uzunluğu kullanılarak rejection sampling uygulanır.
- Kod kişisel bilgiden/sıradan türetilmez; 0/O/1/I/L yoktur. UNIQUE zorunlu; yalnız numara çakışması sınırlı yeniden üretimle çözülür. Genel DB hatası çakışma sayılmaz.
- Tahsis 60 dakika geçerlidir. Aynı taslak UUID'siyle tekrar tıklama aynı geçerli kodu getirir. Süresi dolunca öğrenci oluşmaz; yeni tahsis gerekir. Verilmiş kod başka öğrenciye atanmaz.
- Kayıt öncesinde tarih yılı değişirse yeni yıl için tahsis yenilenir; kayıt tamamlandıktan sonra tarih yılı değişse de kod sabit kalır.
- Girişte küçük harf, baş/son boşluk ve tiresiz biçim kabul edilir. Beklenmedik karakterler sessizce atılmaz. Kod yalnız durum sorgulaması içindir; belge/kimlik/owner oturum erişimi vermez.

## 5. D1 modeli ve kayıt sözleşmesi

Ek migration mevcut verileri silmeden yapılır. Adı uygulama günündeki sıra doğrulanarak belirlenir; şu an sonraki aday `0020_physical_intake_receipts.sql`.

### Fiziksel kayıt ekleri

`tracking_reference` (eski kayıtlar nullable, NULL olmayanlar UNIQUE), `application_date` (eski kayıtlar nullable), `processing_closed_at`, `processing_closed_by_staff_id`, `processing_closure_reason`, `metadata_version` (başlangıç 1). Metadata_version yalnız A4'te kullanılan bilgi değiştiğinde artar; PDF/statü değişimi artırmaz. Mevcut submitted_at/current_pdf_id/lock_version/status ve belge sürümleri korunur.

Yeni JSON kayıt; registration UUID, reservation UUID, tarih, ad, soyad, pasaport, başvuru türü ve isteğe bağlı öğrenci no alır. İstemci takip numarasını kendi seçemez; sunucu tahsis kaydından alır. Tahsis tüketimi, öğrenci INSERT'i, ilk receipt snapshot'u ve audit aynı D1 transaction/batch içindedir. Aynı registration UUID + aynı normalize gövde önceki kaydı döndürür; farklı gövde 409 verir. Önce replay kontrolü, sonra yeni kayıt için tahsis expiry kontrolü yapılır: tamamlanmış işlem tahsis süresi doldu diye kaybolmaz.

Tahsis tablosu: UUID, takip no UNIQUE, taslak UUID, aktör ve oturum hash'i, tarih/yıl, expiry, tüketilen intake ID. Kayıt öncesi yetki bağlı oturumla sınırlıdır. Kayıt sonrası oturum sona erse de yeniden giriş yapan yetkili personel mevcut öğrenciyi açarak devam eder; eski bearer token bilmesi gerekmez.

## 6. Mükerrerlik ve gerçek yeni başvuru — kesin karar

Aktif kayıt: deleted_at NULL, status rejected değil, processing_closed_at NULL ve legacy_status completed değil. Approved_for_processing tek başına kapanış anlamına gelmez.

Pasaport anahtarı mevcut sözleşmeyle uyumlu ASCII büyük harf + baş/son boşluk temizlemedir (`upper(trim(...))`). İç boşluk/tire rastgele kaldırılmaz; noktalama içeren eski kayıtlar sessizce başka pasaportla birleştirilmez. Karşılaştırma pasaport anahtarı + başvuru türüdür; mevcut öğrenci no benzersizliği ayrıca korunur.

**Tüm kayıt yollarına DB trigger koruması:** aktif INSERT, pasaport/tür değişikliği, restore ve yeniden açma sırasında mevcut eski+yeni aktif kayıtlar atomik kontrol edilir. Yeni partial UNIQUE index tek başına kullanılmaz. Yalnız etkinlik/anahtar değişiminde tetiklenen BEFORE INSERT/UPDATE trigger'ları var olan eşleşmede anlaşılır conflict üretir. Eski mükerrerler yerinde kalır; ilgisiz tarih/ad düzenlemesi engellenmez. Eski+yeni tüm yazma yolları, geçişte eski Worker dahil, trigger korumasına tabidir.

Mükerrer bulununca personel mevcut kaydı açar. Birden fazla eski eşleşmede otomatik seçim/merge yok; eşleşmeler personel ekranında sunulur. Gerçek sonraki başvuru gerekiyorsa önceki ofis işlem kaydı, zorunlu kısa gerekçe ve audit ile açıkça kapatılır; bu işlem ikamet izni onayı anlamına gelmez. Sonra yeni takip numarasıyla yeni kayıt açılır. Yeni kaydın alanları önceki başvurudan otomatik kopyalanmaz.

Reviewer/admin ofis işlemini kapatabilir; kapalı kaydı yeniden açma admin yetkisindedir ve aktif eşleşme yoksa yapılır. Kapanış temel bilgi/PDF değişimini kapatır; geçmiş görüntüleme, takip ve A4 indirme kalır. Kapatma eski belgelere veya takip koduna dokunmaz. Mevcut öğrenci no UNIQUE index'i aynı aktiflik tanımıyla yeniden kurulur; eski legacy completed davranışı korunur. Restore/reopen/info edit için lock_version zorunludur.

## 7. A4 sürümü ve kesinti kurtarma — kesin karar

`physical_intake_receipts`: intake ID, benzersiz (intake ID, belge sürümü), UNIQUE oluşturma UUID'si, snapshot, belge sürümü, şablon sürümü, kaynak metadata_version, artefact key, SHA-256, byte_size, state, created_at, expires_at. Bilgi snapshot'u özel personel verisidir. İkamet PDF current_pdf_id ile karıştırılmaz.

**Gerçek A4 PDF bytes'ı özel DOCUMENTS R2 içinde** `receipts/<receipt-uuid>/<sha256>.pdf` altında tutulur. Browser, kayıtlı sunucu snapshot'unu yerel renderer/font/logo ile hazırlar ve yetkili content endpoint'ine gönderir. Sunucu boyut, gerçek PDF parser, 1 sayfa, A4 ölçü/rotation ve hash kontrolü yapar. Bir kez bağlanan artefact değişmez; PDF karantina/ikamet dosyası olarak sınıflandırılmaz ve ikamet scanner kuyruğuna sokulmaz. Yetkili üretilmiş A4'ün mevcut Print Agent PDF doğrulaması devam eder.

Yazma `onlyIf etagDoesNotMatch=*`; aynı receipt'e farklı bytes overwrite edilemez. R2 write → D1 bind koparsa aynı deterministik key/head/hash ile tekrar bağlanır. DB ready kaydı oluşmadan baskı açılmaz. Paralel farklı render'da ilk bağlanan geçerli bytes kazanır; diğer istek mevcut receipt'i getirir. Metadata_version değişmiş snapshot'a basım 409/stale uyarısı verir; yalnız PDF/status değişimi A4'ü bayatlatmaz; yeni bilgi sürümünden A4 gerekir.

Artefact 30 gün tutulur; canlı/belirsiz baskı denemesi veya kısa indirme lease'i varsa silinmez. Cleanup mevcut cron'a ayrı, sınırlı batch olarak eklenir; mevcut scanner/print bakımını bloke etmez. Sahipsiz artefact'lar 24 saatlik güvenlik payından sonra silinir; hazır receipt'i referanslayan dosya sahipsiz kabul edilmez. R2 delete başarısızsa metadata silinmiş sayılmaz. İlk üretim, bilgi güncellemesi ve purged artefact sonrası üretim için farklı belge sürümü ayrılır; aynı oluşturma UUID'si replay'inde mevcut sürüm döner. Snapshot/deneme metadata'sı fiziksel kaydın mevcut yaşam döngüsünü izler; yeni gizli süresiz PII arşivi yaratılmaz.

30 gün sonra tekrar A4 istenirse eski bytes'a devam edilmez: aynı öğrenci/takip numarasıyla yeni receipt belge sürümü açıkça hazırlanır. Şablon/snapshot sürümü kaydedilir. Bekleyen/belirsiz eski baskı varsa yeni sürümden de otomatik baskı açılmaz.

## 8. Personel baskı servisi — kesin karar

**Browser print upload token saklamaz.** Yeni staff receipt servisi yetkili kayıt/receipt ilişkisinden iş yaratır ve sunucu tarafında devam ettirir. Mevcut public print token sözleşmesi değişmez. Ortak rezervasyon/kuyruk/validation servisleri çıkarılarak kullanılır; public auth hiçbir yerde atlanmaz.

1. POST receipt print: yetki, fiziksel gate, güncel snapshot, artefact hash, kuyruk/health/bütçeler doğrulanır.
2. Receipt sürümü+ilk basım veya açık reprint UUID'si, kalıcı idempotency anahtarıdır. Attempt ve print_jobs INSERT'i aynı D1 batch ile yapılır. Aynı intake için blocks_new_attempt=1 olan tek deneme partial UNIQUE index ile korunur; farklı receipt sürümleriyle bu kilit aşılamaz.
3. Job `source=staff`; 1 kopya, A4 portrait, monochrome, simplex. Normal Agent işidir. Public yolların gerektirdiği token hash alanları geçerli rastgele değerlerle dolar; receipt devamı bunları geri üretmez/çözmez, ayrı authenticated service kullanır.
4. Sunucu değişmez receipt bytes'ını PRINT_FILES `print/<job-id>` key'ine write-once kopyalar. Retry'da mevcut object head/hash doğrulanır, üstüne yazılmaz. Sonra aynı job'u ortak policy kontrolleriyle queued yapar. R2/DB adımları arası kopma aynı job üzerinden kurtarılır.
5. Kesintiden sonra personel aynı öğrencide Devam Et'e basar; sunucu uploading olan işi tamamlar veya mevcut queued/terminal durumunu döndürür. Sunucu kabul etmediği iş için “gönderildi” mesajı verilmez. Job expiry/health/pause ve ortak print gate her devamda kontrol edilir.

Süresi dolmuş, submission başlamadığı kanıtlanan uploading işi terminalleştirilip açık yeniden gönderimle yeni attempt açılabilir. `queued/leased/ready` için mevcut iş beklenir; `submission_started/unknown` için otomatik yeniden gönderim yoktur. Receipt servisi mevcut Agent retry protokolünü değiştirmez. HTTP yanıtı kaybolması retry için yeni UUID üretme nedeni değildir.

## 9. Kalıcı baskı sonucu ve fallback — kesin karar

Attempt tablosunda job ID bir ilişki alanıdır, print_jobs'a RESTRICT/CASCADE FK yoktur. Receipt/intake ilişkileri normal FK ile korunur. Deneme statüsü, son bilinen durum/zaman, submission başlangıcı, result code, spooler ID, blocks_new_attempt, risk_acknowledged_at/by ve reprint/manual karar audit'i kalır; bearer token/lease hash içermez.

Migration'daki print_jobs AFTER UPDATE ve BEFORE DELETE trigger'ları ilişkili receipt attempt'e durumu aynı DB transaction'ında aktarır. Terminal/cleanup/reconcile yolu tarayıcıdan bağımsızdır. Purge öncesinde submitted/failed/cancelled/expired/unknown ve submission başlangıcı kopyalanır. Aktif/kararsız iş siliniyorsa attempt unknown olur, otomatik kilit kalkmaz. Trigger yazısı başarısızsa ilgili mutation/purge rollback olur; durum kaybolurken başarı denmez. Metadata aktarımı başarılı olduğunda normal print object/row cleanup devam eder.

| Durum | Personel davranışı / fallback |
| --- | --- |
| Kayıt yanıtı kayıp | Aynı registration UUID ile mevcut kayıt; yeni öğrenci yok |
| A4/logo/font/render hatası | Öğrenci korunur; bozuk PDF gönderilmez; aynı snapshot'tan Hazırla tekrar edilir |
| Artefact upload yanıtı kayıp | Aynı receipt status/hash sorgulanır; hazırsa kayıtlı bytes kullanılır |
| Yazıcı offline/queue full/paused/rate limit | Öğrenci ve A4 korunur; Gönder daha sonra; otomatik browser baskısı yok |
| Print object kopyası/finalize yanıtı kayıp | Aynı attempt/job Devam Et; ikinci iş yok |
| uploading/queued ve Agent almamış | Receipt'e scoped reviewer/admin güvenli cancel; DB cancel teyidi sonrası manuel/yeniden basım |
| leased/ready | İptal edilip durdu varsayılmaz; Agent terminal sonucu beklenir |
| submission_started/unknown | Fiziksel yazıcı/spooler kontrolü gerekir; açık reprint/manual risk teyidi ve audit olmadan yeni baskı yok |
| submitted | “Yazıcıya gönderildi”; kâğıt çıktığı iddiası yok. Yeni baskı yalnız açık personel eylemi |
| failed/expired | Submission geçmişi incelenir; belirsizlik varsa kontrol, yoksa açık yeniden gönderim |
| Print job artık yok | Kalıcı attempt sonucu kullanılır; sonuç yoksa unknown, asla basılmadı varsayımı yok |
| Receipt bytes temizlenmiş | Aktif/belirsiz iş kontrolü ardından yeni receipt sürümü; öğrenci/kod aynı |
| Staff oturumu sona ermiş | Mutasyon durur; yeniden giriş → listeden öğrenci → aynı kayıt/attempt |
| R2/D1 kullanılamıyor | Kaydedildi/basıldı iddiası yok; tekrar girişte kayıt UUID'siyle kontrol |

PDF İndir her zaman sadece indirmedir; otomatik baskı başlatmaz. Manuel Yazdır/yeniden baskı intake seviyesinde aktif iş kontrolü yapar. Güvenle iptal edilemeyen/belirsiz işte personel açık “Mevcut baskıyı kontrol ettim; yeni baskı gönder” kararını verir; olası çift kopya riski belirtilir. Bu karar önceki işi iptal olmuş gibi etiketlemez. Açık risk teyidi gerektiğinde eski denemenin gerçek durumu korunarak blocks_new_attempt kaldırılması, gerekçe/aktör teyidi ve yeni attempt INSERT aynı transaction'da yapılır; eski iş cancelled diye yeniden etiketlenmez. Terminal ama submission geçmişi belirsiz failed/expired işi de teyide kadar bloklayabilir. Aynı anda iki reprint de UUID+DB kilidiyle engellenir. Genel print iptalinde mevcut admin yetkisi değişmez; reviewer iptali yalnız receipt servisiyle ve kendi yetki alanındaki uploading/queued, Agent alınmamış receipt işiyle sınırlıdır.

## 10. A4, beş dil ve logo sözleşmesi

Tek sayfa 210×297 mm, dikey; yaklaşık 12–15 mm marj. Üst iki logo, başlık, TR/EN öğrenci alanları, büyük kod, açık site adresi, beş kısa dil bloğu. Uzun ad/pasaport kesilmez. Tek sayfaya sığmayan geçerli içerik için render hatası gösterilir; yazı okunamaz küçüklüğe indirilmez. Font en az 10 pt; takip kodu belirgin ve LTR'dir.

Başlık: “İkamet Başvurusu — Teslim ve Takip Bilgileri”. Alanlar Ad/First name, Soyad/Last name, Pasaport No/Passport No, Başvuru-Teslim Tarihi/Submission date, Başvuru Takip No/Tracking No.

Site origin'i güvenilir `PUBLIC_PORTAL_ORIGIN` yapılandırmasıdır; https ve allowlist doğrulaması zorunlu. Eksik/geçersiz origin'de öğrenci kaydı yapılabilir, A4 gönderilemez; sebep gösterilir. Yerel/test origin fixture'ı ayrı tanımlanır. Kullanıcıdan veya keyfî Host header'dan adres türetilmez. Uygulamada mevcut gerçek öğrenci domain'i doğrulanır; tahminî staging/Workers adresi basılmaz. Mevcut öğrenci takip QR'si kapsamda yoktur; telefon belge QR'si korunur.

Metinler ve ana sayfa düğme etiketleri aynı i18n kaynağından gelir:

- **Türkçe:** 1. Yukarıdaki siteye girin. 2. “Başvurumu Sorgula”ya basın. 3. Bu kâğıttaki Başvuru Takip No'yu girin ve durumunuzu görün.
- **English:** 1. Open the website above. 2. Select “Track my application”. 3. Enter the tracking number on this sheet to see your application status.
- **Русский:** 1. Откройте сайт, указанный выше. 2. Нажмите «Проверить статус заявки». 3. Введите номер для отслеживания с этого листа, чтобы узнать статус заявки.
- **Türkmençe:** 1. Ýokarda görkezilen saýta giriň. 2. «Arzamyň ýagdaýyny barla» düwmesine basyň. 3. Arzaňyzyň ýagdaýyny görmek üçin şu kagyzdaky yzarlama belgisini giriziň.
- **العربية:** ١. افتح الموقع المذكور أعلاه. ٢. اضغط على «تتبّع طلبي». ٣. أدخل رقم متابعة الطلب الموجود في هذه الورقة لمعرفة حالة طلبك.

Arapça lang=ar/dir=rtl, kod LTR; Türkçe/Kiril/Arapça font glyph'leri kontrol edilir. Metinlerin dil uzmanı kontrolü yapıldığı iddia edilmez; görsel QA ve anlaşılabilirlik kontrolü teslim koşuludur.

Renderer: yerel paketlenmiş html2canvas + mevcut pdf-lib; fontlar lisans metniyle birlikte self-hosted Noto Sans ve Noto Sans Arabic. Browser shaping ardından canvas görüntüsü A4 PDF'e gömülür. Runtime CDN eklenmez. Raster metin seçilebilir değildir; web ekranı erişilebilir HTML kalır. Yaklaşık 200 DPI hedeflenir; parser ve gerçek çıktı kontrolüyle tek sayfa/10 MiB altı garanti edilir. Font/logo beklemesi zaman tahminine değil gerçek load/decode ve document.fonts hazır sinyaline dayanır.

Kapak logosu hatası için göreli yollar ve resimlerin hazır olmadan çıktıya alınması kaynakta güçlü adaydır; canlı kök neden doğrulanmış sayılmaz. Önce yeniden üretim testi, sonra ortak same-origin/base-aware logo loader ile bytes/data URL ve decode kullanılır. Başarısız logoda eksik görselli PDF gönderilmez. Mevcut kapak form alanları/ölçüleri korunur. Kapak İndir ve Yazdır ayrı sınanır; 100/500 ms timing workaround'u gerçek hazır olma sinyaliyle değiştirilir.

## 11. Public takip ve trafik kararları

POST `/api/public/physical-intakes/tracking-lookup` yalnız kod alır. Kod query string/loglara yazılmaz. DTO: takip no, teslim tarihi, öğrenciye açıklanan ofis durumu, son güncelleme. Ad/pasaport/PDF/storage key/print metadata/iç UUID/personel notu yoktur. Silinmiş, tahsis aşamasındaki ve bulunamayan kod aynı bulunamadı cevabıdır. Tüketilmiş numaranın public erişimi tahsisin 60 dakikalık expiry'sinden etkilenmez.

Durumlar: PDF yokken “Dosyanız ofise teslim alındı”; under_review + PDF varken “Dosyanız inceleniyor”; approved_for_processing “Dosyanız işleme alınmak üzere onaylandı”; rejected “Ofisle iletişime geçin”. Ofis işlem kaydı kapatılmışsa “Ofis işlemi kapatıldı; bilgi için ofisle iletişime geçin”. Hiçbiri Göç/YÖK gönderimi veya ikamet izni onayı uydurmaz. Kapalı ve eski online/bağımsız fiziksel kayıtlar için veri biçimi ayrımı korunur.

Merkezi limitler: public lookup IP başına 60/5 dakika + (IP,kod hash'i) 15/5 dakika; böylece bir IP başka IP'deki aynı kodu global kilitlemez. Hatalı biçimler IP bütçesinden sayılır; 1 KiB JSON üst sınırı. Ek yeni CAPTCHA/secret yoktur. Başarısız denemeler ayırt edilemeyen cevaplarla dönülür; no-store zorunlu. Kısa kod sınırlı bir durum anahtarıdır, güçlü kimlik doğrulama sayılmaz.

Personel tahsis/yeni kayıt: session başına 60/5 dakika ve staff ID başına 120/5 dakika, aynı session en çok 5 aktif rezervasyon. Receipt job/reprint oluşturma: session başına 60/5 dakika ve staff ID başına 120/5 dakika. İş sayısında idempotent replay yeni iş sayılmaz; Devam Et/status ayrıca session başına 120/dakika ile sınırlıdır. Paylaşılan ofis IP'si için personel limitleri IP temelli değildir. Public print limitleri değişmez; mevcut küresel print kapasitesi (50 aktif iş) ve sayfa/kopya bütçesi korunur. Receipt route server'da bağlı kayıt ve tek sayfa artefact doğrulamadan özel limit kullanamaz.

## 12. Endpoint ve durum sözleşmesi

Tüm staff mutasyonlar reviewer/admin, same-origin, fiziksel gate ve kayıt scope kontrolünden geçer. Değişiklikler lock_version/If-Match kullanır. Public endpoint ayrı DTO verir.

| Endpoint | Sorumluluk |
| --- | --- |
| GET staff physical-intakes/config | Server bugün, doğrulanmış portal origin ve receipt yetenekleri |
| POST staff physical-intakes/reference-reservations | Taslak UUID'sine idempotent kod tahsisi |
| POST staff physical-intakes/registrations | PDF'siz atomik kayıt + receipt snapshot |
| PATCH staff physical-intakes/:id/metadata | Bilgi/tarih düzeltme; kod sabit |
| POST staff physical-intakes/:id/close | Gerekçeli ofis işlem kapanışı |
| POST staff physical-intakes/:id/reopen | Admin; çakışma ve sürüm kontrollü yeniden açma |
| POST staff physical-intakes/:id/receipts | Bilgi/şablon sürümünden receipt; idempotent |
| PUT staff physical-intakes/:id/receipts/:receiptId/content | Değişmez A4 artefact yükle/bind |
| GET staff physical-intakes/:id/receipts/:receiptId | Receipt state/hash ve yetkili preview/download |
| POST staff physical-intakes/:id/receipts/:receiptId/print | İlk baskı veya açık reprint UUID/kararı |
| POST staff physical-intakes/:id/print-attempts/:attemptId/resume | Aynı işin server upload/finalize devamı |
| POST staff physical-intakes/:id/print-attempts/:attemptId/cancel | Güvenli receipt-scoped iptal |
| GET staff physical-intakes/:id/print-attempts | Job purge sonrası da kalıcı durum |
| POST public physical-intakes/tracking-lookup | Salt okunur öğrenci takibi |

Tablodaki staff/public önekleri `/api/staff/` ve `/api/public/` olarak uygulanır. Route isimleri bu planın sözleşmesidir; mevcut `/register`, `/pdf` ve QR endpoints'i geçişte korunur.

Receipt state: awaiting_content → ready → purged; doğrulama hatası awaiting_content'te tekrar hazırlanabilir. Print attempt: prepared → uploading → queued → leased/ready → submission_started → submitted/failed/unknown; cancelled/expired yolları protokole göre. Network error terminal baskı durumu değildir. HTTP 409 conflict/stale, 401 yeniden giriş, 429 bekleme, 503 service/queue/print unavailable ayrı kullanıcı mesajı üretir. Token/PII loglanmaz.

## 13. Uygulama ve canlıya geçiş sırası

1. HEAD/status ve yerel talimatları doğrula. Numara, tarih, kayıt replay, mükerrer, artifact replay, cleanup, rollback için kırmızı davranış testleri kur.
2. Ek migration, DB trigger'ları, eski kayıt uyumluluğu, salt okunur public takip ve receipt server servislerini geliştir. Yeni kayıt UI'sini önce açma.
3. Bilgi-önce ekranı, edit/close, A4 template/artefact ve print devam/manuel fallback'i geliştir. Ortak logo düzeltmesini dar kapsamlı tut.
4. Beş dilde UI/metin eşleştir; eski online/QR/PDF/scanner/print regression'ı doğrula. Restore edilmiş yerel D1 ve temiz bağımlılık ortamında test et.
5. `npm test`, `npm run build:production`, `npm run deploy:dry-run:production` çalıştır; sentetik deterministik PDF fixture'ları kullan. Sonuçlar uygulama raporunda yer alır.
6. Yalnız istenirse üretim D1 backup+restore provası, kaynak/schema/env envanteri; ek migration'ı uygula. Migration başarısızsa hiçbir yeni UI açılmaz; schema/data denetlenmeden devam edilmez.
7. **Uyumluluk sürümü C:** yeni schema, mükerrer/cleanup trigger uyumu, public kod sorgulaması, yeni kaydı düzenleme/PDF, receipt status/indirme ve devam yollarını destekler; yeni kayıt giriş UI'si kapalıdır. C'nin doğrulanmış commit ve Worker version ID'si release raporunda saklanır.
8. **Tam sürüm F:** yeni kayıt/A4 UI'sini açar. C doğrulanmadan F yayımlanmaz. Yeni kayıt kapısı merkezi `PHYSICAL_RECEIPTS_CREATE_ENABLED` kullanır; bu kapı config/ekran ve yeni JSON registration endpoint'inde sunucuda uygulanır, mevcut kayıt receipt hazırlama/indirme/devam ve public sorgulama yollarını kapatmaz; mevcut PHYSICAL_INTAKE_MODE ve PRINT_ENABLED değerleri değişmez.
9. F hatasında yeni kayıt/ilk baskı üretimi kapatılır veya C'ye dönülür. Verilmiş takip numaralarının public sorgusu, mevcut dosyalar, receipt durum/indirme ve mevcut güvenli devam korunur. C öncesi Worker'a tam rollback bu özellik aktive edildikten sonra geçerli geri dönüş değildir.
10. F deploy başarısızsa C kalır. C deploy başarısızsa eski uygulama nullable ek alanlarla çalışır; takip numaralı yeni kayıt üretilmemiş olacağından öğrenciye bozuk kod verilmez. Artifact/attempt purge C ve F'de aynı invariant'ları taşır. DB rollback/destructive down migration yoktur.

Deploy hedefi goc, komut `npm run deploy:production`. D1/R2 veri, secret bindings, cron schedules, scanner, Agent v7, YKN dağıtımları, PRINT_ENABLED=true ve PHYSICAL_INTAKE_MODE=on öncesi/sonrası korunur. Yeni cron schedule veya R2 bucket gerekmez; mevcut bakım handler'ına ayrı bounded receipt cleanup eklenir. Secret değerleri okunmaz/rotate edilmez.

Tarihî kayıtlara migration'da kod/tarih atanmaz. Eski kayıt/PDF/history/status/legacy alanlar korunur. Takip no olmayan eski kayıtlar mevcut işlemlerle kullanılmaya devam eder; toplu backfill ayrı iştir.

## 14. Kabul koşulları ve kanıt

| Alan | Zorunlu davranış testi / kanıt |
| --- | --- |
| Tarih/numara | İstanbul gün sınırı, ileri/geçmiş gün, yıl değişimi, 7 karakter, normalization, collision, expiry |
| Kayıt | PDF'siz kayıt; çift tık/timeout/replay tek öğrenci; farklı gövde 409; transaction rollback |
| Mükerrer | Eski+yeni aynı pasaport/tür; iki paralel kayıt; restore/edit/reopen; eski mükerrerler korunur; kapanış ardından yeni başvuru |
| Artefact | write-once, farklı bytes replay, R2/DB kopması, stale snapshot, 30 gün retention ve canlı attempt koruması |
| Print | Aynı attempt/job resume; stale heartbeat, queue pause/full, expiry, token gerektirmeyen yetkili devam; public auth korunur |
| Cleanup | Browser kapalıyken terminal durum; AFTER UPDATE/BEFORE DELETE; trigger başarısızsa rollback; job yoksa unknown |
| Fallback | Render/asset hatası; güvenli cancel teyidi; leased/unknown için açık fiziksel kontrol/reprint; iki paralel reprint |
| Public | Kod formu ilk görünür; online oturum gizlemez; PII/PDF yetki yok; ortak IP; (IP,kod) rate limit; kod reservation expiry'den bağımsız |
| A4/kapak | Gerçek tek A4 sayfası, iki logo, okunabilir beş dil/RTL, uzun isim; indirilen PDF ve Windows çıktı ayrı |
| PDF/QR/scanner | Boş kayda ilk PDF, mevcut sayfaları koruyan revizyon, 10 MiB/300 sayfa, pending/clean/unsafe/failed, QR 60 dakika ve oturum sınırı |
| Uyumluluk | Eski multipart API + yeni schema; C/F kod sorgu ve PDF düzenleme; F→C sonrası aynı öğrenci kodu çalışır |
| Yük | 10 personel sekmesi/100 kayıt; tekrar numara/öğrenci yok; kuyruk kapasitesi ve ortak hesap limitleri doğru |

Bu turda sadece belge değişir; npm/build/dry-run henüz çalıştırılmaz. Uygulama testleri, yetkili browser, gerçek telefon QR ve fiziksel Windows baskı UAT ayrı kanıtlardır. Deploy/build başarılı olması kâğıdın çıktığını kanıtlamaz. Gerçek baskı ve canlı veri işlemi sadece ilgili aşama istendiğinde yapılır.

## 15. Nihai karar kaydı ve hazır olma sonucu

| İncelemede açık kalan konu | Kesin karar |
| --- | --- |
| Kesinti sonrası aynı A4/token | Değişmez özel R2 artefact, 30 gün + canlı attempt koruması; authenticated server resume, browser token bağımlılığı yok |
| Print job purge sonrası durum | DB transaction içi durum aktarım trigger'ları; print_jobs FK yok; bilinmeyen sonuç unknown ve otomatik basım kilidi |
| Eski kayıt ve tekrar başvuru | Tüm yolları kapsayan DB mükerrer trigger'ları; audit'li ofis işlem kapanışı; yeni başvuru ayrı öğrenci kaydı/kod |
| Geri dönüşte takip | Önce C uyumluluk sürümü, sonra F; yalnız yeni kayıt UI'si geri çekilebilir; verilmiş kodlar C'de çalışır |
| İleri tarih | Kabul + görünür uyarı; takvim geçerliliği zorunlu |
| Render/asset hatası | Öğrenci korunur; bozuk PDF gönderilmez; aynı kayıt üzerinden tekrar hazırlanır |
| Manuel/yeniden basım | Güvenli iptal veya fiziksel kontrol + açık risk teyidi/audit; otomatik fallback yok |
| Personel yoğunluğu | Receipt'e scoped session/staff limitleri; public limitlere dokunma; global kuyruk bütçesi korunur |

Amaç, kapsam, normal yol, kesinti kurtarma, veri yaşam döngüsü, mükerrerlik, yetki, test ve geri dönüş kararları artık tamamdır. Önceki incelemenin dört tasarım eksiği bu belgede kapatılmıştır. **Plan uygulamaya başlangıç için hazırdır; uygulamanın üretime hazır olması kabul testleri ve UAT sonuçlarına bağlıdır.**

Gerçek portal origin'i, font lisans dosyaları ve C/F release kimlikleri uygulama/teslim sırasında doğrulanacak somut girdilerdir; yeni ürün kararı bekleyen boşluk değildir. Mevcut domain kanıtsız tahmin edilmez. İş sahipliği mevcut uygulama ekibindedir; yeni bağımsız servis/Agent sürümü gerekmez.
