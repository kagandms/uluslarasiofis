# Ofis PC'si: kurulum ve yeni makineye taşıma rehberi (TASLAK)

Durum: **taslak, başka bir makinede denenmedi** (2026-11-13). Kaynak: bu repodaki betikler ve belgeler, PC oturumunun raporları ve 2026-11-13 kurulumunun konuşma kaydı. PC raporları doğrulanmış kabul edilmemelidir. Her adım ilk gerçek geçişte denenip bu belge güncellenmelidir. İlgili belgeler: [document-storage-setup.md](document-storage-setup.md), [plans/2026-11-12-office-pc-document-storage-plan.md](plans/2026-11-12-office-pc-document-storage-plan.md), [`scripts/print_agent/README.md`](../scripts/print_agent/README.md).

## Ofis PC'sinde çalışanlar

| Bileşen | Ne yapar | Nasıl çalışır |
| --- | --- | --- |
| Şifreli belge deposu (SeaweedFS) | Öğrenci belgelerini AES-256-GCM şifreli saklar. Anahtar PC'de yoktur, Worker secret'ındadır. | Windows servisi `svc-gocdepo`, yalnızca `127.0.0.1:9000` (S3). Veri: `C:\Goc\storage`. |
| Tünel (`cloudflared`) | Worker'ın depoya Workers VPC üzerinden ulaşmasını sağlar. İnternete açık adres yoktur. | Windows servisi `svc-cloudflared`, token dosyadan (`C:\Goc\cloudflared\tunnel.token`). Cloudflare'de tünel `GocTunnel`, VPC servisi `goc-document-store` (kimlik `wrangler.jsonc` içinde). |
| Scanner (ClamAV) | Yüklenen belgeleri tarar; belgeleri Worker'ın API'sinden alır. | Python süreci, kullanıcı oturumunda (Registry `Run`). Kod: [`scripts/scanner/`](../scripts/scanner/). Sır: `scanner.secret` dosyası, Worker'da `SCANNER_SECRET`. |
| Print Agent v7 | Portaldan gelen yazdırma işlerini yazıcıya gönderir (Windows GDI). | Python süreci, kullanıcı oturumunda (Startup). Kod: [`scripts/print_agent/`](../scripts/print_agent/). Sır: DPAPI ile makineye ve kullanıcıya bağlı, Worker'da `PRINTER_SECRET`. |

Önerilen klasör düzeni: `C:\Goc\storage` (gerçek klasör), `C:\Goc\print` ve `C:\Goc\scan` (mevcut ajan klasörlerine **junction**), `C:\Goc\bin` (ikililer), `C:\Goc\config` (yalnızca servis hesabı, SYSTEM ve Administrators), `C:\Goc\cloudflared`, `C:\Goc\logs`.

## Yeni makinenin ön koşulları (önce bunlar)

2026-11-13'te eski PC'de madenci (DLL yan yükleme, SYSTEM yetkisi, Defender kapalı, Windows Update engelli) bulundu. Yeni makinede **hiçbir belge ya da anahtar**, aşağıdakiler `scripts/office-pc/verify-office-pc.ps1` ile doğrulanmadan konmamalıdır:

1. Temiz kurulmuş ve güncel Windows (tercihen 11), destek içinde ve yamaları alıyor.
2. Defender açık ve imzaları güncel; güvenlik duvarı üç profilde açık; BitLocker açık, kurtarma anahtarı güvenli yerde.
3. Korsan etkinleştirme araçları ya da kaynağı belirsiz yazılım yok. Windows lisansı kurumdan.
4. Güç planı: uyku ve hazırda bekletme kapalı, kapak kapanınca bir şey yapma.
5. Otomatik oturum açma, yalnızca BitLocker açıldıktan sonra ve Sysinternals Autologon ile (parola LSA sırrı olarak saklanır).
6. Yönetici olmayan standart bir kullanıcı hesabı ayrılması ve ajanların onunla çalışması önerilir (Print Agent'ın DPAPI sırrı bu hesaba bağlı olur).

Kontrol:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\office-pc\verify-office-pc.ps1
```

Betik yalnızca okur; `FAIL` satırı olmadan devam etmeyin.

## Sırlar: yeni makine = yeni sırlar

| Sır | Nerede | Yenileme |
| --- | --- | --- |
| `SCANNER_SECRET` | Worker secret + PC'de `scanner.secret` | Yeni değer üretilir; ikisi birlikte güncellenir (secret listesi onaylıdır, yeni ad eklenmez). |
| `PRINTER_SECRET` | Worker secret + PC'de DPAPI dosyası | DPAPI dosyası makineye bağlıdır; Print Agent paketindeki `setup_production_secret.ps1` ile yeni makinede yeniden üretilir. |
| `DOCUMENT_STORE_ACCESS_KEY_ID`, `DOCUMENT_STORE_SECRET_ACCESS_KEY` | Worker secret + PC'de depo yapılandırması | Yeni S3 kimliği üretilip iki secret güncellenir. |
| Tünel token'ı | PC'de dosya | Aynı tünel yeni makinede kullanılacaksa aynı token; eski makinedeki bağlantı **durdurulur**. Eski makine ele geçirildiyse token yenilenir. |
| `DOCUMENT_ENCRYPTION_KEYS` | Yalnızca Worker secret | Değişmez; anahtar yedeği çevrimdışı saklanır. Kaybolursa depodaki belgeler kaybolur. |

Değerler sohbete, repoya ya da günlüklere yazılmaz. Secret girmek için `wrangler secret put` kullanın (bkz. [document-storage-setup.md](document-storage-setup.md)).

## Kurulum sırası (yeni makine)

1. Ön koşulları sağlayın ve `verify-office-pc.ps1` ile doğrulayın.
2. **Depo ve tünel:** SeaweedFS zip'ini, WinSW'yi ve `cloudflared.exe`'yi **resmi sayfalardan siz indirin** ve yayıncının SHA-256 değerlerini not edin. Yönetici PowerShell'de önce `-DryRun` ile:

   ```powershell
   .\scripts\office-pc\install-storage.ps1 -WeedZip .\windows_amd64.zip -WeedZipSha256 <hex> -WinSwExe .\WinSW-x64.exe -WinSwSha256 <hex> -CloudflaredExe .\cloudflared.exe -CloudflaredSha256 <hex> -DryRun
   ```

   Çıktı doğruysa aynı komutu `-DryRun` olmadan çalıştırın. Betik karşılaştırma tutmazsa durur; hiçbir şey indirmez. Yaptıkları: `C:\Goc\{bin,config,storage,logs,cloudflared}`; `svc-gocdepo` ve `svc-cloudflared` (sanal servis hesabı, yalnızca `127.0.0.1`); izinler **servis oluştuktan sonra**; iki S3 kimliği (yerel yönetici kimliği ve yalnızca `documents` bucket'ına yetkili Worker kimliği, ikisi de rastgele üretilir ve ekrana yazılmaz); `documents` bucket'ı. Worker kimliği `C:\Goc\config\worker-s3.txt` dosyasına (yalnızca Administrators) yazılır; iki değeri Worker secret'larına elle girin.
   Sonra tünel token'ını Cloudflare panelinden alıp bir dosyaya kaydedin ve `.\scripts\office-pc\install-tunnel.ps1 -TokenFile <dosya> -DryRun`, ardından gerçek çalıştırma. Token yokken `svc-cloudflared` manuel başlangıçta bırakılır (aksi halde çöküp durur).
3. **Scanner:** Python 3.12, ClamAV (imzalar için `freshclam`), `scripts\scanner\requirements.txt`; `SCANNER_ORIGIN`, `SCANNER_RUNNER_ID`, `SCANNER_STATE_DIR`, `SCANNER_SECRET_FILE` değişkenleri (bkz. [`run-scanner.bat`](../scripts/scanner/run-scanner.bat)); yeni `scanner.secret`.
4. **Print Agent:** yazıcı sürücüsü tam olarak `Uluslararası Ofis` adıyla (Kyocera TASKalfa 2554ci KX) ve yazıcıya (10.10.x.x ağı) erişimle kurulur; Python ortamı ve `requirements.txt`; `PRINT_AGENT_BASE_URL`, `PRINTER_SECRET`, `PRINT_PRINTER_ID`, `PRINT_RUNNER_ID`, `PRINT_PRINTER_NAME`, `PRINT_AGENT_TEMP_DIR` değişkenleri; yeni DPAPI sırrı. Paket ve test ayrıntıları: [`scripts/print_agent/README.md`](../scripts/print_agent/README.md) ve v7 paketi ([`print-agent-orientation-v7/`](print-agent-orientation-v7/)).
5. Yeniden başlatma testi: servisler oturum açılmadan kalkıyor mu; otomatik oturum sonrası scanner ve Print Agent başlıyor mu.
6. `verify-office-pc.ps1`'i yeniden çalıştırın.

## Depodaki veriyi taşıma

Belgeler şifreli olduğundan veri klasörü kopyalanırken sızıntı riski düşüktür, ama silinmesi ya da bozulması belge kaybı demektir. Yöntemler:

1. **Veri klasörünü kopyalamak:** `svc-gocdepo`'yu durdurun, `C:\Goc\storage` içeriğini yeni makineye (robocopy ya da disk) kopyalayın, yeni makinede aynı bucket ve kimliklerle servisi başlatın. Tutarlı kopya için servis durmuş olmalıdır.
2. **R2'den yeniden taşımak:** R2'de belgelerin kopyası duruyorsa (`dual` modda yeni yüklemeler R2'ye de yazılır) Worker'ın yönetici taşıma rotası yeni depoya yeniden çalıştırılır ([document-storage-setup.md](document-storage-setup.md), "Geçiş"). R2 boşaltıldıysa bu yöntem yoktur.
3. **Yedekten geri yüklemek.** Yedek yöntemi henüz seçilmedi ve geri yükleme denenmedi; bu bölüm yedek kurulunca doldurulacak.

Geçiş anı: yeni depo hazır ve doğrulanınca, eski makinedeki `cloudflared` servisini durdurup yenisini başlatın (aynı tünel ve aynı VPC servisi, Worker ayarı değişmez). Worker'ın S3 secret'ları yeni kimlikle güncellenir. Doğrulama: `dual` modda bir kuru çalıştırma `already_present` döndürmeli, test başvurusuyla yükleme ve önizleme çalışmalı.

Geri dönüş: eski makinenin servislerini yeniden başlatın ve S3 secret'larını eski kimliğe döndürün; ya da `DOCUMENT_STORAGE_BACKEND` değerini `r2` yapın (yalnızca `dual` modda R2'de tüm kopyalar durduğu sürece güvenlidir).

## Eski PC'nin kurulum özeti (2026-11-13, PC oturumu raporu, doğrulanmadı)

- Servisler WinSW 2.12.0 ile: sanal hesap `NT SERVICE\svc-x`, SID türü UNRESTRICTED, Automatic, kurtarma `restart` 5 sn. `svc-gocdepo` komutu: `weed server -dir=C:\Goc\storage -ip=127.0.0.1 -ip.bind=127.0.0.1 -master.telemetry=false -filer=true -s3=true -s3.port=9000 -s3.ip.bind=127.0.0.1 -s3.port.iceberg=0 -s3.port.lance=0 -s3.config=C:\Goc\config\s3.json`.
- SeaweedFS 4.53; dinlenen portlar (hepsi `127.0.0.1`): master 9333/19333, volume 8080/18080, filer 8888/18888, S3 9000/19000; `cloudflared` metrik 20241.
- S3 kimlikleri: `gocdepo-local` (Admin, Read, Write, List, Tagging) ve `goc-worker` (yalnızca `Read:documents`, `Write:documents`, `List:documents`; silme `Write` içinde). Anahtar biçimi: erişim kimliği 20 karakter (`GOCW` + 16 base32), gizli anahtar 40 alfanümerik. `s3.json` yalnızca açılışta okunur; kimlik eklenince servis yeniden başlatılır.
- Doğrulanan S3 davranışı: ETag tırnaklı (MD5); `If-None-Match: *` → 412; `If-Match` yanlışsa 412; meta başlığı `X-Amz-Meta-goc-content-type`; region serbest; imzalanan `Host` origin'e gelen `Host` ile aynı olmalı.
- Eski PC'de bulunan bir anormallik: `C:\Goc\config` klasörüne PC oturumunun eklemediği `DESKTOP-HN1ST5H\User:(F)` izni eklenmişti. Yeni kurulumda `config` yalnızca SYSTEM, Administrators ve (okuma) `svc-gocdepo` iznine sahip olmalıdır; `verify-office-pc.ps1` bu klasörü kontrol eder.
- Eski PC'de hızlı başlatma açıktı; yeni makinede **kapatın** (kapat-aç gerçek bir yeniden başlatma olsun).
- Print Agent: `%APPDATA%\...\Startup\TopkapiPrintAgent.vbs` ile Python 3.12 venv içinde (`PyMuPDF`, `Pillow`, `pywin32`), `prod_secret.dpapi` makine ve kullanıcıya bağlı. Scanner: `HKCU\...\Run` kaydıyla sistem Python'u ve ClamAV 1.5.4, `scanner.secret` dosyası, kullanıcı ortam değişkenleri `SCANNER_ORIGIN`, `SCANNER_RUNNER_ID`, `SCANNER_STATE_DIR`, `SCANNER_SECRET_FILE`, `SCANNER_DATABASE_DIR`, `SCANNER_CLAMSCAN`, `SCANNER_FRESHCLAM`. İkisi de kullanıcı oturumuna bağlıdır; otomatik oturum yoksa yeniden başlatmadan sonra çalışmazlar. S3 ve tünel servisleri oturumdan bağımsızdır.
- Yazıcılar: `Uluslararası Ofis` (Kyocera TASKalfa 2554ci KX, port `10.10.0.228_2`, varsayılan) ve `E244` (Kyocera ECOSYS M3145idn KX).

## Bu kurulumda öğrenilenler

- SigV4 imzası, VPC üzerinden iletilen `Host` başlığıyla (`127.0.0.1:9000`) tutuyor; Cloudflare başlıkları değiştirmiyor.
- Worker tarafında bellek sınırı: büyük dosyaları 8'lik partilerle taşırken aralıklı `503` görüldü; parti boyutu otomatik küçültülünce geçti.
- `SignatureDoesNotMatch` hatası, secret access key'in eksik ya da hatalı girilmesinden çıktı; girişte karakter sayısını (40) kontrol edin.
- Servis hesabı (`NT SERVICE\svc-...`) servis oluşturulmadan çözülmez; izinleri servisten sonra verin.
- WinSW günlük klasörü servis hesabına yazılabilir olmalı: `svc-cloudflared` bu yüzden 290'dan fazla kez çöktü. Token yokken `svc-cloudflared`'ı Automatic yapmayın. Manual başlangıç çökme döngüsünü durdurmaz; kurtarma eylemini kaldırmak için `cmd /c 'sc.exe failure svc-x reset= 0 actions= ""'` gerekir (PowerShell 5.1 boş `""` argümanını iletmez).
- `weed` 4.x: `-s3.port.iceberg=0` ve `-s3.port.lance=0` verilmezse ek portlar açılabilir; `-ip.bind` ve `-s3.ip.bind` `127.0.0.1` olmazsa depo LAN'a açılır. `weed help` takılabilir, sürüm için `weed version`.
- Yönetici bile `s3.json`'u okuyamaz (yalnızca SYSTEM ve `svc-gocdepo`); değiştirmek için geçici `icacls /grant` ve sonra `/remove:g` gerekir, servis yeniden başlatılır.
- PowerShell 5.1: değişken adlarında büyük/küçük harf ayrımı yoktur; `curl` bir takma addır (`curl.exe`); `Set-Content` ANSI yazar, BOM'suz UTF-8 için `[IO.File]::WriteAllText`; SigV4 için `curl.exe --aws-sigv4` ve kimlik bilgisi komut satırına değil `-K` dosyasına yazılmalıdır.
- DPAPI sırları makineler arasında taşınamaz. Canlı depo klasörü bir bulut istemcisiyle senkronlanmaz; yedek için ayrı salt okunur kimlikle `rclone` (şifreli uzak hedef) ya da servis durdurulup anlık görüntü gerekir.
- `wrangler secret put` ve panelden eklenen değişkenler canlı Worker'a hemen yeni sürüm olarak girer; yayın akışının secret ve bağlama kontrolü onaylı listeyle birebir eşleşme ister ([manual-production-release.md](manual-production-release.md)).
