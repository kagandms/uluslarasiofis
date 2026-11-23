# Cloudflare: bot koruması ve hız sınırı rehberi (asistan ve soru formu)

- **Tarih:** 2026-11-20
- **Kapsam:** `topkapiunigoc.com` için Cloudflare panelinde yapılacak iki ayar. Yalnızca hesap sahibi yapabilir; kod değişikliği gerektirmez.
- **Doğrulama durumu:** Menü adları Cloudflare'in o günkü arayüzüne göre yazıldı, ekranda denenmedi. Adlar değişmişse "Security" altında arayın. Ücretsiz plan sınırları değişebilir; panel ne gösteriyorsa onu esas alın.

## Neden

Asistan (`/api/public/chat`) ve soru formu (`/api/public/inquiries`) herkese açık. Uygulama kendi sınırlarını uyguluyor (IP başına 15 dakikada 60 sohbet isteği, günlük 100 / genel 300 yapay zekâ kullanımı). Cloudflare kuralı, bu sınırlara ulaşmadan önce saldırgan trafiği Worker'a hiç yaklaştırmaz ve maliyeti korur.

## 1. Bot Fight Mode (ücretsiz)

1. Cloudflare paneline girin, `topkapiunigoc.com` alanını seçin.
2. **Security** → **Settings** (eski arayüzde **Security → Bots**).
3. **Bot traffic** bölümünde **Bot fight mode** düğmesini **açın**.
4. Kayıt gerekmez; hemen geçerli olur.

Not: Bu mod bazı güvenli botları (arama motorları) yok saymaz ama otomasyonla gelen şüpheli istekleri zorlar. Yazıcı Ajanı (Print Agent), tarayıcı ve GöçNet eklentisi API'ye farklı yoldan geldiği için etkilenmemeli. Açtıktan sonra ofis yazıcısı ve tarayıcıyı bir kez deneyin; bozulursa kapatın ve bana yazın.

## 2. Hız sınırı kuralı (Rate limiting)

1. **Security** → **Security rules** (eski arayüz: **WAF → Rate limiting rules**) → **Create rule** → **Rate limiting rule**.
2. **Rule name:** `public-chat-and-inquiries`
3. **If incoming requests match…** → **Edit expression** ile şunu yapıştırın:

```text
(http.request.method eq "POST" and http.request.uri.path in {"/api/public/chat" "/api/public/inquiries"})
```

4. **Same characteristics:** IP.
5. **Requests / Period:** ücretsiz planda süre genelde **10 saniye** ile sınırlı. **15 istek / 10 saniye** girin. (Üniversite ağında çok öğrenci aynı genel IP'yi kullanabilir; bu yüzden düşük tutmayın.)
6. **Action:** Block. **Duration:** 10 saniye (ücretsiz planda tek seçenek olabilir).
7. **Deploy**.

Ücretsiz planda genelde yalnızca **1** hız sınırı kuralı olur; yukarıdaki ifade iki yolu tek kuralda toplar.

## Sonra kontrol

- Ana sayfada `?bot=1` ile asistan çalışıyor mu, soru formu gönderiliyor mu?
- Cloudflare **Security → Events** sayfasında engellenen istekler görünüyor mu? Normal kullanımda hemen hiç engelleme olmamalı.
- Çok engelleme varsa eşiği 30 istek / 10 saniyeye çıkarın.
