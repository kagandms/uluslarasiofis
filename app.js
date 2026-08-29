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
    let activeAbortController = null; // İptal butonu için aktif OCR isteğini takip eder

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
                } else if (this.isDeleteMode) {
                    html += `<button class="history-btn-secondary" id="btn-history-cancel">İptal</button>`;
                    html += `<button class="history-btn-danger" id="btn-history-delete-selected" ${this.selectedIds.size === 0 ? 'disabled' : ''}>🗑️ Seçilenleri Sil (${this.selectedIds.size})</button>`;
                } else {
                    html += `<button class="history-btn-secondary" id="btn-history-delete-mode">Kayıt Seçerek Sil</button>`;
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

            const deleteModeBtn = document.getElementById('btn-history-delete-mode');
            if (deleteModeBtn) {
                deleteModeBtn.addEventListener('click', () => {
                    this.isDeleteMode = true;
                    this.selectedIds.clear();
                    this.render();
                });
            }

            const cancelBtn = document.getElementById('btn-history-cancel');
            if (cancelBtn) {
                cancelBtn.addEventListener('click', () => {
                    this.isDeleteMode = false;
                    this.selectedIds.clear();
                    this.render();
                });
            }

            const deleteSelectedBtn = document.getElementById('btn-history-delete-selected');
            if (deleteSelectedBtn) {
                deleteSelectedBtn.addEventListener('click', () => {
                    this.deleteSelected();
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
    function showToast(message, type = 'info') {
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
            restoreDraft();
            clearFormExceptTeslimTarihi();
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
        // dateStr format: dd.mm.yyyy
        const parts = dateStr.split('.');
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
        const croppedImg = new Image();
        croppedImg.onload = () => {
            callback(croppedImg);
        };
        croppedImg.src = croppedCanvas.toDataURL('image/jpeg', 0.8);
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
            activeAbortController = null;
            
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
                activeAbortController = controller;
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
                            const clone = response.clone();
                            try {
                                const errorData = await clone.json();
                                if (response.status === 403 || response.status === 429) {
                                    const errorMsg = errorData.error?.message?.toLowerCase() || '';
                                    if (errorMsg.includes('quota') || errorMsg.includes('billing') || errorMsg.includes('rate limit')) {
                                        console.warn(`API Key ${currentApiKeyIndex + 1} kota sınırına ulaştı, sonrakine geçiliyor...`);
                                        currentApiKeyIndex++;
                                        continue; // try next API key in the loop
                                    }
                                }
                            } catch (e) {
                                // ignore JSON parse errors on error response
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
            throw error;
        }
    }

    // --- Field Extraction ---
    // === 2. SAYFA KOORDİNAT BAZLI EXTRACTION ===
    function extractPage2FromCoordinates(words) {
        // Eski bilgilerin kalmaması için önce alanları temizle
        const adresField = document.getElementById('field-adres');
        const telField = document.getElementById('field-tel');
        const mailField = document.getElementById('field-mail');
        if (adresField) {
            adresField.value = '';
            adresField.classList.remove('field-filled');
        }
        if (telField) {
            telField.value = '';
            telField.classList.remove('field-filled');
        }
        if (mailField) {
            mailField.value = '';
            mailField.classList.remove('field-filled');
        }

        if (!words || words.length === 0) return;
        
        const sameRow = (w1, w2) => {
            const h1 = w1.bbox.y1 - w1.bbox.y0;
            const h2 = w2.bbox.y1 - w2.bbox.y0;
            const tolerance = Math.max(h1, h2) * 0.6;
            const center1 = (w1.bbox.y0 + w1.bbox.y1) / 2;
            const center2 = (w2.bbox.y0 + w2.bbox.y1) / 2;
            return Math.abs(center1 - center2) < tolerance;
        };

        // Adım 1: Sınırları belirle (Min Y ve Max Y)
        let minY = 0;
        let maxY = 999999;
        
        for (const w of words) {
            // "KALACAĞI" kelimesi hedef bölümün başlığındadır
            if (/KALACA[GĞ]I/i.test(w.text) && w.bbox.y0 > minY) {
                minY = w.bbox.y1;
                console.log('[Page2] Min Y sınırı bulundu (KALACAĞI):', minY);
            }
            // "ÖĞRENİM" kelimesi sonraki bölümün başlığındadır
            else if (/[OÖ][GĞ]REN[Iİ]M/i.test(w.text) && w.bbox.y0 > minY) {
                maxY = w.bbox.y0;
                console.log('[Page2] Max Y sınırı bulundu (ÖĞRENİM):', maxY);
                break;
            }
        }

        console.log(`[Page2] Arama bölgesi: Y:${minY} - Y:${maxY}`);

        // Bu bölgedeki kelimeler
        const sectionWords = words.filter(w => w.bbox.y0 >= minY && w.bbox.y1 <= maxY);
        const imageWidth = Math.max(...words.map(w => w.bbox.x1), 1);
        const midpoint = imageWidth * 0.50;
        
        let foundAdres = '';
        let foundTel = '';

        // --- ADRES (Çoklu satır desteği) ---
        let adresLabelY = -1;
        let nextLabelY = maxY; // default to end of section
        let rightColumnX = midpoint; // Sağ sütun X sınırı (Telefon vs. adresin içine girmesin diye)
        
        for (const w of sectionWords) {
            if (/^Adres|Address$/i.test(w.text)) {
                if (adresLabelY === -1 || w.bbox.y0 < adresLabelY) {
                    adresLabelY = w.bbox.y0;
                }
            } else if (adresLabelY !== -1 && /^Ta[sŞş][iıI]nma|Moving$/i.test(w.text) && w.bbox.y0 > adresLabelY) {
                if (w.bbox.y0 < nextLabelY) nextLabelY = w.bbox.y0;
            }
            
            // Eğer "Telefon" veya "Phone" kelimesi varsa, Adres bölgesinin sağ sınırını buna göre daralt
            if (/^(?:Telefon|Phone|Tel|E\s*Posta|E-mail)$/i.test(w.text)) {
                if (w.bbox.x0 < rightColumnX) rightColumnX = w.bbox.x0;
            }
        }

        if (adresLabelY !== -1) {
            const adresWords = sectionWords.filter(w => 
                w.bbox.y0 >= adresLabelY - 5 && 
                w.bbox.y1 <= nextLabelY + 5 &&
                w.bbox.x0 < rightColumnX - 5 && // Sağ sütundaki Telefon/Phone etiketleri elenir
                w.bbox.x0 > imageWidth * 0.22 // Sadece değer sütununu al (sol sütundaki etiket artıkları "Ba" vs elenir)
            ).sort((a, b) => {
                if (Math.abs(a.bbox.y0 - b.bbox.y0) > 15) return a.bbox.y0 - b.bbox.y0;
                return a.bbox.x0 - b.bbox.x0;
            });
            
            if (adresWords.length > 0) {
                foundAdres = adresWords.map(aw => aw.text).join(' ').trim();
                // Adresin başındaki "Ba", "İSTANBUL", "," gibi OCR kalıntılarını agresif temizle
                let cleanAdres = foundAdres.replace(/^(?:Ba\s*)?(?:[Iİ]STANBUL\s*)?[\s,]*/i, '').trim();
                // En başa her zaman sabit "İSTANBUL, " ekle
                foundAdres = "İSTANBUL, " + cleanAdres;
                console.log('[Page2] Adres bulundu:', foundAdres);
            }
        }

        // --- TELEFON 1 ---
        // Telefon hücrelerinde Y hizası ("Telefon 1" vs "Phone 1") OCR'ı yanıltabilir. 
        // Bu yüzden bölümün sağ tarafındaki (midpoint'ten büyük) 10 haneli tek numarayı arıyoruz.
        for (const w of sectionWords) {
            if (w.bbox.x0 > midpoint) {
                const digits = w.text.replace(/\D/g, '');
                if (digits.length >= 10) {
                    const last10 = digits.slice(-10);
                    // Başka alan (örn: T.C. kimlik) araya karışmasın diye 5 ile başlıyorsa al (veya standart 10 hane)
                    if (last10.startsWith('5')) {
                        foundTel = `0${last10.slice(0,3)} ${last10.slice(3,6)} ${last10.slice(6,8)} ${last10.slice(8,10)}`;
                        console.log('[Page2] Telefon bulundu (sağ sütun rakam taraması):', foundTel);
                        break;
                    }
                }
            }
        }

        if (foundAdres) {
            const adresField = document.getElementById('field-adres');
            if (adresField) {
                adresField.value = foundAdres.substring(0, 100);
                adresField.classList.add('field-filled');
            }
        }

        if (foundTel) {
            const telField = document.getElementById('field-tel');
            if (telField) {
                telField.value = foundTel;
                telField.classList.add('field-filled');
            }
        }

        // --- E-POSTA ---
        // "E Posta" / "E-mail" / "E-Mail" etiketini bul, ardından aynı satırda veya hemen altında @ içeren metni al
        let foundMail = '';
        let epostaLabelY = -1;
        let epostaLabelX = -1;

        for (let i = 0; i < sectionWords.length; i++) {
            const w = sectionWords[i];
            // "E Posta", "E-Posta", "E-mail", "E-Mail", "Email" etiketlerini tanı
            const isEpostaLabel = /^E[-\s]?Posta$/i.test(w.text) || /^E[-\s]?mail$/i.test(w.text);
            // OCR bazen "E" ve "Posta"yı ayrı kelimeler olarak verir
            const isESplit = /^E$/i.test(w.text) && i + 1 < sectionWords.length && 
                /^Posta$/i.test(sectionWords[i + 1].text) && sameRow(w, sectionWords[i + 1]);
            
            if (isEpostaLabel || isESplit) {
                if (w.bbox.x0 > midpoint * 0.7) { // Sağ taraftaki etiketi al
                    epostaLabelY = w.bbox.y0;
                    epostaLabelX = w.bbox.x0;
                    console.log('[Page2] E-Posta etiketi bulundu:', w.text, 'Y:', epostaLabelY);
                }
            }
        }

        if (epostaLabelY !== -1) {
            // Etiketin yüksekliğinin ~3 katı kadar aşağıya bak
            const searchRangeY = epostaLabelY + 80;
            
            // Önce tüm bölgede @ içeren kelimeleri ara
            const mailCandidates = sectionWords.filter(w =>
                w.text.includes('@') &&
                w.bbox.y0 >= epostaLabelY - 15 &&
                w.bbox.y0 <= searchRangeY
            );

            if (mailCandidates.length > 0) {
                // @ içeren kelimeyi bulduk — bu direkt e-posta adresi olabilir
                foundMail = mailCandidates[0].text.trim();
                console.log('[Page2] E-Posta bulundu (@ içeren kelime):', foundMail);
            } else {
                // OCR bazen e-posta adresini parçalara ayırır (ör: "GURBANNAZAR" "@en-gmail-bgd" ".com")
                // Etiketin sağındaki ve altındaki kelimeleri birleştir
                const nearbyWords = sectionWords.filter(w =>
                    w.bbox.y0 >= epostaLabelY - 10 &&
                    w.bbox.y0 <= searchRangeY &&
                    w.bbox.x0 >= epostaLabelX - 20
                ).sort((a, b) => {
                    if (Math.abs(a.bbox.y0 - b.bbox.y0) > 15) return a.bbox.y0 - b.bbox.y0;
                    return a.bbox.x0 - b.bbox.x0;
                });

                // Etiket kelimelerini atla, geri kalanları birleştir
                const valueParts = nearbyWords
                    .filter(w => !/^(?:E[-\s]?Posta|E[-\s]?mail|E[-\s]?Mail|Phone|Telefon)$/i.test(w.text))
                    .map(w => w.text);

                const combined = valueParts.join('');
                if (combined.includes('@')) {
                    foundMail = combined.trim();
                    console.log('[Page2] E-Posta bulundu (birleştirilmiş):', foundMail);
                }
            }
        }

        // Eğer etiket bulunamazsa, fallback: tüm bölgede @ içeren kelime ara
        if (!foundMail) {
            for (const w of sectionWords) {
                if (w.text.includes('@') && w.text.includes('.')) {
                    foundMail = w.text.trim();
                    console.log('[Page2] E-Posta bulundu (fallback @ taraması):', foundMail);
                    break;
                }
            }
        }

        // E-posta temizliği: gereksiz boşlukları kaldır, küçük harfe dönüştür
        if (foundMail) {
            foundMail = foundMail.replace(/\s+/g, '').toLowerCase();
            // Basit doğrulama: @ ve . içermeli
            if (foundMail.includes('@') && foundMail.includes('.')) {
                const mailField = document.getElementById('field-mail');
                if (mailField) {
                    mailField.value = foundMail;
                    mailField.classList.add('field-filled');
                    console.log('[Page2] E-Posta form alanına yazıldı:', foundMail);
                }
            }
        }
    }

    // === KOORDİNAT BAZLI EXTRACTION (1. Sayfa Tablo hücreleri için) ===
    function extractFromCoordinates(words, extracted) {
        if (!words || words.length === 0) return;
        
        // Yardımcı: iki kelime aynı hücrede/satırda mı?
        const sameRow = (label, word) => {
            const labelH = label.bbox.y1 - label.bbox.y0;
            const wordCenter = (word.bbox.y0 + word.bbox.y1) / 2;
            
            // İngilizce etiketler hücrenin altında, Türkçe etiketler üstündedir.
            // Değerler ise genellikle bu ikisinin ortasındadır.
            // Bu yüzden Y toleransını etiketin diline göre asimetrik veriyoruz.
            const isEnglishLabel = /^(surname|name|nationality|number|appointment|registration)$/i.test(label.text);
            
            let cellY0 = label.bbox.y0 - labelH * 3.0;
            let cellY1 = label.bbox.y1 + labelH * 3.0;
            
            return wordCenter >= cellY0 && wordCenter <= cellY1;
        };
        
        // Form etiketleri — bunları değer olarak almayacağız (OCR hataları dahil)
        // Form etiketlerini OCR hatalarıyla birlikte tanıma listesi
        const coordFormLabels = /^(di[gğ]er|other|citizenship|uyr[uü][gğ]?[uü]?[a-z]*|nationality|nationali|nationally|nation|[dt][oö][gğ][uü]m[a-z]*|born|bom|birth|[öo]nceki|previous|surname|surmame|surnane|sumame|name|nane|mame|father|mother|baba|anne|cinsiyet[iİ]?|sex|gender|medeni|marital|uets|yeri|[üu]lkesi|country|kimlik|id|no|foreigner|place|foreign|date|tarihi|hali|status|biyo(?:metrik)?|number|document|belge(?:si)?|kay[ıi]t|registration|[iİ]kamet|ba[sş]vuru|randevu|talep|seyahat|travel|[iİıI]nformation|type|t[üu]r[üu]|foto[gğ]raf|numara|soyad[ıi]?|ad[ıi]?|ki[sş]i|personal|bilgi|in|of|for|the|that|veren|makam[ıi]?|issuing|authority|adres[iİ]?|address)$/i;
        
        // Resmin tahmini genişliği (words'den hesapla)
        const imageWidth = Math.max(...words.map(w => w.bbox.x1), 1);
        // Sol sütun değerleri kabaca ilk %50'de olur
        const midpoint = imageWidth * 0.50;
        
        // OCR hatalarına karşı daha esnek kontrol (grabName mantığı ile aynı)
        const cleanAndFixWord = (text) => {
            const cleanedWord = text.replace(/[^A-ZÇĞİÖŞÜa-zçğıöşü'\-]/g, '');
            if (cleanedWord.length < 2) return null;
            return text.toLocaleUpperCase('tr-TR')
                .replace(/[0]/g, 'O').replace(/[1]/g, 'I').replace(/[3]/g, 'E')
                .replace(/[4]/g, 'A').replace(/[5]/g, 'S').replace(/[8]/g, 'B')
                .replace(/[^A-ZÇĞİÖŞÜ'\-]/g, '');
        };

        // Bilinen ülke adları — ad/soyad alanına bulaşmasını önlemek için
        const knownCountryNames = /^(T[ÜU]RKMEN[İI]STAN|[ÖO]ZBEK[İI]STAN|KIRGIZ[İI]STAN|KAZAK[İI]STAN|TAC[İI]K[İI]STAN|AZERBAYCAN|G[ÜU]RC[İI]STAN|ERMENISTAN|AFGAN[İI]STAN|PAK[İI]STAN|[İI]RAN|IRAK|RUSYA|FEDERASYONU|S[UÜ]R[İI]YE|MISIR|LIBYA|TUNUS|FAS|SOMALI|YEMEN|L[İI]BNAN|FILISTIN|BANGLADESH|HINDISTAN|NEPAL|MYANMAR|CHINA|IRAN|IRAQ|SYRIA|EGYPT|INDIA|RUSSIA|SMST|MIA)$/i;

        // Yardımcı: etiket kelimesinin sağında (aynı satır) VEYA hemen altında (aynı sütun) olan değer kelimeleri bul
        // maxX: opsiyonel X sınırı — sol kolon etiketleri için sağ kolona taşmayı önler
        const findValueWordsForLabel = (labelWord, maxX = null, skipCountryFilter = false) => {
            // Etiket sol kolondaysa (midpoint'in solunda), maxX'i otomatik hesapla
            const effectiveMaxX = maxX !== null ? maxX : (labelWord.bbox.x0 < midpoint ? midpoint : null);
            
            const validWords = words
                .filter(w => {
                    // X sınırı kontrolü: kelime sağ kolondan mı geliyor?
                    if (effectiveMaxX !== null && w.bbox.x0 >= effectiveMaxX) return false;
                    
                    // Aynı satırda sağda mı?
                    const isRight = sameRow(labelWord, w) && w.bbox.x0 > labelWord.bbox.x1;
                    // Veya aynı sütunda altta mı? (Sıkı X toleransı ile alt satıra taşan uzun veriler için)
                    const labelCenterX = (labelWord.bbox.x0 + labelWord.bbox.x1) / 2;
                    const wCenterX = (w.bbox.x0 + w.bbox.x1) / 2;
                    const isBelow = w.bbox.y0 > labelWord.bbox.y0 + 5 && Math.abs(wCenterX - labelCenterX) < 30;
                    
                    if (!isRight && !isBelow) return false;
                    if (coordFormLabels.test(w.text)) return false; // Form etiketlerini atla
                    
                    // Ülke adı filtresi — ad/soyad gibi alanlara bulaşmasını önler (uyruk için devre dışı)
                    if (!skipCountryFilter && knownCountryNames.test(w.text.replace(/[^A-ZÇĞİÖŞÜa-zçğıöşü]/g, ''))) return false;
                    
                    // OCR Halüsinasyon filtresi
                    const labelH = labelWord.bbox.y1 - labelWord.bbox.y0;
                    const wH = w.bbox.y1 - w.bbox.y0;
                    if (wH > labelH * 3.5 || wH < labelH * 0.3) return false;
                    
                    return cleanAndFixWord(w.text) !== null;
                })
                .sort((a, b) => {
                    // Etikete Y ekseninde (dikeyde) en yakın olan kelimeyi bul
                    const aDist = Math.abs(a.bbox.y0 - labelWord.bbox.y0);
                    const bDist = Math.abs(b.bbox.y0 - labelWord.bbox.y0);
                    const labelH = labelWord.bbox.y1 - labelWord.bbox.y0;
                    
                    if (Math.abs(aDist - bDist) < labelH * 0.6) {
                        return a.bbox.x0 - b.bbox.x0; // Y ekseninde çok yakınlarsa X'e göre sırala
                    }
                    return aDist - bDist;
                });
            
            if (validWords.length === 0) return [];
            
            // İlk geçerli kelimeyi ve onunla aynı satırdaki diğer geçerli kelimeleri al
            const result = [cleanAndFixWord(validWords[0].text)];
            const firstY = validWords[0].bbox.y0;
            const firstH = validWords[0].bbox.y1 - validWords[0].bbox.y0;
            
            for (let i = 1; i < validWords.length; i++) {
                if (Math.abs(validWords[i].bbox.y0 - firstY) < firstH * 0.6) {
                    result.push(cleanAndFixWord(validWords[i].text));
                } else {
                    break;
                }
            }
            
            return result.slice(0, 3); // En fazla 3 kelime al
        };
        
        
        // --- SOYADI ---
        if (!extracted.soyadi) {
            for (let i = 0; i < words.length; i++) {
                const w = words[i];
                if (!/\b(Soyad[ıiIİ]?|Surname)\b/i.test(w.text)) continue;
                
                // Kendi içinde içeriyorsa atla
                if (/Önceki|Previous/i.test(w.text)) continue;
                
                // Önceki kelimelere bak (Önceki Soyadı)
                let skip = false;
                for (let j = Math.max(0, i - 2); j < i; j++) {
                    if (/Önceki|Previous/i.test(words[j].text) && sameRow(words[j], w)) {
                        skip = true;
                        break;
                    }
                }
                if (skip) continue;
                
                const values = findValueWordsForLabel(w);
                if (values.length > 0) {
                    extracted.soyadi = values.join(' ');
                    console.log('[Koordinat] Soyadı bulundu:', extracted.soyadi);
                    break;
                }
            }
        }
        
        // --- ADI ---
        if (!extracted.adi) {
            for (let i = 0; i < words.length; i++) {
                const w = words[i];
                if (!/\b(Ad[ıiIİ]?|Name)\b/i.test(w.text)) continue;
                
                // Kendi içinde içeriyorsa atla
                if (/(Soyad|Baba|Anne|Father|Mother|Previous|[öo]nceki)/i.test(w.text)) continue;
                
                // Önceki kelimelere bak (Baba Adı, Anne Adı)
                let skip = false;
                for (let j = Math.max(0, i - 2); j < i; j++) {
                    if (/(Soyad|Baba|Anne|Father|Mother|Previous|[öo]nceki)/i.test(words[j].text) && sameRow(words[j], w)) {
                        skip = true;
                        break;
                    }
                }
                if (skip) continue;
                
                const values = findValueWordsForLabel(w);
                if (values.length > 0) {
                    extracted.adi = values.join(' ');
                    console.log('[Koordinat] Adı bulundu:', extracted.adi);
                    break;
                }
            }
        }
        // --- UYRUĞU ---
        if (!extracted.uyrugu) {
            for (let i = 0; i < words.length; i++) {
                const w = words[i];
                if (!/\b(Uyru[gğ]u|Nationality)\b/i.test(w.text)) continue;
                if (/(Di[gğ]er|Other|Do[gğ]um|Born|Bom)/i.test(w.text)) continue;
                
                // Önceki kelimelere bakarak "Diğer Uyruğu" veya "Doğumdaki Uyruğu" ise atla
                let skip = false;
                for (let j = Math.max(0, i - 2); j < i; j++) {
                    if (/(Di[gğ]er|Other|Do[gğ]um|Born)/i.test(words[j].text)) {
                        if (Math.abs(words[j].bbox.y0 - w.bbox.y0) < (w.bbox.y1 - w.bbox.y0) * 1.5) {
                            skip = true;
                            break;
                        }
                    }
                }
                if (skip) continue;
                
                // Uyruğu sağ sütunda — midpoint kısıtlaması yok, ülke adı filtresi kapalı
                const values = findValueWordsForLabel(w, null, true);
                if (values.length > 0) {
                    const uniqueValues = [...new Set(values)];
                    extracted.uyrugu = uniqueValues.join(' ');
                    console.log('[Koordinat] Uyruğu bulundu:', extracted.uyrugu);
                    break;
                }
            }
            
            // Fallback: "Nationality" etiketinden de dene
            if (!extracted.uyrugu) {
                for (const w of words) {
                    if (!/^Nationality$/i.test(w.text)) continue;
                    // "Nationality in Born" satırını atla
                    const hasIn = words.some(other => 
                        /^in$/i.test(other.text) && sameRow(w, other) && other.bbox.x0 > w.bbox.x1
                    );
                    if (hasIn) continue;
                    
                    const values = findValueWordsForLabel(w, null, true);
                    if (values.length > 0) {
                        extracted.uyrugu = values.join(' ');
                        console.log('[Koordinat] Uyruğu (Nationality) bulundu:', extracted.uyrugu);
                        break;
                    }
                }
            }
        }

        // --- DOĞUM TARİHİ ---
        if (!extracted.dogumTarihi) {
            for (const w of words) {
                if (!/(Do[gğ]um|Birth)/i.test(w.text)) continue;
                
                // Sağ sütunda olduğundan emin olalım (Kayıt Tarihi solda karışmasın, esneklik için 0.30)
                if (w.bbox.x0 < imageWidth * 0.30) continue;

                // Kelimenin sağında, aynı hizada olan kelimeleri topla
                const dateWords = words.filter(other => 
                    sameRow(w, other) && 
                    other.bbox.x0 > w.bbox.x1
                ).sort((a, b) => a.bbox.x0 - b.bbox.x0);
                
                const dateStr = dateWords.map(dw => dw.text).join(' ');
                // OCR hatalarını düzelt (S->5, O->0, l/I->1, Z->2)
                const cleanDate = dateStr.replace(/[OoQq]/g, '0').replace(/[Ss\$]/g, '5').replace(/[lI|]/g, '1').replace(/[Zz]/g, '2');
                
                const match = cleanDate.match(/(3[01]|[12]\d|0?[1-9])\s*[/.\-\s]+\s*(1[0-2]|0?[1-9])\s*[/.\-\s]+\s*(\d{4})/);
                if (match) {
                    extracted.dogumTarihi = `${match[1].padStart(2, '0')}.${match[2].padStart(2, '0')}.${match[3]}`;
                    console.log('[Koordinat] Doğum Tarihi bulundu:', extracted.dogumTarihi);
                    break;
                }
            }
        }
        
        // --- PASAPORT NO (Belge No) ---
        if (!extracted.pasaportNo) {
            for (let i = 0; i < words.length; i++) {
                const w = words[i];
                // "Belge", "Document", veya "Pasaport" etiketini ara
                if (!/\b(Belge|Document|Pasaport|Passport)\b/i.test(w.text)) continue;
                
                // "seyahat belgesi", "belge bedeli" gibi ilişkisiz bağlamları atla
                const nextWords = words.slice(i + 1, i + 4);
                const nearbyText = nextWords.map(nw => nw.text).join(' ');
                if (/bedel|makbuz|izni|seyahat|travel|receipt/i.test(nearbyText)) continue;
                
                // "No", "Number", "Numarası" kelimesi yakınında mı?
                const hasNoLabel = nextWords.some(nw => 
                    /^(No|Number|Numaras)/i.test(nw.text) && sameRow(w, nw)
                );
                // Etiketin kendisi "Belge" ise yakınında "No" olması gerekiyor
                if (/^Belge$/i.test(w.text) && !hasNoLabel) continue;
                
                // Etiketin sağında ve/veya altında alfanumerik pasaport numarası ara
                const passportCandidates = words.filter(pw => {
                    if (pw === w) return false;
                    // Form etiketlerini atla
                    if (coordFormLabels.test(pw.text)) return false;
                    // Ülke adlarını atla
                    if (knownCountryNames.test(pw.text.replace(/[^A-ZÇĞİÖŞÜa-zçğıöşü]/g, ''))) return false;
                    
                    // Aynı satırda sağda mı?
                    const isRight = sameRow(w, pw) && pw.bbox.x0 > w.bbox.x1;
                    // Veya altında mı? (hücre yapısı yüzünden bir alt satırda olabilir)
                    const labelH = w.bbox.y1 - w.bbox.y0;
                    const isBelow = pw.bbox.y0 > w.bbox.y0 && pw.bbox.y0 < w.bbox.y1 + labelH * 3;
                    
                    if (!isRight && !isBelow) return false;
                    
                    // Pasaport numarası formatı: harf(ler) + rakamlar (ör: A2596273, P09986286)
                    const cleaned = pw.text.replace(/[\s\-]/g, '');
                    if (/^[A-Za-z]{1,2}\d{5,9}$/.test(cleaned)) return true;
                    // Sadece rakamlardan oluşan pasaport no (bazı ülkeler)
                    if (/^\d{7,10}$/.test(cleaned)) return true;
                    
                    return false;
                }).sort((a, b) => {
                    // Etikete en yakın olanı tercih et
                    const aDist = Math.abs(a.bbox.y0 - w.bbox.y0) + Math.abs(a.bbox.x0 - w.bbox.x1);
                    const bDist = Math.abs(b.bbox.y0 - w.bbox.y0) + Math.abs(b.bbox.x0 - w.bbox.x1);
                    return aDist - bDist;
                });
                
                if (passportCandidates.length > 0) {
                    let passNo = passportCandidates[0].text.replace(/[\s\-]/g, '').toUpperCase();
                    // OCR rakam düzeltmeleri (harf kısmını koru)
                    const letterPart = passNo.match(/^([A-Z]*)/)[0];
                    const digitPart = passNo.substring(letterPart.length);
                    passNo = letterPart + digitPart
                        .replace(/[Oo]/g, '0').replace(/[Ss]/g, '5')
                        .replace(/[Zz]/g, '2').replace(/[l]/g, '1');
                    
                    // GC ile başlayan barkod numarasını filtrele
                    if (!/^GC/i.test(passNo)) {
                        extracted.pasaportNo = passNo;
                        console.log('[Koordinat] Pasaport No bulundu:', extracted.pasaportNo);
                        break;
                    }
                }
            }
        }
    }

    function extractFields(text) {
        // Normalize newlines for easier regex matching
        const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        const fullText = lines.join('\n');
        
        const extracted = {
            basvuruNo: '', pasaportNo: '', adi: '', soyadi: '', uyrugu: '', dogumTarihi: ''
        };

        // Known form label words — stops name extraction at right-column labels (OCR hataları dahil)
        const formLabels = /^(di[gğ]er|other|citizenship|uyr[uü][gğ]?[uü]?[a-z]*|nationality|nationali|nationally|nation|[dt][oö][gğ][uü]m[a-z]*|born|bom|birth|[öo]nceki|previous|surname|surmame|surnane|sumame|name|nane|mame|father|mother|baba|anne|cinsiyet[iİ]?|sex|gender|medeni|marital|uets|yeri|[üu]lkesi|country|kimlik|id|no|foreigner|place|foreign|date|tarihi|hali|status|biyo(?:metrik)?|number|document|belge(?:si)?|kay[ıi]t|registration|[iİ]kamet|ba[sş]vuru|randevu|talep|seyahat|travel|[iİıI]nformation|personal|type|t[üu]r[üu]|foto[gğ]raf|numara|soyad[ıi]?|ad[ıi]|veren|makam[ıi]?|issuing|authority|adres[iİ]?|address)$/i;

        // Bilinen ülke adları — ad/soyad alanına bulaşmasını önlemek için
        const knownCountryNames = /^(T[ÜU]RKMEN[İI]STAN|[ÖO]ZBEK[İI]STAN|KIRGIZ[İI]STAN|KAZAK[İI]STAN|TAC[İI]K[İI]STAN|AZERBAYCAN|G[ÜU]RC[İI]STAN|ERMENISTAN|AFGAN[İI]STAN|PAK[İI]STAN|[İI]RAN|IRAK|RUSYA|FEDERASYONU|S[UÜ]R[İI]YE|MISIR|LIBYA|TUNUS|FAS|SOMALI|YEMEN|L[İI]BNAN|FILISTIN|BANGLADESH|HINDISTAN|NEPAL|MYANMAR|CHINA|IRAN|IRAQ|SYRIA|EGYPT|INDIA|RUSSIA|SMST|MIA)$/i;

        // Helper: grab consecutive name words, stopping at form labels.
        // Tolerates 1 lowercase OCR error per word.
        const grabName = (str) => {
            const words = str.split(/[\s,;:]+/).filter(w => w.length > 0);
            const result = [];
            for (const word of words) {
                if (result.length >= 4) break;
                if (formLabels.test(word)) break;
                
                // OCR hatalarına karşı daha esnek kontrol: Kelime içindeki harf dışı karakterleri temizle
                const cleanedWord = word.replace(/[^A-ZÇĞİÖŞÜa-zçğıöşü'\-]/g, '');
                
                // Ülke adıysa ismi sonlandır (sağ kolondan bulaşmayı önle)
                if (knownCountryNames.test(cleanedWord)) break;
                const isNameWord = cleanedWord.length >= 2;
                
                if (isNameWord) {
                    // OCR'da sık karışan rakamları harfe çevir
                    let fixedWord = word.toLocaleUpperCase('tr-TR')
                        .replace(/[0]/g, 'O')
                        .replace(/[1]/g, 'I')
                        .replace(/[3]/g, 'E')
                        .replace(/[4]/g, 'A')
                        .replace(/[5]/g, 'S')
                        .replace(/[8]/g, 'B')
                        .replace(/[^A-ZÇĞİÖŞÜ'\-]/g, '');
                    
                    if(fixedWord.length >= 2) {
                        result.push(fixedWord);
                    }
                } else if (result.length > 0) {
                    break;
                }
            }
            return result.join(' ');
        };

        // ============================================
        // 1. BAŞVURU NO (Kayıt Numarası)
        //    Format: YYYY-NN-NNNNNNN (e.g. 2026-88-0638278)
        // ============================================

        // Strategy A: GCGM barcode text (most reliable, always on the form)
        // e.g. GCGM03-92026880638278 → 2026-88-0638278
        const cleanForBarcode = fullText.replace(/\s+/g, '');
        const barcodeMatch = cleanForBarcode.match(/GC[CG]M\d+[-–]?\d(\d{4})(\d{2})(\d{7})/i);
        if (barcodeMatch) {
            extracted.basvuruNo = `${barcodeMatch[1]}-${barcodeMatch[2]}-${barcodeMatch[3]}`;
        }

        // Strategy B: Label-anchored (near "Kayıt Numarası" / "Registration Number")
        if (!extracted.basvuruNo) {
            const labelMatch = fullText.match(
                /(?:Kay[ıi]t\s*(?:Numaras[ıi]|No)|Registration\s*(?:Number|No))[^\d]{0,30}(\d{4})\s*[-–.\s]\s*(\d{2})\s*[-–.\s]\s*(\d{5,7})/i
            );
            if (labelMatch) {
                extracted.basvuruNo = `${labelMatch[1]}-${labelMatch[2]}-${labelMatch[3]}`;
            }
        }

        // Strategy C: Generic YYYY-NN-NNNNNNN anchored to 20XX or 50XX (OCR error for 2)
        if (!extracted.basvuruNo) {
            const genericMatch = fullText.match(/\b([25Zz]?0\d{2})\s*[-–]\s*(\d{2})\s*[-–]\s*(\d{5,7})\b/);
            if (genericMatch) {
                extracted.basvuruNo = `${genericMatch[1]}-${genericMatch[2]}-${genericMatch[3]}`;
            }
        }

        // OCR digit corrections for başvuru no
        if (extracted.basvuruNo) {
            const parts = extracted.basvuruNo.split('-');
            if (parts.length === 3) {
                parts.forEach((p, idx) => {
                    parts[idx] = p.replace(/[OoQq]/g, '0').replace(/[S\$]/g, '5').replace(/[Zz]/g, '2').replace(/[l]/g, '1');
                });
                // 5 ile başlayan yılları (OCR hatası) 2'ye zorla
                if (parts[0].startsWith('50') || parts[0].startsWith('Z0')) {
                    parts[0] = '20' + parts[0].substring(2);
                }
                extracted.basvuruNo = parts.join('-');
            }
        }

        // ============================================
        // 2. SOYADI VE ADI
        // ============================================

        const pasaportRegex = /\b(?:Pasaport|Document)\s*(?:No|Number)?\b/gi;
        const adiRegex = /\b(?:Ad[ıiIİ]?|Name)\b/gi;
        const soyadiRegex = /\b(?:Soyad[ıiIİ]?|Surname)\b/gi;
        const uyruguRegex = /\b(?:Uyru[gğ]u|Nationality)\b/gi;

        // Soyadı
        let sM;
        while ((sM = soyadiRegex.exec(fullText)) !== null) {
            const before = fullText.substring(Math.max(0, sM.index - 15), sM.index);
            if (/Önceki|Previous/i.test(before)) continue;

            const after = fullText.substring(sM.index + sM[0].length, sM.index + sM[0].length + 100);
            const words = after.split(/[\s\/:.-]+/).filter(w => w.length >= 2);
            let validParts = [];
            let skipped = 0;
            for (let word of words) {
                if (formLabels.test(word) || /personel|personal|information/i.test(word)) {
                    if (validParts.length > 0) break;
                    skipped++;
                    if (skipped > 3) break; // Çok fazla etiket atlarsa dur (yanlış satıra kaymayı önler)
                    continue;
                }
                const cleanWord = word.replace(/[^A-ZÇĞİÖŞÜa-zçğıöşü]/g, '');
                if (cleanWord.length < 2) continue;
                
                validParts.push(cleanWord.toLocaleUpperCase('tr-TR'));
                if (validParts.length >= 2) break; // En fazla 2 kelime
            }
            if (validParts.length > 0 && !extracted.soyadi) {
                extracted.soyadi = validParts.join(' ');
                break;
            }
        }

        // Adı
        let aM;
        while ((aM = adiRegex.exec(fullText)) !== null) {
            const before = fullText.substring(Math.max(0, aM.index - 15), aM.index);
            // Soyadı, Baba Adı, Anne Adı gibi kelimelerin içindeki "Adı" kelimesini atla
            if (/soy|baba|anne|father|mother|previous|[öo]nceki/i.test(before)) continue; 
            
            const after = fullText.substring(aM.index + aM[0].length, aM.index + aM[0].length + 100);
            const words = after.split(/[\s\/:.-]+/).filter(w => w.length >= 2);
            let validParts = [];
            let skipped = 0;
            for (let word of words) {
                if (formLabels.test(word) || /personel|personal|information/i.test(word)) {
                    if (validParts.length > 0) break;
                    skipped++;
                    if (skipped > 3) break;
                    continue;
                }
                const cleanWord = word.replace(/[^A-ZÇĞİÖŞÜa-zçğıöşü]/g, '');
                if (cleanWord.length < 2) continue;
                
                validParts.push(cleanWord.toLocaleUpperCase('tr-TR'));
                if (validParts.length >= 2) break; // En fazla 2 kelime
            }
            if (validParts.length > 0 && !extracted.adi) {
                extracted.adi = validParts.join(' ');
                break;
            }
        }

        // ============================================
        // 4. UYRUĞU — standalone, skip Diğer/Doğumdaki
        // ============================================
        const uyrukRegex = /\bUyru[gğ]u\b/gi;
        let uM;
        while ((uM = uyrukRegex.exec(fullText)) !== null) {
            const before = fullText.substring(Math.max(0, uM.index - 15), uM.index);
            if (/di[gğ]er|do[gğ]um/i.test(before)) continue;

            const after = fullText.substring(uM.index + uM[0].length, uM.index + uM[0].length + 150);
            
            // Tüm kelimeleri alıp aradaki etiketleri atlıyoruz
            const words = after.split(/[\s\/:.-]+/).filter(w => w.length >= 2);
            let validParts = [];
            let skipped = 0;
            for (let word of words) {
                if (formLabels.test(word) || /personel|personal|information/i.test(word)) {
                    if (validParts.length > 0) break; // Ülke adından sonra etiket gelirse dur
                    skipped++;
                    if (skipped > 4) break;
                    continue; // Başlangıçtaki etiketleri (örn: Foreign, ID, Number) atla
                }
                
                if (/^[A-ZÇĞİÖŞÜa-zçğıöşü]+$/.test(word)) {
                    validParts.push(word.toLocaleUpperCase('tr-TR'));
                } else if (validParts.length > 0) {
                    break;
                }
                
                if (validParts.length >= 2) break; // En fazla 2 kelimelik ülkeler
            }
            
            if (validParts.length > 0) {
                // Aynı kelime tekrar ediyorsa (örn: TÜRKMENİSTAN TÜRKMENİSTAN) tekile düşür
                const uniqueParts = [...new Set(validParts)];
                extracted.uyrugu = uniqueParts.join(' ');
                break;
            }
        }

        // ============================================
        // 5. DOĞUM TARİHİ
        // ============================================
        const dobMatch = fullText.match(
            /(?:Do[gğ]um|Date\s*of\s*Birth|Born)[^\d]{0,120}(3[01]|[12]\d|0?[1-9])\s*[/.\-\s]+\s*(1[0-2]|0?[1-9])\s*[/.\-\s]+\s*(\d{4})/i
        );
        if (dobMatch) {
            extracted.dogumTarihi = `${dobMatch[1].padStart(2, '0')}.${dobMatch[2].padStart(2, '0')}.${dobMatch[3]}`;
        }

        // ============================================
        // 6. PASAPORT NO (Belge No)
        // ============================================
        const belgeMatch = fullText.match(
            /(?:Belge\s*N[oO0]|Number\s*of\s*Document)[^\w]{0,10}([A-Z0-9ĞÜŞİÖÇğüşiöç]{5,15})/i
        );
        if (belgeMatch) {
            let pass = belgeMatch[1].toUpperCase().replace(/\s/g, '');
            if (pass.length >= 5 && !/^INFORMATION$/i.test(pass) && !/^NUMBER$/i.test(pass)) {
                extracted.pasaportNo = pass;
            }
        }

        // Fallback: Letter(s) + digits (e.g. A2596273, P09986286)
        if (!extracted.pasaportNo) {
            const passMatch = fullText.match(/\b([A-Za-z]{1,2}\d{6,9})\b/);
            if (passMatch) {
                const candidate = passMatch[1].toUpperCase();
                if (!/^GC/i.test(candidate)) {
                    extracted.pasaportNo = candidate;
                }
            }
        }

        // OCR corrections for passport digits
        if (extracted.pasaportNo) {
            const letterMatch = extracted.pasaportNo.match(/^([A-Za-zĞÜŞİÖÇ]*)/);
            if (letterMatch && letterMatch[0].length < extracted.pasaportNo.length) {
                const lp = letterMatch[0];
                const dp = extracted.pasaportNo.substring(lp.length);
                extracted.pasaportNo = lp + dp.replace(/[Oo]/g, '0').replace(/[Ss]/g, '5').replace(/[Zz]/g, '2').replace(/[l]/g, '1');
            }
        }

        // Garbage Collector: Reject overly long extractions
        if (extracted.adi && extracted.adi.split(' ').length > 4) extracted.adi = '';
        if (extracted.soyadi && extracted.soyadi.split(' ').length > 4) extracted.soyadi = '';

        return extracted;
    }

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
        }
        showToast('İnternet yok. Tarama yapılamaz, manuel giriş yapabilirsiniz.', 'warning');
    } else {
        if(btnUpload) {
            btnUpload.disabled = false;
            btnUpload.style.opacity = '1';
            btnUpload.title = "";
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
            const formFields = getDraftFields();
            Object.keys(draft).forEach(k => {
                if (formFields[k] && draft[k]) {
                    formFields[k].value = draft[k];
                    hasData = true;
                }
            });
            if (hasData) {
                showToast('Kaldığınız yerden devam ediyorsunuz (Taslak yüklendi).', 'info');
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
