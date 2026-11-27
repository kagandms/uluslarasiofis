# Kabul testleri — yetkili günlük iş akışı (2026-11-27)

Kaynak: `claude/portal-update-features-plan-7a67da`. Yalnız yerel ortam ve sentetik veri. "Oto" = `test/acceptance*.test.js` (Worker + bellek içi D1 / jsdom), "Tarayıcı" = yerel Vite + yerel D1.

## A — Durum metinleri, tekrar yükleme, soru notu
| No | Senaryo ve beklenen sonuç |
| --- | --- |
| A01 | `sent_to_migration` ve `migration_approved` yeni metinleri öğrenci takibinde 5 dilde döner; eski metin hiçbir yanıtta yok |
| A02 | "Gönderildi" başvuruda taramadan geçemeyen belge: incelemeye al + tekrar iste → öğrenci takibinde yeniden yükleme ve sebep görünür |
| A03 | Göç'e iletilmiş başvuruda tekrar isteme reddedilir, kayıt değişmez |
| A04 | Aynı istek iki kez / eski revizyon numarasıyla → 409, veri bozulmaz |
| A05 | Yenisi yüklenmiş eski hatalı dosya ve silinmiş başvuru tarama listesinde yok; tarama makinesi ucu kişisel veri döndürmez |
| A06 | Not: ekle, düzenle, sil; iki personel çakışmasında 409 ve ilk not korunur; 1000 kabul, 1001 ret |
| A07 | Not hiçbir herkese açık yanıtta ve denetim kaydında yok; oturumsuz 401, başka köken 403; soru silinince not da gider |

## B — Topi belge çıktısı ve puantaj
| No | Senaryo ve beklenen sonuç |
| --- | --- |
| B01 | Ekran görüntüsündeki cümleler doğru belge + 10 kopya |
| B02 | 9 belgenin her biri en az 4 yazımla (Türkçe karaktersiz, yazım hatalı, kibar cümle) doğru belge |
| B03 | "checklist", "dilekçe", "form", "kayıt", "ikamet", "lisansüstü başvuru" → hiçbir belge kendiliğinden yazdırılmaz, seçenek sunulur, adet korunur |
| B04 | 0, 51, -3 kopya reddedilir; 1 ve 50 kabul |
| B05 | Tebliğ, çalışma saati, YKN, YÖKSİS, gelen soru ve durum değiştirme cümleleri yazdırmaya gitmez; "sil/onayla" reddedilir |
| B06 | Puantaj: kişi başı ayrı dosya, yalnız o kişinin saatleri; 30 günlük ay, yarım saat, toplam; boş gün ile 0 saat ayrı (dosya geri okunarak) |
| B07 | Geçmiş ay, boş ay, Şubat; Türkçe dosya adı; kütüphane yoksa anlaşılır hata |

## C — Excel eşitleme ve öğrenci görünümü
| No | Senaryo ve beklenen sonuç |
| --- | --- |
| C01 | Her Excel durumu doğru sonuca gider (onay, eksik evrak, inceleme, sorgulanmadı=değişiklik yok) |
| C02 | Orta grubu 00/13/99 olan numaralar; kayıt tarihi 29/30/31 gün eski ve boş |
| C03 | Kısa ad eşleşir; farklı ad ve tek sözcük elle kontrole; aynı öğrencinin iki açık kaydı elle kontrole (yalnız online seçilse de) |
| C04 | Önizleme tek başına hiçbir veriyi değiştirmez; onaysız kayıt değişmez; tekrar uygulama güvenli |
| C05 | Önizlemeden sonra kayıt veya Excel değişirse çakışma, yazma yok |
| C06 | Eski sorgulu Excel yeni eksik evrak işaretini silemez; yeni sorgulu "incelemede" siler |
| C07 | Eksik evrak → öğrenci uyarı ve son tarihi görür (açıklama, başvuru no görmez); onaylanınca veya geri alınınca uyarı kaybolur |
| C08 | Filtreler (eksik evrak, onaylandı, eski sorgu) doğru sayı ve sayfalama; kalıcı silmede ek bilgi temizlenir |

## Sonuçlar (2026-11-27, yerel)

| Maddeler | Otomatik | Not |
| --- | --- | --- |
| A01–A07 | 7/7 geçti | İlk koşuda 4 hata test yazımından kaynaklandı (yanlış mod adı, belge kodu, sütun adı, yanıt alanı) |
| B01–B07 | 7/7 geçti | İlk koşuda 2 hata Excel okuma biçiminden kaynaklandı |
| C01–C08 | tümü geçti (11 test) | İlk koşuda hatalar test verisi ve beklenti biçiminden kaynaklandı |

- Bu turda ürün kodunda hata bulunmadı; ürün kodu değişmedi.
- Duyarlılık denemesi (geçici kopyada ürün bilerek bozuldu): tarih koruması, ad eşleşmesi, sürüm denetimi, not çakışması, kopya sınırı, silinmiş başvuru filtresi, boş gün, öğrenci uyarısı. 8/8 yakalandı; sonuncusu için ilk turda test eksikti, eklendi.
- Tam paket: `npm test` 2.523 test, 2.522 geçti, 1 atlandı; `build:production` ve `deploy:dry-run:production` geçti.
- Tarayıcı (geçici kopya, yapay zekâ yerine boş yanıt veren taklit): Topi cümleleri doğru belge ve adet verdi; belirsiz istekte seçenek düğmeleri göründü; seçilen belgenin PDF'i hazırlandı. İkamet, YÖKSİS ve çalışma saatleri ekranlarında 375 px'te yatay taşma ölçülmedi.
- **Doğrulanamadı:** yazdırma penceresinin açılması (test tarayıcısı yeni pencereyi engelliyor; mevcut yazdırma yolu değişmedi), gerçek yapay zekâ modeli, gerçek portal verisiyle eşitleme.
