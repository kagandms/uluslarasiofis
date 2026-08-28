import sys

with open('app.js', 'r') as f:
    content = f.read()

old_cancel = """    function cancelOCR() {
        if (activeAbortController) {
            activeAbortController.abort();
            activeAbortController = null;
        }
        isProcessingPage2 = false;
        isSequentialCapture = false;
        setActiveStep(1);
        showToast('İşlem iptal edildi.', 'info');
    }"""

new_cancel = """    function cancelOCR() {
        let aborted = false;
        if (activeAbortController) {
            activeAbortController.abort();
            activeAbortController = null;
            aborted = true;
        }
        isProcessingPage2 = false;
        isSequentialCapture = false;
        croppedImages = [];
        page1ImageObj = null;
        
        // Reset form if going home
        const resultForm = document.getElementById('result-form');
        if (resultForm) resultForm.reset();
        document.querySelectorAll('.glass-input').forEach(el => {
            el.classList.remove('success', 'field-filled');
        });
        
        setActiveStep(1);
        
        if (aborted) {
            showToast('İşlem iptal edildi.', 'info');
        }
    }"""

content = content.replace(old_cancel, new_cancel)

with open('app.js', 'w') as f:
    f.write(content)
