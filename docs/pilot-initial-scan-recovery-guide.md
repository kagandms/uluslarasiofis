# İlk temiz olmayan belgenin güvenli yenilenmesi

Bu kılavuz yeni adayın öğrenci/personel davranışını anlatır. Uzak staging, fiziksel cihaz ve kurum kimlik kontrolü UAT'si **NOT EXECUTED**; yerel test sonucu pilot açılış kararı değildir.

## Personel

Başvuru pending tarama ile gönderilmiş olabilir. `submitted` başvuruda mevcut **İncelemeye Başla** işlemini kullanın. `under_review` veya devam eden `resubmission_required` başvuruda, güncel revizyon `submitted`, yükleme finalized, upload-intent completed ve cleanup none ise:

- `clean`: mevcut içerik yenileme/onay/erişim akışı korunur.
- `unsafe` veya terminal `failed`: **Yeniden Yükleme İste** görünür. En az 3 görünür, en fazla 1000 karakterlik anlaşılır öğrenci gerekçesi girin. Örneğin şifreli/bozuk dosya için şifresiz ve açılabilir yeni dosya isteyin. Zararlı dosyayı açarak kontrol etmeyin.
- `pending`: yenileme/onay/okuma yetkisi açılmaz. Scanner'ın hazır olup olmadığını ve backlog'u izleyin. Başarısız denemenin job sonucu `failed` olsa da file hâlâ pending olabilir; file ancak üç deneme tükendiğinde terminal failed olur.

Non-clean belgede Önizle/İndir/Onayla sunulmaz; API ve ZIP kapıları da kapalıdır. Yenileme isteği güvenlik onayı değildir. Gerekçe, öğrenci mesajı, belge ve başvuru durumları, audit aynı atomik işlemde kaydedilir. 409 durumunda güncel başvuruyu tekrar okuyun; eski revizyon üzerinde işlemi tekrarlamayın. Tarama sonucu, current revizyon veya başvuru durumu commit öncesi değişirse işlem reddedilir.

Yeni yükleme mevcut diğer temiz belge onaylarını değiştirmez. İstenen belgelerin yenilenmesi bittiğinde personel mevcut kurallarla incelemeye devam eder; tek bir temiz dosya bütün başvuruyu onaylamaz. Başka bir güncel belge pending/non-clean ise bütün başvuru ZIP'i hâlâ kapalı kalır.

## Öğrenci

Başvuru numarası ve erişim koduyla `/basvuru/` üzerinden, ayrı cihazda da kendi oturumunuzu açabilirsiniz. Owner takip ekranındaki personel gerekçesini okuyun. Yalnız istenen belge kodu için yeni, uygun PDF/JPEG/PNG/WebP dosyası gönderin; istenmeyen belge değiştirilemez. Başvuru numarası veya öğrenci numarası tek başına yükleme yetkisi değildir.

Tarayıcı yüklemesi, finalize ve object doğrulaması tamamlandığında yeni revizyon current/pending olur ve ayrı scanner işi alır. “Yükleme tamamlandı” temiz tarama veya insan onayı anlamına gelmez. İlk dosyanın unsafe/failed verdict'i korunur; eski lease/result yeni revizyonu clean yapamaz. Yeni dosya gerçek scanner clean sonucu alana kadar erişim/onay kapalıdır. Önceden istenmiş replacement'ın unsafe/failed `unsafe_scan_retry` yolu korunur.

Kod ve oturum kaybolduysa yeni başvuru açmayı tekrarlamayın. Tek aktif başvuru kuralı sürer; [yetkili destek prosedürü](pilot-lost-draft-support.md) fiziksel/kurumsal doğrulama gerektirir.

## Uzak kabul beklentileri

PM öğrenci/personel kullanım kitine yukarıdaki yenileme davranışı ve pending ile clean ayrımı aktarılmalı. Bu repo kitin dağıtılmış kopyasını içermez; o kopyanın güncellendiği veya gerçek UAT'nin geçtiği iddia edilmez.

İki ayrı uzak vaka çalıştırılmalı: ilk finalize → pending iken gerçek submit → initial unsafe; aynı zincirde şifreli/bozuk dosya → üç deneme sonunda terminal failed. Her birinde mevcut Start Review → gerekçeli yenileme → ikinci cihazda kodla owner erişimi → yalnız istenen belge yeni current/pending/job → yeni gerçek temiz tarama → dosya erişimi ve personel onayı kanıtlanmalı. İlk dosya non-clean, diğer belge onayları değişmeden kalmalı; CSRF/cross-owner/stale sonuç ve istenmeyen belge replacement reddi doğrulanmalı.

Capability güvenliği nedeniyle ilk finalize sonrası iş yaklaşık 10 dakikaya kadar bekleyebilir. Gerçek staging'de bekleme/backlog ölçülmeli; uzak DB'de `available_at` değiştirilmemeli. Yerel testin queue saatini hızlandırması bu sürenin ölçümü değildir. Bütün bu uzak satırlar **NOT EXECUTED**.
