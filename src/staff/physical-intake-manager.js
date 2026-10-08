import { splitPdfPages } from '../services/split-pdf-pages.js';
import { recognizePhysicalApplicationForm } from './physical-form-ocr.js';
import { IS_PHYSICAL_INTAKE_ENABLED, MAX_PHYSICAL_PDF_BYTES } from '../config/physical-intake-policy.js';
import { buildPhysicalPdfUrl, createPhysicalIntakeClient } from './physical-intake-client.js';
import { renderPhysicalIntakes } from './physical-intake-view.js';
import { openPdfMergerModal } from '../ui/pdfMergerModal.js';
import { showToast } from '../ui/toastManager.js';
import './physical-intake.css';

function setBusy(context, isBusy) {
    context.isBusy = isBusy;
    context.root.setAttribute('aria-busy', String(isBusy));
    if (isBusy) {
        context.controls = [...context.root.querySelectorAll('button,input,select,textarea')].map(node => ({ node, wasDisabled: node.disabled }));
        context.controls.forEach(({ node }) => { node.disabled = true; });
        return;
    }
    context.controls.forEach(({ node, wasDisabled }) => { if (node.isConnected) node.disabled = wasDisabled; });
    context.controls = [];
}

function showMessage(context, message) {
    context.state.message = message;
    const notice = context.root.querySelector('#physical-intake-notice');
    if (notice) notice.textContent = message;
}

function render(context) {
    renderPhysicalIntakes(context.root, context.state, context.handlers);
}

async function execute(context, work) {
    if (context.isBusy) return;
    setBusy(context, true);
    try { await work(); }
    catch (error) {
        console.error('Physical workspace operation failed.', { errorName: error.name, code: error.code });
        showMessage(context, error.status === 401 ? 'Oturum sona erdi. Sayfayı yenileyip tekrar giriş yapın.' : error.message);
    } finally { setBusy(context, false); }
}

async function loadQueue(context) {
    if (context.state.previewUrl) { URL.revokeObjectURL(context.state.previewUrl); context.state.previewUrl = null; }
    context.state.preparedPdf = null;
    const response = await fetch('/api/staff/physical-access', { credentials: 'same-origin', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Fiziksel başvuru erişimi kontrol edilemedi.');
    const access = await response.json();
    if (!access.allowed) {
        context.root.replaceChildren();
        const notice = context.root.ownerDocument.createElement('p');
        notice.textContent = 'Fiziksel başvuru bu oturum için etkin değil. ONLINE seçeneğinden mevcut başvurulara ulaşabilirsiniz.';
        context.root.append(notice);
        return;
    }
    context.state.result = await context.api.query(context.state.query);
    context.state.view = 'queue';
    context.state.message = 'Fiziksel teslimler — son güncellenen kayıtlar önce gösterilir.';
    render(context);
}

async function openDetail(context, id) {
    context.state.isRejecting = false;
    context.state.detail = await context.api.detail(id);
    context.state.view = 'detail';
    context.state.message = 'PDF’ler bu öğrenci kaydında saklanır; kaydedildikten sonra yeniden açılabilir.';
    render(context);
}

function openCreate(context) {
    if (context.isBusy) return;
    openPdfMergerModal({ contextLabel: 'Önce başvuru formunu yükleyin; ardından kalan belgeleri sırayla ekleyin.',
        mergeLabel: 'PDF Oluştur', confirmLabel: 'Öğrenci Bilgilerine Geç',
        successMessage: 'PDF hazır. Öğrenci bilgilerini kontrol edip Kaydet’e basın.',
        onPrepare: files => recognizePhysicalApplicationForm(files),
        onSave: async (bytes, fields) => {
            if (bytes.length > MAX_PHYSICAL_PDF_BYTES) throw new Error('PDF en fazla 10 MB olabilir. Belgeleri küçültüp tekrar oluşturun.');
            if (context.state.previewUrl) URL.revokeObjectURL(context.state.previewUrl);
            context.state.previewUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
            context.state.preparedPdf = bytes;
            context.state.registrationId = crypto.randomUUID();
            context.state.view = 'create';
            context.state.draft = { student_number: '', first_name: fields?.first_name || '', last_name: fields?.last_name || '',
                passport_number: fields?.passport_number || '', application_type: 'initial', linked_application_id: null };
            context.state.message = fields?.warning || 'PDF hazır. OCR bilgilerini kontrol edin; gerekirse düzeltip Kaydet’e basın.';
            render(context);
        }
    });
}

async function createReceipt(context) {
    if (!context.state.preparedPdf) throw new Error('Önce PDF oluşturun.');
    context.state.detail = await context.api.register({ id: context.state.registrationId, receipt: { ...context.state.draft }, bytes: context.state.preparedPdf });
    URL.revokeObjectURL(context.state.previewUrl);
    context.state.previewUrl = null;
    context.state.preparedPdf = null;
    showToast('İşlem başarılı. Başvuru ve PDF kaydedildi.', 'success');
    await loadQueue(context);
    showMessage(context, 'İşlem başarılı. Başvuru ve PDF kaydedildi. Durum: İncelemede.');
}

async function mutateReceipt(context, options) {
    if (options.action === 'delete' && !window.confirm('Bu fiziksel teslim kaydı Silinenler’e taşınsın mı? PDF sürümleri saklanır.')) return;
    const detail = await context.api.change(options.intake.id, { action: options.action,
        body: { lock_version: options.intake.lock_version, ...(options.action === 'status' ? { status: options.status, ...(options.status === 'rejected' ? { rejection_reason: options.reason } : {}) } : {}) } });
    if (context.state.view === 'detail') {
        context.state.isRejecting = false;
        context.state.detail = detail;
        context.state.message = 'Kayıt güncellendi.';
        render(context);
        return;
    }
    await loadQueue(context);
}

async function persistPdf(context, capture, bytes) {
    if (context.isBusy) throw new Error('Başka bir işlem devam ediyor. Tamamlanınca tekrar deneyin.');
    if (bytes.byteLength > MAX_PHYSICAL_PDF_BYTES) throw new Error('PDF en fazla 10 MB olabilir. Sayfa sayısını azaltın veya PDF’i küçültün.');
    if (capture.bytes && capture.bytes !== bytes) capture.fileId = crypto.randomUUID();
    capture.bytes = bytes;
    setBusy(context, true);
    try {
        await context.api.savePdf(capture.id, { bytes, fileId: capture.fileId, version: capture.version });
        showMessage(context, 'PDF öğrenci kaydına kaydedildi. Açabilir veya indirebilirsiniz.');
        try { await openDetail(context, capture.id); showMessage(context, 'PDF kaydedildi. Açabilir veya indirebilirsiniz.'); }
        catch (error) { console.error('Saved physical PDF refresh failed.', { errorName: error.name }); }
    } catch (error) {
        if (error.code === 'PDF_RETRY_REQUIRED') capture.fileId = crypto.randomUUID();
        showMessage(context, error.message);
        throw error;
    } finally { setBusy(context, false); }
}

function captureReceipt(context) {
    const intake = context.state.detail.intake;
    return { id: intake.id, version: intake.lock_version, fileId: crypto.randomUUID(),
        label: `${intake.student_number || 'Öğrenci no belirtilmedi'} — ${intake.first_name} ${intake.last_name}` };
}

async function fetchCurrentPdf(intake) {
    if (!intake.current_pdf_id) return [];
    const response = await fetch(buildPhysicalPdfUrl(intake.id, intake.current_pdf_id, 'download'), {
        credentials: 'same-origin', signal: AbortSignal.timeout(60000)
    });
    if (!response.ok) throw new Error('Mevcut PDF alınamadı. Belgeleri eksiksiz birleştirmek için tekrar deneyin.');
    const pdf = await response.blob();
    if (!pdf.size || pdf.size > MAX_PHYSICAL_PDF_BYTES) throw new Error('Mevcut PDF boyutu geçersiz. Kaydı yenileyip tekrar deneyin.');
    const pages = await splitPdfPages(new Uint8Array(await pdf.arrayBuffer()));
    return pages.map(page => new File([page.bytes], page.name, { type: 'application/pdf' }));
}

async function deletePdf(context) {
    const intake = context.state.detail.intake;
    if (!intake.current_pdf_id || !window.confirm('Güncel PDF kayıttan ayrılsın mı? Sürüm geçmişi saklanır.')) return;
    await context.api.deletePdf(intake.id, { fileId: intake.current_pdf_id, version: intake.lock_version });
    await openDetail(context, intake.id);
}

async function preparePdf(context) {
    const capture = captureReceipt(context);
    const initialFiles = await fetchCurrentPdf(context.state.detail.intake);
    openPdfMergerModal({ contextLabel: `${capture.label} · Sayfaları sıralayın veya silin; QR ve dosya seçimiyle yeni belgeler ekleyin.`,
        initialFiles, maxFiles: 300, mergeLabel: 'PDF’yi Yeniden Oluştur', confirmLabel: 'Değişiklikleri Kaydet',
        onSave: bytes => persistPdf(context, capture, bytes) });
}


function createHandlers(context) {
    const run = work => execute(context, work);
    return {
        back: () => {
            if (context.state.view === 'create' && !window.confirm('Henüz kaydedilmemiş PDF ve bilgiler bırakılarak listeye dönülsün mü?')) return;
            run(() => loadQueue(context));
        }, newReceipt: () => openCreate(context),
        open: id => run(() => openDetail(context, id)),
        search: query => run(async () => { context.state.query = { ...context.state.query, ...query, page: 1 }; await loadQueue(context); }),
        page: page => run(async () => { context.state.query.page = page; await loadQueue(context); }),
        create: () => run(() => createReceipt(context)),
        mutate: (intake, action, status) => run(() => mutateReceipt(context, { intake, action, status })),
        reject: intake => { context.state.isRejecting = true; context.state.rejectionReason = ''; render(context); },
        cancelReject: () => { context.state.isRejecting = false; render(context); },
        saveRejection: reason => run(() => mutateReceipt(context, { intake: context.state.detail.intake, action: 'status', status: 'rejected', reason })),
        preparePdf: () => run(() => preparePdf(context)), deletePdf: () => run(() => deletePdf(context))
    };
}

/** Mounts the staff physical-intake workspace.
 * @param {HTMLElement} root Workspace mount. @returns {void} Registers workspace navigation and actions.
 */
export function initializePhysicalIntakeManager(root) {
    if (!IS_PHYSICAL_INTAKE_ENABLED) return;
    const context = { root, api: createPhysicalIntakeClient(), isBusy: false, controls: [], handlers: null,
        state: { view: 'queue', query: { q: '', status: 'all', page: 1, page_size: 25 }, result: null, detail: null, message: '' } };
    context.handlers = createHandlers(context);
    root.textContent = 'Fiziksel başvuru erişimi kontrol ediliyor…';
    root.ownerDocument.addEventListener('workspace:view-changed', event => {
        if (event.detail?.viewName === 'physical' && !context.state.result && context.state.view === 'queue') {
            execute(context, () => loadQueue(context));
        }
    });
}
