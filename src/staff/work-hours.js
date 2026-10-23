const HOURS_PEOPLE = [
    ['kagan_samet', 'Kağan Samet'], ['asaf', 'Asaf'], ['eyup', 'Eyüp'], ['oguz', 'Oğuz'], ['eray', 'Eray']
];

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function formatDisplayDate(date) {
    const [year, month, day] = date.split('-');
    return `${day}.${month}.${year}`;
}

async function loadDate(root, date) {
    const status = root.querySelector('[data-work-hours-status]');
    status.textContent = 'Kayıtlar yükleniyor…';
    try {
        const response = await fetch(`/api/staff/work-hours?date=${encodeURIComponent(date)}`, { credentials: 'same-origin' });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error?.message || 'Kayıtlar yüklenemedi.');
        renderMonth(root, payload);
        status.textContent = formatDisplayDate(payload.selectedDate);
        root.querySelector('[data-work-hours-display]').textContent = `Seçili gün: ${formatDisplayDate(payload.selectedDate)}`;
    } catch (error) {
        status.textContent = error.message || 'Kayıtlar yüklenemedi. Sayfayı yenileyip tekrar deneyin.';
    }
}

function renderMonth(root, payload) {
    const records = new Map(payload.records.map((record) => [`${record.work_date}:${record.staff_key}`, record.minutes]));
    const selectedDate = payload.selectedDate;
    const today = payload.today;
    const isWeekend = [0, 6].includes(new Date(`${selectedDate}T12:00:00+03:00`).getUTCDay());
    const canEdit = selectedDate === today && !isWeekend;
    const peopleRows = HOURS_PEOPLE.map(([key, name]) => {
        const value = records.get(`${selectedDate}:${key}`);
        const options = Array.from({ length: 49 }, (_, index) => index * 30)
            .map((minutes) => `<option value="${minutes}" ${value === minutes ? 'selected' : ''}>${minutes / 60} saat</option>`).join('');
        const total = payload.records.filter((record) => record.staff_key === key).reduce((sum, record) => sum + record.minutes, 0) / 60;
        return `<article class="work-hours-person-card"><div class="work-hours-person-heading"><h4>${escapeHtml(name)}</h4><span class="work-hours-entry-state ${value === undefined ? 'is-empty' : 'is-saved'}">${value === undefined ? 'Henüz girilmedi' : 'Kaydedildi'}</span></div><label for="work-hours-${key}">${canEdit ? 'Bugünkü çalışma süresi' : 'Çalışma süresi'}</label><div class="work-hours-entry-controls"><select id="work-hours-${key}" data-person="${key}" ${canEdit ? '' : 'disabled'}>${options}</select><button class="btn btn-primary" type="button" data-save="${key}" ${canEdit ? '' : 'disabled'}>Kaydet</button></div><div class="work-hours-person-footer"><span>${formatDisplayDate(selectedDate)} <strong>${value === undefined ? '—' : `${value / 60} saat`}</strong></span><span>Aylık <strong>${total} saat</strong></span></div></article>`;
    }).join('');
    root.querySelector('[data-work-hours-table]').innerHTML = `<div class="work-hours-people-grid">${peopleRows}</div>`;
    const notice = root.querySelector('[data-work-hours-holiday]');
    notice.hidden = canEdit;
    notice.textContent = isWeekend ? 'Cumartesi ve pazar günleri kayıt girilemez.' : 'Geçmiş tarih kayıtları görüntülenebilir, değiştirilemez.';
    root.querySelector('[data-work-hours-history]').innerHTML = payload.records.map((record) => {
        const name = HOURS_PEOPLE.find(([key]) => key === record.staff_key)?.[1] || record.staff_key;
        return `<article class="work-hours-history-item"><time datetime="${escapeHtml(record.work_date)}">${escapeHtml(record.work_date)}</time><strong>${escapeHtml(name)}</strong><span>${record.minutes / 60} saat</span></article>`;
    }).join('') || '<p class="work-hours-empty-history">Bu ay için kayıt yok.</p>';
}

export function initWorkHours() {
    const root = document.getElementById('staff-work-hours');
    if (!root) return;
    const dateInput = root.querySelector('[data-work-hours-date]');
    dateInput.value = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    dateInput.max = dateInput.value;
    dateInput.addEventListener('change', () => loadDate(root, dateInput.value));
    root.addEventListener('click', async (event) => {
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
