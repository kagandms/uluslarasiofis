import sys

with open('app.js', 'r') as f:
    content = f.read()

listeners = """
    if (btnUploadPage2) {
        btnUploadPage2.addEventListener('click', () => {
            if (fileInputPage2) fileInputPage2.click();
        });
    }

    if (btnCancelPage2) {
        btnCancelPage2.addEventListener('click', () => {
            if (page1ImageObj) {
                isProcessingPage2 = false;
                isSequentialCapture = false;
                processAndRunOCR(page1ImageObj);
                page1ImageObj = null;
            } else {
                setActiveStep(1);
            }
        });
    }
"""

content = content.replace("    const miniDropzone = document.getElementById('mini-dropzone');", listeners + "\n    const miniDropzone = document.getElementById('mini-dropzone');")

with open('app.js', 'w') as f:
    f.write(content)
