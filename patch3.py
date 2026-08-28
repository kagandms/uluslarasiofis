import sys

with open('app.js', 'r') as f:
    content = f.read()

old_skip = """    document.getElementById('btn-skip-capture-next')?.addEventListener('click', () => {
        cleanupCropper();
        if (currentImageObj) {
            croppedImages.push(currentImageObj.src);
            page1ImageObj = currentImageObj;
            isSequentialCapture = true;
            isProcessingPage2 = true;
            showToast('1. sayfa kaydedildi. Lütfen 2. sayfayı yükleyin/çekin.', 'info');
            setTimeout(() => {
                if (fileInputPage2) {
                    fileInputPage2.click();
                } else {
                    fileInput.click();
                }
            }, 500);
        }
    });"""

new_skip = """    document.getElementById('btn-skip-capture-next')?.addEventListener('click', () => {
        cleanupCropper();
        if (currentImageObj) {
            croppedImages.push(currentImageObj.src);
            page1ImageObj = currentImageObj;
            isSequentialCapture = true;
            isProcessingPage2 = true;
            setActiveStep(1.5);
        }
    });"""

content = content.replace(old_skip, new_skip)

old_crop = """    document.getElementById('btn-crop-capture-next')?.addEventListener('click', () => {
        getCroppedImage((img) => {
            cleanupCropper();
            if (img) {
                croppedImages.push(img);
            } else if (currentImageObj) {
                croppedImages.push(currentImageObj);
            }
            
            if (useCameraForPage2) {
                fileInput.setAttribute('capture', 'environment');
            }
            fileInput.click();
        });
    });"""

new_crop = """    document.getElementById('btn-crop-capture-next')?.addEventListener('click', () => {
        getCroppedImage((img) => {
            cleanupCropper();
            if (img) {
                croppedImages.push(img);
            } else if (currentImageObj) {
                croppedImages.push(currentImageObj);
            }
            
            page1ImageObj = currentImageObj;
            isSequentialCapture = true;
            isProcessingPage2 = true;
            setActiveStep(1.5);
        });
    });"""

content = content.replace(old_crop, new_crop)

with open('app.js', 'w') as f:
    f.write(content)
