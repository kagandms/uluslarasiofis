const LOGO_FILES = Object.freeze({ university:'topkapi_logo.jpg', migration:'goc_logo.png' });

/** Builds a base-aware local asset URL. @param {string} filename Bundled filename. @returns {string} Same-origin path. */
export function buildDocumentAssetUrl(filename) {
    return `${import.meta.env?.BASE_URL || '/'}${filename}`;
}

async function readLogoBytes(filename) {
    const response=await fetch(buildDocumentAssetUrl(filename),{credentials:'same-origin'});
    if (!response.ok) throw new Error('Belge logosu yüklenemedi. Tekrar deneyin.');
    const blob=await response.blob();
    if (!blob.size || !blob.type.startsWith('image/')) throw new Error('Belge logosu geçersiz.');
    return new Promise((resolve,reject)=>{
        const reader=new FileReader();
        reader.onload=()=>resolve(reader.result);
        reader.onerror=()=>reject(new Error('Belge logosu okunamadı.'));
        reader.readAsDataURL(blob);
    });
}

/** Loads both logos as bytes/data URLs before any render. @returns {Promise<object>} Decodable logos. @throws {Error} Missing asset. */
export async function loadDocumentLogos() {
    const [university,migration]=await Promise.all([readLogoBytes(LOGO_FILES.university),readLogoBytes(LOGO_FILES.migration)]);
    return {university,migration};
}

/** Waits for actual image decode and font readiness. @param {HTMLElement} root Document tree. @returns {Promise<void>} Ready assets. @throws {Error} Failed decode. */
export async function waitDocumentAssets(root) {
    await Promise.all([...root.querySelectorAll('img')].map(async image=>{
        await image.decode();
        if (!image.naturalWidth || !image.naturalHeight) throw new Error('Belge logosu çözümlenemedi.');
    }));
    await root.ownerDocument.fonts.ready;
}

/** Replaces cover logos with loaded same-origin bytes and waits for decode. @param {HTMLElement} root Cover. @returns {Promise<void>} Ready cover. @throws {Error} Failed asset. */
export async function prepareDocumentLogos(root) {
    const logos=await loadDocumentLogos();
    root.querySelector('img[data-document-logo="university"]').src=logos.university;
    root.querySelector('img[data-document-logo="migration"]').src=logos.migration;
    await waitDocumentAssets(root);
}
