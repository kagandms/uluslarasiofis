const fs = require('fs');

let content = fs.readFileSync('app.js', 'utf8');

const targetStr = `
            // Generate HTML for the print area
            const printHtml = getDocumentHtml(vBasvuruNo, vTeslim, vYabanciKimlik, vPasaportNo, vAdi, vSoyadi, vUyrugu, vDogum, vAdres, vTel, vMail, currentYear, vTebligatTarihi, true);
            
            
            // Native window.print() yöntemine dönüldü
            let printArea = document.getElementById('print-area');
            if (!printArea) {
                printArea = document.createElement('div');
                printArea.id = 'print-area';
                document.body.appendChild(printArea);
            }
            printArea.innerHTML = printHtml;
            
            // Geçmişe kaydet
            historyManager.save('print');
            
            showToast('Yazdırma ekranı hazırlanıyor...', 'info');
            setTimeout(() => {
                window.print();
            }, 300);
`;

const replacement = `
            showToast('Yazdırma ekranı hazırlanıyor...', 'info');
            
            // Use html2canvas so print perfectly matches the PDF
            loadPdfLibraries().then(async (loaded) => {
                if (!loaded) {
                    showToast('Yazdırma modülü yüklenemedi.', 'error');
                    return;
                }
                
                const container = document.createElement('div');
                container.style.cssText = 'position:fixed;left:-9999px;top:0;width:794px;background:white;z-index:-1;';
                container.innerHTML = getDocumentHtml(vBasvuruNo, vTeslim, vYabanciKimlik, vPasaportNo, vAdi, vSoyadi, vUyrugu, vDogum, vAdres, vTel, vMail, currentYear, vTebligatTarihi, false);
                document.body.appendChild(container);
                
                try {
                    const canvas = await html2canvas(container.lastElementChild, {
                        scale: 2,
                        useCORS: true,
                        backgroundColor: '#ffffff',
                        logging: false
                    });
                    document.body.removeChild(container);
                    
                    const imgData = canvas.toDataURL('image/jpeg', 0.95);
                    
                    let printArea = document.getElementById('print-area');
                    if (!printArea) {
                        printArea = document.createElement('div');
                        printArea.id = 'print-area';
                        document.body.appendChild(printArea);
                    }
                    
                    // Put the generated image inside print area, stretched to A4 size perfectly
                    printArea.innerHTML = \`<img src="\${imgData}" style="width: 210mm; height: 297mm; display: block; margin: 0 auto; object-fit: fill;">\`;
                    
                    // Geçmişe kaydet
                    historyManager.save('print');
                    
                    setTimeout(() => {
                        window.print();
                    }, 500);
                } catch (err) {
                    console.error(err);
                    showToast('Yazdırma sırasında bir hata oluştu.', 'error');
                    if(document.body.contains(container)) document.body.removeChild(container);
                }
            });
`;

if (content.includes(targetStr.trim().split('\n')[0])) {
    // Basic replace logic
    // Just find the index
    const startIndex = content.indexOf('// Generate HTML for the print area');
    const endIndex = content.indexOf('}, 300);', startIndex) + 8;
    if (startIndex !== -1 && endIndex > startIndex) {
        content = content.substring(0, startIndex) + replacement + content.substring(endIndex);
        fs.writeFileSync('app.js', content, 'utf8');
        console.log('Replaced print block successfully');
    } else {
        console.log('Could not find exact block to replace');
    }
} else {
    console.log('Target string not found');
}
