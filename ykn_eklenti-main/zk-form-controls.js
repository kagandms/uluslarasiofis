(() => {
    if (window.YknZkForm?.version === '1.2.102') return;
    const confirmedSelections = new WeakMap();
    const attemptedSelections = new Set();
    const COUNTRY_ALIAS_GROUPS = [
        ['afghanistan', 'afganistan'],
        ['albania', 'arnavutluk'],
        ['azerbaijan', 'azerbaycan'],
        ['bosniaandherzegovina', 'bosnahersek'],
        ['bulgaria', 'bulgaristan'],
        ['china', 'cin'],
        ['croatia', 'hirvatistan'],
        ['egypt', 'misir'],
        ['georgia', 'gurcistan'],
        ['greece', 'yunanistan'],
        ['india', 'hindistan'],
        ['iran', 'iran'],
        ['iraq', 'irak'],
        ['kazakhstan', 'kazakistan'],
        ['kyrgyzstan', 'kirgizistan'],
        ['lebanon', 'lubnan'],
        ['libya', 'libya'],
        ['morocco', 'fas'],
        ['nigeria', 'nijerya'],
        ['northmacedonia', 'kuzeymakedonya'],
        ['pakistan', 'pakistan'],
        ['palestine', 'filistin'],
        ['romania', 'romanya'],
        ['russia', 'rusya'],
        ['saudiarabia', 'suudiarabistan'],
        ['somalia', 'somali'],
        ['sudan', 'sudan'],
        ['syria', 'suriye'],
        ['tajikistan', 'tacikistan'],
        ['turkmenistan', 'turkmenistan'],
        ['ukraine', 'ukrayna'],
        ['unitedarabemirates', 'birlesikarapemirlikleri'],
        ['unitedkingdom', 'birlesikkrallik'],
        ['unitedstates', 'amerika'],
        ['uzbekistan', 'ozbekistan'],
        ['yemen', 'yemen'],
        ['zimbabwe', 'zimbabwe']
    ];

    const COUNTRY_FIELDS = Object.freeze({
        nationality: ['Uyruğu', 'Nationality'],
        birthNationality: ['Doğum Uyruğu', 'Birth Nationality'],
        birthCountry: ['Doğum Yeri Ülkesi', 'Birth Country', 'Born Country'],
        issuerCountry: ['Belgeyi Veren Ülke', 'Document Issuing Country']
    });

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

    function resolveButtonRoot(candidate) {
        return candidate?.querySelector?.('table.z-button')
            || candidate?.closest('table.z-button')
            || candidate?.closest('button, input[type="button"], input[type="submit"], .z-button, .z-toolbarbutton, .z-button-os, .form-btn, a, [role="button"]')
            || candidate?.closest('[class*="z-button"]:not([class*="z-button-"])')
            || candidate;
    }

    function findAcceptanceControls(expectedCode = '') {
        const inputSelector = 'input:not([type="button"]):not([type="submit"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"])';
        const clickableSelector = 'button, a, input[type="button"], input[type="submit"], [role="button"], .z-button, .z-toolbarbutton, [class*="z-button"]';
        const expectedNorm = normalizeCompact(expectedCode);
        for (const targetDocument of collectDocuments()) {
            const targetWindow = targetDocument.defaultView;
            if (!targetWindow) continue;
            const inputs = Array.from(targetDocument.querySelectorAll(inputSelector)).filter((input) => !input.readOnly && isVisible(input));
            let idInput = expectedNorm
                ? inputs.find((input) => !input.closest('.z-grid-body, .z-listbox-body') && normalizeCompact(input.value) === expectedNorm)
                : null;
            if (!idInput) {
                idInput = inputs.find((input) => {
                    if (input.closest('.z-grid-body, .z-listbox-body')) return false;
                    const meta = normalizeCompact([input.placeholder, input.getAttribute('placeholder'), input.title, input.name, input.id, input.labels?.[0]?.textContent].join(' '));
                    const isChdextr = /(?:-|_)chdextr$/i.test(input.id || '');
                    return (isChdextr || meta.includes('kabul')) && !meta.includes('pasaport') && !meta.includes('tc') && !meta.includes('dogum') && !meta.includes('tarih');
                });
            }
            if (!idInput) {
                const textNodes = targetDocument.querySelectorAll('span, td, div, label, b, strong, th, p, a, legend, caption, .z-caption, .z-groupbox-header');
                for (const node of textNodes) {
                    if (node.children.length > 3 || !isVisible(node)) continue;
                    const txt = normalizeCompact(node.innerText || node.textContent || '');
                    if (!txt.includes('kabul') || txt.includes('kabultarih')
                        || (!txt.includes('id') && !txt.includes('sorgula') && !txt.includes('mektup') && !txt.includes('kod') && !txt.includes('no'))) {
                        continue;
                    }
                    const td = node.closest('td');
                    if (td?.nextElementSibling) {
                        const siblingInput = Array.from(td.nextElementSibling.querySelectorAll(inputSelector)).find((input) => !input.readOnly && isVisible(input));
                        if (siblingInput) {
                            idInput = siblingInput;
                            break;
                        }
                    }
                    const box = node.closest('.z-groupbox, .z-panel, fieldset, table, form, div.z-window') || node.parentElement;
                    if (box) {
                        const boxInput = Array.from(box.querySelectorAll(inputSelector)).find((input) => {
                            if (input.readOnly || !isVisible(input)) return false;
                            const meta = normalizeCompact([input.placeholder, input.getAttribute('placeholder'), input.title, input.name, input.id].join(' '));
                            return !meta.includes('pasaport') && !meta.includes('tc') && !meta.includes('dogum') && !meta.includes('tarih');
                        });
                        if (boxInput) {
                            idInput = boxInput;
                            break;
                        }
                    }
                }
            }
            if (!idInput) {
                for (const row of targetDocument.querySelectorAll('tr, .z-row, .form-row, .z-hbox, .z-vbox')) {
                    if (!isVisible(row)) continue;
                    const text = normalizeCompact(row.textContent || '');
                    if (!text.includes('kabul') || !text.includes('id') || text.includes('tarih')) continue;
                    idInput = Array.from(row.querySelectorAll(inputSelector)).find((input) => !input.readOnly && isVisible(input)) || null;
                    if (idInput) break;
                }
            }
            if (!idInput) continue;

            const scoreButton = (candidate) => {
                if (!isVisible(candidate) || candidate.closest('.z-menu, .z-menuitem, .z-menu-item, .z-menupopup, .z-caption, .z-tab, nav')) return -1;
                const root = resolveButtonRoot(candidate);
                if (!isVisible(root)) return -1;
                const text = normalizeCompact(root.innerText || root.textContent || root.value || root.getAttribute?.('aria-label') || root.getAttribute?.('title') || '');
                if (!text || text.length > 60 || text.includes('pasaport') || text.includes('belge') || text.includes('tckimlik')
                    || text.includes('temizle') || text.includes('kaydet') || text.includes('iptal') || text.includes('vazgec')) return -1;
                const hasKabul = text.includes('kabul');
                if (!hasKabul) return -1;
                const hasAra = text.includes('ara');
                const hasSorgula = text.includes('sorgula');
                const hasGetir = text.includes('getir');
                if (!hasAra && !hasSorgula && !hasGetir) return -1;
                let score = 0;
                if (hasKabul && hasAra) score += 220;
                else if (hasKabul && (hasSorgula || hasGetir)) score += 180;
                else if (hasKabul) score += 100;
                if (text.includes('mektup')) score += 30;
                if (text.includes('id')) score += 20;
                if (root.tagName !== 'A') score += 25;
                if (idInput.compareDocumentPosition(root) & Node.DOCUMENT_POSITION_FOLLOWING) score += 30;
                return score;
            };

            let searchBtn = null;
            let bestScore = 0;
            const rowScope = idInput.closest('tr, .z-row, .form-row, .z-hbox, .z-vbox');
            if (rowScope) {
                for (let sib = rowScope, hop = 0; sib && hop < 4; sib = sib.nextElementSibling, hop += 1) {
                    for (const candidate of sib.querySelectorAll(clickableSelector)) {
                        const score = scoreButton(candidate);
                        if (score > bestScore) {
                            bestScore = score;
                            searchBtn = resolveButtonRoot(candidate);
                        }
                    }
                    if (bestScore >= 200) break;
                }
            }
            for (let scope = rowScope || idInput.parentElement, depth = 0;
                scope && scope !== targetDocument.body && depth < 12 && bestScore < 200; scope = scope.parentElement, depth += 1) {
                for (const candidate of scope.querySelectorAll(clickableSelector)) {
                    const score = scoreButton(candidate);
                    if (score > bestScore) {
                        bestScore = score;
                        searchBtn = resolveButtonRoot(candidate);
                    }
                }
            }
            if (!searchBtn) {
                for (const candidate of targetDocument.querySelectorAll(clickableSelector)) {
                    const score = scoreButton(candidate);
                    if (score >= 180 && score > bestScore) {
                        bestScore = score;
                        searchBtn = resolveButtonRoot(candidate);
                    }
                }
            }
            return { idInput, searchBtn, targetWindow };
        }
        return null;
    }

    function findResetControl() {
        const clickableSelector = 'button, .z-button, [class*="z-button"], a, input[type="button"], [role="button"], table.z-button';
        for (const targetDocument of collectDocuments()) {
            const targetWindow = targetDocument.defaultView;
            if (!targetWindow) continue;
            const clickables = Array.from(targetDocument.querySelectorAll(clickableSelector)).filter(isVisible);
            let kaydetBtn = null;
            for (const c of clickables) {
                const txt = normalizeCompact(c.innerText || c.textContent || c.value || c.getAttribute?.('title') || '');
                if (txt === 'kaydet' || txt.startsWith('kaydet')) {
                    kaydetBtn = resolveButtonRoot(c);
                    break;
                }
            }
            if (kaydetBtn) {
                for (let parent = kaydetBtn.parentElement, depth = 0; parent && parent !== targetDocument.body && depth < 8; depth += 1, parent = parent.parentElement) {
                    const parentTxt = normalizeCompact(parent.innerText || parent.textContent || '');
                    if (parentTxt.includes('excel')) break;
                    for (const c of parent.querySelectorAll(clickableSelector)) {
                        if (c === kaydetBtn || kaydetBtn.contains(c) || !isVisible(c)) continue;
                        const cTxt = normalizeCompact(c.innerText || c.textContent || c.value || c.getAttribute?.('title') || '');
                        if (cTxt === 'temizle') {
                            return { resetBtn: resolveButtonRoot(c), targetWindow };
                        }
                    }
                }
            }
            for (const c of clickables) {
                const txt = normalizeCompact(c.innerText || c.textContent || c.value || c.getAttribute?.('title') || '');
                if (txt !== 'temizle' && txt !== 'yenikayit') continue;
                const root = resolveButtonRoot(c);
                let isFilterBar = false;
                for (let anc = root.parentElement, hop = 0; anc && anc !== targetDocument.body && hop < 4; anc = anc.parentElement, hop += 1) {
                    const ancTxt = normalizeCompact(anc.innerText || anc.textContent || '');
                    if (ancTxt.includes('excel') || ancTxt.includes('yil') || ancTxt.includes('ykn')) {
                        isFilterBar = true;
                        break;
                    }
                }
                if (!isFilterBar) {
                    return { resetBtn: root, targetWindow };
                }
            }
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
        // ZK retains deferred, ignorable window events until the next real AU action.
        // Waiting for those events before allowing that action deadlocks serial transfers.
        return desktops.some((desktop) => (targetWindow.zAu?.getAuRequests?.(desktop) || [])
            .some(request => !(request.opts?.defer === true && request.opts?.ignorable === true)));
    }

    function isActivelyProcessing(targetWindow) {
        if (!targetWindow) return false;
        const zk = targetWindow.zk;
        return Boolean(zk?.processing || zk?.mounting || zk?.loading > 0 || targetWindow.zAu?.processing?.());
    }

    function waitForIdle() {
        if (collectDocuments().every((targetDocument) => !isBusy(targetDocument.defaultView))) {
            return Promise.resolve({ success: true });
        }
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

    function waitForActiveProcessing(timeoutMs = 2_500) {
        if (collectDocuments().every((targetDocument) => !isActivelyProcessing(targetDocument.defaultView))) {
            return Promise.resolve({ success: true });
        }
        const deadline = Date.now() + timeoutMs;
        return new Promise((resolve) => {
            const timer = setInterval(() => {
                if (collectDocuments().every((targetDocument) => !isActivelyProcessing(targetDocument.defaultView))
                    || Date.now() >= deadline) {
                    clearInterval(timer);
                    resolve({ success: true });
                }
            }, 20);
        });
    }

    // A single MAIN-world owner prevents a fast reset response from causing a second click.
    async function resetStudentForm(options) {
        await waitForIdle();
        const resetKey = `reset:${options.requestId || ''}`;
        if (!options.requestId || attemptedSelections.has(resetKey)) return { success: false, resetPerformed: false };
        const control = findResetControl();
        if (!control) return { success: false, resetPerformed: false };
        const widget = findZkWidget(control.resetBtn, control.targetWindow);
        const observer = widget?.fire ? observeResponse(control.targetWindow) : null;
        attemptedSelections.add(resetKey);
        if (attemptedSelections.size > 100) attemptedSelections.delete(attemptedSelections.values().next().value);
        try {
            if (widget?.fire) widget.fire('onClick', null, { toServer: true });
            if (!widget?.fire) control.resetBtn.click();
            if (observer) await waitForResponse(observer);
            await waitForIdle();
            return { success: true, resetPerformed: true };
        } finally { observer?.dispose(); }
    }

    async function settleAndSyncSearch(options = {}) {
        const isSearchAction = Boolean(options.syncSearchInput || options.triggerSearchClick || options.resetStudentForm || options.kabulId || ('triggerSearchClick' in options));
        if (!isSearchAction) {
            return await waitForIdle();
        }
        await waitForActiveProcessing();

        if (options.resetStudentForm) return await resetStudentForm(options);

        const controls = findAcceptanceControls(options.kabulId);
        if (!controls?.targetWindow?.zk?.Widget?.$) return { success: true };
        const { idInput, searchBtn, targetWindow } = controls;
        const code = String(idInput?.value || options.kabulId || '').trim();
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
            await new Promise((resolve) => setTimeout(resolve, 15));
            await waitForActiveProcessing();
        }

        if (options.triggerSearchClick && searchBtn) {
            const attemptKey = options.requestId ? `search:${options.requestId}` : '';
            if (!attemptKey || !attemptedSelections.has(attemptKey)) {
                let sawResponse = false;
                const listener = { onResponse() { sawResponse = true; } };
                try { targetWindow.zWatch?.listen?.({ onResponse: listener }); } catch { /* Optional */ }
                try {
                    if (!isActivelyProcessing(targetWindow)) {
                        await new Promise((resolve) => setTimeout(resolve, 15));
                    }
                    if (!isActivelyProcessing(targetWindow) && !sawResponse) {
                        if (attemptKey) {
                            attemptedSelections.add(attemptKey);
                            if (attemptedSelections.size > 100) attemptedSelections.delete(attemptedSelections.values().next().value);
                        }
                        if (code && inputWidget) {
                            try {
                                const needsChange = inputWidget._value !== code;
                                if (typeof inputWidget.setValue === 'function') inputWidget.setValue(code);
                                inputWidget._value = code;
                                inputWidget._lastValue = code;
                                if (needsChange && typeof inputWidget.fire === 'function') {
                                    inputWidget.fire('onChange', { value: code }, { toServer: true });
                                }
                            } catch { /* Ignore */ }
                        }
                        const buttonWidget = findZkWidget(searchBtn, targetWindow);
                        if (buttonWidget && typeof buttonWidget.fire === 'function') {
                            buttonWidget.fire('onClick', null, { toServer: true });
                            await new Promise((resolve) => setTimeout(resolve, 20));
                        }
                    }
                } finally {
                    try { targetWindow.zWatch?.unlisten?.({ onResponse: listener }); } catch { /* Optional */ }
                }
                await waitForActiveProcessing();
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
                    reject(new Error('YÖKSİS seçimi sunucu yanıtıyla doğrulanamadı.'));
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

    function readCountryVariants(value) {
        const normalized = normalizeCompact(value);
        return COUNTRY_ALIAS_GROUPS.find(aliases => aliases.includes(normalized)) || [normalized];
    }

    function findCountryOption(select, value) {
        const variants = readCountryVariants(value).filter(Boolean);
        if (!variants.length) return null;
        const options = Array.from(select.options).filter(option => !option.disabled && option.value && normalizeCompact(option.text));
        const matches = options.filter(option => variants.some(candidate =>
            readCountryVariants(option.text).includes(candidate) || normalizeCompact(option.value) === candidate));
        return matches.length === 1 ? matches[0] : null;
    }

    function findCountry(options) {
        const labels = COUNTRY_FIELDS[options.field];
        if (!labels || !window.YknFieldTargets?.find) return null;
        const candidates = collectDocuments().map(root => window.YknFieldTargets.find({ root, labels, kind: 'select' })).filter(Boolean);
        if (candidates.length !== 1) return null;
        const select = candidates[0];
        const targetWindow = select.ownerDocument.defaultView;
        const widget = targetWindow?.zk?.Widget?.$(select);
        const option = findCountryOption(select, options.value);
        if (!option || (targetWindow?.zk && widget?.className !== 'zul.sel.Select')) return null;
        return { select, option, widget, targetWindow };
    }

    function hasCountryWidgetSelection(target) {
        if (!target.widget) return true;
        const selectedIndex = target.widget.getSelectedIndex?.();
        let optionIndex = 0;
        for (let child = target.widget.firstChild; child; child = child.nextSibling) {
            const isOption = child.className === 'zul.sel.Option' || (target.targetWindow.zul?.sel?.Option
                && child.$instanceof?.(target.targetWindow.zul.sel.Option));
            if (!isOption) continue;
            if (optionIndex === selectedIndex) return child.uuid === target.option.id;
            optionIndex += 1;
        }
        return false;
    }

    function isCountrySelectionRetained(target) {
        if (!target || target.select.options[target.select.selectedIndex] !== target.option) return false;
        const scope = target.select.closest('td, .z-cell, label') || target.select.parentElement;
        return hasCountryWidgetSelection(target) && !scope?.querySelector('.z-errorbox, [aria-invalid="true"]');
    }

    function commitCountry(target) {
        const { select, option, widget, targetWindow } = target;
        if (widget && (!option.id || !widget._doChange || !widget.getSelectedIndex || !widget.fire)) {
            throw new Error('YÖKSİS ülke seçimi güvenilir biçimde gönderilemiyor.');
        }
        select.value = option.value;
        option.selected = true;
        if (!widget) {
            for (const name of ['input', 'change', 'blur']) select.dispatchEvent(new targetWindow.Event(name, { bubbles: true }));
            return;
        }
        const previousIndex = widget.getSelectedIndex();
        // Use the live Select handler to keep option/widget indices in sync, including hidden options.
        widget._doChange();
        if (widget.getSelectedIndex() === previousIndex) {
            // A DOM selection left by an earlier attempt still needs its first confirmed server event.
            widget.fire('onSelect', { items: [option.id], reference: option.id }, { toServer: true });
        }
    }

    async function selectCountry(options) {
        await waitForIdle();
        const target = findCountry(options);
        if (!target || !options.requestId) return { success: false, verified: false };
        const identity = target.widget || target.select;
        if (confirmedSelections.get(identity) === options.requestId && isCountrySelectionRetained(target)) {
            return { success: true, verified: true, eventSent: false };
        }
        const attemptKey = `${options.requestId}:country:${options.field}`;
        if (attemptedSelections.has(attemptKey)) return { success: false, verified: false, eventSent: false };
        const observer = target.widget ? observeResponse(target.targetWindow) : null;
        attemptedSelections.add(attemptKey);
        if (attemptedSelections.size > 100) attemptedSelections.delete(attemptedSelections.values().next().value);
        try {
            commitCountry(target);
            if (observer) await waitForResponse(observer);
            await waitForIdle();
            const refreshed = findCountry(options);
            const verified = isCountrySelectionRetained(refreshed);
            if (verified) {
                confirmedSelections.set(refreshed.widget || refreshed.select, options.requestId);
                attemptedSelections.delete(attemptKey);
            }
            return { success: verified, verified, eventSent: true };
        } finally { observer?.dispose(); }
    }

    async function verifyCountry(options) {
        await waitForIdle();
        const target = findCountry(options);
        const verified = Boolean(target && options.requestId
            && confirmedSelections.get(target.widget || target.select) === options.requestId && isCountrySelectionRetained(target));
        return { success: verified, verified };
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
            if (options.action === 'selectCountry') return await selectCountry(options);
            if (options.action === 'verifyCountry') return await verifyCountry(options);
            return { success: false, verified: false };
        } catch (error) {
            console.warn('[YKN] ZK operation could not be verified.', { action: options.action, errorName: error?.name || 'Error' });
            return { success: false, verified: false, error: 'YÖKSİS seçimi veya sunucu güncellemesi doğrulanamadı.' };
        }
    }

    window.YknZkForm = Object.freeze({ version: '1.2.102', execute });
})();
