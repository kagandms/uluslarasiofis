const RESULT_CARD_TEMPLATE = `
    <div class="tebligat-result-card" style="background: var(--bg-color); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; margin-bottom: 10px; display: flex; flex-direction: column; gap: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
            <div class="tebligat-result-name" style="font-weight: 600; font-size: 1.1rem; color: var(--text-primary); flex: 1;"></div>
            <div class="tebligat-actions" style="display: flex; gap: 6px;">
                <button class="btn btn-outline btn-mark-tebligat" style="padding: 4px 8px; font-size: 0.85rem; border-radius: 6px; display: flex; align-items: center; gap: 4px; transition: all 0.2s;" title="İşaretle"></button>
                <button class="btn btn-outline btn-unmark-tebligat" style="display: none; padding: 4px 8px; font-size: 0.85rem; border-radius: 6px; align-items: center; gap: 4px; border-color: #e74c3c; color: #e74c3c; background-color: rgba(231, 76, 60, 0.1); cursor: pointer; transition: all 0.2s;" title="İşareti Kaldır">
                    <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    Kaldır
                </button>
            </div>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.95rem; color: var(--text-secondary);">
            <span class="tebligat-result-page" style="display: flex; align-items: center; gap: 4px;">
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                <span></span>
            </span>
            <span class="tebligat-result-number" style="font-weight: 600; color: var(--accent); background: rgba(33, 150, 243, 0.1); padding: 4px 8px; border-radius: 12px;"></span>
        </div>
    </div>`;

const MARK_BUTTON_TEMPLATE = '<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
const MARKED_BUTTON_TEMPLATE = '<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><polyline points="20 6 9 17 4 12"></polyline></svg>';

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function appendHighlightedName(target, name, query) {
    const words = String(query || '').trim().split(/\s+/).filter(Boolean);
    const patterns = words.map((word) => new RegExp(escapeRegExp(word), 'giu'));
    const matches = [];
    for (const pattern of patterns) {
        for (const match of name.matchAll(pattern)) {
            matches.push({ start: match.index, end: match.index + match[0].length });
        }
    }

    matches.sort((left, right) => left.start - right.start || right.end - left.end);
    const ranges = [];
    for (const match of matches) {
        const previous = ranges.at(-1);
        if (previous && match.start <= previous.end) {
            previous.end = Math.max(previous.end, match.end);
            continue;
        }
        ranges.push({ ...match });
    }

    let cursor = 0;
    for (const range of ranges) {
        target.append(target.ownerDocument.createTextNode(name.slice(cursor, range.start)));
        const mark = target.ownerDocument.createElement('mark');
        mark.style.cssText = 'background-color: rgba(33, 150, 243, 0.2); color: var(--accent); padding: 0 2px; border-radius: 3px; background-image: none;';
        mark.textContent = name.slice(range.start, range.end);
        target.append(mark);
        cursor = range.end;
    }
    target.append(target.ownerDocument.createTextNode(name.slice(cursor)));
}

/**
 * Creates a tebligat result card while keeping record values in text and dataset properties.
 * @param {{document: Document, record: Record<string, unknown>, query: string, isMarked: boolean}} options
 * @returns {HTMLElement}
 */
export function createTebligatResultCard({ document, record, query, isMarked }) {
    const template = document.createElement('template');
    template.innerHTML = RESULT_CARD_TEMPLATE;
    const card = template.content.firstElementChild;
    const name = String(record.isim ?? '');
    const page = String(record.sayfa ?? '');
    const number = record.no === undefined || record.no === null ? '' : String(record.no);

    card.dataset.sayfa = page;
    card.dataset.isim = name;
    card.dataset.no = number;
    appendHighlightedName(card.querySelector('.tebligat-result-name'), name, query);

    if (record._isFuzzy) {
        const badge = document.createElement('span');
        badge.className = 'tebligat-fuzzy-badge';
        badge.style.cssText = 'background: rgba(243, 156, 18, 0.15); color: #d35400; font-size: 0.72rem; font-weight: 600; padding: 2px 7px; border-radius: 6px; margin-left: 8px; display: inline-flex; align-items: center; gap: 3px; vertical-align: middle;';
        badge.textContent = '~ Benzer';
        card.querySelector('.tebligat-result-name').after(badge);
    }

    card.querySelector('.tebligat-result-page span').textContent = `Sayfa: ${page}`;
    card.querySelector('.tebligat-result-number').textContent = `No: ${number || '-'}`;

    const markButton = card.querySelector('.btn-mark-tebligat');
    markButton.innerHTML = `${isMarked ? MARKED_BUTTON_TEMPLATE : MARK_BUTTON_TEMPLATE}${isMarked ? ' İşaretlendi' : ' İşaretle'}`;
    markButton.classList.toggle('marked', isMarked);
    markButton.disabled = isMarked;
    markButton.style.cssText += isMarked
        ? 'border-color: #27ae60; color: #27ae60; background-color: rgba(39, 174, 96, 0.1); cursor: default;'
        : 'border-color: var(--card-border); color: var(--text-secondary); cursor: pointer;';
    card.querySelector('.btn-unmark-tebligat').style.display = isMarked ? 'flex' : 'none';
    return card;
}
