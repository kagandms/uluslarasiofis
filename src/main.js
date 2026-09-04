
// --- Authentication Logic ---
let currentToken = localStorage.getItem('site_token') || sessionStorage.getItem('site_token');

function checkAuth() {
    const overlay = document.getElementById('login-overlay');
    if (!overlay) return;

    if (currentToken) {
        overlay.style.display = 'none';
    } else {
        overlay.style.display = 'flex';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    checkAuth();

    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const password = document.getElementById('login-password').value;
            const rememberMe = document.getElementById('login-remember').checked;
            const btn = document.getElementById('btn-login-submit');
            const errorDiv = document.getElementById('login-error');

            const originalHtml = btn.innerHTML;
            btn.innerHTML = '<div class="spinner" style="width: 14px; height: 14px; border-width: 2px;"></div> Bekleyiniz...';
            btn.disabled = true;
            errorDiv.style.display = 'none';

            try {
                const res = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password, rememberMe })
                });

                const data = await res.json();
                if (res.ok && data.token) {
                    currentToken = data.token;
                    if (rememberMe) {
                        localStorage.setItem('site_token', data.token);
                    } else {
                        sessionStorage.setItem('site_token', data.token);
                    }
                    document.getElementById('login-overlay').style.display = 'none';
                    if (window.showToast) window.showToast('Giriş başarılı!', 'success');
                } else {
                    throw new Error(data.error || 'Giriş başarısız');
                }
            } catch (err) {
                errorDiv.textContent = err.message;
                errorDiv.style.display = 'block';
            } finally {
                btn.innerHTML = originalHtml;
                btn.disabled = false;
            }
        });
    }
});

// Intercept fetch calls to add Authorization header and handle 401
const originalFetch = window.fetch;
window.fetch = async function() {
    let [resource, config] = arguments;
    
    // Sadece /api isteklerine token ekle (ve login harici)
    if (typeof resource === 'string' && resource.startsWith('/api') && !resource.startsWith('/api/login')) {
        config = config || {};
        config.headers = config.headers || {};
        
        // Headers nesnesiyse veya düz objeyse Authorization ekle
        if (config.headers instanceof Headers) {
            config.headers.append('Authorization', `Bearer ${currentToken}`);
        } else {
            config.headers['Authorization'] = `Bearer ${currentToken}`;
        }
    }
    
    const response = await originalFetch(resource, config);
    
    if (response.status === 401 && typeof resource === 'string' && resource.startsWith('/api') && !resource.startsWith('/api/login')) {
        // Token expired or invalid
        currentToken = null;
        localStorage.removeItem('site_token');
        sessionStorage.removeItem('site_token');
        const overlay = document.getElementById('login-overlay');
        if (overlay) overlay.style.display = 'flex';
        if (window.showToast) window.showToast('Oturum süresi doldu, lütfen tekrar giriş yapın.', 'warning');
    }
    
    return response;
};
import { initTheme } from './ui/themeManager.js';
import { setActiveStep, STEP_IDS } from './ui/stepWizard.js';
import { renderStudentForms, getAllFormsData, populateFormNode } from './ui/formManager.js';
import { saveDraft, restoreDraft, clearDraft, initDraftAutoSave } from './managers/draftManager.js';
import { historyManager, initHistoryPanel } from './managers/historyManager.js';
import { showCropperForFile, getCroppedImage, cleanupCropper, initCropperControls } from './ui/cropperModal.js';
import { prepareImageForOCR } from './services/imageProcessor.js';
import { runOCR, cancelOCR } from './services/ocrService.js';
import { generateAndDownloadPdf, printDocument } from './services/pdfGenerator.js';
import { showToast } from './ui/toastManager.js';
import { initTebligatSearch } from './ui/tebligatSearch.js';
import { initWorkspaceNavigation } from './ui/workspaceNavigation.js';
import { initYknManager } from './managers/yknManager.js';

// --- Clear Old PWA Service Workers ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(registration => {
                console.log('PWA Service Worker başarıyla kaydedildi:', registration.scope);
            })
            .catch(error => {
                console.error('Service Worker kayıt hatası:', error);
            });
    });
}



// --- State ---
let pendingFiles = [];
let croppedImages = [];
let page1ImageObj = null;
let isProcessingPage2 = false;
let isSequentialCapture = false;
let useCameraForPage2 = false;
let studentsQueue = [];
let page1BackgroundPromise = null;
let updateState = null;

document.addEventListener('DOMContentLoaded', () => {
    // --- Initializations ---
    initTheme();
    initHistoryPanel();
    initTebligatSearch();
    document.addEventListener('workspace:view-changed', (event) => {
        if (event.detail?.viewName === 'cover') setActiveStep(STEP_IDS.UPLOAD);
    });
    initWorkspaceNavigation();
    initYknManager();
    
    initDraftAutoSave();
    
    // Set active step to Upload
    setActiveStep(STEP_IDS.UPLOAD);
    
    renderStudentForms([{}]);
    

    
    const dailyCounterWidget = document.getElementById('daily-counter-widget');
    if (dailyCounterWidget) {
        dailyCounterWidget.style.cursor = 'pointer';
        dailyCounterWidget.addEventListener('click', () => {
            const body = document.querySelector('.history-body');
            if (body && !body.classList.contains('open')) {
                const toggle = document.getElementById('history-toggle');
                if (toggle) toggle.click();
            }
            setTimeout(() => {
                const panel = document.getElementById('history-panel');
                if (panel) panel.scrollIntoView({ behavior: 'smooth' });
            }, 50);
        });
    }
    
    // --- Manual Entry & Form Clear ---
    const btnManualEntry = document.getElementById('btn-manual-entry');
    if (btnManualEntry) {
        btnManualEntry.addEventListener('click', () => {
            croppedImages = [];
            page1ImageObj = null;
            
            // Manuel doldurmada "2. sayfayı ekle" resim yükleme butonunu gizle
            const btnAddPage2 = document.getElementById('btn-add-page2-step3');
            if (btnAddPage2) btnAddPage2.style.display = 'none';

            // Manuel doldurmada Tekrar Tara butonuna gerek yok
            const btnRescan = document.getElementById('btn-rescan');
            if (btnRescan) btnRescan.style.display = 'none';

            // Formun içini sıfırla ki eski OCR vs kırıntısı kalmasın, draft yüklenmezse boş gelsin
            studentsQueue = [];

            setActiveStep(STEP_IDS.FORM_RESULT);
            restoreDraft();
        });
    }

    const btnClearForm = document.getElementById('btn-clear-form-global');
    if (btnClearForm) {
        btnClearForm.addEventListener('click', () => {
            if (confirm('Formdaki tüm veriler silinecek. Emin misiniz?')) {
                studentsQueue = [];
                renderStudentForms([{}]);
                clearDraft();
            }
        });
    }

    // --- File Handling & Drag Drop ---
    const uploadZone = document.getElementById('upload-zone');
    const fileInput = document.getElementById('file-input');
    
    const btnBatchProcess = document.getElementById('btn-batch-process');
    if (btnBatchProcess) {
        btnBatchProcess.addEventListener('click', () => {
            processAllStudents(studentsQueue);
        });
    }

    const btnBatchAddNew = document.getElementById('btn-batch-add-new');
    if (btnBatchAddNew) {
        btnBatchAddNew.addEventListener('click', () => {
            const fileInput = document.getElementById('file-input');
            if (fileInput) {
                fileInput.removeAttribute('capture');
                fileInput.click();
            }
        });
    }

    const fileInputPage2 = document.getElementById('file-input-page2');
    
    function handleMultipleFilesSelection(fileList) {
        if (!fileList || fileList.length === 0) return;
        pendingFiles = Array.from(fileList).filter(f => f.type.startsWith('image/'));
        if (pendingFiles.length === 0) {
            showToast('Lütfen sadece resim dosyaları seçin.', 'error');
            return;
        }
        croppedImages = [];
        page1ImageObj = null;
        isSequentialCapture = false;
        
        const btnAddPage2 = document.getElementById('btn-add-page2-step3');
        if (btnAddPage2) btnAddPage2.style.display = 'inline-flex';
        
        const btnRescan = document.getElementById('btn-rescan');
        if (btnRescan) btnRescan.style.display = 'inline-flex';
        
        handleFile(pendingFiles.shift());
    }
    
    function handleFile(file) {
        if (!file) {
            cleanupCropper();
            
            if (croppedImages.length > 0) {
                for (let i = 0; i < croppedImages.length; i += 2) {
                    studentsQueue.push({ page1: croppedImages[i], page2: croppedImages[i+1] || null });
                }
            }
            processAllStudents(studentsQueue);

            return;
        }
        
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                showCropperForFile(img, {
                    isFirstImage: croppedImages.length === 0,
                    isPage2: isProcessingPage2,
                    hasMoreFiles: pendingFiles.length > 0
                });
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }
    
    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            handleMultipleFilesSelection(e.target.files);
            e.target.value = '';
        });
    }
    
    if (fileInputPage2) {
        fileInputPage2.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) {
                isSequentialCapture = true;
                isProcessingPage2 = true;
                useCameraForPage2 = !!e.target.getAttribute('capture');
                pendingFiles = []; 
                handleFile(e.target.files[0]);
                e.target.value = '';
            }
        });
    }
    
    const fileInputUpdate = document.getElementById('file-input-update');
    if (fileInputUpdate) {
        fileInputUpdate.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    const img = new Image();
                    img.onload = () => {
                        showCropperForFile(img, { isUpdate: true, isPage2: updateState.page === 2 });
                    };
                    img.src = ev.target.result;
                };
                reader.readAsDataURL(e.target.files[0]);
                e.target.value = '';
            }
        });
    }

    window.addEventListener('requestRetake', (e) => {
        updateState = e.detail;
        if (fileInputUpdate) {
            fileInputUpdate.setAttribute('capture', 'environment');
            fileInputUpdate.click();
        }
    });

    window.addEventListener('requestRecrop', (e) => {
        updateState = e.detail;
        if (updateState.record && updateState.record.original) {
            showCropperForFile(updateState.record.original, { isUpdate: true, isPage2: updateState.page === 2 });
        } else {
            showToast('Orijinal görüntü bulunamadı.', 'error');
        }
    });
    
    if (uploadZone) {
        uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadZone.classList.add('dragover');
        });
        uploadZone.addEventListener('dragleave', () => {
            uploadZone.classList.remove('dragover');
        });
        uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadZone.classList.remove('dragover');
            handleMultipleFilesSelection(e.dataTransfer.files);
        });
    }
    
    document.addEventListener('paste', (e) => {
        if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
        if (e.clipboardData && e.clipboardData.files) {
            handleMultipleFilesSelection(e.clipboardData.files);
        }
    });

    // --- Step 3 Page 2 Capture ---
    const fileInputPage2Step3 = document.getElementById('file-input-page2-step3');
    if (fileInputPage2Step3) {
        fileInputPage2Step3.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                isProcessingPage2 = true;
                setActiveStep(STEP_IDS.OCR_PROGRESS);
                const reader = new FileReader();
                reader.onload = (ev) => {
                    const img = new Image();
                    img.onload = async () => {
                        try {
                            const prep = prepareImageForOCR(img);
                            await runOCR(prep.dataUrl, prep.canvas, true, true);
                            showToast('2. sayfa bilgileri eklendi.', 'success');
                            setActiveStep(STEP_IDS.FORM_RESULT);
                            saveDraft();
                        } catch (err) {
                            setActiveStep(STEP_IDS.FORM_RESULT);
                        }
                    };
                    img.src = ev.target.result;
                };
                reader.readAsDataURL(file);
                e.target.value = '';
            }
        });
    }
    
    // --- Cropper UI Handlers ---
    
    function getCurrentOriginalImg() {
        const el = document.getElementById('cropper-image');
        if (!el || !el.src) return null;
        const newImg = new Image();
        newImg.src = el.src;
        return newImg;
    }

    function processNextStep(img, isAddingStudent = false, isSkip = false) {
        const originalImg = isSkip ? img : (getCurrentOriginalImg() || img);
        const imgRecord = { cropped: img, original: originalImg };
        
        croppedImages.push(imgRecord);
        
        if (isSequentialCapture && !isProcessingPage2) {
            page1ImageObj = imgRecord;
            cleanupCropper();
            
            // BACKGROUND OCR
            const prep = prepareImageForOCR(imgRecord.cropped);
            page1BackgroundPromise = runOCR(prep.dataUrl, prep.canvas, true, false, true);
            page1ImageObj.backgroundPromise = page1BackgroundPromise;
            
            setActiveStep(STEP_IDS.PAGE2_UPLOAD);
        } else {
            if (pendingFiles.length > 0) {
                handleFile(pendingFiles.shift());
            } else if (isAddingStudent) {
                studentsQueue.push({ page1: page1ImageObj, page2: imgRecord });
                cleanupCropper();
                croppedImages = [];
                page1ImageObj = null;
                isProcessingPage2 = false;
                isSequentialCapture = false;
                page1BackgroundPromise = null;
                
                const countEl = document.getElementById('batch-queue-count');
                if (countEl) countEl.textContent = studentsQueue.length;
                setActiveStep(STEP_IDS.BATCH_QUEUE);
            } else {
                cleanupCropper();
                if (page1ImageObj && imgRecord) {
                    studentsQueue.push({ page1: page1ImageObj, page2: imgRecord });
                } else if (croppedImages.length > 0) {
                    for (let i = 0; i < croppedImages.length; i += 2) {
                        studentsQueue.push({ page1: croppedImages[i], page2: croppedImages[i+1] || null });
                    }
                }
                processAllStudents(studentsQueue);
            }
        }
    }
    
    initCropperControls({
        onCancel: () => {
            cleanupCropper();
            croppedImages = [];
            pendingFiles = [];
            page1ImageObj = null;
            isProcessingPage2 = false;
            isSequentialCapture = false;
            setActiveStep(STEP_IDS.UPLOAD);
        },
        onSkip: () => {
            const img = document.getElementById('cropper-image');
            const newImg = new Image();
            newImg.src = img.src;
            processNextStep(newImg, false, true);
        },
        onConfirm: () => {
            getCroppedImage((img) => processNextStep(img, false));
        },
        onCropAddStudent: () => {
            getCroppedImage((img) => processNextStep(img, true));
        },
        onCropSkipAddStudent: () => {
            const imgEl = document.getElementById('cropper-image');
            const newImg = new Image();
            newImg.src = imgEl.src;
            processNextStep(newImg, true, true);
        },
        onNext: () => {
            getCroppedImage((img) => processNextStep(img));
        },
        onSkipCaptureNext: () => {
            isSequentialCapture = true;
            const imgEl = document.getElementById('cropper-image');
            const newImg = new Image();
            newImg.src = imgEl.src;
            processNextStep(newImg, false, true);
            if (fileInputPage2) {
                if(useCameraForPage2) fileInputPage2.setAttribute('capture', 'environment');
                else fileInputPage2.removeAttribute('capture');
                fileInputPage2.click();
            }
        },
        onCropCaptureNext: () => {
            isSequentialCapture = true;
            getCroppedImage((img) => {
                processNextStep(img);
                if (fileInputPage2) {
                    if(useCameraForPage2) fileInputPage2.setAttribute('capture', 'environment');
                    else fileInputPage2.removeAttribute('capture');
                    fileInputPage2.click();
                }
            });
        },
        onUpdate: () => {
            getCroppedImage(async (img) => {
                const state = updateState;
                updateState = null;
                const originalImg = getCurrentOriginalImg() || img;
                const imgRecord = { cropped: img, original: originalImg };
                cleanupCropper();
                
                if (state) {
                    const isPage2 = state.page === 2;
                    const studentRecord = studentsQueue[state.index];
                    if (studentRecord) {
                        if (isPage2) studentRecord.page2 = imgRecord;
                        else studentRecord.page1 = imgRecord;
                    }
                    
                    setActiveStep(STEP_IDS.OCR_PROGRESS);
                    try {
                        const prep = prepareImageForOCR(imgRecord.cropped);
                        const result = await runOCR(prep.dataUrl, prep.canvas, true, isPage2);
                        
                        const wrappers = document.querySelectorAll('.student-form-wrapper');
                        const wrapper = Array.from(wrappers).find(w => parseInt(w.dataset.index) === state.index);
                        if (wrapper && result) {
                            populateFormNode(wrapper, result);
                            showToast(`${state.page}. Sayfa başarıyla güncellendi.`, 'success');
                            window.dispatchEvent(new Event('formChanged'));
                        }
                        setActiveStep(STEP_IDS.FORM_RESULT);
                    } catch (err) {
                        console.error('Update OCR Error', err);
                        if (err.name !== 'AbortError' && err.message !== 'Aborted') {
                            setActiveStep(STEP_IDS.FORM_RESULT);
                        }
                    }
                }
            });
        }
    });

    const btnUploadPage2 = document.getElementById('btn-upload-page2');
    const btnCancelPage2 = document.getElementById('btn-cancel-page2');
    if (btnUploadPage2) {
        btnUploadPage2.addEventListener('click', () => {
            useCameraForPage2 = false;
            if (fileInputPage2) {
                fileInputPage2.removeAttribute('capture');
                fileInputPage2.click();
            }
        });
    }
    if (btnCancelPage2) {
        btnCancelPage2.addEventListener('click', () => {
            isSequentialCapture = false;
            isProcessingPage2 = false;
            if (page1ImageObj) {
                processAllStudents([[page1ImageObj, null]]);
            }
        });
    }

    // --- OCR Orchestration ---
    async function processAndRunOCR(img) {
        if (!img) return;
        setActiveStep(STEP_IDS.OCR_PROGRESS);
        try {
            const prep = prepareImageForOCR(img);
            await runOCR(prep.dataUrl, prep.canvas, false, isProcessingPage2);
        } catch (error) {
            console.error(error);
        }
    }

    
    async function processAllStudents(queue) {
        setActiveStep(STEP_IDS.OCR_PROGRESS);
        const progressBar = document.getElementById('progress-bar');
        const progressText = document.getElementById('progress-text');
        if (progressText) progressText.textContent = `${queue.length} öğrencinin belgeleri analiz ediliyor...`;
        
        try {
            const results = [];
            for (let i = 0; i < queue.length; i++) {
                const studentImages = queue[i];
                const page1Record = studentImages.page1;
                const page2Record = studentImages.page2;
                
                const p1 = prepareImageForOCR(page1Record.cropped);
                const p2 = page2Record ? prepareImageForOCR(page2Record.cropped) : null;
                
                let studentResult = {};
                if (progressText) progressText.textContent = `${queue.length} öğrencinin ${i + 1}.si analiz ediliyor...`;
                
                let res1;
                if (page1Record.backgroundPromise) {
                    res1 = await page1Record.backgroundPromise;
                } else {
                    res1 = await runOCR(p1.dataUrl, p1.canvas, true, false);
                }
                
                if (p2) {
                    const res2 = await runOCR(p2.dataUrl, p2.canvas, true, true);
                    studentResult = { ...res1, ...res2 };
                } else {
                    studentResult = res1 || {};
                }
                
                studentResult._page1Record = page1Record;
                studentResult._page2Record = page2Record;
                
                results.push(studentResult);
                
                if (progressBar) {
                    const percent = Math.round(((i + 1) / queue.length) * 100);
                    progressBar.style.width = percent + '%';
                    document.querySelectorAll('#progress-percentage').forEach(el => el.textContent = '%' + percent);
                }
            }
            
            renderStudentForms(results);
            setActiveStep(STEP_IDS.FORM_RESULT);
            showToast(`${queue.length} öğrenci başarıyla analiz edildi.`, 'success');
            saveDraft();
            
        } catch (error) {
            console.error('OCR İşlemi başarısız:', error);
            if (error.name !== 'AbortError' && error.message !== 'Aborted') {
                setActiveStep(STEP_IDS.UPLOAD);
            }
        } finally {
            croppedImages = [];
            page1ImageObj = null;
            isProcessingPage2 = false;
            isSequentialCapture = false;
            studentsQueue = [];
        }
    }
    

    // --- Cancel OCR Wiring ---
    const btnCancelOcr = document.getElementById('btn-cancel-ocr');
    if (btnCancelOcr) {
        btnCancelOcr.addEventListener('click', () => {
            cancelOCR();
            setActiveStep(STEP_IDS.UPLOAD);
        });
    }

    // History restore event listener for cleaning cropper states
    window.addEventListener('historyRestore', () => {
        croppedImages = [];
        page1ImageObj = null;
        isSequentialCapture = false;
        isProcessingPage2 = false;

        // Reset "E-Tabloya Ekle" button(s) back to original state
        document.querySelectorAll('.btn-add-to-sheet').forEach(btn => {
            btn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" class="btn-icon"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line><line x1="15" y1="13" x2="15" y2="17"></line><line x1="13" y1="15" x2="17" y2="15"></line></svg> E-Tabloya Ekle`;
            btn.style.backgroundColor = '#27ae60';
            btn.style.borderColor = '#27ae60';
            btn.style.color = '';
            btn.style.cursor = '';
            btn.disabled = false;
            btn.dataset.added = 'false';
            btn.dataset.assignedNo = '';
        });
    });

    // --- Action Buttons (Step 3) ---
    const btnRescan = document.getElementById('btn-rescan');
    const btnCopyOcr = document.getElementById('btn-copy-ocr');
    const btnDownload = document.getElementById('btn-download');
    const btnPrint = document.getElementById('btn-print');

    if (btnRescan) {
        btnRescan.addEventListener('click', () => {
            const fileInput = document.getElementById('file-input');
            if (fileInput) fileInput.click();
        });
    }

    const btnGoHome = document.getElementById('btn-go-home-global');
    if (btnGoHome) {
        btnGoHome.addEventListener('click', () => {
            setActiveStep(STEP_IDS.UPLOAD);
        });
    }

    if (btnCopyOcr) {
        btnCopyOcr.addEventListener('click', () => {
            const rawText = document.getElementById('ocr-raw-text') ? document.getElementById('ocr-raw-text').value : '';
            navigator.clipboard.writeText(rawText).then(() => {
                showToast('Ham OCR metni kopyalandı.', 'success');
            });
        });
    }

    
    document.addEventListener('click', (e) => {
        const btnDownload = e.target.closest('.btn-download-student');
        if (btnDownload) {
            const wrapper = btnDownload.closest('.student-form-wrapper');
            generateAndDownloadPdf(btnDownload, wrapper);
        }
    });

    
    document.addEventListener('click', (e) => {
        const btnPrint = e.target.closest('.btn-print-student');
        if (btnPrint) {
            const wrapper = btnPrint.closest('.student-form-wrapper');
            printDocument(btnPrint, wrapper);
        }
    });

    document.addEventListener('click', async (e) => {
        const btnAdd = e.target.closest('.btn-add-to-sheet');
        if (btnAdd) {
            const wrapper = btnAdd.closest('.student-form-wrapper');
            if (!wrapper) return;

            // Get Adı and Soyadı
            const inputAdi = wrapper.querySelector('input[data-field="adi"]');
            const inputSoyadi = wrapper.querySelector('input[data-field="soyadi"]');
            const isim = `${inputAdi ? inputAdi.value.trim() : ''} ${inputSoyadi ? inputSoyadi.value.trim() : ''}`.trim();

            if (!isim) {
                showToast('Lütfen önce ad ve soyad bilgisini doldurun.', 'warning');
                return;
            }

            // Calculate NEXT week's Monday
            const today = new Date();
            const currentDay = today.getDay(); // 0 is Sunday, 1 is Monday
            
            // Find CURRENT week's Monday
            const diffToCurrentMonday = today.getDate() - currentDay + (currentDay === 0 ? -6 : 1);
            const currentMonday = new Date(today.getFullYear(), today.getMonth(), diffToCurrentMonday);
            
            // Add 7 days to get NEXT week's Monday
            const nextMonday = new Date(currentMonday);
            nextMonday.setDate(currentMonday.getDate() + 7);
            
            const dd = String(nextMonday.getDate()).padStart(2, '0');
            const mm = String(nextMonday.getMonth() + 1).padStart(2, '0');
            const yyyy = nextMonday.getFullYear();
            const sayfa = `${dd}.${mm}.${yyyy}`;

            // Check if already added
            if (btnAdd.dataset.added === 'true') {
                const assignedNo = btnAdd.dataset.assignedNo;
                const originalHtml = btnAdd.innerHTML;
                btnAdd.innerHTML = '<div class="spinner" style="width: 14px; height: 14px; border-width: 2px;"></div> Kaldırılıyor...';
                btnAdd.disabled = true;

                try {
                    const response = await fetch('/api/remove-tebligat', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ sayfa, isim, no: assignedNo })
                    });
                    const data = await response.json();
                    if (response.ok && data.success) {
                        btnAdd.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" class="btn-icon"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line><line x1="15" y1="13" x2="15" y2="17"></line><line x1="13" y1="15" x2="17" y2="15"></line></svg> E-Tabloya Ekle`;
                        btnAdd.style.backgroundColor = '#27ae60';
                        btnAdd.style.borderColor = '#27ae60';
                        btnAdd.style.color = '';
                        btnAdd.style.cursor = '';
                        btnAdd.disabled = false;
                        btnAdd.dataset.added = 'false';
                        showToast(`Başarılı: ${sayfa} sayfasından kaldırıldı!`, 'success');
                    } else {
                        throw new Error(data.error || 'Kaldırma başarısız');
                    }
                } catch (err) {
                    console.error(err);
                    btnAdd.innerHTML = originalHtml;
                    btnAdd.disabled = false;
                    showToast(`Hata: ${err.message}`, 'error');
                }
                return;
            }

            // Set button to loading (Add mode)
            const originalHtml = btnAdd.innerHTML;
            btnAdd.innerHTML = '<div class="spinner" style="width: 14px; height: 14px; border-width: 2px;"></div> Ekleniyor...';
            btnAdd.disabled = true;

            try {
                const response = await fetch('/api/add-tebligat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sayfa, isim })
                });
                
                const data = await response.json();
                if (response.ok && data.success) {
                    btnAdd.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><polyline points="20 6 9 17 4 12"></polyline></svg> Eklendi (${sayfa} / No: ${data.assignedNo || '-'}) (Tablodan kaldırmak için tekrar tıklayınız.)`;
                    btnAdd.style.backgroundColor = 'rgba(39, 174, 96, 0.1)';
                    btnAdd.style.color = '#27ae60';
                    btnAdd.style.borderColor = '#27ae60';
                    btnAdd.style.cursor = 'pointer';
                    btnAdd.disabled = false;
                    btnAdd.dataset.added = 'true';
                    btnAdd.dataset.assignedNo = data.assignedNo || '';
                    showToast(`Başarılı: ${sayfa} sayfasına ${data.assignedNo || '-'} numarasıyla eklendi!`, 'success');
                } else {
                    throw new Error(data.error || 'Ekleme başarısız');
                }
            } catch (err) {
                console.error(err);
                btnAdd.innerHTML = originalHtml;
                btnAdd.disabled = false;
                showToast(`Hata: ${err.message}`, 'error');
            }
        }
    });

    
    // --- Online/Offline Listener ---
    const updateOnlineStatus = () => {
        const btnUpload = document.getElementById('btn-upload');
        if (navigator.onLine) {
            if(btnUpload) {
                btnUpload.disabled = false;
                btnUpload.style.opacity = '1';
                btnUpload.title = '';
            }
        } else {
            if(btnUpload) {
                btnUpload.disabled = true;
                btnUpload.style.opacity = '0.5';
                btnUpload.title = 'İnternet bağlantısı yok';
            }
            showToast('İnternet bağlantısı kesildi. Çevrimdışı moda geçildi.', 'warning');
        }
    };

    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    updateOnlineStatus(); // initial check

    // --- Shortcut Listener ---
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
            const step3 = document.getElementById('step-3');
            if (step3 && step3.classList.contains('active')) {
                e.preventDefault();
                const btnPrint = document.getElementById('btn-print');
                if (btnPrint) btnPrint.click();
            }
        }
    });
});

// --- PWA Installation Logic ---
let deferredPrompt;
const isIos = () => /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

document.addEventListener('DOMContentLoaded', () => {
    const installBtn = document.getElementById('btn-install-pwa');
    
    // iOS Handling
    if (installBtn && !isStandalone() && isIos()) {
        installBtn.style.display = 'inline-flex';
        installBtn.addEventListener('click', () => {
            alert("🍎 iOS Cihazlarda Yükleme:\n\n1. Safari'nin alt menüsündeki 'Paylaş' (Kare içinde yukarı ok) butonuna dokunun.\n2. Açılan menüyü aşağı kaydırıp 'Ana Ekrana Ekle' seçeneğine dokunun.\n3. Sağ üstten 'Ekle' diyerek işlemi tamamlayın.");
        });
    }
});

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    
    const installBtn = document.getElementById('btn-install-pwa');
    if (installBtn && !isStandalone()) {
        installBtn.style.display = 'inline-flex';
        
        // Remove old listeners to avoid multiple fires
        const newBtn = installBtn.cloneNode(true);
        installBtn.parentNode.replaceChild(newBtn, installBtn);
        
        newBtn.addEventListener('click', async () => {
            if (deferredPrompt) {
                deferredPrompt.prompt();
                const { outcome } = await deferredPrompt.userChoice;
                if (outcome === 'accepted') {
                    newBtn.style.display = 'none';
                }
                deferredPrompt = null;
            }
        });
    }
});

window.addEventListener('appinstalled', () => {
    const installBtn = document.getElementById('btn-install-pwa');
    if (installBtn) installBtn.style.display = 'none';
    deferredPrompt = null;
});
