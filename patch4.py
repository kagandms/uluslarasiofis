import sys

with open('app.js', 'r') as f:
    content = f.read()

content = content.replace("croppedImages.push(currentImageObj.src);", "croppedImages.push(currentImageObj);")

old_crop = """    document.getElementById('btn-crop-capture-next')?.addEventListener('click', () => {
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

new_crop = """    document.getElementById('btn-crop-capture-next')?.addEventListener('click', () => {
        getCroppedImage((img) => {
            cleanupCropper();
            if (img) {
                croppedImages.push(img);
                page1ImageObj = img;
            } else if (currentImageObj) {
                croppedImages.push(currentImageObj);
                page1ImageObj = currentImageObj;
            }
            
            isSequentialCapture = true;
            isProcessingPage2 = true;
            setActiveStep(1.5);
        });
    });"""

content = content.replace(old_crop, new_crop)

with open('app.js', 'w') as f:
    f.write(content)
