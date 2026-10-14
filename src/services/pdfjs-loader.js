let bootstrapPromise = null;

/** Awaits the bundled PDF.js bootstrap instead of polling a global with a timeout.
 * @returns {Promise<object>} Configured PDF.js library.
 * @throws {Error} When loading the bundled library fails.
 */
export async function loadPdfJs() {
    if (!globalThis.window) throw new Error('PDF sıkıştırma bileşeni hazır değil. Sayfayı yenileyip tekrar deneyin.');
    if (globalThis.window?.pdfjsLib?.getDocument) return window.pdfjsLib;
    if (!bootstrapPromise) bootstrapPromise = import('../staff/pdfjs-bootstrap.js');
    try {
        const bootstrap = await bootstrapPromise;
        return await bootstrap.pdfjsReady;
    } catch (error) {
        bootstrapPromise = null;
        console.error('PDF.js bootstrap failed.', { errorName: error.name });
        throw error;
    }
}
