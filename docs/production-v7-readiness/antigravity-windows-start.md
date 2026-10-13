# Antigravity — Windows Agent v7 production başlatma ve otomatik başlangıç

8 Ekim 2026. Bu belge talimattır; bu görevde Agent başlatılmadı, Windows ayarı değiştirilmedi veya baskı gönderilmedi. Foreground Agent başlatma ve daha sonra fiziksel UAT için kurum sorumlusunun açık izni gerekir. Public aktivasyon ayrı bir karardır.

## Paket ve hesap

- Kullanılacak paket: `print-agent-windows-v7.zip`.
- SHA-256: `f732c59ca6d04b49bfd450553e890d2359ad0efb5e47c8e04d6c5417103b6a9f`.
- ZIP kökü altında `scripts\print_agent\print_agent.py` ve `requirements.txt` bulunur. `.env.example` otomatik yüklenmez.
- Fiziksel portrait/landscape testlerini geçen Windows hesabını, gerçek Kyocera kuyruk adını, production için atanmış mevcut `PRINT_PRINTER_ID` ve `PRINT_RUNNER_ID` değerlerini kullanın. Eski Agent süreçlerini ve mevcut görevleri kontrol ederek tek runner bırakın; farklı kimlik üretmek ikinci Agent çalıştırmayı güvenli yapmaz.
- Python ortamında paket gereksinimleri `PyMuPDF==1.27.2`, `Pillow==12.3.0`, Windows'ta `pywin32==311` olmalı. Mevcut doğrulanmış ortam kullanılabilir. Yeni ortam gerekirse ZIP kökünden `py -3 -m venv .venv`, ardından `.\.venv\Scripts\python.exe -m pip install -r scripts\print_agent\requirements.txt`.
- Test komutu: `.\.venv\Scripts\python.exe -m unittest discover -s scripts\print_agent -p "test*.py"`. Beklenen 45/45; bu komut Agent başlatmaz veya baskı göndermez.

## İzin sonrası foreground başlatma

Production API origin'i **`https://goc.topkapiuni.workers.dev`** olmalı. `/yazdir/` tarayıcı sayfasıdır; Agent base URL'sine bu yol eklenmez.

Mevcut **production** `PRINTER_SECRET` yetkili operatörün kurumca onaylı güvenli kaynağından alınır. Staging anahtarı varsayılmaz, yeni anahtar üretilmez. Anahtarı chat'e, komut argümanına, `.env` dosyasına, Git'e, `setx` ile kullanıcı/makine ortamına veya loga yazmayın. Aşağıdaki PowerShell örneği değeri ekrana ve komut geçmişine koymadan yalnız mevcut süreç ve Python alt sürecine verir. Komutlar burada çalıştırılmadı.

ZIP'in açıldığı kökte, doğrulanmış Windows hesabıyla:

```powershell
$ErrorActionPreference = 'Stop'
$env:PRINT_AGENT_BASE_URL = 'https://goc.topkapiuni.workers.dev'
$env:PRINT_PRINTER_ID = Read-Host 'Mevcut production printer ID'
$env:PRINT_RUNNER_ID = Read-Host 'Mevcut production runner ID'
$env:PRINT_PRINTER_NAME = Read-Host 'Windows Kyocera kuyrugunun tam adi'
$env:PRINT_AGENT_POLL_SECONDS = '5'
$env:PRINT_AGENT_TEMP_DIR = Join-Path $env:LOCALAPPDATA 'TopkapiPrintAgent\temp'
New-Item -ItemType Directory -Force -Path $env:PRINT_AGENT_TEMP_DIR | Out-Null
$securePrinterSecret = Read-Host 'Mevcut production PRINTER_SECRET' -AsSecureString
$printerCredential = [System.Management.Automation.PSCredential]::new('print-agent', $securePrinterSecret)
try {
    $env:PRINTER_SECRET = $printerCredential.GetNetworkCredential().Password
    & .\.venv\Scripts\python.exe .\scripts\print_agent\print_agent.py
} finally {
    Remove-Item Env:PRINTER_SECRET -ErrorAction SilentlyContinue
    $printerCredential = $null
    $securePrinterSecret = $null
}
```

Özel temp klasörü yalnız çalıştıran hesap ve yöneticilere erişilebilir olmalı. İlk bağlantı **PRINT_ENABLED=false ve UAT kapalıyken** yapılır: Agent gerçek printer kontrolünden sonra heartbeat gönderir. Operatör D1'de taze `health=ready`, `settings_protocol=3` ve doğru tek runner'ı doğrular. Kapalı durumda claim için `503 PRINT_DISABLED` beklenir; Agent'ın `HTTPError` türüyle tekrar deneme kaydı bununla uyumludur. Heartbeat'in 401/403 alması production secret/URL uyuşmazlığıdır; secret değeri paylaşılmadan hata kodu üzerinden incelenir. Bu durumda UAT başlatılmaz.

## Başarılı uçtan uca testten sonra otomatik başlangıç

Varsayılan yöntem: Task Scheduler altında **aynı doğrulanmış hesapla At logon**. Bu, bilgisayar açıldıktan sonra ilgili hesap oturum açınca başlar. Kullanıcı oturumu açılmadan başlatma gerekiyorsa At startup / noninteractive hesap seçimi ayrıca printer erişimi ve gerçek yeniden başlatma testi gerektirir; burada doğrulanmış sayılmaz.

- Secret için kurumun mevcut secret store'u tercih edilir. Yerel seçenek gerekiyorsa aynı Windows hesabında `PSCredential` nesnesini `Export-Clixml` ile, Agent klasörü dışında ACL ile korunan bir dosyada saklayın. Windows DPAPI şifrelemesi aynı kullanıcı ve aynı bilgisayara bağlıdır. Task wrapper `Import-Clixml` ile belleğe alır, yalnız Python alt sürecinin ortamına aktarır; komut satırı/çıktıda secret bulunmaz. [Microsoft Export-Clixml](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.utility/export-clixml?view=powershell-7.4)
- Task action: kurumun onayladığı PowerShell wrapper; `-NoProfile -File <tam-wrapper-yolu>`. Çalışma dizini ZIP kökü; Python ve Agent yolları mutlak olmalı. ExecutionPolicy bypass gerekmez.
- “If the task is already running: Do not start a new instance” / `IgnoreNew`; bir eski service/task/manual runner daha bulunmamalı. Task'ın tek başına `IgnoreNew` ayarı başka bir elle başlatılan Agent'ı engellemez. [Microsoft MultipleInstancesPolicy](https://learn.microsoft.com/en-us/windows/win32/taskschd/taskschedulerschema-multipleinstancespolicy-settingstype-element)
- Ağ erişimi ve sınırlı hata sonrası restart; aynı Windows hesabının printer erişimi. Rastgele yeni runner ID üretmeden aynı atanmış kimlikleri koruyun.
- Otomatik görevi önce **PRINT_ENABLED=false, UAT kapalı** halde yeniden başlatma/oturum açma ile sınayın. Tek süreç ve taze protocol-3 heartbeat görülmeli; fiziksel baskı oluşmamalı.
- Son aktivasyondan sonra operator gözetimi, `unknown` durumunda otomatik tekrar baskı yapılmaması ve kontrollü kapatma yolu doğrulanmalı.

Bu görevde DPAPI dosyası, wrapper, Task Scheduler görevi veya Windows Service oluşturulmadı.


## Bu inceleme sonrası kesin heartbeat doğrulama sırası

Bu adımlar yalnız incelenmiş Worker'ın **onaylı production deploy'u ve kapalı sağlık kontrolleri tamamlandıktan sonra** uygulanır. Fiziksel A/B/C kabulü tamamlanmıştır; yeniden belge gönderilmez.

1. Operatörden PRINT_ENABLED=false, PRINT_UAT_ENABLED=false ve kuyruk boş teyidini alın. Public `/yazdir/` kapalı kalır. ZIP hash'ini `Get-FileHash .\print-agent-windows-v7.zip -Algorithm SHA256` ile yukarıdaki değerle karşılaştırın.
2. Önceden doğrulanmış Windows hesabı/Kyocera kuyruğu ve mevcut production printer/runner ID ile tek v7 foreground sürecini yukarıdaki PowerShell komutuyla başlatın. Secret mevcut production güvenli kaynağından alınır; değerini veya cookie/Authorization header'ı paylaşmayın. Agent kodunu, yerel test PDF'sini ve printer defaults'u değiştirmeyin.
3. Agent `POST /api/printer/heartbeat` gönderir; beklenen 200, health=ready, settings_protocol=3. Heartbeat yaklaşık 20 saniyede bir yenilenir. Operatör aşağıdaki **read-only** SQL ile production D1 üzerinde iki farklı zamanda taze seen_at ve aynı atanmış runner'ı kontrol eder:

```sql
SELECT printer_id, runner_id, health, settings_protocol, seen_at
FROM printer_heartbeats
ORDER BY seen_at DESC LIMIT 5;
SELECT count(*) AS active_jobs FROM print_jobs
WHERE status IN ('uploading','queued','leased','ready','submission_started')
  AND cleanup_status='none';
```

4. Global gate kapalı olduğundan claim için **503 PRINT_DISABLED** ve Agent'ın HTTPError/retry kaydı beklenir. Hiçbir job alınmamalı; active_jobs=0 ve spooler'da yeni job yok. Heartbeat 401/403, health farklı veya protocol farklıysa durun; yalnız hata kodu, zaman ve request ID raporlayın. Secret rotate etmeyin, staging secret denemeyin.
5. Antigravity sonucu şu biçimde bildirir: `production heartbeat PASS — ready / protocol 3 / seen_at iki kontrolde güncellendi / tek runner / queue 0 / fiziksel baskı yok`. Başlatma doğrulanamadıysa aynı alanlarla BLOCKED ve hata kodu. Agent açık bırakılacaksa yetkili operatör gözetimi gerekir; pencere/hash açılmaz, belge finalize edilmez.
6. Bu heartbeat doğrulaması Windows otomatik başlangıç kurma veya tek test PDF'sini gönderme yetkisi değildir. Bunlar sonraki açık onaya bağlıdır.
