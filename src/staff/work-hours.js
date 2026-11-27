import { buildTimesheet } from './timesheet/timesheetModel.js';
import { writeTimesheet } from './timesheet/timesheetWriter.js';

const HOURS_PEOPLE = [
    ['kagan_samet', 'Kağan Samet'], ['asaf', 'Asaf'], ['eyup', 'Eyüp'], ['oguz', 'Oğuz'], ['eray', 'Eray']
];

const renderedPayloads = new WeakMap();
const latestRequestIds = new WeakMap();

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function formatDisplayDate(date) {
    const [year, month, day] = date.split('-');
    return `${day}.${month}.${year}`;
}

async function loadDate(root, date) {
    const status = root.querySelector('[data-work-hours-status]');
    const requestId = (latestRequestIds.get(root) || 0) + 1;
    latestRequestIds.set(root, requestId);
    status.textContent = 'Kayıtlar yükleniyor…';
    try {
        const response = await fetch(`/api/staff/work-hours?date=${encodeURIComponent(date)}`, { credentials: 'same-origin' });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error?.message || 'Kayıtlar yüklenemedi.');
        if (latestRequestIds.get(root) !== requestId) return;
        renderMonth(root, payload);
        if (payload.selectedDate === payload.today) updateReminder(root.ownerDocument, payload);
        status.textContent = formatDisplayDate(payload.selectedDate);
        root.querySelector('[data-work-hours-display]').textContent = `Seçili gün: ${formatDisplayDate(payload.selectedDate)}`;
    } catch (error) {
        if (latestRequestIds.get(root) !== requestId) return;
        status.textContent = error.message || 'Kayıtlar yüklenemedi. Sayfayı yenileyip tekrar deneyin.';
    }
}

function updateReminder(document, payload) {
    const reminder = document.querySelector('[data-work-hours-reminder]');
    if (!reminder) return;
    const saved = new Set(payload.records.filter(record => record.work_date === payload.today).map(record => record.staff_key));
    reminder.hidden = Array.isArray(payload.people) && payload.people.length > 0
        && payload.people.every(({ key }) => saved.has(key));
}

function renderMonth(root, payload) {
    renderedPayloads.set(root, payload);
    const records = new Map(payload.records.map((record) => [`${record.work_date}:${record.staff_key}`, record.minutes]));
    const selectedDate = payload.selectedDate;
    const today = payload.today;
    const canEdit = selectedDate === today;
    const peopleRows = HOURS_PEOPLE.map(([key, name]) => {
        const value = records.get(`${selectedDate}:${key}`);
        const options = Array.from({ length: 49 }, (_, index) => index * 30)
            .map((minutes) => `<option value="${minutes}" ${value === minutes ? 'selected' : ''}>${minutes / 60} saat</option>`).join('');
        const total = payload.records.filter((record) => record.staff_key === key).reduce((sum, record) => sum + record.minutes, 0) / 60;
        return `<article class="work-hours-person-card"><div class="work-hours-person-heading"><h4>${escapeHtml(name)}</h4><span class="work-hours-entry-state ${value === undefined ? 'is-empty' : 'is-saved'}">${value === undefined ? 'Henüz girilmedi' : 'Kaydedildi'}</span></div><label for="work-hours-${key}">${canEdit ? 'Bugünkü çalışma süresi' : 'Çalışma süresi'}</label><div class="work-hours-entry-controls"><select id="work-hours-${key}" data-person="${key}" ${canEdit ? '' : 'disabled'}>${options}</select><button class="btn btn-primary" type="button" data-save="${key}" ${canEdit ? '' : 'disabled'}>Kaydet</button></div><div class="work-hours-person-footer"><span>${formatDisplayDate(selectedDate)} <strong>${value === undefined ? '—' : `${value / 60} saat`}</strong></span><span>Aylık <strong>${total} saat</strong></span></div><div class="work-hours-person-actions"><button class="btn btn-outline work-hours-export-btn" type="button" data-export-timesheet="${key}">Puantaj Oluştur</button></div></article>`;
    }).join('');
    root.querySelector('[data-work-hours-table]').innerHTML = `<div class="work-hours-people-grid">${peopleRows}</div><p class="work-hours-template-note">Geçici puantaj çıktısı: okul şablonu henüz eklenmedi.</p>`;
    const notice = root.querySelector('[data-work-hours-holiday]');
    notice.hidden = canEdit;
    notice.textContent = 'Geçmiş tarih kayıtları görüntülenebilir, değiştirilemez.';
    root.querySelector('[data-work-hours-history]').innerHTML = payload.records.map((record) => {
        const name = HOURS_PEOPLE.find(([key]) => key === record.staff_key)?.[1] || record.staff_key;
        return `<article class="work-hours-history-item"><time datetime="${escapeHtml(record.work_date)}">${escapeHtml(record.work_date)}</time><strong>${escapeHtml(name)}</strong><span>${record.minutes / 60} saat</span></article>`;
    }).join('') || '<p class="work-hours-empty-history">Bu ay için kayıt yok.</p>';
}

const BLOB_REVOKE_DELAY_MS = 60_000;

function triggerFileDownload(doc, fileName, bytes) {
    const view = doc?.defaultView || globalThis;
    const BlobCtor = view.Blob || globalThis.Blob;
    const urlApi = view.URL || globalThis.URL;
    const blob = new BlobCtor([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    const objectUrl = urlApi.createObjectURL(blob);
    const link = doc.createElement('a');
    link.href = objectUrl;
    link.download = fileName;
    link.hidden = true;
    doc.body.append(link);
    link.click();
    link.remove();
    const scheduleTimer = typeof view.setTimeout === 'function' ? view.setTimeout.bind(view) : globalThis.setTimeout;
    const timer = scheduleTimer(() => {
        urlApi.revokeObjectURL?.(objectUrl);
    }, BLOB_REVOKE_DELAY_MS);
    if (typeof timer?.unref === 'function') timer.unref();
}

function handleTimesheetExport(root, personKey) {
    const status = root.querySelector('[data-work-hours-status]');
    const payload = renderedPayloads.get(root);
    if (!payload || typeof payload.selectedDate !== 'string') {
        status.textContent = 'Puantaj oluşturmak için önce kayıtların yüklenmesini bekleyin.';
        return;
    }

    const personEntry = HOURS_PEOPLE.find(([key]) => key === personKey);
    const personName = personEntry?.[1] || personKey;
    const view = root.ownerDocument?.defaultView || globalThis;
    const XLSX = view.XLSX;

    try {
        const timesheet = buildTimesheet({
            month: payload.selectedDate.slice(0, 7),
            today: payload.today,
            person: { key: personKey, name: personName },
            records: payload.records
        });
        const { fileName, bytes } = writeTimesheet(timesheet, { XLSX });
        triggerFileDownload(root.ownerDocument, fileName, bytes);
        status.textContent = timesheet.missingDays > 0
            ? `Uyarı: ${personName} için bu ayda ${timesheet.missingDays} hafta içi günü eksik. ${fileName} indirildi.`
            : `${fileName} indirildi.`;
    } catch (error) {
        status.textContent = error.message || 'Puantaj dosyası oluşturulamadı.';
    }
}

async function refreshReminder(document) {
    try {
        const response = await fetch('/api/staff/work-hours', { credentials: 'same-origin' });
        if (!response.ok) throw new Error('Çalışma saati kayıtları alınamadı.');
        updateReminder(document, await response.json());
    } catch {
        const reminder = document.querySelector('[data-work-hours-reminder]');
        if (reminder) reminder.hidden = false;
    }
}

export function initWorkHours(doc = document) {
    const root = doc.getElementById('staff-work-hours');
    if (!root) return;
    const dateInput = root.querySelector('[data-work-hours-date]');
    dateInput.value = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    dateInput.max = dateInput.value;
    dateInput.addEventListener('change', () => loadDate(root, dateInput.value));
    (doc.defaultView || globalThis).addEventListener?.('staff-work-hours:changed', () => loadDate(root, dateInput.value));
    doc.addEventListener('visibilitychange', () => {
        if (!doc.hidden) void refreshReminder(doc);
    });
    for (const id of ['btn-workspace-home', 'btn-go-home-global', 'staff-home-link']) {
        doc.getElementById(id)?.addEventListener('click', () => void refreshReminder(doc));
    }
    root.addEventListener('click', async (event) => {
        const exportButton = event.target.closest('[data-export-timesheet]');
        if (exportButton) {
            handleTimesheetExport(root, exportButton.dataset.exportTimesheet);
            return;
        }
        const button = event.target.closest('[data-save]');
        if (!button) return;
        const select = root.querySelector(`[data-person="${button.dataset.save}"]`);
        const status = root.querySelector('[data-work-hours-status]');
        button.disabled = true;
        try {
            const response = await fetch('/api/staff/work-hours', {
                method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ person: button.dataset.save, minutes: Number(select.value) })
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload?.error?.message || 'Kayıt yapılamadı.');
            status.textContent = 'Kayıt kaydedildi.';
            await loadDate(root, dateInput.value);
        } catch (error) {
            status.textContent = error.message || 'Kayıt yapılamadı. Seçiminiz korundu; tekrar deneyebilirsiniz.';
        } finally {
            button.disabled = false;
        }
    });
    loadDate(root, dateInput.value);
}
