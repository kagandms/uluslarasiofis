(() => {
    if (window.YknZkForm?.version === '1.2.95') return;
    const confirmedSelections = new WeakMap();
    const attemptedSelections = new Set();

    function normalizeLabel(value) {
        return String(value || '').toLocaleLowerCase('tr-TR').normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').trim();
    }

    function normalizeCompact(value) {
        return normalizeLabel(value)
            .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c')
            .replace(/[^a-z0-9]/g, '');
    }

    function isVisible(control) {
        if (!control?.isConnected || control.disabled) return false;
        for (let ancestor = control; ancestor; ancestor = ancestor.parentElement) {
            const style = ancestor.ownerDocument?.defaultView?.getComputedStyle?.(ancestor);
            if (ancestor.hidden || ancestor.getAttribute('aria-hidden') === 'true'
                || style?.display === 'none' || style?.visibility === 'hidden') return false;
        }
        return true;
    }

    function collectDocuments(root = document) {
        const documents = [root];
        for (const frame of root.querySelectorAll('iframe, frame')) {
            try {
                if (frame.contentDocument) documents.push(...collectDocuments(frame.contentDocument));
            } catch { /* Cross-origin frames are outside the permitted target form. */ }
        }
        return documents;
    }

    function findZkWidget(element, targetWindow) {
        if (!element || !targetWindow?.zk?.Widget?.$) return null;
        for (let current = element, depth = 0; current && depth < 6; current = current.parentElement, depth += 1) {
            try {
                const widget = targetWindow.zk.Widget.$(current);
                if (widget) return widget;
            } catch { /* Continue walking ancestors */ }
        }
        const nested = element.querySelector?.('table.z-button, .z-button, button, input');
        if (nested) {
            try {
                return targetWindow.zk.Widget.$(nested);
            } catch { /* Ignore */ }
        }
        return null;
    }

    function findAcceptanceControls() {
        const inputSelector = 'input:not([type="button"]):not([type="submit"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"])';
        const clickableSelector = 'button, a, input[type="button"], input[type="submit"], [role="button"], .z-button, .z-toolbarbutton, [class*="z-button"]';
        for (const targetDocument of collectDocuments()) {
            const targetWindow = targetDocument.defaultView;
            if (!targetWindow) continue;
            const inputs = Array.from(targetDocument.querySelectorAll(inputSelector)).filter((input) => !input.readOnly && isVisible(input));
            let idInput = inputs.find((input) => {
                if (input.closest('.z-grid-body, .z-listbox-body')) return false;
                const meta = normalizeCompact([input.placeholder, input.getAttribute('placeholder'), input.title, input.name, input.id, input.labels?.[0]?.textContent].join(' '));
                const isChdextr = /(?:-|_)chdextr$/i.test(input.id || '');
                return (isChdextr || meta.includes('kabul')) && !meta.includes('pasaport') && !meta.includes('tc') && !meta.includes('dogum') && !meta.includes('tarih');
            });
            if (!idInput) {
                for (const row of targetDocument.querySelectorAll('tr, .z-row, .form-row')) {
                    if (!isVisible(row)) continue;
                    const text = normalizeCompact(row.textContent || '');
                    if (!text.includes('kabul') || !text.includes('id') || text.includes('tarih')) continue;
                    idInput = Array.from(row.querySelectorAll(inputSelector)).find((input) => !input.readOnly && isVisible(input)) || null;
                    if (idInput) break;
                }
            }
            if (!idInput) continue;

            const resolveRoot = (candidate) => candidate?.querySelector?.('table.z-button')
                || candidate?.closest('table.z-button')
                || candidate?.closest('button, input[type="button"], input[type="submit"], .z-button, .z-toolbarbutton, .z-button-os, .form-btn, a, [role="button"]')
                || candidate?.closest('[class*="z-button"]:not([class*="z-button-"])')
                || candidate;
            const scoreButton = (candidate) => {
                if (!isVisible(candidate) || candidate.closest('.z-menu, .z-menuitem, .z-menu-item, .z-menupopup, .z-caption, .z-tab, nav')) return -1;
                const root = resolveRoot(candidate);
                if (!isVisible(root)) return -1;
                const text = normalizeCompact(root.innerText || root.textContent || root.value || root.getAttribute?.('aria-label') || root.getAttribute?.('title') || '');
                if (!text || text.length > 60 || text.includes('pasaport') || text.includes('belgeno') || text.includes('tckimlik')
                    || text.includes('temizle') || text.includes('kaydet') || text.includes('iptal') || text.includes('vazgec')) return -1;
                const hasKabul = text.includes('kabul');
                const hasAra = text.includes('ara');
                const hasSorgula = text.includes('sorgula');
                const hasGetir = text.includes('getir');
                if (!hasAra && !hasSorgula && !hasGetir && !hasKabul) return -1;
                let score = 0;
                if (hasKabul && hasAra) score += 220;
                else if (hasKabul && (hasSorgula || hasGetir)) score += 180;
                else if (hasAra) score += 80;
                else if (hasSorgula) score += 70;
                else if (hasGetir) score += 40;
                if (text.includes('mektup')) score += 30;
                if (text.includes('id')) score += 20;
                if (root.tagName !== 'A') score += 25;
                if (idInput.compareDocumentPosition(root) & Node.DOCUMENT_POSITION_FOLLOWING) score += 30;
                return score;
            };

            let searchBtn = null;
            let bestScore = 0;
            for (let scope = idInput.closest('tr, .z-row, .form-row') || idInput.parentElement, depth = 0;
                scope && scope !== targetDocument.body && depth < 12; scope = scope.parentElement, depth += 1) {
                for (const candidate of scope.querySelectorAll(clickableSelector)) {
                    const score = scoreButton(candidate);
                    if (score > bestScore) {
                        bestScore = score;
                        searchBtn = resolveRoot(candidate);
                    }
                }
                if (bestScore >= 200) break;
            }
            if (!searchBtn) {
                for (const candidate of targetDocument.querySelectorAll(clickableSelector)) {
                    const score = scoreButton(candidate);
                    if (score >= 180 && score > bestScore) {
                        bestScore = score;
                        searchBtn = resolveRoot(candidate);
                    }
                }
            }
            return { idInput, searchBtn, targetWindow };
        }
        return null;
    }

    function getRadioLabel(radio) {
        const label = radio.labels?.[0] || radio.closest('label')
            || radio.closest('.z-radio')?.querySelector('label, .z-radio-cnt, .z-radio-content');
        return normalizeLabel(label?.textContent || '');
    }

    function getFieldOptions(field) {
        if (field === 'gender') return [['erkek', 'male'], ['kadin', 'female']];
        if (field === 'marital') return [['bekar', 'single'], ['evli', 'married']];
        return [];
    }

    function findRadio(options) {
        const choices = getFieldOptions(options.field);
        const requested = choices.find((labels) => labels.includes(normalizeLabel(options.value)));
        if (!requested) return null;
        const candidates = [];
        for (const targetDocument of collectDocuments()) {
            for (const radio of targetDocument.querySelectorAll('input[type="radio"]')) {
                if (!isVisible(radio) || !requested.includes(getRadioLabel(radio))) continue;
                const scope = radio.closest('.z-radiogroup, tr, .z-row, fieldset');
                if (!scope) continue;
                const labels = Array.from(scope.querySelectorAll('input[type="radio"]')).map(getRadioLabel);
                if (!choices.every((aliases) => labels.some((label) => aliases.includes(label)))) continue;
                const targetWindow = targetDocument.defaultView;
                const widget = targetWindow?.zk?.Widget?.$(radio)
                    || targetWindow?.zk?.Widget?.$(radio.closest('.z-radio'));
                candidates.push({ radio, widget, targetWindow });
            }
        }
        return candidates.length === 1 ? candidates[0] : null;
    }

    function isBusy(targetWindow) {
        if (!targetWindow) return false;
        const zk = targetWindow.zk;
        if (zk?.processing || zk?.mounting || zk?.loading > 0 || targetWindow.zAu?.processing?.()) return true;
        const desktops = Object.values(zk?.Desktop?.all || {});
        return desktops.some((desktop) => targetWindow.zAu?.getAuRequests?.(desktop)?.length > 0);
    }

    function waitForIdle() {
        const deadline = Date.now() + 8_000;
        return new Promise((resolve, reject) => {
            const timer = setInterval(() => {
                if (collectDocuments().every((targetDocument) => !isBusy(targetDocument.defaultView))) {
                    clearInterval(timer);
                    resolve({ success: true });
                } else if (Date.now() >= deadline) {
                    clearInterval(timer);
                    reject(new Error('YÖKSİS güncellemesi tamamlanmadı; işlem durduruldu.'));
                }
            }, 25);
        });
    }

    async function settleAndSyncSearch(options = {}) {
        await waitForIdle();
        if (!options.syncSearchInput && !options.triggerSearchClick) return { success: true };
        const controls = findAcceptanceControls();
        if (!controls?.targetWindow?.zk?.Widget?.$) return { success: true };
        const { idInput, searchBtn, targetWindow } = controls;
        const code = String(idInput?.value || '').trim();
        const inputWidget = findZkWidget(idInput, targetWindow);

        if (options.syncSearchInput && code && inputWidget && inputWidget._value !== code) {
            try {
                if (typeof inputWidget.setValue === 'function') inputWidget.setValue(code);
                inputWidget._value = code;
                inputWidget._lastValue = code;
                if (typeof inputWidget.fire === 'function') {
                    inputWidget.fire('onChange', { value: code }, { toServer: true });
                }
            } catch { /* Ignore widget sync error and continue */ }
            await new Promise((resolve) => setTimeout(resolve, 35));
            await waitForIdle();
        }

        if (options.triggerSearchClick && searchBtn) {
            const attemptKey = options.requestId ? `search:${options.requestId}` : '';
            if (!attemptKey || !attemptedSelections.has(attemptKey)) {
                let sawResponse = false;
                const listener = { onResponse() { sawResponse = true; } };
                try { targetWindow.zWatch?.listen?.({ onResponse: listener }); } catch { /* Optional */ }
                try {
                    if (!isBusy(targetWindow)) {
                        await new Promise((resolve) => setTimeout(resolve, 35));
                    }
                    if (!isBusy(targetWindow) && !sawResponse) {
                        if (attemptKey) {
                            attemptedSelections.add(attemptKey);
                            if (attemptedSelections.size > 100) attemptedSelections.delete(attemptedSelections.values().next().value);
                        }
                        if (code && inputWidget) {
                            try {
                                if (typeof inputWidget.setValue === 'function') inputWidget.setValue(code);
                                inputWidget._value = code;
                                inputWidget._lastValue = code;
                            } catch { /* Ignore */ }
                        }
                        const buttonWidget = findZkWidget(searchBtn, targetWindow);
                        if (buttonWidget && typeof buttonWidget.fire === 'function') {
                            buttonWidget.fire('onClick', null, { toServer: true });
                            await new Promise((resolve) => setTimeout(resolve, 35));
                        }
                    }
                } finally {
                    try { targetWindow.zWatch?.unlisten?.({ onResponse: listener }); } catch { /* Optional */ }
                }
                await waitForIdle();
            }
        }
        return { success: true };
    }

    function observeResponse(targetWindow) {
        if (!targetWindow.zWatch?.listen || !targetWindow.zWatch?.unlisten) {
            throw new Error('YÖKSİS sunucu yanıtı doğrulanamıyor.');
        }
        let hasResponse = false;
        const listener = { onResponse() { hasResponse = true; } };
        targetWindow.zWatch.listen({ onResponse: listener });
        return {
            hasResponse: () => hasResponse,
            dispose: () => targetWindow.zWatch.unlisten({ onResponse: listener })
        };
    }

    function waitForResponse(observer) {
        const deadline = Date.now() + 8_000;
        return new Promise((resolve, reject) => {
            const timer = setInterval(() => {
                if (observer.hasResponse()) {
                    clearInterval(timer);
                    resolve();
                } else if (Date.now() >= deadline) {
                    clearInterval(timer);
                    reject(new Error('YÖKSİS radio seçimi sunucu yanıtıyla doğrulanamadı.'));
                }
            }, 25);
        });
    }

    function isSelectionRetained(target) {
        const group = target?.widget?.getRadiogroup?.();
        const hasSelection = target?.radio.checked && target.widget?.isChecked?.() === true
            && group?.getSelectedItem?.() === target.widget;
        const scope = target?.radio.closest('tr, .z-row, fieldset') || target?.radio.parentElement;
        return Boolean(hasSelection && !scope?.querySelector('.z-errorbox, [aria-invalid="true"]'));
    }

    function commitSelection(target) {
        const group = target.widget?.getRadiogroup?.();
        if (!group?.setSelectedItem || !group.getSelectedItem || !target.widget?.setChecked
            || !target.widget.isChecked || !target.widget.fireOnCheck_) {
            throw new Error('YÖKSİS radio grubu güvenilir biçimde seçilemiyor.');
        }
        group.setSelectedItem(target.widget);
        target.widget.setChecked(true);
        // ZK Radio.fireOnCheck_ performs the framework's normal radio/group notification.
        // https://github.com/zkoss/zk/blob/v9.6.0/zul/src/archive/web/js/zul/wgt/Radio.js
        target.widget.fireOnCheck_(true);
    }

    async function selectRadio(options) {
        await waitForIdle();
        const target = findRadio(options);
        if (!target) return { success: false, verified: false };
        const previous = confirmedSelections.get(target.widget);
        if (previous === options.requestId && options.requestId && isSelectionRetained(target)) {
            return { success: true, verified: true, eventSent: false };
        }
        const attemptKey = `${options.requestId}:${options.field}`;
        if (attemptedSelections.has(attemptKey)) return { success: false, verified: false, eventSent: false };
        const observer = observeResponse(target.targetWindow);
        attemptedSelections.add(attemptKey);
        if (attemptedSelections.size > 100) attemptedSelections.delete(attemptedSelections.values().next().value);
        try {
            commitSelection(target);
            await waitForResponse(observer);
            await waitForIdle();
            const refreshed = findRadio(options);
            const verified = isSelectionRetained(refreshed);
            if (verified && options.requestId) confirmedSelections.set(refreshed.widget, options.requestId);
            return { success: verified, verified, eventSent: true };
        } finally { observer.dispose(); }
    }

    /** Executes a bounded MAIN-world ZK operation without returning student values. */
    async function execute(options) {
        try {
            if (options.action === 'waitForIdle') return await settleAndSyncSearch(options);
            if (options.action === 'verifyRadio') {
                await waitForIdle();
                const target = findRadio(options);
                const verified = Boolean(target && options.requestId && confirmedSelections.get(target.widget) === options.requestId && isSelectionRetained(target));
                return { success: verified, verified };
            }
            if (options.action === 'selectRadio') return await selectRadio(options);
            return { success: false, verified: false };
        } catch {
            return { success: false, verified: false, error: 'YÖKSİS seçimi veya sunucu güncellemesi doğrulanamadı.' };
        }
    }

    window.YknZkForm = Object.freeze({ version: '1.2.95', execute });
})();
