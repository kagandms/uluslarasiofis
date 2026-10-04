import { isPointInSelection, moveSelection, resizeSelection, toDisplayBox } from './cropper-selection.js';

(() => {
    const canvas = document.getElementById('passport-canvas');
    const stage = document.getElementById('stage');
    const selection = document.getElementById('selection');
    const status = document.getElementById('status');
    const confirmButton = document.getElementById('confirm');
    const resetButton = document.getElementById('reset');
    const candidatesElement = document.getElementById('candidates');
    let box = null;
    let pointerDrag = null;
    let manualOnly = false;

    const setStatus = (message, isError = false) => {
        status.textContent = message;
        status.classList.toggle('error', isError);
    };

    const base64ToBytes = (value) => {
        const binary = atob(String(value || '').replace(/^data:[^,]+,/, ''));
        return Uint8Array.from(binary, (char) => char.charCodeAt(0));
    };

    const renderSelection = () => {
        if (!box) return;
        const rect = canvas.getBoundingClientRect();
        const displayBox = toDisplayBox(box, { width: canvas.width, height: canvas.height }, rect);
        selection.style.left = `${displayBox.x}px`;
        selection.style.top = `${displayBox.y}px`;
        selection.style.width = `${displayBox.width}px`;
        selection.style.height = `${displayBox.height}px`;
    };

    const resetSelection = () => {
        const width = Math.max(1, Math.round(canvas.width * 0.3));
        const height = Math.max(1, Math.round(width * 1.25));
        box = {
            x: Math.round((canvas.width - width) / 2),
            y: Math.round((canvas.height - height) / 2),
            width,
            height: Math.min(height, canvas.height)
        };
        renderSelection();
    };

    const pagePoint = (event) => {
        const rect = canvas.getBoundingClientRect();
        return {
            x: Math.max(0, Math.min(canvas.width, (event.clientX - rect.left) * canvas.width / rect.width)),
            y: Math.max(0, Math.min(canvas.height, (event.clientY - rect.top) * canvas.height / rect.height))
        };
    };

    stage.addEventListener('pointerdown', (event) => {
        const point = pagePoint(event);
        const resizeHandle = event.target.closest?.('[data-handle]')?.dataset.handle;
        pointerDrag = {
            mode: resizeHandle ? 'resize' : isPointInSelection(point, box) ? 'move' : 'draw',
            handle: resizeHandle || '',
            point,
            box: box ? { ...box } : null
        };
        stage.setPointerCapture?.(event.pointerId);
    });
    stage.addEventListener('pointermove', (event) => {
        if (!pointerDrag) return;
        const point = pagePoint(event);
        box = pointerDrag.mode === 'resize'
            ? resizeSelection(pointerDrag.box, pointerDrag.handle, pointerDrag.point, point, { width: canvas.width, height: canvas.height })
            : pointerDrag.mode === 'move'
                ? moveSelection(pointerDrag.box, pointerDrag.point, point, { width: canvas.width, height: canvas.height })
                : {
                x: Math.min(pointerDrag.point.x, point.x),
                y: Math.min(pointerDrag.point.y, point.y),
                width: Math.max(1, Math.abs(point.x - pointerDrag.point.x)),
                height: Math.max(1, Math.abs(point.y - pointerDrag.point.y))
            };
        renderSelection();
    });
    stage.addEventListener('pointerup', () => { pointerDrag = null; });
    resetButton.addEventListener('click', resetSelection);

    const drawImage = (image) => {
        canvas.width = image.width;
        canvas.height = image.height;
        canvas.getContext('2d').drawImage(image, 0, 0);
        stage.hidden = false;
        resetSelection();
        confirmButton.disabled = false;
        setStatus('Fotoğraf alanını seçip aktarımı onaylayın.');
    };

    const markSelectedCandidate = (button) => {
        candidatesElement.querySelectorAll('.candidate').forEach((item) => item.classList.toggle('selected', item === button));
    };

    const imageFromDocument = (documentData) => new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Pasaport görseli açılamadı.'));
        image.src = `data:${documentData.contentType || 'image/jpeg'};base64,${documentData.documentBase64}`;
    });

    const addCandidate = (label, preview, onSelect) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'candidate';
        button.append(preview);
        const caption = document.createElement('span');
        caption.textContent = label;
        button.append(caption);
        button.addEventListener('click', async () => {
            try {
                confirmButton.disabled = true;
                await onSelect();
                markSelectedCandidate(button);
            } catch (error) {
                setStatus(error.message || 'Pasaport sayfası açılamadı.', true);
            }
        });
        candidatesElement.append(button);
        return button;
    };

    const renderPdfPage = async (pdf, pageNumber) => {
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1.5 });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        stage.hidden = false;
        resetSelection();
        confirmButton.disabled = false;
        setStatus('Fotoğraf alanını seçip aktarımı onaylayın.');
    };

    const addPdfCandidates = async (documentData, documentIndex) => {
        const bytes = base64ToBytes(documentData.documentBase64);
        const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
            const page = await pdf.getPage(pageNumber);
            const viewport = page.getViewport({ scale: 0.18 });
            const preview = document.createElement('canvas');
            preview.width = Math.ceil(viewport.width);
            preview.height = Math.ceil(viewport.height);
            await page.render({ canvasContext: preview.getContext('2d'), viewport }).promise;
            addCandidate(`Belge ${documentIndex + 1} · Sayfa ${pageNumber}`, preview, () => renderPdfPage(pdf, pageNumber));
        }
    };

    const addImageCandidate = async (documentData, documentIndex) => {
        const image = await imageFromDocument(documentData);
        const preview = document.createElement('img');
        preview.alt = `Pasaport belgesi ${documentIndex + 1}`;
        preview.src = image.src;
        addCandidate(`Belge ${documentIndex + 1}`, preview, async () => drawImage(image));
    };

    const loadDocument = async () => {
        const stored = await new Promise((resolve) => chrome.storage.local.get('pendingPassportCrop', resolve));
        const pending = stored?.pendingPassportCrop;
        const documents = pending?.documents?.length
            ? pending.documents
            : pending?.documentBase64 ? [{ documentBase64: pending.documentBase64, contentType: pending.contentType }] : [];
        if (documents.length === 0) throw new Error('Kırpılacak pasaport belgesi bulunamadı.');
        pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdf.worker.min.js');

        for (let index = 0; index < documents.length; index += 1) {
            const documentData = documents[index];
            const bytes = base64ToBytes(documentData.documentBase64);
            const isPdf = String(documentData.contentType || '').includes('pdf') || String.fromCharCode(...bytes.slice(0, 4)) === '%PDF';
            if (isPdf) await addPdfCandidates(documentData, index);
            else await addImageCandidate(documentData, index);
        }
        const firstCandidate = candidatesElement.querySelector('.candidate');
        if (!firstCandidate) throw new Error('Gösterilebilen pasaport sayfası bulunamadı.');
        firstCandidate.click();
    };

    const sendManualTransfer = () => {
        confirmButton.disabled = true;
        setStatus('Fotoğraf bulunamadı; öğrenci bilgileri YÖKSİS’e aktarılıyor…');
        chrome.runtime.sendMessage({
            action: 'FILL_YOKSIS_WITHOUT_PHOTO',
            requestId: `crop-${Date.now()}`
        }, (response) => {
            if (chrome.runtime.lastError || !response?.success) {
                confirmButton.disabled = false;
                setStatus(response?.error || chrome.runtime.lastError?.message || 'YÖKSİS aktarımı başlatılamadı.', true);
                return;
            }
            const unavailable = Array.from(new Set([
                ...(response.unavailableFields || []),
                ...(response.missingFields || []),
                ...(response.manualPhotoRequired ? ['Fotoğraf'] : [])
            ])).filter(Boolean);
            const detail = unavailable.length > 0
                ? ` Eksik kalan alanlar: ${unavailable.join(', ')}.`
                : '';
            setStatus(`Bilgiler aktarıldı.${detail} Fotoğrafı YÖKSİS’te elle yükleyin.`, true);
        });
    };

    confirmButton.addEventListener('click', () => {
        if (manualOnly) {
            sendManualTransfer();
            return;
        }
        if (!box || !box.width || !box.height) return;
        confirmButton.disabled = true;
        setStatus('Kırpılmış fotoğraf ve öğrenci bilgileri YÖKSİS’e aktarılıyor…');
        const output = document.createElement('canvas');
        output.width = Math.round(box.width);
        output.height = Math.round(box.height);
        output.getContext('2d').drawImage(canvas, box.x, box.y, box.width, box.height, 0, 0, output.width, output.height);
        chrome.runtime.sendMessage({
            action: 'CROPPED_PHOTO_CONFIRMED',
            requestId: `crop-${Date.now()}`,
            photoBase64: output.toDataURL('image/jpeg', 0.92),
            fileName: 'ogrenci_foto.jpg'
        }, (response) => {
            if (chrome.runtime.lastError || !response?.success) {
                confirmButton.disabled = false;
                setStatus(response?.error || chrome.runtime.lastError?.message || 'YÖKSİS aktarımı başlatılamadı.', true);
                return;
            }
            if (response.partial) {
                const unavailable = Array.from(new Set([
                    ...(response.unavailableFields || []),
                    ...(response.missingFields || [])
                ])).filter(Boolean);
                const detail = unavailable.length > 0
                    ? ` Eksik kalan alanlar: ${unavailable.join(', ')}.`
                    : ' Bazı alanlar YÖKSİS formunda doğrulanamadı.';
                setStatus(`Fotoğraf aktarıldı.${detail} Lütfen YÖKSİS formunda kontrol edip tamamlayın.`, true);
                return;
            }
            setStatus('Aktarım tamamlandı. YÖKSİS formunu son kez kontrol edin.');
            window.setTimeout(() => window.close(), 900);
        });
    });

    loadDocument().catch((error) => {
        const message = String(error?.message || error || '');
        if (/Kırpılacak pasaport belgesi bulunamadı|Gösterilebilen pasaport sayfası bulunamadı/.test(message)) {
            manualOnly = true;
            confirmButton.disabled = false;
            confirmButton.textContent = 'Bilgileri YÖKSİS’e Aktar';
            setStatus('Pasaport bulunamadı. Diğer bilgiler aktarılabilir; fotoğrafı YÖKSİS’te elle yükleyin.');
            return;
        }
        setStatus(message, true);
    });
})();
