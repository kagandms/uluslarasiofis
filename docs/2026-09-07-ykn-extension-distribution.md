# YKN Eklenti Dağıtımı

## Amaç

Yeni bir bilgisayarda portal açıldığında YKN eklentisi yoksa kullanıcıya anlaşılır bir hata ve güncel eklenti indirme bağlantısı göstermek.

## Karar

- Portal `PING/PONG` köprüsüyle eklentinin hazır olup olmadığını kontrol eder.
- Köprü yanıt vermezse YKN çalışma alanında indirme ve kurulum yardım alanı görünür.
- Portal yalnızca ZIP dosyasını indirebilir; tarayıcı güvenliği nedeniyle eklentiyi kullanıcının onayı olmadan kuramaz.
- `predev` ve `prebuild` adımları eklenti kaynaklarını doğrudan `ykn_eklenti-main` klasöründen paketler.
- Paket sürümlü bir ZIP, `latest` kopyası ve sürüm metadata dosyası olarak yayınlanır.

## Güncelleme davranışı

`ykn_eklenti-main/manifest.json` içindeki sürüm veya eklenti dosyaları değiştiğinde `npm run dev` ya da `npm run build` yeni ZIP’i yeniden üretir. Portal metadata dosyasını cache kullanmadan okuyup sürümlü indirme adresine yönelir.

## Kurulum sınırı

Kullanıcı ZIP’i klasöre çıkarıp `chrome://extensions` veya `yandex://extensions` üzerinden “Paketlenmemiş öğe yükle” adımını bir kez tamamlamalıdır. Kurulumdan sonra portal yenilenir ve köprü tekrar kontrol edilir.
