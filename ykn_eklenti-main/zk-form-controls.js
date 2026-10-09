(() => {
    if (window.YknZkForm?.version === '1.2.93') return;
    const confirmedSelections = new WeakMap();
    const attemptedSelections = new Set();

    function normalizeLabel(value) {
        return String(value || '').toLocaleLowerCase('tr-TR').normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').trim();
    }

    function isVisible(control) {
        if (!control?.isConnected || control.disabled) return false;
        for (let ancestor = control; ancestor; ancestor = ancestor.parentElement) {
            const style = ancestor.ownerDocument.defaultView.getComputedStyle(ancestor);
            if (ancestor.hidden || ancestor.getAttribute('aria-hidden') === 'true'
                || style.display === 'none' || style.visibility === 'hidden') return false;
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
                const widget = targetWindow.zk?.Widget?.$(radio)
                    || targetWindow.zk?.Widget?.$(radio.closest('.z-radio'));
                candidates.push({ radio, widget, targetWindow });
            }
        }
        return candidates.length === 1 ? candidates[0] : null;
    }

    function isBusy(targetWindow) {
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
            if (options.action === 'waitForIdle') return await waitForIdle();
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

    window.YknZkForm = Object.freeze({ version: '1.2.93', execute });
})();
