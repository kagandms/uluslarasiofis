import { extractFromCoordinates, extractPage2FromCoordinates } from "./utils/parser.js";
// --- PWA Installation Logic ---
let deferredPrompt;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent the mini-infobar from appearing on mobile
    e.preventDefault();
    // Stash the event so it can be triggered later.
    deferredPrompt = e;
    // Update UI notify the user they can install the PWA
    const installBtn = document.getElementById('btn-install-pwa');
    if (installBtn && !isStandalone) {
        installBtn.style.display = 'inline-flex';
    }
});

// Wait for DOM to load
document.addEventListener('DOMContentLoaded', () => {
    // ============================================
    // GOOGLE VISION API KEY (DOĞRUDAN BAĞLANTI)
    // ============================================
    // Vercel sunucusunu aradan çıkarıp doğrudan Google'a bağlanmak ve hızı artırmak için 
    // buraya Google Cloud API anahtarınızı yapıştırabilirsiniz. 
    // Güvenlik için Google Cloud Console üzerinden bu anahtarı sadece kendi domaininizde çalışacak şekilde kısıtlamalısınız.
    // Eğer burası boş bırakılırsa (''), sistem otomatik olarak /api/ocr (Vercel) üzerinden yavaş ama güvenli yoldan çalışmaya devam eder.
    // ============================================
    // Google Vision API Anahtarları (Birden fazla eklenebilir)
    // Kota (aylık 1000 limit) dolduğunda sistem otomatik olarak sıradakine geçer.
    const GOOGLE_VISION_API_KEYS = [
        'AIzaSyDYxXNcg1XH9YR-I6fyVdsoZjxryFj27tU', // 1. API
        'AIzaSyDdi7G0dHDDPOEuhaGYhYmVfIA2mYhuniM', // 2. API
        ''  // 3. API (buraya yapıştırın)
    ];
    let currentApiKeyIndex = 0; 
    // ============================================

    // --- DOM Elements ---
    const uploadZone = document.getElementById('upload-zone');
    const fileInput = document.getElementById('file-input');
    const fileInputPage2 = document.getElementById('file-input-page2');
    const cameraBtn = document.getElementById('camera-btn');
    const previewImage = document.getElementById('preview-image');
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');
    const toastContainer = document.getElementById('toast-container');
    
    let isProcessingPage2 = false;
    let page1ImageObj = null;
    let isSequentialCapture = false;
    let useCameraForPage2 = false;
    let pendingFiles = [];
    let croppedImages = [];
    let activeAbortControllers = new Set(); // İptal butonu için aktif OCR isteklerini takip eder

    // Steps
    const step1 = document.getElementById('step-1');
    const stepPage2 = document.getElementById('step-page2');
    const step2 = document.getElementById('step-2');
    const step3 = document.getElementById('step-3');
    
    // Buttons
    const btnRescan = document.getElementById('btn-rescan');
    const btnClear = document.getElementById('btn-clear');
    const btnDownload = document.getElementById('btn-download');
    const btnPrint = document.getElementById('btn-print');
    const btnCopyOcr = document.getElementById('btn-copy-ocr');
    const btnInstallPwa = document.getElementById('btn-install-pwa');
    const btnCancelOcr = document.getElementById('btn-cancel-ocr');
    const btnUploadPage2 = document.getElementById('btn-upload-page2');
    const btnCancelPage2 = document.getElementById('btn-cancel-page2');

    // PWA Install Logic for iOS fallback display
    if (btnInstallPwa) {
        if (isIOS && !isStandalone) {
            btnInstallPwa.style.display = 'inline-flex';
        }
        
        btnInstallPwa.addEventListener('click', async () => {
            if (isIOS) {
                // Show iOS custom modal
                const iosModal = document.getElementById('ios-pwa-modal');
                if (iosModal) iosModal.style.display = 'flex';
            } else if (deferredPrompt) {
                // Show native Android/Desktop install prompt
                deferredPrompt.prompt();
                const { outcome } = await deferredPrompt.userChoice;
                if (outcome === 'accepted') {
                    console.log('User accepted the install prompt');
                    btnInstallPwa.style.display = 'none';
                }
                deferredPrompt = null;
            }
        });
    }
    function getDocumentHtml(vBasvuruNo, vTeslim, vYabanciKimlik, vPasaportNo, vAdi, vSoyadi, vUyrugu, vDogum, vAdres, vTel, vMail, currentYear, vTebligatTarihi, isPrint = false) {
        const wrapperStyle = isPrint 
            ? "font-family:'Times New Roman',Times,serif;padding:5mm 10mm;color:black;background:white;border:4px double black;box-sizing:border-box;max-width:210mm;margin:0 auto;-webkit-print-color-adjust:exact;print-color-adjust:exact;"
            : "font-family:'Times New Roman',Times,serif;padding:12mm 14mm;color:black;background:white;border:4px double black;box-sizing:border-box;width:794px;";
            
        return `
            <style>
                .pt { width: 100%; border-collapse: collapse; margin-bottom: 5px; }
                .pt th, .pt td { border: 1px solid #000; padding: 9px 10px; text-align: left; vertical-align: middle; font-size: 14px; font-family: 'Times New Roman', serif; }
                .pt th { font-weight: bold; }
            </style>
            <div id="${isPrint ? 'pdf-content' : 'pdf-canvas-content'}" style="${wrapperStyle}">
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
                    <div style="width: 60px; height: 60px; display: flex; align-items: center; justify-content: flex-start;">
                        <img src="topkapi_logo.jpg" style="height: 100%; width: auto; mix-blend-mode: multiply;" crossorigin="anonymous">
                    </div>
                    <div style="flex: 1; border: 1px solid black; margin: 0 15px; padding: 8px 0; text-align: center; font-size: 16px; font-weight: bold;">
                        İSTANBUL TOPKAPI ÜNİVERSİTESİ
                    </div>
                    <div style="width: 60px; height: 60px; display: flex; align-items: center; justify-content: flex-end;">
                        <img src="goc_logo.png" style="height: 100%; width: auto;" crossorigin="anonymous">
                    </div>
                </div>
                <table class="pt" style="margin-bottom:4px;">
                    <tr><td colspan="4" style="height:18px;"></td></tr>
                    <tr>
                        <th width="25%"><u>e</u>-İkamet<br>Başvuru No</th><td width="25%">${currentYear}-${vBasvuruNo.replace(new RegExp('^' + currentYear + '-'), '')}</td>
                        <th width="25%">Öğrencinin Evraklarını<br>Ofise Teslim Tarihi</th><td width="25%">${vTeslim}</td>
                    </tr>
                    <tr>
                        <th>Yabancı Kimlik<br>No</th><td>${vYabanciKimlik}</td>
                        <th>Pasaport No</th><td>${vPasaportNo}</td>
                    </tr>
                    <tr>
                        <th>Adı</th><td>${vAdi}</td>
                        <th>Soyadı</th><td>${vSoyadi}</td>
                    </tr>
                    <tr>
                        <th>Uyruğu</th><td>${vUyrugu}</td>
                        <th>Doğum Tarihi</th><td>${vDogum}</td>
                    </tr>
                    <tr>
                        <td></td>
                        <td style="text-align:center;">Adres</td>
                        <td style="text-align:center;">Tel No</td>
                        <td style="text-align:center;">Mail</td>
                    </tr>
                    <tr>
                        <th>Öğrencinin<br>İletişim Bilgisi</th>
                        <td>${vAdres.toUpperCase().startsWith('İSTANBUL') ? '' : 'İSTANBUL, '}${vAdres}</td>
                        <td>${vTel}</td>
                        <td>${vMail}</td>
                    </tr>
                </table>
                <p style="text-align:justify;font-size:11.5px;margin:6px 0;line-height:1.3;text-indent:30px;">
                    6458 sayılı Kanunun 38. maddesi çerçevesinde istenilen aşağıdaki belgelerin ekte sunulduğuna dair işbu tebliğ ve tebellüğ belgesi tanzim edilerek taraflarca imza altına alınmış, belgenin bir sureti tarafınıza teslim edilmiş olup, diğer sureti İl Göç İdaresi Müdürlüğüne gönderilecektir.
                </p>

                <p style="font-weight:bold;font-size:12px;margin:8px 0 4px 0;">BELGELER:</p>
                <ul style="list-style:none;padding:0 0 0 10px;margin:0;font-size:10.5px;line-height:1.2;">
                    <li style="margin-bottom:1px;">☐ İkamet izni kayıt/başvuru formu (öğrenci tarafından ıslak imzalı şekilde)</li>
                    <li style="margin-bottom:1px;">☐ Pasaport ya da pasaport yerine geçen belge (aslı görüldü şeklinde)</li>
                    <li style="margin-bottom:1px;">☐ Öğrencilik durumunu gösterir belge</li>
                    <li style="margin-bottom:1px;">☐ 4 adet biometrik fotoğraf</li>
                    <li style="margin-bottom:1px;">☐ Geçerli sağlık sigortası (GSS ya da ikamet izni talep süresini kapsayan özel sağlık sigortası)</li>
                    <li style="margin-bottom:1px;">☐ Kalacağı adres bilgilerini gösterir belge
                        <ul style="list-style-type:disc;padding-left:20px;margin:2px 0;">
                            <li>Kendi evinde kalıyorsa, tapu fotokopisi (uzatma başvurularında "yerleşim yeri belgesi ve fatura" yeterlidir)</li>
                            <li>Kira sözleşmesi ile kalıyorsa, kira sözleşmesinin noter onaylı örneği</li>
                            <li>Otel vb. konaklama yerlerinde kalınıyorsa, bu yerlerde kalındığına dair belge</li>
                            <li>Öğrenci yurtlarında kalınıyorsa, yurtta kalındığına dair belge</li>
                            <li>Destekleyici yanında kalınıyorsa, yanında kaldığı kişinin noter onaylı taahhüdü (Destekleyici evli ise ayrıca eşinin de noter onaylı taahhüdü)</li>
                        </ul>
                    </li>
                    <li style="margin-bottom:1px;">☐ İkamet izni belge bedelinin ödendiğine dair makbuz</li>
                    <li style="margin-bottom:1px;">☐ 18 yaşından küçük yabancılar için; vize muafiyetiyle ya da farklı amaca yönelik vizeyle gelenler için; veli/vasi bilgisini içeren belge (doğum belgesi, aile belgesi vb.) ve veli/vasi/yasal temsilcisi tarafından verilen muvafakatname (amacına uygun vizeyle ((öğrenim vizesi)) gelenler için; muvafakatname ve veli/vasi bilgisini içeren belge eklenmeyecektir.)</li>
                </ul>
                <p style="font-weight:bold;font-size:12px;margin:12px 0 4px 0;text-align:center;border:1px solid #000;padding:6px;">Tebliğ belgenizi teslim almak üzere müracaat edebileceğiniz en erken tarih: ${vTebligatTarihi}</p>
                <div style="margin-top:40px;display:flex;justify-content:space-around;font-weight:bold;font-size:13px;padding-bottom:15mm;padding-top:15px;page-break-before:avoid;break-before:avoid;">
                    <div style="text-align:center;"><u>TEBLİĞ EDEN</u><br><br>Üniversite Personeli</div>
                    <div style="text-align:center;"><u>TEBELLÜĞ EDEN</u><br><br>Yabancı Öğrenci</div>
                </div>
            </div>
        `;
    }

    // Form Fields
    const fields = {
        basvuruNo: document.getElementById('field-basvuru-no'),
        teslimTarihi: document.getElementById('field-teslim-tarihi'),
        pasaportNo: document.getElementById('field-pasaport-no'),
        adi: document.getElementById('field-adi'),
        soyadi: document.getElementById('field-soyadi'),
        uyrugu: document.getElementById('field-uyrugu'),
        dogumTarihi: document.getElementById('field-dogum-tarihi'),
        adres: document.getElementById('field-adres'),
        tel: document.getElementById('field-tel'),
        mail: document.getElementById('field-mail')
    };

    // ===========================================
    // GEÇMIŞ / İŞLEM LOGU SİSTEMİ
    // ===========================================
    const HISTORY_KEY = 'ikamet-history';
    const TRASH_KEY = 'ikamet-history-trash';
    const HISTORY_MAX_DAYS = 30;

    const historyManager = {
        isDeleteMode: false,
        isTrashMode: false,
        selectedIds: new Set(),
        getAll() {
            try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
        },
        getTrashAll() {
            try { return JSON.parse(localStorage.getItem(TRASH_KEY) || '[]'); } catch { return []; }
        },
        saveTrash(items) {
            const trash = this.getTrashAll();
            const now = new Date().toISOString();
            items.forEach(i => { i.deletedAt = now; trash.unshift(i); });
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - HISTORY_MAX_DAYS);
            const filtered = trash.filter(t => new Date(t.deletedAt || t.timestamp) > cutoff);
            localStorage.setItem(TRASH_KEY, JSON.stringify(filtered));
        },
        restoreFromTrash(id) {
            const trash = this.getTrashAll();
            const entry = trash.find(t => t.id === id);
            if (entry) {
                const history = this.getAll();
                delete entry.deletedAt;
                history.unshift(entry);
                history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
                const remaining = trash.filter(t => t.id !== id);
                localStorage.setItem(TRASH_KEY, JSON.stringify(remaining));
                this.render();
            }
        },
        emptyTrash() {
            localStorage.removeItem(TRASH_KEY);
            this.render();
        },

        save(action) {
            const now = new Date();
            const entry = {
                id: `${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
                timestamp: now.toISOString(),
                date: `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}.${now.getFullYear()}`,
                time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
                action: action, // 'pdf' veya 'print'
                fields: {}
            };
            // Tüm form alanlarını kaydet
            Object.entries(fields).forEach(([key, field]) => {
                if (!field) return;
                entry.fields[key] = field.value || '';
            });
            // Uyrugu "OTHER" ise diğer input'u da kaydet
            const otherInput = document.getElementById('field-uyrugu-other');
            if (otherInput && fields.uyrugu && fields.uyrugu.value === 'OTHER') {
                entry.fields.uyruguOther = otherInput.value || '';
            }

            const history = this.getAll();
            history.unshift(entry); // En yeni başa

            // 30 günden eski kayıtları temizle
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - HISTORY_MAX_DAYS);
            const filtered = history.filter(h => new Date(h.timestamp) > cutoff);

            localStorage.setItem(HISTORY_KEY, JSON.stringify(filtered));
            this.render();
        },

        toggleSelection(id) {
            if (this.selectedIds.has(id)) {
                this.selectedIds.delete(id);
            } else {
                this.selectedIds.add(id);
            }
            this.render();
        },
        
        deleteSelected() {
            const history = this.getAll();
            const toDelete = history.filter(h => this.selectedIds.has(h.id));
            if (toDelete.length > 0) this.saveTrash(toDelete);

            const remaining = history.filter(h => !this.selectedIds.has(h.id));
            localStorage.setItem(HISTORY_KEY, JSON.stringify(remaining));
            this.selectedIds.clear();
            this.isDeleteMode = false;
            this.render();
        },

        deleteEntry(id) {
            const history = this.getAll();
            const entry = history.find(h => h.id === id);
            if (entry) this.saveTrash([entry]);

            const remaining = history.filter(h => h.id !== id);
            localStorage.setItem(HISTORY_KEY, JSON.stringify(remaining));
            this.render();
        },

        clearAll() {
            const history = this.getAll();
            if (history.length > 0) this.saveTrash(history);
            localStorage.removeItem(HISTORY_KEY);
            this.render();
        },

        getTodayCount() {
            const today = new Date();
            const todayStr = `${String(today.getDate()).padStart(2, '0')}.${String(today.getMonth() + 1).padStart(2, '0')}.${today.getFullYear()}`;
            return this.getAll().filter(h => h.date === todayStr).length;
        },

        getGroupedByDate(sourceArray) {
            const history = sourceArray || this.getAll();
            const groups = {};
            history.forEach(h => {
                if (!groups[h.date]) groups[h.date] = [];
                groups[h.date].push(h);
            });
            return groups;
        },

        _formatDateLabel(dateStr) {
            const today = new Date();
            const todayStr = `${String(today.getDate()).padStart(2, '0')}.${String(today.getMonth() + 1).padStart(2, '0')}.${today.getFullYear()}`;
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = `${String(yesterday.getDate()).padStart(2, '0')}.${String(yesterday.getMonth() + 1).padStart(2, '0')}.${yesterday.getFullYear()}`;

            if (dateStr === todayStr) return 'Bugün';
            if (dateStr === yesterdayStr) return 'Dün';
            return dateStr;
        },

        restore(id) {
            const entry = this.getAll().find(h => h.id === id);
            if (!entry || !entry.fields) return;

            // Teslim tarihi dahil tüm alanları doldur
            Object.entries(entry.fields).forEach(([key, value]) => {
                if (key === 'uyruguOther') return; // Ayrı işle
                const field = fields[key];
                if (!field) return;
                field.value = value;
                if (value) field.classList.add('field-filled');
                else field.classList.remove('field-filled');
            });

            // Uyrugu "OTHER" ise diğer input'u göster
            const otherInput = document.getElementById('field-uyrugu-other');
            if (otherInput) {
                if (entry.fields.uyrugu === 'OTHER' && entry.fields.uyruguOther) {
                    otherInput.value = entry.fields.uyruguOther;
                    otherInput.style.display = 'block';
                } else {
                    otherInput.value = '';
                    otherInput.style.display = 'none';
                }
            }

            // Step 3'e geç
            croppedImages = [];
            page1ImageObj = null;
            setActiveStep(3);
            
            const name = [entry.fields.adi, entry.fields.soyadi].filter(Boolean).join(' ') || 'Kayıt';
            showToast(`${name} bilgileri yüklendi.`, 'success');
        },

        render() {
            const todayCount = this.getTodayCount();
            
            const itemsToRender = this.isTrashMode ? this.getTrashAll() : this.getAll();
            const groups = this.getGroupedByDate(itemsToRender);
            const totalCount = itemsToRender.length;
            const trashCount = this.getTrashAll().length;

            // Step 3 badge güncelle
            const badge = document.getElementById('history-today-badge');
            if (badge) {
                badge.textContent = `Bugün: ${todayCount}`;
                badge.style.display = todayCount > 0 ? 'inline-flex' : 'none';
            }

            // Ana sayfa paneli
            const panel = document.getElementById('history-panel');
            if (!panel) return;

            const header = panel.querySelector('.history-header');
            const body = panel.querySelector('.history-body');
            if (!header || !body) return;

            // Sayaç güncelle
            const countEl = header.querySelector('.history-count');
            if (countEl) {
                if (this.isTrashMode) {
                    countEl.textContent = 'Çöp Kutusu';
                } else {
                    countEl.textContent = todayCount > 0 ? `Bugün: ${todayCount} işlem` : 'Henüz işlem yok';
                }
            }

            if (totalCount === 0) {
                if (this.isTrashMode) {
                    body.innerHTML = '<p class="history-empty">Çöp kutusu boş.</p>';
                    body.innerHTML += '<div class="history-actions-row"><button class="history-btn-secondary" id="btn-history-back">← Geri Dön</button></div>';
                } else {
                    body.innerHTML = '<p class="history-empty">Henüz kayıt bulunmuyor. PDF indirdiğinizde veya yazdırdığınızda burada görünecek.</p>';
                    if (trashCount > 0) {
                        body.innerHTML += `<div class="history-actions-row" style="margin-top:15px;"><button class="history-btn-secondary" id="btn-history-trash">🗑️ Çöp Kutusu (${trashCount})</button></div>`;
                    }
                }
            } else {
                let html = '';
                const dates = Object.keys(groups);
                dates.forEach(date => {
                    const label = this._formatDateLabel(date);
                    const items = groups[date];
                    html += `<div class="history-date-group">
                        <div class="history-date-title">
                            <span>${label}</span>
                            <span class="history-date-count">${items.length} kayıt</span>
                        </div>`;
                    
                    items.forEach(item => {
                        const name = [item.fields.adi, item.fields.soyadi].filter(Boolean).join(' ') || '—';
                        const basvuruNo = item.fields.basvuruNo || '';
                        let uyruk = item.fields.uyrugu || '';
                        if (uyruk === 'OTHER' && item.fields.uyruguOther) uyruk = item.fields.uyruguOther;
                        const actionIcon = item.action === 'pdf' ? '📄' : '🖨️';
                        const actionLabel = item.action === 'pdf' ? 'PDF' : 'Yazdır';
                        const isSelected = this.selectedIds.has(item.id);
                        const selectedClass = isSelected ? 'selected' : '';
                        
                        const checkboxHtml = this.isDeleteMode ? `
                            <div class="history-checkbox ${selectedClass}">
                                ${isSelected ? '✓' : ''}
                            </div>
                        ` : '';

                        const itemActionBtn = this.isTrashMode 
                            ? `<button class="history-restore-btn" data-restore-id="${item.id}" title="Geri Yükle">↺</button>`
                            : (!this.isDeleteMode ? `<button class="history-delete-btn" data-delete-id="${item.id}" title="Sil">✕</button>` : '');

                        html += `<div class="history-item ${this.isDeleteMode ? 'delete-mode' : ''} ${selectedClass}" data-id="${item.id}" title="${this.isDeleteMode ? 'Seç / Bırak' : (this.isTrashMode ? 'Geri yüklemek için yandaki butonu kullanın' : 'Tıkla → formu doldur')}">
                            ${checkboxHtml}
                            <div class="history-item-content">
                                <div class="history-item-main">
                                    <span class="history-item-name">${name}</span>
                                    <span class="history-item-time">${actionIcon} ${item.time}</span>
                                </div>
                                <div class="history-item-detail">
                                    ${basvuruNo ? `<span>${basvuruNo}</span>` : ''}
                                    ${uyruk ? `<span>• ${uyruk}</span>` : ''}
                                    <span class="history-item-action-label">${actionLabel}</span>
                                </div>
                            </div>
                            ${itemActionBtn}
                        </div>`;
                    });

                    html += '</div>';
                });

                html += `<div class="history-actions-row">`;
                
                if (this.isTrashMode) {
                    html += `<button class="history-btn-secondary" id="btn-history-back">← Geri Dön</button>`;
                    html += `<button class="history-btn-danger" id="btn-history-empty-trash">💥 Çöp Kutusunu Boşalt</button>`;
                } else {
                    if (trashCount > 0) {
                        html += `<button class="history-btn-secondary" id="btn-history-trash">🗑️ Çöp Kutusu (${trashCount})</button>`;
                    }
                    html += `<button class="history-btn-danger" id="btn-history-clear">🗑️ Tümünü Temizle</button>`;
                }
                
                html += `</div>`;

                body.innerHTML = html;
            }

            // Event delegation
            body.querySelectorAll('.history-item').forEach(el => {
                el.addEventListener('click', (e) => {
                    if (e.target.closest('.history-delete-btn') || e.target.closest('.history-restore-btn')) return;
                    if (this.isTrashMode) return; // Çöp kutusundayken item'a tıklamak bir şey yapmasın
                    if (this.isDeleteMode) {
                        this.toggleSelection(el.dataset.id);
                    } else {
                        this.restore(el.dataset.id);
                    }
                });
            });

            body.querySelectorAll('.history-delete-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.deleteEntry(btn.dataset.deleteId);
                });
            });

            body.querySelectorAll('.history-restore-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.restoreFromTrash(btn.dataset.restoreId);
                    showToast('Kayıt geçmişe geri yüklendi.', 'info');
                });
            });

            const clearBtn = document.getElementById('btn-history-clear');
            if (clearBtn) {
                clearBtn.addEventListener('click', () => {
                    if (confirm('Tüm geçmiş çöp kutusuna taşınacak. Emin misiniz?')) {
                        this.clearAll();
                    }
                });
            }

            const emptyTrashBtn = document.getElementById('btn-history-empty-trash');
            if (emptyTrashBtn) {
                emptyTrashBtn.addEventListener('click', () => {
                    if (confirm('Çöp kutusu tamamen boşaltılacak ve geri alınamayacak. Emin misiniz?')) {
                        this.emptyTrash();
                    }
                });
            }

            
            
            const backBtn = document.getElementById('btn-history-back');
            if (backBtn) {
                backBtn.addEventListener('click', () => {
                    this.isTrashMode = false;
                    this.render();
                });
            }

            const trashBtn = document.getElementById('btn-history-trash');
            if (trashBtn) {
                trashBtn.addEventListener('click', () => {
                    this.isTrashMode = true;
                    this.isDeleteMode = false;
                    this.selectedIds.clear();
                    this.render();
                });
            }
        }
    };

    // --- Toast System ---
    window.showToast = function(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        // Icon based on type
        let icon = 'ℹ️';
        if (type === 'success') icon = '✅';
        if (type === 'error') icon = '❌';

        toast.textContent = `${icon} ${message}`;
        
        if (toastContainer) {
            toastContainer.appendChild(toast);
        } else {
            document.body.appendChild(toast);
        }

        // Trigger show animation
        requestAnimationFrame(() => toast.classList.add('show'));

        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }


    // --- Step Management ---
    function setActiveStep(stepNumber) {
        [step1, stepPage2, step2, step3].forEach((section) => {
            if (section) section.classList.remove('active', 'hidden');
        });

        if (stepNumber === 1 && step1) step1.classList.add('active');
        if (stepNumber === 1.5 && stepPage2) stepPage2.classList.add('active');
        if (stepNumber === 2 && step2) step2.classList.add('active');
        if (stepNumber === 3 && step3) step3.classList.add('active');

        [1, 2, 3].forEach(num => {
            const indicator = document.getElementById(`indicator-${num}`);
            if (indicator) {
                indicator.classList.remove('active', 'completed');
                if (num < Math.floor(stepNumber)) indicator.classList.add('completed');
                if (num === Math.floor(stepNumber)) indicator.classList.add('active');
            }
        });
    }

    
    // --- Dark Mode Logic ---
    const btnDarkMode = document.getElementById('btn-dark-mode');
    const isDark = localStorage.getItem('theme') === 'dark';
    
    if (isDark) {
        document.body.classList.add('dark-mode');
    }
    
    if (btnDarkMode) {
        btnDarkMode.addEventListener('click', () => {
            document.body.classList.toggle('dark-mode');
            if (document.body.classList.contains('dark-mode')) {
                localStorage.setItem('theme', 'dark');
            } else {
                localStorage.setItem('theme', 'light');
            }
        });
    }

    // --- Service Worker Registration ---
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js').then(reg => {
                console.log('Service Worker registered', reg);
            }).catch(err => {
                console.warn('Service Worker registration failed', err);
            });
        });
    }

    
    // --- Manual Entry Logic ---
    function clearFormExceptTeslimTarihi() {
        const savedTeslim = fields.teslimTarihi ? fields.teslimTarihi.value : '';
        
        Object.entries(fields).forEach(([key, field]) => {
            if (!field || key === 'teslimTarihi') return;
            if (field.tagName === 'SELECT') {
                field.selectedIndex = 0; 
            } else {
                field.value = '';
            }
            field.classList.remove('success', 'field-filled');
        });
        
        const otherInput = document.getElementById('field-uyrugu-other');
        if (otherInput) {
            otherInput.value = '';
            otherInput.style.display = 'none';
        }
        
        if (fields.teslimTarihi) fields.teslimTarihi.value = savedTeslim;
    }

    const btnManualEntry = document.getElementById('btn-manual-entry');
    if (btnManualEntry) {
        btnManualEntry.addEventListener('click', () => {
            clearFormExceptTeslimTarihi();
            restoreDraft();
            croppedImages = [];
            page1ImageObj = null;
            setActiveStep(3);
            showToast('Manuel giriş moduna geçildi.', 'info');
        });
    }

    const btnClearForm = document.getElementById('btn-clear-form');
    if (btnClearForm) {
        btnClearForm.addEventListener('click', () => {
            if (confirm('Teslim tarihi dışındaki tüm bilgileri silmek istediğinize emin misiniz?')) {
                clearFormExceptTeslimTarihi();
                showToast('Form temizlendi.', 'info');
            }
        });
    }

    // Initial setup
    setActiveStep(1);

    // Set default date for teslim tarihi
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const yyyy = today.getFullYear();
    if (fields.teslimTarihi) fields.teslimTarihi.value = `${dd}.${mm}.${yyyy}`;

    // --- Geçmiş paneli ilk render ---
    historyManager.render();
    
    // Toggle açılır/kapanır
    const historyToggle = document.getElementById('history-toggle');
    const historyBody = document.querySelector('.history-body');
    if (historyToggle && historyBody) {
        historyToggle.addEventListener('click', () => {
            const isOpen = historyBody.classList.toggle('open');
            historyToggle.querySelector('.history-toggle-icon').textContent = isOpen ? '▲' : '▼';
        });
    }

    // --- Tebligat Tarihi Hesaplama ---
    // Formül: Verilen tarihten sonraki haftanın Cuma günü
    // Örnek: Cuma verilirse → 7 gün sonraki Cuma, Pazartesi verilirse → o haftanın Cumasından sonraki Cuma
    function calculateTebligatDate(dateStr) {
        if (!dateStr) return '';
        // Normalize separators: replace /, -, and spaces with dots
        const normalizedDate = dateStr.replace(/[\/\-\s]/g, '.');
        const parts = normalizedDate.split('.');
        if (parts.length !== 3) return '';
        const d = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10) - 1; // JS ayları 0-indexed
        const y = parseInt(parts[2], 10);
        if (isNaN(d) || isNaN(m) || isNaN(y)) return '';
        
        const date = new Date(y, m, d);
        const dayOfWeek = date.getDay(); // 0=Pazar, 5=Cuma
        
        // Bu haftanın Cumasını bul, sonra +7 gün ekle
        let daysToThisFriday = (5 - dayOfWeek + 7) % 7; // 0 = zaten Cuma
        const daysToNextFriday = daysToThisFriday + 7; // Sonraki haftanın Cuması
        
        const tebligatDate = new Date(y, m, d + daysToNextFriday);
        const tdd = String(tebligatDate.getDate()).padStart(2, '0');
        const tmm = String(tebligatDate.getMonth() + 1).padStart(2, '0');
        const tyyyy = tebligatDate.getFullYear();
        
        // Gün adını Türkçe olarak al
        const gunAdlari = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
        const gunAdi = gunAdlari[tebligatDate.getDay()];
        
        return `${tdd}.${tmm}.${tyyyy} (${gunAdi})`;
    }

    // --- Image Upload & Camera ---
    
    // Trigger file input when clicking the zone (if no child clicked specifically)
    if (uploadZone) {
        uploadZone.addEventListener('click', (e) => {
            if (e.target !== cameraBtn) {
                useCameraForPage2 = false;
                fileInput.removeAttribute('capture');
                fileInput.click();
            }
        });

        // Drag and Drop
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
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                handleMultipleFilesSelection(e.dataTransfer.files);
            }
        });
    }

    if (cameraBtn) {
        cameraBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            useCameraForPage2 = true;
            fileInput.setAttribute('capture', 'environment');
            fileInput.click();
        });
    }

    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length > 0) {
                isProcessingPage2 = false;
                handleMultipleFilesSelection(e.target.files);
            }
            // Reset capture attribute for next time
            fileInput.removeAttribute('capture');
        });
    }

    function handleMultipleFilesSelection(fileList) {
        pendingFiles = Array.from(fileList);
        if (croppedImages.length === 0) {
            // First time selecting files
            if (pendingFiles.length > 0) {
                handleFile(pendingFiles.shift());
            }
        } else {
            // "Kırp ve 2. Sayfayı Çek" ile yeni dosya geldiyse
            if (pendingFiles.length > 0) {
                handleFile(pendingFiles.shift());
            }
        }
    }

    if (fileInputPage2) {
        fileInputPage2.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) {
                isProcessingPage2 = true;
                handleFile(e.target.files[0]);
            }
        });
    }


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
                croppedImages = [];
                croppedImages = [];
                processAndRunOCR(page1ImageObj);
                page1ImageObj = null;
            } else {
                setActiveStep(1);
            }
        });
    }

    const miniDropzone = document.getElementById('mini-dropzone');
    if (miniDropzone) {
        miniDropzone.addEventListener('click', () => {
            if (fileInputPage2) fileInputPage2.click();
        });
        
        miniDropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            miniDropzone.classList.add('dragover');
        });

        miniDropzone.addEventListener('dragleave', () => {
            miniDropzone.classList.remove('dragover');
        });

        miniDropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            miniDropzone.classList.remove('dragover');
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                isProcessingPage2 = true;
                handleFile(e.dataTransfer.files[0]);
            }
        });
    }

    // Paste for screenshots
    document.addEventListener('paste', (e) => {
        if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length > 0) {
            handleFile(e.clipboardData.files[0]);
        }
    });

    let cropperInstance = null;
    let baseRotation = 0;
    const cropperModal = document.getElementById('cropper-modal');
    const cropperImage = document.getElementById('cropper-image');
    let currentImageObj = null;

    function handleFile(file) {
        if (!file.type.startsWith('image/')) {
            showToast('Lütfen geçerli bir resim dosyası yükleyin.', 'error');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                if (previewImage && !isProcessingPage2) {
                    previewImage.src = img.src;
                    previewImage.style.display = 'block';
                }
                
                showCropperForFile(img);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }
    
    function showCropperForFile(img) {
        currentImageObj = img;
        if (cropperImage && cropperModal) {
            cropperImage.src = img.src;
            cropperModal.style.display = 'flex';
            
            // Döndürme ayarlarını sıfırla
            baseRotation = 0;
            const rotationSlider = document.getElementById('rotation-slider');
            if (rotationSlider) rotationSlider.value = 0;
            
            const btnConfirm = document.getElementById('btn-crop-confirm');
            const btnSkip = document.getElementById('btn-crop-skip');
            const btnNext = document.getElementById('btn-crop-next');
            const btnCaptureNext = document.getElementById('btn-crop-capture-next');
            const btnSkipCaptureNext = document.getElementById('btn-skip-capture-next');
            
            if (pendingFiles.length > 0) {
                if (btnConfirm) btnConfirm.style.display = 'none';
                if (btnSkip) btnSkip.style.display = 'none';
                if (btnCaptureNext) btnCaptureNext.style.display = 'none';
                if (btnSkipCaptureNext) btnSkipCaptureNext.style.display = 'none';
                if (btnNext) btnNext.style.display = 'block';
            } else if (croppedImages.length === 0 && !isProcessingPage2) {
                if (btnConfirm) btnConfirm.style.display = 'block';
                if (btnSkip) btnSkip.style.display = 'block';
                if (btnCaptureNext) btnCaptureNext.style.display = 'block';
                if (btnSkipCaptureNext) btnSkipCaptureNext.style.display = 'block';
                if (btnNext) btnNext.style.display = 'none';
            } else {
                if (btnConfirm) btnConfirm.style.display = 'block';
                if (btnSkip) btnSkip.style.display = 'block';
                if (btnCaptureNext) btnCaptureNext.style.display = 'none';
                if (btnSkipCaptureNext) btnSkipCaptureNext.style.display = 'none';
                if (btnNext) btnNext.style.display = 'none';
            }
            
            if (cropperInstance) {
                cropperInstance.destroy();
            }
            
            cropperInstance = new Cropper(cropperImage, {
                viewMode: 1,
                dragMode: 'move',
                autoCropArea: 0.9,
                restore: false,
                guides: true,
                center: true,
                highlight: false,
                cropBoxMovable: true,
                cropBoxResizable: true,
                toggleDragModeOnDblclick: false,
                checkOrientation: false,
            });
        } else {
            processNextStep(img);
        }
    }

    function processNextStep(img) {
        if (isProcessingPage2 && croppedImages.length === 0) {
            processAndRunOCR(img);
            return;
        }
        
        croppedImages.push(img);
        
        if (pendingFiles.length > 0) {
            handleFile(pendingFiles.shift());
        } else if (croppedImages.length === 2) {
            processMultipleImages(croppedImages[0], croppedImages[1]);
            croppedImages = [];
        } else if (croppedImages.length === 1) {
            processAndRunOCR(croppedImages[0]);
            croppedImages = [];
        }
    }

    function getCroppedImage(callback) {
        if (!cropperInstance) {
            callback(null);
            return;
        }
        
        // RAM çökmesini (OOM) önlemek için çözünürlüğü sınırla (Özellikle mobil kameralar için kritik)
        const croppedCanvas = cropperInstance.getCroppedCanvas({
            maxWidth: 1500,
            maxHeight: 1500
        });
        
        if (!croppedCanvas) {
            callback(null);
            return;
        }
        croppedCanvas.toBlob((blob) => {
            if (!blob) return callback(null);
            const croppedImg = new Image();
            const objectUrl = URL.createObjectURL(blob);
            croppedImg.onload = () => {
                callback(croppedImg);
                // ObjectURL temizlenecekse callback sonrasına bir revoke eklenebilir
                // ancak şu anki mimaride image objecti daha sonra da kullanılıyor, 
                // bu yüzden Base64 yerine blob referansı tutmak yine de RAM'i muazzam rahatlatır.
            };
            croppedImg.src = objectUrl;
        }, 'image/jpeg', 0.8);
    }

    function cleanupCropper() {
        if (cropperModal) cropperModal.style.display = 'none';
        if (cropperInstance) {
            cropperInstance.destroy();
            cropperInstance = null;
        }
    }

    // --- Döndürme (Rotation) Kontrolleri ---
    function updateCropperRotation() {
        if (!cropperInstance) return;
        const slider = document.getElementById('rotation-slider');
        const fineTune = parseFloat(slider ? slider.value : 0) || 0;
        cropperInstance.rotateTo(baseRotation + fineTune);
    }

    document.getElementById('btn-rotate-left')?.addEventListener('click', () => {
        if (!cropperInstance) return;
        baseRotation -= 90;
        updateCropperRotation();
    });

    document.getElementById('btn-rotate-right')?.addEventListener('click', () => {
        if (!cropperInstance) return;
        baseRotation += 90;
        updateCropperRotation();
    });

    document.getElementById('rotation-slider')?.addEventListener('input', () => {
        if (!cropperInstance) return;
        updateCropperRotation();
    });

    document.getElementById('btn-crop-cancel')?.addEventListener('click', () => {
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
    });

    document.getElementById('btn-crop-confirm')?.addEventListener('click', () => {
        getCroppedImage((img) => {
            cleanupCropper();
            if (img) {
                processNextStep(img);
            } else {
                if (currentImageObj) processNextStep(currentImageObj);
            }
        });
    });

    document.getElementById('btn-crop-next')?.addEventListener('click', () => {
        getCroppedImage((img) => {
            cleanupCropper();
            if (img) {
                processNextStep(img);
            } else {
                if (currentImageObj) processNextStep(currentImageObj);
            }
        });
    });

    document.getElementById('btn-skip-capture-next')?.addEventListener('click', () => {
        cleanupCropper();
        if (currentImageObj) {
            croppedImages.push(currentImageObj);
            page1ImageObj = currentImageObj;
            isSequentialCapture = true;
            isProcessingPage2 = true;
            setActiveStep(1.5);
        }
    });

    document.getElementById('btn-crop-capture-next')?.addEventListener('click', () => {
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
    });

    // --- Image Pre-processing ---
    function prepareImageForOCR(img) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        let width = img.width;
        let height = img.height;
        // 800px: yavaş ağlarda upload süresini kısaltır, OCR doğruluğunu korur
        const MAX_WIDTH = 800;
        
        if (width > MAX_WIDTH) {
            const ratio = MAX_WIDTH / width;
            width = MAX_WIDTH;
            height = height * ratio;
        }

        canvas.width = width;
        canvas.height = height;
        
        // Hız ve İsabet Optimizasyonu: JS döngüsü yerine yüksek kontrastlı donanım filtresi
        ctx.filter = 'grayscale(100%) contrast(160%) brightness(105%)';
        ctx.drawImage(img, 0, 0, width, height);
        
        // WebP 0.65: yavaş ağlarda veri miktarını azaltır, OCR için yeterli kalite
        return { dataUrl: canvas.toDataURL('image/webp', 0.65), canvas: canvas };
    }

    function processAndRunOCR(img) {
        setActiveStep(2);
        const prep = prepareImageForOCR(img);
        runOCR(prep.dataUrl, prep.canvas, false);
    }

    async function processMultipleImages(img1, img2) {
        setActiveStep(2);
        isSequentialCapture = false;
        
        if (progressText) progressText.innerText = 'Görseller hazırlanıyor...';
        // Arayüzün güncellenmesine izin ver
        await new Promise(resolve => setTimeout(resolve, 50));
        
        const prep1 = prepareImageForOCR(img1);
        const prep2 = prepareImageForOCR(img2);
        
        try {
            if (progressBar) progressBar.style.width = '10%';
            if (progressText) progressText.innerText = '1. ve 2. Sayfa eşzamanlı işleniyor...';
            
            // Hız optimizasyonu: İki sayfa sırayla değil, paralel (aynı anda) sunucuya gönderilir
            await Promise.all([
                runOCR(prep1.dataUrl, prep1.canvas, true, false), // Page 1
                runOCR(prep2.dataUrl, prep2.canvas, true, true)   // Page 2
            ]);
            
            isProcessingPage2 = false;
            
            if (progressText) progressText.innerText = 'İşlem tamamlandı!';
            showToast('Tüm sayfalar başarıyla okundu.', 'success');
            if (progressBar) progressBar.style.width = '100%';
            setActiveStep(3);
            
        } catch (error) {
            console.error("Multiple OCR Error:", error);
            isProcessingPage2 = false;
            activeAbortControllers.clear();
            
            // Kullanıcı iptal ettiyse farklı mesaj göster
            if (error.name === 'AbortError') {
                showToast('İşlem iptal edildi.', 'info');
            } else {
                let userMsg = error.message || 'OCR işlemi başarısız. Lütfen tekrar deneyin.';
                if (userMsg.includes('Load failed') || userMsg.includes('Failed to fetch')) {
                    userMsg = 'Sunucu bağlantısı koptu. İnternetinizi kontrol edin ve tekrar deneyin.';
                } else if (userMsg.length > 150) {
                    userMsg = userMsg.substring(0, 150) + '...';
                }
                showToast(userMsg, 'error');
            }
            setActiveStep(1);
        }
    }

    // --- OCR İptal Fonksiyonu ---
    function cancelOCR() {
        let aborted = false;
        if (activeAbortControllers.size > 0) {
            activeAbortControllers.forEach(ctrl => ctrl.abort());
            activeAbortControllers.clear();
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
    }

    // cancelOCR'u global scope'a taşı (logo onclick için)
    window.cancelOCR = cancelOCR;

    // İptal butonu event listener
    if (btnCancelOcr) {
        btnCancelOcr.addEventListener('click', cancelOCR);
    }

    // --- OCR Processing ---
    async function runOCR(imageDataUrl, sourceCanvas, skipStep3 = false, isPage2 = isProcessingPage2) {
        try {
            if (progressBar) progressBar.style.width = '0%';
            if (progressText) progressText.innerText = 'OCR başlatılıyor...';

            // Wait a moment for UI to update
            await new Promise(resolve => setTimeout(resolve, 100));

            // === VERCEL VEYA DOĞRUDAN GOOGLE VISION BAĞLANTISI ===
            try {
                const base64Data = imageDataUrl.split(',')[1];
                
                const controller = new AbortController();
                activeAbortControllers.add(controller);
                const timeoutId = setTimeout(() => controller.abort(), 60000);
                
                let fetchBody;

                // Google Vision isteği için ortak body
                const buildVisionBody = (key) => JSON.stringify({
                    requests: [{
                        image: { content: base64Data },
                        features: [{ type: 'DOCUMENT_TEXT_DETECTION', model: 'builtin/latest' }],
                        imageContext: { languageHints: ["tr", "en"] }
                    }]
                });

                let response;

                // Geçerli bir API anahtarı bul (boş olanları atla)
                while (currentApiKeyIndex < GOOGLE_VISION_API_KEYS.length && (!GOOGLE_VISION_API_KEYS[currentApiKeyIndex] || GOOGLE_VISION_API_KEYS[currentApiKeyIndex].trim() === '')) {
                    currentApiKeyIndex++;
                }

                if (currentApiKeyIndex < GOOGLE_VISION_API_KEYS.length) {
                    let apiSuccess = false;

                    while (currentApiKeyIndex < GOOGLE_VISION_API_KEYS.length && !apiSuccess) {
                        const CURRENT_KEY = GOOGLE_VISION_API_KEYS[currentApiKeyIndex];
                        if (!CURRENT_KEY || CURRENT_KEY.trim() === '') {
                            currentApiKeyIndex++;
                            continue;
                        }

                        if (progressText) progressText.innerText = `Yapay Zeka ile Analiz Ediliyor (API ${currentApiKeyIndex + 1})...`;

                        const euUrl = `https://eu-vision.googleapis.com/v1/images:annotate?key=${CURRENT_KEY}`;
                        const globalUrl = `https://vision.googleapis.com/v1/images:annotate?key=${CURRENT_KEY}`;

                        const tryFetch = async (url, signal) => fetch(url, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: buildVisionBody(),
                            signal
                        });

                        try {
                            const euController = new AbortController();
                            const euTimeout = setTimeout(() => euController.abort(), 20000);
                            const abortHandler = () => euController.abort();
                            controller.signal.addEventListener('abort', abortHandler);
                            
                            response = await tryFetch(euUrl, euController.signal);
                            
                            controller.signal.removeEventListener('abort', abortHandler);
                            clearTimeout(euTimeout);
                            if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
                        } catch (euErr) {
                            if (controller.signal.aborted) throw euErr;
                            if (progressText) progressText.innerText = 'Alternatif sunucuya bağlanılıyor...';
                            response = await tryFetch(globalUrl, controller.signal);
                        }

                        // Check for quota errors
                        if (!response.ok) {
                            if (response.status === 403 || response.status === 429) {
                                console.warn(`API Key ${currentApiKeyIndex + 1} kota veya yetki sınırına ulaştı, sonrakine geçiliyor...`);
                                currentApiKeyIndex++;
                                continue; // try next API key in the loop
                            }
                        }

                        apiSuccess = true;
                        break; // Successfully got a response (could be OK, or a non-quota error)
                    }

                    if (currentApiKeyIndex >= GOOGLE_VISION_API_KEYS.length && !apiSuccess) {
                        // Eğer tüm keyler bittiyse Vercel fallback'e düşsün
                        // Ama wait, we already set response, we just break.
                        // Actually, if we hit the end of the loop and haven't succeeded, it will just use the last response.
                    }
                }
                
                // Vercel Fallback
                if (currentApiKeyIndex >= GOOGLE_VISION_API_KEYS.length && (!response || !response.ok)) {
                    if (progressText) progressText.innerText = 'Sunucuya (Vercel) bağlanılıyor...';
                    response = await fetch('/api/ocr', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ imageContent: base64Data }),
                        signal: controller.signal
                    });
                }
                clearTimeout(timeoutId);
                activeAbortControllers.delete(controller);
                
                if (response.ok) {
                    const data = await response.json();
                    
                    if (data.responses && data.responses[0] && data.responses[0].textAnnotations) {
                        const annotations = data.responses[0].textAnnotations;
                        
                        // annotations[0] contains the full text
                        const serverText = annotations[0].description;
                        
                        // Map the rest of the annotations to serverWords
                        const serverWords = [];
                        for (let i = 1; i < annotations.length; i++) {
                            const word = annotations[i];
                            const vertices = word.boundingPoly.vertices;
                            // Google Vision returns x and y, which might be undefined if 0
                            const xs = vertices.map(v => v.x || 0);
                            const ys = vertices.map(v => v.y || 0);
                            
                            serverWords.push({
                                text: word.description,
                                bbox: {
                                    x0: Math.min(...xs),
                                    y0: Math.min(...ys),
                                    x1: Math.max(...xs),
                                    y1: Math.max(...ys)
                                },
                                confidence: 0.99
                            });
                        }
                        
                        if (progressBar) progressBar.style.width = '90%';
                        if (progressText) progressText.innerText = 'Veriler çözümleniyor...';
                        
                        const rawTextEl = document.getElementById('ocr-raw-text');
                        if (rawTextEl) rawTextEl.textContent = serverText;
                        
                        if (isPage2) {
                            console.log('[OCR] 2. Sayfa Koordinat bazlı extraction (Google Vision)...');
                            extractPage2FromCoordinates(serverWords);
                            
                            if (!skipStep3) {
                                if (progressText) progressText.innerText = 'İşlem tamamlandı!';
                                showToast('2. Sayfa bilgileri çıkarıldı.', 'success');
                                setActiveStep(3);
                                isProcessingPage2 = false;
                            }
                            return true;
                        }
                        
                        let serverExtracted = {
                            basvuruNo: '', pasaportNo: '', adi: '', soyadi: '', uyrugu: '', dogumTarihi: ''
                        };
                        
                        // Önce en güvenilir olan koordinat bazlı aramayı yap (Google Vision API)
                        extractFromCoordinates(serverWords, serverExtracted);
                        
                        // Bulunamayan alanlar (veya barkod) için regex tabanlı fallback'i kullan
                        const fallbackExtracted = extractFields(serverText);
                        Object.keys(serverExtracted).forEach(key => {
                            if (!serverExtracted[key] && fallbackExtracted[key]) {
                                serverExtracted[key] = fallbackExtracted[key];
                            }
                        });
                        populateForm(serverExtracted);
                        if (!skipStep3) {
                            if (progressText) progressText.innerText = 'İşlem tamamlandı!';
                            showToast('OCR işlemi başarıyla tamamlandı.', 'success');
                            setActiveStep(3);
                        }
                        return true;
                    } else {
                        throw new Error('Resimde metin bulunamadı veya geçersiz format.');
                    }
                } else {
                    let errMsg = response.statusText;
                    try {
                        const errData = await response.json();
                        if (errData.error && errData.error.message) errMsg = errData.error.message;
                    } catch (e) {}
                    
                    if (response.status === 400 || response.status === 403) {
                        if (errMsg.toLowerCase().includes('billing')) {
                            errMsg += " (Sunucudaki Google Cloud hesabında fatura sorunu var.)";
                        } else {
                            errMsg += " (Sunucu API anahtarı geçersiz veya yetkisiz.)";
                        }
                    } else if (response.status === 500) {
                        errMsg += " (Sunucuda API Anahtarı eksik veya yapılandırılmamış olabilir.)";
                    }
                    throw new Error(`HTTP ${response.status}: ${errMsg}`);
                }
            } catch (err) {
                console.error('Google Vision API Hatası:', err);
                throw err;
            }

        } catch (error) {
            if (error.name === 'AbortError' || error.message === 'Aborted') {
                console.log('OCR isteği iptal edildi.');
                return false;
            }
            console.error("OCR Error:", error);
            
            let userMsg = error.message ? error.message : 'OCR işlemi başarısız. Lütfen daha net bir fotoğraf yükleyin.';
            if (userMsg.includes('Load failed') || userMsg.includes('Failed to fetch')) {
                userMsg = 'Sunucu bağlantısı koptu. İnternetinizi kontrol edin veya fotoğrafı biraz daha kırparak yüklemeyi deneyin.';
            } else if (userMsg.length > 150) {
                userMsg = userMsg.substring(0, 150) + '...';
            }
            
            if (!skipStep3) {
                showToast(userMsg, 'error');
                setActiveStep(1);
            }
            isProcessingPage2 = false;
            isSequentialCapture = false;
            croppedImages = [];
            page1ImageObj = null;
            pendingFiles = [];
            throw error;
        }
    }

    // --- Field Extraction ---
    // === 2. SAYFA KOORDİNAT BAZLI EXTRACTION ===
    // === KOORDİNAT BAZLI EXTRACTION (1. Sayfa Tablo hücreleri için) ===

    // --- Populate Form ---
    function populateForm(data) {
        // Only auto-fill fields that exist on the Göç İdaresi form
        const mapping = {
            basvuruNo: data.basvuruNo,
            pasaportNo: data.pasaportNo,
            adi: data.adi,
            soyadi: data.soyadi,
            uyrugu: data.uyrugu,
            dogumTarihi: data.dogumTarihi
        };
        // yabanciKimlik is NOT extracted from OCR — it remains empty for manual entry
        // adres, tel, mail are extracted from Page 2 via extractPage2FromCoordinates

        for (const [key, value] of Object.entries(mapping)) {
            const field = fields[key];
            if (field && value) {
                if (field.tagName === 'SELECT') {
                    // Select elemanı ise, değerin seçenekler arasında olup olmadığını kontrol et
                    const optionExists = Array.from(field.options).some(opt => opt.value === value);
                    if (optionExists) {
                        field.value = value;
                        field.classList.add('success');
                        if (key === 'uyrugu') {
                            const otherInput = document.getElementById('field-uyrugu-other');
                            if (otherInput) otherInput.style.display = 'none';
                        }
                    } else if (key === 'uyrugu') {
                        field.value = 'OTHER';
                        field.classList.add('success');
                        const otherInput = document.getElementById('field-uyrugu-other');
                        if (otherInput) {
                            otherInput.style.display = 'block';
                            otherInput.value = value;
                            otherInput.classList.add('success');
                        }
                    }
                } else {
                    field.value = value;
                    field.classList.add('success');
                }
            }
        }
    }

    // --- Event Listeners ---
    if (btnRescan) {
        btnRescan.addEventListener('click', () => {
            if (fileInput) fileInput.value = '';
            setActiveStep(1);
        });
    }

    if (fields.uyrugu) {
        fields.uyrugu.addEventListener('change', (e) => {
            const otherInput = document.getElementById('field-uyrugu-other');
            if (e.target.value === 'OTHER') {
                otherInput.style.display = 'block';
            } else {
                otherInput.style.display = 'none';
            }
        });
    }

    if (btnCopyOcr) {
        btnCopyOcr.addEventListener('click', () => {
            const rawText = document.getElementById('ocr-raw-text').innerText;
            if (rawText) {
                navigator.clipboard.writeText(rawText).then(() => {
                    showToast('OCR metni kopyalandı!', 'success');
                }).catch(err => {
                    console.error('Kopyalama hatası:', err);
                    showToast('Kopyalama başarısız oldu.', 'error');
                });
            } else {
                showToast('Kopyalanacak metin yok.', 'warning');
            }
        });
    }

    if (btnClear) {
        btnClear.addEventListener('click', () => {
            localStorage.removeItem('ikamet_draft');
            Object.values(fields).forEach(field => {
                if (field && field.id !== 'field-teslim-tarihi') {
                    field.value = '';
                    field.classList.remove('field-filled');
                }
            });
        });
    }

    // Word Document Generation
    let generatedPdf = null;

    // --- Lazy Load PDF Libraries ---
    let pdfLibsLoaded = false;
    let isPdfLoading = false;
    async function loadPdfLibraries() {
        if (pdfLibsLoaded) return true;
        if (isPdfLoading) {
            // Wait for it to finish if it's currently loading
            while(isPdfLoading) {
                await new Promise(r => setTimeout(r, 100));
            }
            return pdfLibsLoaded;
        }
        
        isPdfLoading = true;
        
        try {
            await Promise.all([
                new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
                    script.onload = resolve;
                    script.onerror = reject;
                    document.head.appendChild(script);
                }),
                new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
                    script.onload = resolve;
                    script.onerror = reject;
                    document.head.appendChild(script);
                })
            ]);
            pdfLibsLoaded = true;
            return true;
        } catch (e) {
            showToast('PDF kütüphaneleri yüklenemedi. İnternet bağlantınızı kontrol edin.', 'error');
            return false;
        } finally {
            isPdfLoading = false;
        }
    }

    let generatedPdfName = "";

    if (btnDownload) {
        btnDownload.addEventListener('click', async () => {
            if (generatedPdf) {
                const pdfBlob = generatedPdf.output('blob');
                
                // Geçmişe kaydet - Sadece kullanıcı gerçekten indirmeye çalıştığında
                historyManager.save('pdf');

                generatedPdf.save(generatedPdfName);
                showToast('PDF indiriliyor...', 'success');
                
                // Reset button after download
                generatedPdf = null;
                btnDownload.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" class="btn-icon"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> PDF İndir`;
                btnDownload.style.backgroundColor = '';
                btnDownload.classList.remove('pdf-ready');
                return;
            }

            const loaded = await loadPdfLibraries();
            if (!loaded) return;

            btnDownload.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" class="btn-icon"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg> Hazırlanıyor...`;
            showToast('PDF hazırlanıyor, lütfen bekleyin...', 'info');

            // Form değerlerini topla (print handler ile aynı mantık)
            const vBasvuruNo = fields.basvuruNo.value.trim() || ' ';
            const vTeslim = fields.teslimTarihi.value.trim() || ' ';
            const vYabanciKimlik = ' ';
            const vPasaportNo = fields.pasaportNo.value.trim() || ' ';
            const vAdi = fields.adi.value.trim() || ' ';
            const vSoyadi = fields.soyadi.value.trim() || ' ';
            let vUyrugu = fields.uyrugu.value;
            if (vUyrugu === 'OTHER') {
                const otherInput = document.getElementById('field-uyrugu-other');
                if (otherInput && otherInput.value.trim()) vUyrugu = otherInput.value.trim();
            }
            vUyrugu = vUyrugu.trim() || ' ';
            const vDogum = fields.dogumTarihi.value ? fields.dogumTarihi.value.trim() : ' ';
            const vAdres = fields.adres.value.trim() || ' ';
            const vTel = fields.tel.value.trim() || ' ';
            const vMail = fields.mail.value.trim() || ' ';
            const currentYear = new Date().getFullYear();
            const vTebligatTarihi = calculateTebligatDate(vTeslim);

            // Aynı yazdırma şablonunu gizli div'e render et
            const container = document.createElement('div');
            container.style.cssText = 'position:fixed;left:-9999px;top:0;width:794px;background:white;z-index:-1;';
            container.innerHTML = getDocumentHtml(vBasvuruNo, vTeslim, vYabanciKimlik, vPasaportNo, vAdi, vSoyadi, vUyrugu, vDogum, vAdres, vTel, vMail, currentYear, vTebligatTarihi, false);
            document.body.appendChild(container);

            try {
                const canvas = await html2canvas(container.lastElementChild, {
                    scale: 2,
                    useCORS: true,
                    backgroundColor: '#ffffff',
                    logging: false
                });
                document.body.removeChild(container);

                const { jsPDF } = window.jspdf;
                const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
                const imgData = canvas.toDataURL('image/jpeg', 0.95);
                const pdfW = pdf.internal.pageSize.getWidth();
                const pdfH = pdf.internal.pageSize.getHeight();
                pdf.addImage(imgData, 'JPEG', 0, 0, pdfW, pdfH);

                const fName = vAdi.trim() ? vAdi.trim() : 'Ad';
                const fSurname = vSoyadi.trim() ? vSoyadi.trim() : 'Soyad';
                
                generatedPdf = pdf;
                generatedPdfName = `ONBILGI_${fSurname}_${fName}.pdf`;
                
                // Update button
                btnDownload.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" class="btn-icon"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> PDF Hazır - Tıkla İndir`;
                btnDownload.style.backgroundColor = 'var(--success)';
                btnDownload.classList.add('pdf-ready');
                
                showToast('PDF oluşturuldu! İndirmek için butona tekrar tıklayın.', 'success');
            } catch (err) {
                if (document.body.contains(container)) document.body.removeChild(container);
                console.error('PDF hatası:', err);
                showToast('PDF oluşturulurken hata: ' + err.message, 'error');
                btnDownload.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" class="btn-icon"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> PDF İndir`;
            }
        });
    }
    if (btnPrint) {
        btnPrint.addEventListener('click', () => {
            // Get current values
            const vBasvuruNo = fields.basvuruNo.value.trim() || ' ';
            const vTeslim = fields.teslimTarihi.value.trim() || ' ';
            const vYabanciKimlik = ' '; // Not available in fields
            const vPasaportNo = fields.pasaportNo.value.trim() || ' ';
            const vAdi = fields.adi.value.trim() || ' ';
            const vSoyadi = fields.soyadi.value.trim() || ' ';
            
            // Handle Uyruğu which is a select with an 'other' option
            let vUyrugu = fields.uyrugu.value;
            if (vUyrugu === 'OTHER') {
                const otherInput = document.getElementById('field-uyrugu-other');
                if (otherInput && otherInput.value.trim()) {
                    vUyrugu = otherInput.value.trim();
                }
            }
            vUyrugu = vUyrugu.trim() || ' ';
            
            // Format dates
            const vDogum = fields.dogumTarihi.value ? fields.dogumTarihi.value.trim() : ' ';
            const vAdres = fields.adres.value.trim() || ' ';
            const vTel = fields.tel.value.trim() || ' ';
            const vMail = fields.mail.value.trim() || ' ';

            // Gelecek seneler için dinamik yıl oluştur
            const currentYear = new Date().getFullYear();
            const vTebligatTarihi = calculateTebligatDate(vTeslim);

            
            showToast('Yazdırma ekranı hazırlanıyor...', 'info');
            
            // Use html2canvas so print perfectly matches the PDF
            loadPdfLibraries().then(async (loaded) => {
                if (!loaded) {
                    showToast('Yazdırma modülü yüklenemedi.', 'error');
                    return;
                }
                
                const container = document.createElement('div');
                container.style.cssText = 'position:fixed;left:-9999px;top:0;width:794px;background:white;z-index:-1;';
                container.innerHTML = getDocumentHtml(vBasvuruNo, vTeslim, vYabanciKimlik, vPasaportNo, vAdi, vSoyadi, vUyrugu, vDogum, vAdres, vTel, vMail, currentYear, vTebligatTarihi, false);
                document.body.appendChild(container);
                
                try {
                    const canvas = await html2canvas(container.lastElementChild, {
                        scale: 2,
                        useCORS: true,
                        backgroundColor: '#ffffff',
                        logging: false
                    });
                    document.body.removeChild(container);
                    
                    const imgData = canvas.toDataURL('image/jpeg', 0.95);
                    
                    let printArea = document.getElementById('print-area');
                    if (!printArea) {
                        printArea = document.createElement('div');
                        printArea.id = 'print-area';
                        document.body.appendChild(printArea);
                    }
                    
                    // Put the generated image inside print area, stretched to A4 size perfectly
                    printArea.innerHTML = `<img src="${imgData}" style="width: 210mm; height: 297mm; display: block; margin: 0 auto; object-fit: fill;">`;
                    
                    // Geçmişe kaydet
                    historyManager.save('print');
                    
                    setTimeout(() => {
                        window.print();
                    }, 500);
                } catch (err) {
                    console.error(err);
                    showToast('Yazdırma sırasında bir hata oluştu.', 'error');
                    if(document.body.contains(container)) document.body.removeChild(container);
                }
            });

        });
    }
});


// --- OFFLINE AND SHORTCUT HANDLERS ---
function updateOnlineStatus() {
    const btnUpload = document.getElementById('btn-upload');
    if (!navigator.onLine) {
        if(btnUpload) {
            btnUpload.disabled = true;
            btnUpload.style.opacity = '0.5';
            btnUpload.title = "İnternet bağlantısı koptu. Tarama yapılamaz.";
            btnUpload.style.pointerEvents = 'none';
        }
        showToast('İnternet yok. Tarama yapılamaz, manuel giriş yapabilirsiniz.', 'warning');
    } else {
        if(btnUpload) {
            btnUpload.disabled = false;
            btnUpload.style.opacity = '1';
            btnUpload.title = "";
            btnUpload.style.pointerEvents = 'auto';
        }
    }
}
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
window.addEventListener('DOMContentLoaded', updateOnlineStatus);

// Intercept Ctrl+P / Cmd+P
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        const step3 = document.getElementById('step-3');
        if (step3 && step3.classList.contains('active')) {
            const btnPrint = document.getElementById('btn-print');
            if (btnPrint) btnPrint.click();
        } else {
            showToast('Yazdırmak için önce bir form hazırlamalısınız.', 'info');
        }
    }
});

// Draft Auto-Save (Fixed Scope)
function getDraftFields() {
    return {
        basvuruNo: document.getElementById('field-basvuru-no'),
        teslimTarihi: document.getElementById('field-teslim-tarihi'),
        pasaportNo: document.getElementById('field-pasaport-no'),
        adi: document.getElementById('field-adi'),
        soyadi: document.getElementById('field-soyadi'),
        uyrugu: document.getElementById('field-uyrugu'),
        dogumTarihi: document.getElementById('field-dogum-tarihi'),
        adres: document.getElementById('field-adres'),
        tel: document.getElementById('field-tel'),
        mail: document.getElementById('field-mail')
    };
}

function saveDraft() {
    const draft = {};
    const formFields = getDraftFields();
    Object.keys(formFields).forEach(id => {
        if (formFields[id]) draft[id] = formFields[id].value;
    });
    localStorage.setItem('ikamet_draft', JSON.stringify(draft));
}

function restoreDraft() {
    const draftStr = localStorage.getItem('ikamet_draft');
    if (draftStr) {
        try {
            const draft = JSON.parse(draftStr);
            let hasData = false;
            Object.keys(draft).forEach(k => {
                if (draft[k] && draft[k].trim() !== '') hasData = true;
            });
            
            if (hasData) {
                if (confirm('Yarım kalan bir form taslağınız bulundu. Kaldığınız yerden devam etmek ister misiniz?')) {
                    const formFields = getDraftFields();
                    Object.keys(draft).forEach(k => {
                        if (formFields[k] && draft[k]) {
                            formFields[k].value = draft[k];
                        }
                    });
                    showToast('Taslak yüklendi.', 'info');
                } else {
                    localStorage.removeItem('ikamet_draft');
                }
            }
        } catch(e) {}
    }
}

// Bind save draft to inputs
document.addEventListener('DOMContentLoaded', () => {
    const formFields = getDraftFields();
    Object.keys(formFields).forEach(id => {
        if (formFields[id]) {
            formFields[id].addEventListener('input', saveDraft);
            formFields[id].addEventListener('change', saveDraft);
        }
    });
});
