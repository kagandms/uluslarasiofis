# Tabletten günlük deployment: sadeleştirme kararı ve en kısa yol

Durum: inceleme önerisi; bu dal Draft PR olarak değerlendirilmelidir. Production yayın kilidi açılamaz. Bu belge hiçbir backup, restore, rollback, merge veya deploy işlemini yetkilendirmez. Mevcut kodun bütün recovery şartlarını uygulanmış ya da zorunlu hedef mimari olarak kabul etmeyin.

## Değerlendirme

Mevcut hazırlık, gerçek kanıt yerine düzenlenmiş JSON alanlarının kabul edilmesini engeller ve yalnız sentetik veriyle kurtarma testini sağlar. Ancak dört ayrı imza otoritesi, yeni controller/observer servisleri, her taze yedeğin kendisini restore etme şartı ve her release'e bağlı 15 dakikalık tutarlılık penceresi bu projenin **şemayı ve kaynakları değiştirmeyen günlük kod yayını** için gereğinden ağırdır. Bu servisler kurulmuş değildir; sırf mevcut verifier şemasını karşılamak için kurulmaları önerilmiyor. Ortak print/belge retention modeli de veri silme politikasını gereksiz uzatabilir.

Bu dal inceleme malzemesidir; CI'ın yeşil olması mevcut recovery tasarımını merge etmeyi önermek için yeterli değildir. Sade model kararlaştırıldıktan sonra bu Draft PR'daki politika ve testler o modele göre ayrıca düzenlenmeli. Bugün kapılar gevşetilmedi, `enabled:false` ve koşulsuz publication lock korundu.

## Her normal kod deployment'ında gerekenler

| Kapı | Uygulanacak kısa kontrol |
| --- | --- |
| Kaynak ve yetkilendirme | Yalnız manuel dispatch, güncel production HEAD ile tam SHA eşitliği; başarılı required CI; Production environment reviewer onayı; en dar mevcut deployment kimliği yalnız bu environment'ta |
| Artifact | Aynı SHA'nın CI'da test edilmiş dist paketi; allowlist dosya listesi, boyut ve SHA-256 round-trip kontrolü; onaydan sonra yeniden build yok |
| Canlı hedef ve veri sınırı | Worker `goc`, doğru account/D1/R2; runtime secret isim/tipleri, vars, cron ve migration ledger beklenenle aynı; değer okumadan drift'te dur; deploy job'ında migration/export/restore komutu yok |
| Kurtarma hazır mı? | Onaylı backup kaynağının güncel başarı/varlık/retention metadata'sı ve geçerli periyodik restore raporu; başarısız/eski/eksik veya güvenilmeyen kayıtta dur. Her deploy için yeni backup veya aynı backup'a yeni restore şartı yok |
| Worker geri dönüşü | Son sağlıklı immutable Worker+asset sürümü kaydı ve şema/secret/binding/cron/vars uyumluluğu; değişmeyen sözleşme için önceki inceleme tekrar kullanılabilir, canlı sürüm/drift kontrolü yine yapılır |
| Yayın ve sonuç | Tek concurrency grubu, yayın anında SHA'yı tekrar kontrol; doğrulanmış aynı artifact; runtime secret değerlerini koruyan yol; sadece sabit public GET health check ve hatada açık başarısızlık kaydı |

Health check başarısızlığı otomatik D1/R2 restore veya otomatik iş tekrarı başlatmaz. Worker rollback yalnız ayrıca onaylı bir operasyon olur. Şeması değişmeyen kod da hatalı veri yazabileceğinden normal deploy'da backup sağlığı kontrolünü tamamen kaldırmak doğru değildir.

## Ayrı bakım/kurtarma süreci

- **Günlük başlangıç önerisi:** D1 Time Travel erişimi/retention'ını doğrula; şema, indeks, trigger ve ledger içeren şifreli SQL yedeğini ayrı backup kimliğiyle otomatik al. Mevcut günlük JSON backup tek başına yeterli SQL kurtarma yolu değildir. Sıklık ve retention veri kaybı hedefi (RPO) ve bütçe onayına bağlıdır.
- **R2:** Belgeler için private bağımsız kopya, içerik hash'li envanter ve onaylı lifecycle kullan. Her gün tüm byte'ları tekrar kopyalamak yerine doğrulanabilir artımlı kopya değerlendir; silmeler/tombstone ve zincir tamamlığı test edilmeli. İlk kopya ve sonraki sürekli kopyalama ayrı açık veri işleme onayı ister.
- **Geçici print dosyaları:** Varsayılan olarak uzun dönem arşive dahil etme önerisi ayrıca kapsam kararıdır; mevcut gate bugün bu istisnayı kabul etmez. D1 kuyruk/referansları ile geçici byte kaybının etkisini değerlendir; saklama süresini sessizce uzatma. Restore sonrası eski işleri otomatik tekrar yazdırma. Print'i kapsam dışı bırakmak açık onay ve uyarlanmış test/politika gerektirir.
- **Restore provası:** İlk etkinleştirmeden önce gerçek bir yedeği üretime yazamayan, dış servisleri kapalı izole kaynaklarda doğrula. Sonrasında aylık başlangıç önerisi ve backup formatı, şema, şifreleme veya storage politikası değiştiğinde tekrar; yeni günlük yedekler aynı test edilmiş üretici/format/şema kapsamına bağlı olmalı. Aynı exact backup'ı her gün restore etme şartı yerine provenance ve değişiklik geçerliliğini doğrula.
- **Alarm ve kanıt:** Backup hatası/gecikmesi ve yaklaşan restore geçerlilik sonu için tek bakım akışında alarm. Kanıt gerçek çalışmadan gelmeli: kaynak/kapsam, zaman, SHA-256, sonuç ve güvenilir job/provider provenance. Repo içine `passed:true` yazmak kanıt değildir. İmza gerekiyorsa mevcut güvenilir servis/managed key kullan; dört yeni servis kurmayı ön koşul yapma. CI'da private veri, nesne anahtarı, signed URL veya decrypt/secret değeri bulunmamalı.
- **Maliyet:** Mevcut reusable CI + manuel release yeterli günlük hat olsun; bakım tek ayrı workflow/işte schedule ve manuel tetiklemeyi paylaşabilir. Sentetik restore zaten CI'da olduğundan ek `recovery-preparation.yml` normal deploy için gerekli değildir; sadeleştirme revizyonunda kaldırılması değerlendirilmeli. Yeni npm bağımlılığı eklenmedi. Hesap/DB/R2 hacmi bilinmeden fiyat veya RPO/RTO garantisi verilemez; ana giderler saklanan byte, R2 işlemleri, D1 export/import ve periyodik test compute'udur.

Şema migration'ı, destructive işlem, binding/cron değişikliği ve secret rotasyonu normal günlük akışa sokulmamalı: değişikliğe özel backup, uyumluluk/restore planı ve ayrıca onay gerekir. Migration release workflow'unda otomatik çalışmaz. D1/R2 arasında atomik snapshot yoktur; tutarlılık yöntemi ve eksik/geçici nesne davranışı gerçek kurtarma hedefi için ilk prova öncesi çözülmeli. Günlük kod yayınına her seferinde üretimi durdurma şartı eklenmemeli.

## En kısa uygulanabilir yol haritası

1. **Kapsamı bir kez kararlaştır:** Bu Draft PR üzerinden sade modeli seç; ayrı kimliklerle read-only envanter, D1 plan/Time Travel, R2 hacim/lifecycle, belgeler/print kapsamı, retention ve maliyet tavanını onayla. Deployment token'ına yetki ekleme. Metadata erişimi ve gerçek veri export/kopyası onaylarını ayır.
2. **Tek gerçek kurtarma kanıtı oluştur:** Açık export/kopya ve izole restore onayından sonra en küçük uygun private backup hedefini kur; SQL+R2 kapsamını gerçekten yedekle/geri yükle, hash ve referansları doğrula; print/scanner/cron yan etkilerini kapat. Worker geri dönüş hedefinin code/assets ve veri sözleşmesini doğrula; production üzerinde restore veya rollback yapma. Ardından aynı mekanizmayı günlük backup + periyodik restore olarak otomatikleştir; dört otoriteli zorunluluğu ve exact-backup restore bağını reviewed değişiklikle sadeleştir.
3. **Mevcut manuel release'i tamamla:** Yeni paralel deployment sistemi kurmadan test edilmiş artifact'tan deploy yolunu, salt okunur health check'i ve sade metadata sağlık kapısını ekle; önce yayın kilidi kapalı rehearsal ve gerçek GitHub CI ile doğrula. Artifact yeniden build edilmemeli. Mevcut preflight kimlik/binding/secret/cron/ledger korumaları kalmalı.
4. **Ayrı son onay:** Revize tasarım ve gerçek kanıt incelendikten sonra PR merge ve yayın kilidini kaldıran değişiklik için ayrıca onay al. İlk gerçek deploy yine ayrı açık onay + GitHub Production reviewer onayı ister. Sonraki günlük kullanım: tablet → Codex değişiklik/PR → CI → incelenmiş merge → manuel exact-SHA release → GitHub onayı.

Bugün tamamlanmayanlar: güncel cloud backup varlığı/bağımsız kopya, onaylı kapsam/retention, gerçek izole restore, doğrulanmış Worker geri dönüş hedefi, güvenilir otomatik kanıt üretimi ve exact-artifact gerçek deploy yolu. Bu eksikler başarılı gibi gösterilmedi. Güncel publication lock kalkmadı; bu dal production uygulama, D1/R2, secret değerleri veya cron davranışını değiştirmiyor.
