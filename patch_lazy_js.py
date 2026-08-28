import sys

with open('app.js', 'r') as f:
    content = f.read()

lazy_logic = """
    // --- Lazy Load PDF Libraries ---
    let pdfLibsLoaded = false;
    let isPdfLoading = false;
    async function loadPdfLibraries() {
        if (pdfLibsLoaded) return true;
        if (isPdfLoading) {
            // Wait for it to finish if it's currently loading
            while(isPdfLoading) {
                await new Promise(r => setTimeout(r, 100));
            }
            return pdfLibsLoaded;
        }
        
        isPdfLoading = true;
        showToast('PDF modülleri yükleniyor, lütfen bekleyin...', 'info');
        
        try {
            await Promise.all([
                new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
                    script.onload = resolve;
                    script.onerror = reject;
                    document.head.appendChild(script);
                }),
                new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
                    script.onload = resolve;
                    script.onerror = reject;
                    document.head.appendChild(script);
                })
            ]);
            pdfLibsLoaded = true;
            return true;
        } catch (e) {
            showToast('PDF kütüphaneleri yüklenemedi. İnternet bağlantınızı kontrol edin.', 'error');
            return false;
        } finally {
            isPdfLoading = false;
        }
    }
"""

content = content.replace("    let generatedPdfName = \"\";", lazy_logic + "\n    let generatedPdfName = \"\";")

old_pdf_check = """            if (typeof html2canvas === 'undefined' || typeof jspdf === 'undefined') {
                showToast('PDF kütüphanesi yüklenemedi, lütfen sayfayı yenileyip tekrar deneyin.', 'error');
                return;
            }"""

new_pdf_check = """            const loaded = await loadPdfLibraries();
            if (!loaded) return;"""

content = content.replace(old_pdf_check, new_pdf_check)

with open('app.js', 'w') as f:
    f.write(content)
