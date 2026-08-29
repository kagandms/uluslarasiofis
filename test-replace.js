function getDocumentHtml(vBasvuruNo, vTeslim, vYabanciKimlik, vPasaportNo, vAdi, vSoyadi, vUyrugu, vDogum, vAdres, vTel, vMail, currentYear, vTebligatTarihi, isPrint = false) {
    // For print, we use width:100% and max-width:210mm to let the browser size it.
    // For PDF, we use fixed width:794px.
    const wrapperStyle = isPrint 
        ? "font-family:'Times New Roman',Times,serif;padding:5mm 10mm;color:black;background:white;border:4px double black;box-sizing:border-box;min-height:264mm;max-width:210mm;margin:0 auto;display:flex;flex-direction:column;-webkit-print-color-adjust:exact;print-color-adjust:exact;"
        : "font-family:'Times New Roman',Times,serif;padding:12mm 14mm;color:black;background:white;border:4px double black;box-sizing:border-box;width:794px;min-height:1120px;display:flex;flex-direction:column;";
        
    return `
        <style>
            .pt { width: 100%; border-collapse: collapse; margin-bottom: 5px; }
            .pt th, .pt td { border: 1px solid #000; padding: 9px 10px; text-align: left; vertical-align: middle; font-size: 14px; font-family: 'Times New Roman', serif; }
            .pt th { font-weight: bold; }
        </style>
        <div id="${isPrint ? 'pdf-content' : 'pdf-canvas-content'}" style="${wrapperStyle}">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
                <div style="width: 60px; height: 60px; display: flex; align-items: center; justify-content: flex-start;">
                    <img src="topkapi_logo.jpg" style="height: 100%; width: auto; mix-blend-mode: multiply;" crossorigin="anonymous">
                </div>
                <div style="flex: 1; border: 1px solid black; margin: 0 15px; padding: 8px 0; text-align: center; font-size: 16px; font-weight: bold;">
                    İSTANBUL TOPKAPI ÜNİVERSİTESİ
                </div>
                <div style="width: 60px; height: 60px; display: flex; align-items: center; justify-content: flex-end;">
                    <img src="goc_logo.png" style="height: 100%; width: auto;" crossorigin="anonymous">
                </div>
            </div>
            <table class="pt" style="margin-bottom:4px;">
                <tr><td colspan="4" style="height:18px;"></td></tr>
                <tr>
                    <th width="25%"><u>e</u>-İkamet<br>Başvuru No</th><td width="25%">${currentYear}-${vBasvuruNo.replace(new RegExp('^' + currentYear + '-'), '')}</td>
                    <th width="25%">Öğrencinin Evraklarını<br>Ofise Teslim Tarihi</th><td width="25%">${vTeslim}</td>
                </tr>
                <tr>
                    <th>Yabancı Kimlik<br>No</th><td>${vYabanciKimlik}</td>
                    <th>Pasaport No</th><td>${vPasaportNo}</td>
                </tr>
                <tr>
                    <th>Adı</th><td>${vAdi}</td>
                    <th>Soyadı</th><td>${vSoyadi}</td>
                </tr>
                <tr>
                    <th>Uyruğu</th><td>${vUyrugu}</td>
                    <th>Doğum Tarihi</th><td>${vDogum}</td>
                </tr>
                <tr>
                    <td></td>
                    <td style="text-align:center;">Adres</td>
                    <td style="text-align:center;">Tel No</td>
                    <td style="text-align:center;">Mail</td>
                </tr>
                <tr>
                    <th>Öğrencinin<br>İletişim Bilgisi</th>
                    <td>${vAdres.toUpperCase().startsWith('İSTANBUL') ? '' : 'İSTANBUL, '}${vAdres}</td>
                    <td>${vTel}</td>
                    <td>${vMail}</td>
                </tr>
            </table>
            <p style="text-align:justify;font-size:11.5px;margin:6px 0;line-height:1.3;text-indent:30px;">
                6458 sayılı Kanunun 38. maddesi çerçevesinde istenilen aşağıdaki belgelerin ekte sunulduğuna dair işbu tebliğ ve tebellüğ belgesi tanzim edilerek taraflarca imza altına alınmış, belgenin bir sureti tarafınıza teslim edilmiş olup, diğer sureti İl Göç İdaresi Müdürlüğüne gönderilecektir.
            </p>

            <p style="font-weight:bold;font-size:12px;margin:8px 0 4px 0;">BELGELER:</p>
            <ul style="list-style:none;padding:0 0 0 10px;margin:0;font-size:10.5px;line-height:1.2;">
                <li style="margin-bottom:1px;">☐ İkamet izni kayıt/başvuru formu (öğrenci tarafından ıslak imzalı şekilde)</li>
                <li style="margin-bottom:1px;">☐ Pasaport ya da pasaport yerine geçen belge (aslı görüldü şeklinde)</li>
                <li style="margin-bottom:1px;">☐ Öğrencilik durumunu gösterir belge</li>
                <li style="margin-bottom:1px;">☐ 4 adet biometrik fotoğraf</li>
                <li style="margin-bottom:1px;">☐ Geçerli sağlık sigortası (GSS ya da ikamet izni talep süresini kapsayan özel sağlık sigortası)</li>
                <li style="margin-bottom:1px;">☐ Kalacağı adres bilgilerini gösterir belge
                    <ul style="list-style-type:disc;padding-left:20px;margin:2px 0;">
                        <li>Kendi evinde kalıyorsa, tapu fotokopisi (uzatma başvurularında "yerleşim yeri belgesi ve fatura" yeterlidir)</li>
                        <li>Kira sözleşmesi ile kalıyorsa, kira sözleşmesinin noter onaylı örneği</li>
                        <li>Otel vb. konaklama yerlerinde kalınıyorsa, bu yerlerde kalındığına dair belge</li>
                        <li>Öğrenci yurtlarında kalınıyorsa, yurtta kalındığına dair belge</li>
                        <li>Destekleyici yanında kalınıyorsa, yanında kaldığı kişinin noter onaylı taahhüdü (Destekleyici evli ise ayrıca eşinin de noter onaylı taahhüdü)</li>
                    </ul>
                </li>
                <li style="margin-bottom:1px;">☐ İkamet izni belge bedelinin ödendiğine dair makbuz</li>
                <li style="margin-bottom:1px;">☐ 18 yaşından küçük yabancılar için; vize muafiyetiyle ya da farklı amaca yönelik vizeyle gelenler için; veli/vasi bilgisini içeren belge (doğum belgesi, aile belgesi vb.) ve veli/vasi/yasal temsilcisi tarafından verilen muvafakatname (amacına uygun vizeyle ((öğrenim vizesi)) gelenler için; muvafakatname ve veli/vasi bilgisini içeren belge eklenmeyecektir.)</li>
            </ul>
            <p style="font-weight:bold;font-size:12px;margin:12px 0 4px 0;text-align:center;border:1px solid #000;padding:6px;">Tebliğ belgenizi teslim almak üzere müracaat edebileceğiniz en erken tarih: ${vTebligatTarihi}</p>
            <div style="margin-top:auto;display:flex;justify-content:space-around;font-weight:bold;font-size:13px;padding-bottom:15mm;padding-top:15px;">
                <div style="text-align:center;"><u>TEBLİĞ EDEN</u><br><br>Üniversite Personeli</div>
                <div style="text-align:center;"><u>TEBELLÜĞ EDEN</u><br><br>Yabancı Öğrenci</div>
            </div>
        </div>
    `;
}
