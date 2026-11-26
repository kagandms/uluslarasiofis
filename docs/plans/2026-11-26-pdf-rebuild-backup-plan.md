# Yedek belge katmanı: PDF yeniden oluşturma ve yeni revizyon planı

- Tarih: 2026-11-26
- Kapsam: Tarayıcının imza kaynağı (ClamAV upstream) kesildiğinde kullanılacak yedek katman. Yalnızca PDF belgeleri için yeniden oluşturma ve yeni revizyon olarak kaydetme.
- Kaynak: Bu oturumda incelenen kod ve canlı durum kayıtları (`scripts/scanner/`, `src/server/domain/scanner-policy.js`, `src/server/repositories/d1/*`, 26 Kasım 2026 canlı tarayıcı durumu).
- Doğrulama durumu: **Henüz doğrulanmadı.** Bu bir plan. Hiçbir kod yazılmadı, yerel test yapılmadı, canlıya dokunulmadı.

## 1. Neden gerekli

- Tarayıcı, ClamAV imza dosyasının yaşı kabul süresini aşınca duruyor. Bu süre 24 saatten 72 saate çıkarıldı, ama upstream uzun süre yayın yapmazsa yine duracak.
- Yedek katman, imza eskiyken dosyaları işleme almaya devam edebilmek için tasarlandı. Kendi imza veritabanımızı kurmuyoruz.
- Yeniden oluşturma, PDF içindeki gizli öğeleri (JavaScript, gömülü dosya, otomatik eylem) temizler. Yine de bilinen tüm zararlıları yakalayamaz. Bu nedenle sonuç, tam tarama sonucu değil, "azaltılmış güvence" olarak işaretlenecek.

## 2. Kararlar (sahibi onayladı)

- Yeniden oluşturulmuş PDF, orijinal belgenin **üstüne yazılmaz**. Yeni bir revizyon olarak kaydedilir.
- Bu revizyon **taranmış** sayılır. İndirilebilir ve önizlenebilir olmalı, mevcut taranmış belgeler gibi davranmalı.
- Personelin ve kullanıcının ayrıca bir tarama adımı yapmasına gerek yoktur. Otomatik çalışır.
- Yeniden tarama (imza geldiğinde yeniden kontrol) bu planın kapsamında **değil**.

## 3. Mevcut durum (kanıtlar)

- Sonuç doğrulaması, sonucun SHA-256 değerini iş kaydındaki orijinal dosyayla eşleştiriyor ([scanner-policy.js:56](src/server/domain/scanner-policy.js:56)). Yeniden oluşturulmuş bir dosya bu eşleşmeyi bozar. Bu yüzden yeni revizyon gerekir.
- "Temiz" sonuç için tam tarama kanıtı şart ([scanner-policy.js:41](src/server/domain/scanner-policy.js:41)). Yedek modda bu kural değişecek ve sonucu ayırt edecek yeni bir sonuç türü gerekecek.
- Revizyon durumu (`scan_status`) 13'ten fazla sunucu modülünde kapı olarak kullanılıyor: indirme, önizleme, inceleme, başvuru hazırlığı, yeniden gönderim ve GöçNet aktarımı. Yeni revizyonun bu kapılardan geçmesi için dosya kaydı ve iş kaydı tutarlı olmalı.
- Runner, dosyaları sunucudan geçici olarak çekip tarıyor ve işi bitince siliyor. Yeniden oluşturma da aynı geçici dosya alanında yapılmalı. Kalıcı yerel kopya tutulmamalı.

## 4. Aşamalar

### Aşama 1: Runner'da PDF yeniden oluşturma (sunucu değişikliği yok)

- Kapsam: `scripts/scanner/` altında yeniden oluşturma modülü. Girdi: indirilmiş PDF. Çıktı: yeni PDF ve bir özet (kaldırılan öğeler, sayfa sayısı, başarı durumu).
- Yapılacaklar: JavaScript, gömülü dosya, otomatik eylem ve şifreli içeriğin kaldırılması. Sayfaların görüntüye çevrilip yeni PDF'e konması (en güçlü temizlik) veya seçili bir yapısal temizlik.
- Test: `test/scanner/` altında gerçek test PDF'leri (metinli, formlu, JavaScript'li, gömülü dosyalı). Metin ve sayfa sayısı korunmalı, riskli öğeler kalkmalı.
- Çıkış ölçütü: Test sonuçları yerelde kanıtlanmış ve test kayıtları eklenmiş olmalı.

### Aşama 2: Sunucu tarafı yeni revizyon (ayrı onay)

- Yeni endpoint: runner yeniden oluşturulmuş PDF'i yükler, sunucu boyut, SHA-256 ve tür kontrolü yapar, yeni revizyon kaydı oluşturur.
- Şema: Yeni revizyon ile orijinal arasında bağ ve yedek modu işaretleyen bir alan. Bu migration paylaşılan `migrations/` klasöründe olduğu için sahiplik ve tam yayın yolu gerekir.
- Sonuç türü: Yedek modda "azaltılmış güvence" sonucu için yeni kod. Mevcut `clean` kapılarının bu revizyonu kabul etmesi için kapsam belirlenmeli.
- Test: `test/scannerApi.test.js` altında bellek içi veritabanıyla, yeni revizyonun indirme, önizleme ve inceleme kapılarından geçtiğini kanıtlayan testler.

### Aşama 3: Yayın (ayrı onay)

- Görev dalı birleştirilmeden önce `npm test`, `npm run build:production`, `npm run deploy:dry-run:production` çalışmalı.
- Tam yol: önce `preflight`, sonra `publish`. GitHub'da Production environment onayı gerekir.
- Staging kullanılmadığı için yayın öncesi doğrulama yalnızca yerelde ve dry-run ile yapılır.

## 5. Riskler

- Yeniden oluşturma, resmi belgelerdeki form alanlarını, dijital imzaları veya fontları bozabilir. Bu, sahibinin kabul ettiği bir risk.
- Yedek modda kabul edilen dosyalar, bilinen zararlıları kaçırabilir. Bu bir güvenlik kararı ve kayıt altına alınmalı.
- Sunucu şeması değişirse mevcut revizyonlar ve geriye dönük raporlama etkilenebilir.
- Upstream imza gecikmesi uzarsa, bu yedek katman da sınırsız çalışmaz. Upstream sorununu çözmez.

## 6. Açık sorular

- Yeniden oluşturmada sayfa görüntüye çevrilsin mi (en güçlü temizlik, dosya boyutu ve kalite maliyeti) yoksa yapısal temizlik yeterli mi?
- Yedek modda kabul edilen dosyalar için personele ayrı bir gösterge gösterilsin mi? (Kullanıcı bunu istemedi, ama kayıt tutulması gerekebilir.)
- Yedek mod ne zaman otomatik devreye girsin? Örneğin imza yaşı 72 saati aştığında.

## 7. Sonraki adım

- Aşama 1'in yerelde yapılması ve sonucun bu plana göre kaydedilmesi.
