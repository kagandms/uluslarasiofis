# QR bağlantısını erken sonlandırma — onaylanan kapsam

Karar: PC'de “QR bağlantısını bitir” düğmesi bağlantıyı tamamen kapatır. Yeniden kullanım yeni QR ve telefon eşleştirmesi gerektirir. Duraklatma seçeneği kullanıcı tarafından tercih edilmedi.

- Kullanıcı: mevcut yetkili personel; aynı oturum/sahiplik kontrolü korunur.
- Amaç: kullanılmayan bağlantının PC ve telefon sorgularını sonlandırmak.
- Aktif fotoğraf alımı/yüklemesi korunur; sunucu atomik olarak uploading/finalized fotoğraf varken sonlandırmayı reddeder.
- PC'ye alınmış dosyalar korunur; telefonda gönderilmemiş seçimler silinmez ve tekrar gönderilemez olarak işaretlenir.
- Kapatma isteği başarısızsa bağlantı yerelde kaybolmaz; tekrar denenebilir.
- Telefon sonraki durum kontrolünde bağlantının sona erdiğini öğrenir, sorguları durdurur ve yeni QR ister.
- Mevcut 1 saniyelik PC, 1,5 saniyelik telefon aktif aktarım aralığı korunur; ek sürekli sorgu yoktur.
- Yerel kod ve testler; production deploy bu istek kapsamında yapılmaz.

Varsayımlar: tek aktif PC paneli mevcut modal akışında yönetilir; telefon ağdaysa kapanmayı mevcut polling aralığında öğrenir. Ağ kesintisinde sunucu kapatması otoritedir. Migration veya yeni kaynak gerekmez. Bakım mevcut aktarım modülleri içindedir.
