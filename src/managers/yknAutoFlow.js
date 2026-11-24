/**
 * @fileoverview YKN otomatik arama → kabul mektubu → YÖKSİS → kırpma → aktarım durum makinesi.
 * Durumlar: IDLE → SEARCHED → ACCEPTANCE → COPY → CROPPER → DONE | STOPPED.
 * Son adım yalnızca kırpıcıdaki `submit()` aktarımını çağırır; YÖKSİS'te kaydet/gönder yapmaz.
 */

const DEFAULT_ASPECT_RATIO = 35 / 45;
const MAX_SOURCE_ATTEMPTS = 20;

function readText(value) {
    return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function extractStudentName(student) {
    if (!student || typeof student !== 'object') return '';
    const direct = readText(student.studentName || student.fullName || student.name);
    if (direct) return direct;
    return [
        readText(student.firstName || student.ad),
        readText(student.lastName || student.soyad)
    ].filter(Boolean).join(' ');
}

function extractPassportNo(student, fallback) {
    if (!student || typeof student !== 'object') return fallback;
    const value = readText(student.passportNo || student.pasaportNo || student.passportNumber);
    return value ? value.toUpperCase() : fallback;
}

function faceErrorMessage(errorCode) {
    if (errorCode === 'no-face') {
        return 'Pasaport sayfasında yüz algılanamadı. Lütfen fotoğrafı elle kırpın.';
    }
    if (errorCode === 'multiple-faces') {
        return 'Pasaport sayfasında birden fazla yüz algılandı. Lütfen öğrenci yüzünü elle kırpın.';
    }
    return 'Otomatik yüz algılama kullanılamıyor. Lütfen fotoğrafı elle kırpın.';
}

/**
 * YKN otomatik akış durum makinesini oluşturur.
 *
 * @param {object} deps - Dışa bağlı eylem ve sorgu fonksiyonları.
 * @param {() => boolean} deps.enabled - Otomatik zincir anahtarının açık olup olmadığını döndürür.
 * @param {(id: 'read-acceptance' | 'copy') => void} deps.click - İlgili adım düğmesini tetikler.
 * @param {() => Array<{ dataUrl: string, text: string }>} deps.getPages - Kırpıcıdaki mevcut belge sayfalarını döndürür.
 * @param {() => number} deps.getPageIndex - Seçili sayfa dizinini döndürür.
 * @param {(index: number) => Promise<boolean>} [deps.selectPage] - Kırpıcıyı belirtilen sayfa dizinine geçirir; başarısızsa `false` döner.
 * @param {(index: number, rotation: number) => Promise<{ dataUrl: string } | false>} [deps.rotatePage] - Döndürülmüş sayfayı kalıcı olarak düzeltip kırpıcıya yeniden yükler.
 * @param {() => Promise<boolean>} deps.selectNextSource - Bir sonraki belge kaynağına geçer; kaynak yoksa `false` döner.
 * @param {(imageDataUrl: string, aspectRatio: number, options?: { tryRotations?: boolean }) => Promise<{ x: number, y: number, width: number, height: number, rotation?: number } | { error: string }>} deps.detectFace - Yüz kırpma kutusunu hesaplar.
 * @param {(input: { text: string, studentName: string, passportNo: string }) => { isPassport: boolean, reason?: string }} deps.evaluatePage - Pasaport sayfası doğrulamasını yapar.
 * @param {(page: { dataUrl?: string, text?: string }) => Promise<string>} [deps.ensurePageText] - Metni boş sayfalarda OCR ile metin üretir.
 * @param {(box: { x: number, y: number, width: number, height: number }) => boolean | void} deps.applyCrop - Hesaplanan kırpma kutusunu uygular.
 * @param {(defaults: { medeni: string }) => void} deps.setDefaults - Boş alanlar için varsayılan değerleri yazar.
 * @param {() => string} deps.getGender - Kırpıcıdaki seçili cinsiyet değerini döndürür.
 * @param {() => void} deps.submit - Kırpıcıdaki YÖKSİS'e aktarım düğmesini tetikler.
 * @param {(message: string, level: string) => void} deps.report - Durum mesajını kullanıcıya bildirir.
 * @returns {{ start: (passportNo: string, options?: { force?: boolean }) => boolean, onSearchDone: (student?: object | null) => void, onYoksisReady: () => void, onCropperReady: (ctx?: object) => Promise<void>, cancel: (reason?: string) => void, isActive: () => boolean }} Durum makinesi API'si.
 */
export function createYknAutoFlow(deps) {
    let state = 'IDLE';
    let runId = 0;
    let forced = false;
    let currentPassportNo = '';
    let currentStudentName = '';
    const pageTextCache = new Map();
    const ensurePageText = typeof deps.ensurePageText === 'function'
        ? deps.ensurePageText
        : async (page) => (typeof page?.text === 'string' ? page.text : '');

    function isActive() {
        return state !== 'IDLE' && state !== 'DONE' && state !== 'STOPPED';
    }

    function isRunCurrent(expectedRunId) {
        return runId === expectedRunId && isActive();
    }

    function safeReport(message, level) {
        try {
            deps.report?.(message, level);
        } catch {
            // Raporlama hatası akış kontrolünü bozmamalı.
        }
    }

    function safeEnabled() {
        try {
            return Boolean(deps.enabled?.());
        } catch {
            return false;
        }
    }

    function cancel(reason) {
        const wasActive = isActive();
        runId += 1;
        state = 'STOPPED';
        if (wasActive) {
            const message = typeof reason === 'string' && reason.trim()
                ? reason.trim()
                : 'Otomatik akış durduruldu. İşleme elle devam edebilirsiniz.';
            safeReport(message, 'error');
        }
    }

    function start(passportNo, { force = false } = {}) {
        if (isActive()) {
            cancel('Yeni arama başlatıldığı için önceki otomatik akış iptal edildi.');
        }

        if (!force && !safeEnabled()) {
            return false;
        }

        runId += 1;
        forced = Boolean(force);
        currentPassportNo = readText(passportNo).toUpperCase();
        currentStudentName = '';
        state = 'SEARCHED';
        safeReport('Otomatik YKN akışı başlatıldı; öğrenci araması bekleniyor.', 'info');
        return true;
    }

    function onSearchDone(student) {
        if (state === 'IDLE' || state === 'DONE' || state === 'STOPPED') {
            if (!safeEnabled()) {
                return;
            }
            runId += 1;
            forced = false;
            currentPassportNo = '';
            currentStudentName = '';
            state = 'SEARCHED';
        }

        if (state !== 'SEARCHED') {
            return;
        }

        if (!forced && !safeEnabled()) {
            cancel('Otomatik zincir kapalı. İşleme elle devam edebilirsiniz.');
            return;
        }

        if (student === null || student === false) {
            cancel('Öğrenci kaydı bulunamadı. Pasaport numarasını kontrol edip yeniden deneyin.');
            return;
        }

        currentStudentName = extractStudentName(student) || currentStudentName;
        currentPassportNo = extractPassportNo(student, currentPassportNo);
        state = 'ACCEPTANCE';
        safeReport('Öğrenci bulundu; kabul mektubu okunuyor ve YÖKSİS araması başlatılıyor.', 'info');

        try {
            deps.click('read-acceptance');
        } catch {
            cancel('Kabul mektubu okuma adımı başlatılamadı. Lütfen düğmeye elle tıklayın.');
        }
    }

    function onYoksisReady() {
        if (state !== 'ACCEPTANCE') {
            return;
        }

        if (!forced && !safeEnabled()) {
            cancel('Otomatik zincir kapatıldı. İşleme elle devam edebilirsiniz.');
            return;
        }

        state = 'COPY';
        safeReport('YÖKSİS hazır; öğrenci bilgileri alınıyor ve pasaport kırpıcı açılıyor.', 'info');

        try {
            deps.click('copy');
        } catch {
            cancel('Bilgi alma ve kırpıcı açma adımı başlatılamadı. Lütfen düğmeye elle tıklayın.');
        }
    }

    async function onCropperReady(ctx = {}) {
        if (state !== 'COPY') {
            return;
        }

        if (!forced && !safeEnabled()) {
            cancel('Otomatik zincir kapatıldı. Fotoğrafı elle kırpıp aktarabilirsiniz.');
            return;
        }

        const myRunId = runId;
        state = 'CROPPER';

        const aspectRatio = typeof ctx?.aspectRatio === 'number' && Number.isFinite(ctx.aspectRatio) && ctx.aspectRatio > 0
            ? ctx.aspectRatio
            : DEFAULT_ASPECT_RATIO;

        try {
            let validPage = null;
            let validPageIndex = 0;
            let shownPageIndex = 0;
            let lastRejectReason = 'Seçilen belge pasaport kimlik sayfası değil.';
            let attempts = 0;
            let sourceIndex = 0;

            while (attempts < MAX_SOURCE_ATTEMPTS && !validPage) {
                if (!isRunCurrent(myRunId)) return;

                const pages = deps.getPages?.() || [];
                const rawIndex = typeof deps.getPageIndex === 'function'
                    ? deps.getPageIndex()
                    : (sourceIndex === 0 ? ctx?.pageIndex : 0);
                const startIndex = typeof rawIndex === 'number'
                    && Number.isInteger(rawIndex)
                    && rawIndex >= 0
                    && rawIndex < pages.length
                    ? rawIndex
                    : 0;

                if (pages.length === 0) {
                    attempts += 1;
                    lastRejectReason = 'Kırpıcıda pasaport sayfası bulunamadı.';
                } else {
                    for (let offset = 0; offset < pages.length && attempts < MAX_SOURCE_ATTEMPTS; offset += 1) {
                        if (!isRunCurrent(myRunId)) return;

                        const pageIndex = (startIndex + offset) % pages.length;
                        const page = pages[pageIndex];
                        attempts += 1;

                        if (!page) {
                            lastRejectReason = 'Kırpıcıda pasaport sayfası bulunamadı.';
                            continue;
                        }

                        let pageText = typeof page.text === 'string' ? page.text : '';
                        if (!pageText.trim()) {
                            const cacheKey = typeof page.dataUrl === 'string' && page.dataUrl ? page.dataUrl : '';
                            if (cacheKey && pageTextCache.has(cacheKey)) {
                                pageText = pageTextCache.get(cacheKey);
                            } else {
                                try {
                                    const ensured = await ensurePageText(page);
                                    pageText = typeof ensured === 'string' ? ensured : '';
                                } catch {
                                    pageText = '';
                                }
                                if (cacheKey) {
                                    pageTextCache.set(cacheKey, pageText);
                                }
                                if (!isRunCurrent(myRunId)) return;
                            }
                        }

                        const evaluation = deps.evaluatePage({
                            text: pageText,
                            studentName: currentStudentName,
                            passportNo: currentPassportNo
                        });
                        if (evaluation?.isPassport) {
                            validPage = page;
                            validPageIndex = pageIndex;
                            shownPageIndex = startIndex;
                            break;
                        }
                        if (evaluation?.reason) {
                            lastRejectReason = evaluation.reason;
                        }
                    }
                }

                if (validPage) {
                    break;
                }
                if (attempts >= MAX_SOURCE_ATTEMPTS) {
                    break;
                }

                const hasNext = typeof deps.selectNextSource === 'function'
                    ? await deps.selectNextSource()
                    : false;

                if (!isRunCurrent(myRunId)) return;

                if (!hasNext) {
                    cancel(`${lastRejectReason} Lütfen doğru pasaport belgesini elle seçip kırpın.`);
                    return;
                }
                sourceIndex += 1;
            }

            if (!validPage) {
                cancel('Geçerli pasaport sayfası bulunamadı. Lütfen pasaport belgesini elle seçip kırpın.');
                return;
            }

            if (validPageIndex !== shownPageIndex) {
                const switched = typeof deps.selectPage === 'function'
                    ? await deps.selectPage(validPageIndex)
                    : false;
                if (!isRunCurrent(myRunId)) return;
                if (!switched) {
                    cancel('Lütfen doğru pasaport belgesini elle seçip kırpın.');
                    return;
                }
            }

            let faceResult = await deps.detectFace(validPage.dataUrl, aspectRatio, { tryRotations: true });
            if (!isRunCurrent(myRunId)) return;

            if (!faceResult || faceResult.error) {
                cancel(faceErrorMessage(faceResult?.error));
                return;
            }

            if (faceResult.rotation === 90 || faceResult.rotation === 180 || faceResult.rotation === 270) {
                if (typeof deps.rotatePage !== 'function') {
                    cancel(faceErrorMessage('no-face'));
                    return;
                }
                const rotation = faceResult.rotation;
                const rotatedPage = await deps.rotatePage(validPageIndex, rotation);
                if (!isRunCurrent(myRunId)) return;
                if (!rotatedPage || typeof rotatedPage.dataUrl !== 'string' || !rotatedPage.dataUrl) {
                    cancel(faceErrorMessage('no-face'));
                    return;
                }
                safeReport(`Pasaport sayfası ${rotation}° döndürülüp düzeltildi.`, 'info');
                faceResult = await deps.detectFace(rotatedPage.dataUrl, aspectRatio);
                if (!isRunCurrent(myRunId)) return;
                if (!faceResult || faceResult.error) {
                    cancel(faceErrorMessage(faceResult?.error));
                    return;
                }
            }

            const gender = readText(deps.getGender?.());
            if (!gender) {
                cancel('Cinsiyet bilgisi boş. Cinsiyeti seçin ve aktarımı elle tamamlayın.');
                return;
            }

            const currentMedeni = readText(ctx?.medeni);
            if (!currentMedeni) {
                deps.setDefaults?.({ medeni: 'Bekar' });
            }

            const applied = deps.applyCrop(faceResult);
            if (applied === false) {
                cancel('Kırpma alanı uygulanamadı. Lütfen fotoğrafı elle kırpıp aktarın.');
                return;
            }

            if (!isRunCurrent(myRunId)) return;

            deps.submit();
            state = 'DONE';
            safeReport(
                'Pasaport fotoğrafı kırpıldı ve bilgiler YÖKSİS formuna aktarıldı. Lütfen kontrol edip YÖKSİS üzerinden kaydedin.',
                'success'
            );
        } catch {
            if (isRunCurrent(myRunId)) {
                cancel('Otomatik kırpma ve aktarım sırasında hata oluştu. Lütfen işlemi elle tamamlayın.');
            }
        }
    }

    return {
        start,
        onSearchDone,
        onYoksisReady,
        onCropperReady,
        cancel,
        isActive
    };
}
