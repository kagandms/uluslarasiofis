import sys

with open('app.js', 'r') as f:
    content = f.read()

old_pdf = """    if (btnDownload) {
        btnDownload.addEventListener('click', async () => {
            if (typeof html2canvas === 'undefined' || typeof jspdf === 'undefined') {
                showToast('PDF kütüphanesi yüklenemedi, lütfen sayfayı yenileyip tekrar deneyin.', 'error');
                return;
            }

            showToast('PDF hazırlanıyor...', 'info');

            // Form değerlerini topla (print handler ile aynı mantık)"""

new_pdf = """    let generatedPdf = null;
    let generatedPdfName = "";

    if (btnDownload) {
        btnDownload.addEventListener('click', async () => {
            if (generatedPdf) {
                generatedPdf.save(generatedPdfName);
                showToast('PDF indiriliyor...', 'success');
                // Reset button after download
                generatedPdf = null;
                btnDownload.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" class="btn-icon"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> PDF İndir`;
                btnDownload.style.backgroundColor = '';
                btnDownload.classList.remove('pdf-ready');
                return;
            }

            if (typeof html2canvas === 'undefined' || typeof jspdf === 'undefined') {
                showToast('PDF kütüphanesi yüklenemedi, lütfen sayfayı yenileyip tekrar deneyin.', 'error');
                return;
            }

            btnDownload.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" class="btn-icon"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg> Hazırlanıyor...`;
            showToast('PDF hazırlanıyor, lütfen bekleyin...', 'info');

            // Form değerlerini topla (print handler ile aynı mantık)"""

content = content.replace(old_pdf, new_pdf)

old_pdf_end = """                const fName = vAdi.trim() ? vAdi.trim() : 'Ad';
                const fSurname = vSoyadi.trim() ? vSoyadi.trim() : 'Soyad';
                pdf.save(`ONBILGI_${fSurname}_${fName}.pdf`);
                showToast('PDF başarıyla oluşturuldu!', 'success');
            } catch (err) {
                if (document.body.contains(container)) document.body.removeChild(container);
                console.error('PDF hatası:', err);
                showToast('PDF oluşturulurken hata: ' + err.message, 'error');
            }
        });
    }"""

new_pdf_end = """                const fName = vAdi.trim() ? vAdi.trim() : 'Ad';
                const fSurname = vSoyadi.trim() ? vSoyadi.trim() : 'Soyad';
                
                generatedPdf = pdf;
                generatedPdfName = `ONBILGI_${fSurname}_${fName}.pdf`;
                
                // Update button
                btnDownload.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" class="btn-icon"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> PDF Hazır - Tıkla İndir`;
                btnDownload.style.backgroundColor = 'var(--success)';
                btnDownload.classList.add('pdf-ready');
                
                showToast('PDF oluşturuldu! İndirmek için butona tekrar tıklayın.', 'success');
            } catch (err) {
                if (document.body.contains(container)) document.body.removeChild(container);
                console.error('PDF hatası:', err);
                showToast('PDF oluşturulurken hata: ' + err.message, 'error');
                btnDownload.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" class="btn-icon"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> PDF İndir`;
            }
        });
    }"""

content = content.replace(old_pdf_end, new_pdf_end)

with open('app.js', 'w') as f:
    f.write(content)
