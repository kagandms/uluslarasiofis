import sys

with open('app.js', 'r') as f:
    content = f.read()

old_js = """    document.getElementById('btn-crop-cancel')?.addEventListener('click', () => {
        cleanupCropper();
        if (previewImage) previewImage.style.display = 'none';
        fileInput.value = "";
        if (fileInputPage2) fileInputPage2.value = "";
        isSequentialCapture = false;
        isProcessingPage2 = false;
        page1ImageObj = null;
        pendingFiles = [];
        croppedImages = [];
    });"""

new_js = """    document.getElementById('btn-crop-cancel')?.addEventListener('click', () => {
        cleanupCropper();
        if (previewImage) previewImage.style.display = 'none';
        fileInput.value = "";
        if (fileInputPage2) fileInputPage2.value = "";
        isSequentialCapture = false;
        isProcessingPage2 = false;
        page1ImageObj = null;
        pendingFiles = [];
        croppedImages = [];
    });

    document.getElementById('btn-crop-skip')?.addEventListener('click', () => {
        cleanupCropper();
        if (currentImageObj) {
            processNextStep(currentImageObj);
        }
    });"""

content = content.replace(old_js, new_js)

with open('app.js', 'w') as f:
    f.write(content)
