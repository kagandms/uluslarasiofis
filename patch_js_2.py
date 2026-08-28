import sys

with open('app.js', 'r') as f:
    content = f.read()

old_display = """            const btnConfirm = document.getElementById('btn-crop-confirm');
            const btnNext = document.getElementById('btn-crop-next');
            const btnCaptureNext = document.getElementById('btn-crop-capture-next');
            const btnSkipCaptureNext = document.getElementById('btn-skip-capture-next');
            
            if (pendingFiles.length > 0) {
                if (btnConfirm) btnConfirm.style.display = 'none';
                if (btnCaptureNext) btnCaptureNext.style.display = 'none';
                if (btnSkipCaptureNext) btnSkipCaptureNext.style.display = 'none';
                if (btnNext) btnNext.style.display = 'block';
            } else if (croppedImages.length === 0 && !isProcessingPage2) {
                if (btnConfirm) btnConfirm.style.display = 'block';
                if (btnCaptureNext) btnCaptureNext.style.display = 'block';
                if (btnSkipCaptureNext) btnSkipCaptureNext.style.display = 'block';
                if (btnNext) btnNext.style.display = 'none';
            } else {
                if (btnConfirm) btnConfirm.style.display = 'block';
                if (btnCaptureNext) btnCaptureNext.style.display = 'none';
                if (btnSkipCaptureNext) btnSkipCaptureNext.style.display = 'none';
                if (btnNext) btnNext.style.display = 'none';
            }"""

new_display = """            const btnConfirm = document.getElementById('btn-crop-confirm');
            const btnSkip = document.getElementById('btn-crop-skip');
            const btnNext = document.getElementById('btn-crop-next');
            const btnCaptureNext = document.getElementById('btn-crop-capture-next');
            const btnSkipCaptureNext = document.getElementById('btn-skip-capture-next');
            
            if (pendingFiles.length > 0) {
                if (btnConfirm) btnConfirm.style.display = 'none';
                if (btnSkip) btnSkip.style.display = 'none';
                if (btnCaptureNext) btnCaptureNext.style.display = 'none';
                if (btnSkipCaptureNext) btnSkipCaptureNext.style.display = 'none';
                if (btnNext) btnNext.style.display = 'block';
            } else if (croppedImages.length === 0 && !isProcessingPage2) {
                if (btnConfirm) btnConfirm.style.display = 'block';
                if (btnSkip) btnSkip.style.display = 'block';
                if (btnCaptureNext) btnCaptureNext.style.display = 'block';
                if (btnSkipCaptureNext) btnSkipCaptureNext.style.display = 'block';
                if (btnNext) btnNext.style.display = 'none';
            } else {
                if (btnConfirm) btnConfirm.style.display = 'block';
                if (btnSkip) btnSkip.style.display = 'block';
                if (btnCaptureNext) btnCaptureNext.style.display = 'none';
                if (btnSkipCaptureNext) btnSkipCaptureNext.style.display = 'none';
                if (btnNext) btnNext.style.display = 'none';
            }"""

content = content.replace(old_display, new_display)

with open('app.js', 'w') as f:
    f.write(content)
