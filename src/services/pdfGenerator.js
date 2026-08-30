import { CDN_URLS } from '../config/constants.js';
import { getFormData, getFormElements } from '../ui/formManager.js';
import { historyManager } from '../managers/historyManager.js';
import { showToast } from '../ui/toastManager.js';
import { calculateTebligatDate } from '../utils/dateUtils.js';

let generatedPdf = null;
let generatedPdfName = "";
let pdfLibsLoaded = false;
let isPdfLoading = false;

export async function loadPdfLibraries() {
    if (pdfLibsLoaded) return true;
    if (isPdfLoading) {
        while(isPdfLoading) {
            await new Promise(r => setTimeout(r, 100));
        }
        return pdfLibsLoaded;
    }

    isPdfLoading = true;
    showToast('PDF kütüphaneleri yükleniyor, lütfen bekleyin...', 'info');

    try {
        await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = CDN_URLS.HTML2CANVAS;
            script.onload = resolve;
            script.onerror = () => reject(new Error('html2canvas yüklenemedi'));
            document.head.appendChild(script);
        });

        await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = CDN_URLS.JSPDF;
            script.onload = resolve;
            script.onerror = () => reject(new Error('jspdf yüklenemedi'));
            document.head.appendChild(script);
        });

        pdfLibsLoaded = true;
        isPdfLoading = false;
        return true;
    } catch (e) {
        isPdfLoading = false;
        showToast('PDF sistemi yüklenemedi. İnternet bağlantınızı kontrol edin.', 'error');
        console.error(e);
        return false;
    }
}
export function getDocumentHtml(vBasvuruNo, vTeslim, vYabanciKimlik, vPasaportNo, vAdi, vSoyadi, vUyrugu, vDogum, vAdres, vTel, vMail, currentYear, vTebligatTarihi, isPrint = false) {
    
    // PC'deki çok beğenilen büyük ve okunaklı ayarları her iki cihaza da uyguluyoruz
    const s = {
        wrapperPad: '4mm 14mm',
        tableFont: '14px',
        tablePad: '7px 10px',
        pFont: '14px',
        pMargin: '14px 0',
        pLineHeight: '1.6',
        titleFont: '15px',
        listFont: '13.5px',
        listLineHeight: '1.5',
        listMb: '5px',
        innerListMb: '4px',
        boxFont: '15.5px',
        boxMargin: '16px 0 8px 0',
        boxPad: '10px',
        sigFont: '15px',
        sigPadBottom: '16mm'
    };

    // Yazdırırken (isPrint = true) vh (ekran boyutu) KULLANMIYORUZ çünkü mobilde sayfayı kesiyor.
    // Doğrudan A4 boyutu olan 287mm kullanıyoruz (Tüm sanal yazıcıların kenar boşluklarına sığması için 297mm yerine 287mm).
    // PDF (isPrint = false) için tam oran olan 1122px kullanıyoruz.
    const wrapperStyle = isPrint 
        ? `font-family:'Times New Roman',Times,serif;padding:${s.wrapperPad};color:black;background:white;border:4px double black;box-sizing:border-box;max-width:210mm;height:287mm;margin:0 auto;-webkit-print-color-adjust:exact;print-color-adjust:exact;display:flex;flex-direction:column;overflow:hidden;`
        : `font-family:'Times New Roman',Times,serif;padding:${s.wrapperPad};color:black;background:white;border:4px double black;box-sizing:border-box;width:794px;height:1122px;display:flex;flex-direction:column;overflow:hidden;`;
        
    return `
        <style>
            .pt { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
            .pt th, .pt td { border: 1px solid #000; padding: ${s.tablePad}; text-align: left; vertical-align: middle; font-size: ${s.tableFont}; font-family: 'Times New Roman', serif; }
            .pt th { font-weight: bold; }
        </style>
        <div id="${isPrint ? 'pdf-content' : 'pdf-canvas-content'}" style="${wrapperStyle}">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; flex-shrink: 0;">
                <div style="width: 60px; height: 60px; display: flex; align-items: center; justify-content: flex-start;">
                    <img src="topkapi_logo.jpg" style="height: 100%; width: auto; mix-blend-mode: multiply;" crossorigin="anonymous">
                </div>
                <div style="flex: 1; border: 1px solid black; margin: 0 15px; padding: 6px 0; text-align: center; font-size: 16px; font-weight: bold;">
                    İSTANBUL TOPKAPI ÜNİVERSİTESİ
                </div>
                <div style="width: 60px; height: 60px; display: flex; align-items: center; justify-content: flex-end;">
                    <img src="goc_logo.png" style="height: 100%; width: auto;" crossorigin="anonymous">
                </div>
            </div>
            <table class="pt" style="margin-bottom:6px; flex-shrink: 0;">
                <tr><td colspan="4" style="height:12px;"></td></tr>
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
            <p style="text-align:justify;font-size:${s.pFont};margin:${s.pMargin};line-height:${s.pLineHeight};text-indent:30px; flex-shrink: 0;">
                6458 sayılı Kanunun 38. maddesi çerçevesinde istenilen aşağıdaki belgelerin ekte sunulduğuna dair işbu tebliğ ve tebellüğ belgesi tanzim edilerek taraflarca imza altına alınmış, belgenin bir sureti tarafınıza teslim edilmiş olup, diğer sureti İl Göç İdaresi Müdürlüğüne gönderilecektir.
            </p>

            <p style="font-weight:bold;font-size:${s.titleFont};margin:8px 0 4px 0; flex-shrink: 0;">BELGELER:</p>
            <ul style="list-style:none;padding:0 0 0 10px;margin:0;font-size:${s.listFont};line-height:${s.listLineHeight}; flex-shrink: 0;">
                <li style="margin-bottom:${s.listMb};">☐ İkamet izni kayıt/başvuru formu (öğrenci tarafından ıslak imzalı şekilde)</li>
                <li style="margin-bottom:${s.listMb};">☐ Pasaport ya da pasaport yerine geçen belge (aslı görüldü şeklinde)</li>
                <li style="margin-bottom:${s.listMb};">☐ Öğrencilik durumunu gösterir belge</li>
                <li style="margin-bottom:${s.listMb};">☐ 4 adet biometrik fotoğraf</li>
                <li style="margin-bottom:${s.listMb};">☐ Geçerli sağlık sigortası (GSS ya da ikamet izni talep süresini kapsayan özel sağlık sigortası)</li>
                <li style="margin-bottom:${s.listMb};">☐ Kalacağı adres bilgilerini gösterir belge
                    <ul style="list-style-type:disc;padding-left:20px;margin:2px 0;">
                        <li style="margin-bottom:${s.innerListMb};">Kendi evinde kalıyorsa, tapu fotokopisi (uzatma başvurularında "yerleşim yeri belgesi ve fatura" yeterlidir)</li>
                        <li style="margin-bottom:${s.innerListMb};">Kira sözleşmesi ile kalıyorsa, kira sözleşmesinin noter onaylı örneği</li>
                        <li style="margin-bottom:${s.innerListMb};">Otel vb. konaklama yerlerinde kalınıyorsa, bu yerlerde kalındığına dair belge</li>
                        <li style="margin-bottom:${s.innerListMb};">Öğrenci yurtlarında kalınıyorsa, yurtta kalındığına dair belge</li>
                        <li style="margin-bottom:${s.innerListMb};">Destekleyici yanında kalınıyorsa, yanında kaldığı kişinin noter onaylı taahhüdü (Destekleyici evli ise ayrıca eşinin de noter onaylı taahhüdü)</li>
                    </ul>
                </li>
                <li style="margin-bottom:${s.listMb};">☐ İkamet izni belge bedelinin ödendiğine dair makbuz</li>
                <li style="margin-bottom:${s.listMb};">☐ 18 yaşından küçük yabancılar için; vize muafiyetiyle ya da farklı amaca yönelik vizeyle gelenler için; veli/vasi bilgisini içeren belge (doğum belgesi, aile belgesi vb.) ve veli/vasi/yasal temsilcisi tarafından verilen muvafakatname (amacına uygun vizeyle ((öğrenim vizesi)) gelenler için; muvafakatname ve veli/vasi bilgisini içeren belge eklenmeyecektir.)</li>
            </ul>
            <p style="font-weight:bold;font-size:${s.boxFont};margin:${s.boxMargin};text-align:center;border:1px solid #000;padding:${s.boxPad}; flex-shrink: 0;">Tebliğ belgenizi teslim almak üzere müracaat edebileceğiniz en erken tarih: ${vTebligatTarihi}</p>
            
            <!-- This pushes the signature block to the bottom of the page -->
            <div style="flex-grow: 1;"></div>

            <div style="margin-top:10px;display:flex;justify-content:space-around;font-weight:bold;font-size:${s.sigFont};padding-bottom:${s.sigPadBottom};padding-top:10px;page-break-before:avoid;break-before:avoid; flex-shrink: 0;">
                <div style="text-align:center;"><u>TEBLİĞ EDEN</u><br><br>Üniversite Personeli</div>
                <div style="text-align:center;"><u>TEBELLÜĞ EDEN</u><br><br>Yabancı Öğrenci</div>
            </div>
        </div>
    `;
}

export async function generateAndDownloadPdf(btnDownload) {
    if (generatedPdf) {
        generatedPdf.save(generatedPdfName);
        historyManager.save('pdf');
        
        btnDownload.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" class="btn-icon"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><line x1="9" y1="15" x2="15" y2="15"></line></svg> PDF İndir`;
        btnDownload.style.backgroundColor = '#c0392b';
        btnDownload.style.borderColor = '#c0392b';
        generatedPdf = null;
        return;
    }

    const libsReady = await loadPdfLibraries();
    if (!libsReady) return;

    btnDownload.innerHTML = `<span class="spinner" style="width: 14px; height: 14px; border-width: 2px; margin-right: 8px;"></span> Hazırlanıyor...`;

    setTimeout(async () => {
        try {
            const data = getFormData();
            const fields = getFormElements();
            
            const currentYear = new Date().getFullYear();
            const vBasvuruNo = data.basvuruNo || "";
            const vTeslim = data.teslimTarihi || "";
            const vYabanciKimlik = ""; 
            const vPasaportNo = data.pasaportNo || "";
            const vAdi = data.adi || "";
            const vSoyadi = data.soyadi || "";
            const vDogum = data.dogumTarihi || "";
            const vAdres = data.adres || "";
            const vTel = data.tel || "";
            const vMail = data.mail || "";
            
            let vUyrugu = data.uyrugu || "";
            if (fields.uyrugu && fields.uyrugu.value === 'OTHER' && fields.uyruguOther) {
                vUyrugu = fields.uyruguOther.value || "";
            }

            const vTebligatTarihi = calculateTebligatDate(vTeslim);

            const container = document.createElement('div');
            container.style.position = 'fixed';
            container.style.left = '-9999px';
            container.innerHTML = getDocumentHtml(vBasvuruNo, vTeslim, vYabanciKimlik, vPasaportNo, vAdi, vSoyadi, vUyrugu, vDogum, vAdres, vTel, vMail, currentYear, vTebligatTarihi, false);
            document.body.appendChild(container);

            const canvas = await window.html2canvas(container.querySelector('#pdf-canvas-content'), {
                scale: 2,
                useCORS: true,
                backgroundColor: '#ffffff'
            });
            document.body.removeChild(container);

            const imgData = canvas.toDataURL('image/jpeg', 0.95);
            const pdf = new window.jspdf.jsPDF({
                orientation: 'portrait',
                unit: 'mm',
                format: 'a4'
            });

            const pdfW = pdf.internal.pageSize.getWidth();
            const pdfH = (canvas.height * pdfW) / canvas.width;
            pdf.addImage(imgData, 'JPEG', 0, 0, pdfW, pdfH);
            
            generatedPdf = pdf;
            
            const fName = vAdi.replace(/[^a-zA-ZğüşıöçĞÜŞİÖÇ\s]/g, '').trim().split(' ').join('_');
            const fSurname = vSoyadi.replace(/[^a-zA-ZğüşıöçĞÜŞİÖÇ\s]/g, '').trim().split(' ').join('_');
            generatedPdfName = `ONBILGI_${fSurname}_${fName}.pdf`;

            btnDownload.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" class="btn-icon"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> PDF Hazır - Tıkla İndir`;
            btnDownload.style.backgroundColor = '#27ae60';
            btnDownload.style.borderColor = '#27ae60';

        } catch (err) {
            console.error('PDF oluşturma hatası:', err);
            showToast('PDF oluşturulurken bir hata meydana geldi.', 'error');
            btnDownload.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" class="btn-icon"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><line x1="9" y1="15" x2="15" y2="15"></line></svg> PDF İndir`;
        }
    }, 100);
}

export async function printDocument(btnPrint) {
    const originalText = btnPrint.innerHTML;
    btnPrint.innerHTML = `<span class="spinner" style="width: 14px; height: 14px; border-width: 2px; margin-right: 8px;"></span> Hazırlanıyor...`;

    setTimeout(() => {
        try {
            const data = getFormData();
            const fields = getFormElements();

            const currentYear = new Date().getFullYear();
            const vBasvuruNo = data.basvuruNo || "";
            const vTeslim = data.teslimTarihi || "";
            const vYabanciKimlik = ""; 
            const vPasaportNo = data.pasaportNo || "";
            const vAdi = data.adi || "";
            const vSoyadi = data.soyadi || "";
            const vDogum = data.dogumTarihi || "";
            const vAdres = data.adres || "";
            const vTel = data.tel || "";
            const vMail = data.mail || "";
            
            let vUyrugu = data.uyrugu || "";
            if (fields.uyrugu && fields.uyrugu.value === 'OTHER' && fields.uyruguOther) {
                vUyrugu = fields.uyruguOther.value || "";
            }

            const vTebligatTarihi = calculateTebligatDate(vTeslim);

            const printArea = document.getElementById('print-area');
            if (printArea) {
                printArea.innerHTML = getDocumentHtml(vBasvuruNo, vTeslim, vYabanciKimlik, vPasaportNo, vAdi, vSoyadi, vUyrugu, vDogum, vAdres, vTel, vMail, currentYear, vTebligatTarihi, true);
            }

            historyManager.save('print');

            setTimeout(() => {
                window.print();
                btnPrint.innerHTML = originalText;
                // iPhone/iOS Safari asenkron (non-blocking) çalışır.
                // Anında temizleme yaparsak ekrana boş sayfa yansır.
                // HTML zaten CSS ile gizli olduğu için kodun burada kalması zararsızdır.
            }, 500);

        } catch (err) {
            console.error('Yazdırma hatası:', err);
            showToast('Yazdırma hazırlığı sırasında hata oluştu.', 'error');
            btnPrint.innerHTML = originalText;
        }
    }, 100);
}
