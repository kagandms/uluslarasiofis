import { CHATBOT_MESSAGES } from './i18n/chatbot-messages.js';
import { INQUIRY_MESSAGES } from './i18n/inquiry-messages.js';
import { PUBLIC_MESSAGES, SESSION3_MESSAGES, SUPPORTED_LOCALES } from './i18n/messages.js';
import { createTopi, createTopiMouse, ensureTopiStyles, setTopiState } from './topiMascot.js';

export const CHATBOT_PILOT_QUERY_GATE = 'bot';

const CHAT_ENDPOINT = '/api/public/chat';
const MAX_MESSAGES_IN_REQUEST = 10;
const MAX_MESSAGE_LENGTH = 500;
const HELLO_DURATION_MS = 2400;
const REPLY_STATE_DURATION_MS = 4000;
const PANEL_CLOSE_FALLBACK_MS = 260;
const FOCUS_SCROLL_DELAY_MS = 250;
const MOBILE_MEDIA_QUERY = '(max-width: 600px)';
const MOBILE_OPEN_CLASS = 'chatbot-mobile-open';
const activeControllers = new WeakMap();

function normalizeLocale(locale) {
    const candidate = String(locale || '').trim().toLowerCase();
    return SUPPORTED_LOCALES.includes(candidate) ? candidate : 'tr';
}

function readChatbotMessages(locale) {
    return CHATBOT_MESSAGES[locale] || CHATBOT_MESSAGES.tr;
}

function resolveActionLabel(locale, labelKey) {
    const key = String(labelKey || '').trim();
    if (!key) return '';
    return CHATBOT_MESSAGES[locale]?.[key]
        ?? PUBLIC_MESSAGES[locale]?.[key]
        ?? SESSION3_MESSAGES[locale]?.[key]
        ?? INQUIRY_MESSAGES[locale]?.[key]
        ?? CHATBOT_MESSAGES.tr?.[key]
        ?? PUBLIC_MESSAGES.tr?.[key]
        ?? SESSION3_MESSAGES.tr?.[key]
        ?? INQUIRY_MESSAGES.tr?.[key]
        ?? key;
}

const SAFE_ACTION_HREF_PATTERN = /^\/(?![\/\\])[A-Za-z0-9\-._~\/?#=&%]*$/;

function resolveSafeHref(href, origin = globalThis.location?.origin) {
    if (typeof href !== 'string' || !origin || origin === 'null') return null;
    if (!SAFE_ACTION_HREF_PATTERN.test(href)) return null;
    try {
        const decoded = decodeURIComponent(href);
        if (decoded.includes('\\') || decoded.startsWith('//')) return null;
        const url = new URL(href, origin);
        if (url.origin !== origin || url.pathname.startsWith('//')) return null;
        return `${url.pathname}${url.search}${url.hash}`;
    } catch {
        return null;
    }
}

function resolveFetcher(document, customFetcher) {
    if (typeof customFetcher === 'function') return customFetcher;
    const view = document?.defaultView;
    if (typeof view?.fetch === 'function') return view.fetch.bind(view);
    if (typeof globalThis.fetch === 'function') return globalThis.fetch.bind(globalThis);
    return null;
}

function prefersReducedMotion(document) {
    return Boolean(document?.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
}

function isNarrowViewport(document) {
    const view = document?.defaultView;
    if (!view) return false;
    if (view.matchMedia?.(MOBILE_MEDIA_QUERY)?.matches) return true;
    return typeof view.innerWidth === 'number' && view.innerWidth > 0 && view.innerWidth <= 600;
}

function shouldAnimatePanel(document, animateOption) {
    if (prefersReducedMotion(document)) return false;
    if (animateOption === false) return false;
    const view = document?.defaultView;
    if (typeof view?.requestAnimationFrame !== 'function') return false;
    if (animateOption === true) return true;
    return (
        typeof view?.matchMedia === 'function'
        && ('ontransitionend' in view || typeof view?.TransitionEvent === 'function')
    );
}

function getFocusableElements(container) {
    const selector = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return [...container.querySelectorAll(selector)].filter(
        (element) => !element.hidden && !element.closest('[hidden]') && element.getAttribute('aria-hidden') !== 'true'
    );
}

function resolveReplyMascotState(actions) {
    if (!Array.isArray(actions)) return 'understood';
    if (actions.some((action) => action && typeof action === 'object' && action.type === 'inquiry')) {
        return 'handoff';
    }
    if (actions.some((action) => (
        action
        && typeof action === 'object'
        && (
            action.type === 'tracking'
            || (action.type === 'link' && action.label_key === 'chatbotOpenTracking')
        )
    ))) {
        return 'checking';
    }
    return 'understood';
}

/**
 * Mounts and manages the pilot home-page chatbot widget inside `#home-chatbot-root`.
 * Conversation state stays strictly in memory (no browser storage).
 * @param {{locale?: string, root?: Document, mountElement?: HTMLElement, fetcher?: typeof fetch, animate?: boolean}} [options]
 * @returns {{open: () => void, close: () => void, setLocale: (nextLocale: string) => void, destroy: () => void}|null}
 */
export function initHomeChatbot({ locale, root = globalThis.document, mountElement, fetcher, animate } = {}) {
    const document = mountElement?.ownerDocument || root;
    if (!document) return null;

    const mountTarget = mountElement || document.getElementById('home-chatbot-root');
    if (!mountTarget) return null;

    const existing = activeControllers.get(mountTarget);
    if (existing) existing.destroy();

    ensureTopiStyles(document);

    const reducedMotion = prefersReducedMotion(document);
    let activeLocale = normalizeLocale(locale || document.documentElement?.lang);
    let isOpen = false;
    let isSending = false;
    let destroyed = false;
    let hasValidationError = false;
    let hasGreeted = false;
    let mascotResetTimer = null;
    let focusScrollTimer = null;
    let openFrameId = null;
    let closeCleanup = null;
    let attachedViewport = null;
    let conversationHistory = [];
    const localizedLogBindings = [];

    const widgetRoot = document.createElement('div');
    widgetRoot.className = reducedMotion ? 'chatbot-root is-reduced-motion' : 'chatbot-root';

    const launcherDock = document.createElement('div');
    launcherDock.className = 'chatbot-launcher-dock';

    const launcherTagline = document.createElement('div');
    launcherTagline.className = 'chatbot-launcher-tagline';
    launcherTagline.setAttribute('aria-hidden', 'true');

    const launcherButton = document.createElement('button');
    launcherButton.type = 'button';
    launcherButton.id = 'home-chatbot-launcher';
    launcherButton.className = 'chatbot-launcher';
    launcherButton.setAttribute('aria-expanded', 'false');
    launcherButton.setAttribute('aria-controls', 'home-chatbot-panel');
    const launcherTopi = createTopi(document, { state: 'idle', size: 48 });
    const launcherText = document.createElement('span');
    launcherText.className = 'chatbot-launcher-text';
    const launcherMouse = reducedMotion ? null : createTopiMouse(document, { size: 22 });
    if (launcherMouse) {
        launcherButton.append(launcherTopi, launcherText, launcherMouse);
    } else {
        launcherButton.append(launcherTopi, launcherText);
    }
    launcherDock.append(launcherTagline, launcherButton);

    const panel = document.createElement('section');
    panel.id = 'home-chatbot-panel';
    panel.className = 'chatbot-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'chatbot-panel-title');
    panel.hidden = true;

    const header = document.createElement('div');
    header.className = 'chatbot-header';
    const headerBrand = document.createElement('div');
    headerBrand.className = 'chatbot-header-brand';
    const headerTopi = createTopi(document, { state: 'idle', size: 36 });
    const title = document.createElement('h2');
    title.id = 'chatbot-panel-title';
    title.className = 'chatbot-title';
    const titleName = document.createElement('span');
    titleName.className = 'chatbot-title-name';
    const titleSep = document.createElement('span');
    titleSep.className = 'chatbot-title-sep chatbot-sr-only';
    titleSep.textContent = ' · ';
    const titleText = document.createElement('span');
    titleText.className = 'chatbot-title-text';
    title.append(titleName, titleSep, titleText);
    headerBrand.append(headerTopi, title);
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'chatbot-close';
    closeButton.textContent = '✕';
    header.append(headerBrand, closeButton);

    const notice = document.createElement('p');
    notice.className = 'chatbot-notice';

    const log = document.createElement('div');
    log.className = 'chatbot-log';
    log.setAttribute('role', 'log');
    log.setAttribute('aria-live', 'polite');
    log.setAttribute('aria-relevant', 'additions');

    const chipsContainer = document.createElement('div');
    chipsContainer.className = 'chatbot-chips';
    chipsContainer.setAttribute('role', 'group');

    const chipDefinitions = [
        { key: 'chipDocuments', kind: 'query' },
        { key: 'chipStatus', kind: 'query' },
        { key: 'chipInquiry', kind: 'inquiry' }
    ];
    const chipButtons = chipDefinitions.map((definition) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'chatbot-chip';
        button.dataset.chipKind = definition.kind;
        button.dataset.chipKey = definition.key;
        chipsContainer.append(button);
        return button;
    });

    const composer = document.createElement('form');
    composer.className = 'chatbot-composer';
    composer.noValidate = true;

    const composerRow = document.createElement('div');
    composerRow.className = 'chatbot-composer-row';

    const inputLabel = document.createElement('label');
    inputLabel.className = 'chatbot-sr-only';
    inputLabel.htmlFor = 'chatbot-input';

    const input = document.createElement('textarea');
    input.id = 'chatbot-input';
    input.className = 'chatbot-input';
    input.name = 'message';
    input.rows = 2;

    const sendButton = document.createElement('button');
    sendButton.type = 'submit';
    sendButton.className = 'chatbot-send';

    composerRow.append(inputLabel, input, sendButton);

    const composerMeta = document.createElement('div');
    composerMeta.className = 'chatbot-composer-meta';

    const validationError = document.createElement('p');
    validationError.id = 'chatbot-validation-error';
    validationError.className = 'chatbot-validation-error';
    validationError.setAttribute('role', 'alert');
    validationError.hidden = true;

    const counter = document.createElement('span');
    counter.className = 'chatbot-counter';
    counter.textContent = `0 / ${MAX_MESSAGE_LENGTH}`;

    composerMeta.append(validationError, counter);
    composer.append(composerRow, composerMeta);

    panel.append(header, notice, log, chipsContainer, composer);
    widgetRoot.append(launcherDock, panel);
    mountTarget.replaceChildren(widgetRoot);
    mountTarget.dataset.chatbotInitialized = 'true';

    function scrollLogToBottom() {
        log.scrollTop = log.scrollHeight;
    }

    function clearMascotTimer() {
        if (mascotResetTimer !== null) {
            globalThis.clearTimeout(mascotResetTimer);
            mascotResetTimer = null;
        }
    }

    function clearFocusScrollTimer() {
        if (focusScrollTimer !== null) {
            globalThis.clearTimeout(focusScrollTimer);
            focusScrollTimer = null;
        }
    }

    function clearViewportProperties() {
        panel.style.removeProperty('--chatbot-vvh');
        panel.style.removeProperty('--chatbot-vvt');
    }

    function applyVisualViewportMetrics() {
        if (destroyed || !isOpen) return;
        const vv = document.defaultView?.visualViewport;
        if (!vv || !isNarrowViewport(document)) {
            clearViewportProperties();
            return;
        }
        if (typeof vv.height === 'number' && Number.isFinite(vv.height) && vv.height > 0) {
            panel.style.setProperty('--chatbot-vvh', `${vv.height}px`);
        }
        if (typeof vv.offsetTop === 'number' && Number.isFinite(vv.offsetTop)) {
            panel.style.setProperty('--chatbot-vvt', `${Math.max(0, vv.offsetTop)}px`);
        }
    }

    function detachViewportSync() {
        if (!attachedViewport) return;
        attachedViewport.removeEventListener?.('resize', applyVisualViewportMetrics);
        attachedViewport.removeEventListener?.('scroll', applyVisualViewportMetrics);
        attachedViewport = null;
    }

    function attachViewportSync() {
        const vv = document.defaultView?.visualViewport;
        if (!vv) {
            clearViewportProperties();
            return;
        }
        if (attachedViewport !== vv) {
            detachViewportSync();
            vv.addEventListener?.('resize', applyVisualViewportMetrics);
            vv.addEventListener?.('scroll', applyVisualViewportMetrics);
            attachedViewport = vv;
        }
        applyVisualViewportMetrics();
    }

    function handleInputFocus() {
        if (destroyed || !isOpen) return;
        clearFocusScrollTimer();
        focusScrollTimer = globalThis.setTimeout(() => {
            focusScrollTimer = null;
            if (destroyed || !isOpen) return;
            applyVisualViewportMetrics();
            if (isNarrowViewport(document)) {
                scrollLogToBottom();
                composer.scrollIntoView?.({ block: 'end' });
            }
        }, FOCUS_SCROLL_DELAY_MS);
    }

    function setMascotState(state) {
        const launcherState = (!isOpen && state !== 'thinking') ? 'idle' : state;
        setTopiState(headerTopi, state);
        setTopiState(launcherTopi, launcherState);
    }

    function scheduleMascotIdle(delayMs) {
        clearMascotTimer();
        mascotResetTimer = globalThis.setTimeout(() => {
            mascotResetTimer = null;
            if (!destroyed && !isSending) {
                setMascotState('idle');
            }
        }, delayMs);
    }

    function updateInputMeta() {
        const length = input.value.length;
        const overLimit = length > MAX_MESSAGE_LENGTH;
        counter.textContent = `${length} / ${MAX_MESSAGE_LENGTH}`;
        counter.classList.toggle('is-over-limit', overLimit);

        if (overLimit) {
            hasValidationError = true;
            validationError.textContent = readChatbotMessages(activeLocale).inputTooLong;
            validationError.hidden = false;
            input.setAttribute('aria-invalid', 'true');
            input.setAttribute('aria-describedby', 'chatbot-validation-error');
        } else {
            hasValidationError = false;
            validationError.hidden = true;
            validationError.textContent = '';
            input.removeAttribute('aria-invalid');
            input.removeAttribute('aria-describedby');
        }
    }

    function appendMessage({ role, text = '', textKey = '', actions = [], isError = false, mascotState = 'idle' }) {
        const wrapper = document.createElement('div');
        wrapper.className = `chatbot-message chatbot-message-${isError ? 'error' : role}`;

        const roleLabel = document.createElement('span');
        roleLabel.className = 'chatbot-sr-only';
        const roleKey = role === 'user' ? 'userRoleLabel' : 'assistantRoleLabel';
        roleLabel.textContent = `${readChatbotMessages(activeLocale)[roleKey]}: `;
        localizedLogBindings.push({ element: roleLabel, type: 'role', key: roleKey });

        const isAssistant = role !== 'user';
        const contentContainer = isAssistant ? document.createElement('div') : wrapper;
        if (isAssistant) {
            contentContainer.className = 'chatbot-message-body';
            const avatar = createTopi(document, { state: mascotState, calm: true, size: 28 });
            wrapper.append(roleLabel, avatar, contentContainer);
        } else {
            wrapper.append(roleLabel);
        }

        const bubble = document.createElement('p');
        bubble.className = 'chatbot-bubble';
        if (textKey) {
            bubble.textContent = readChatbotMessages(activeLocale)[textKey] || '';
            localizedLogBindings.push({ element: bubble, type: 'message', key: textKey });
        } else {
            // Render all user and model text strictly via textContent so HTML cannot execute or inject DOM nodes.
            bubble.textContent = String(text);
        }

        contentContainer.append(bubble);

        if (Array.isArray(actions) && actions.length > 0) {
            const actionRow = document.createElement('div');
            actionRow.className = 'chatbot-actions';

            for (const action of actions) {
                if (!action || typeof action !== 'object') continue;
                if (action.type === 'inquiry') {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'chatbot-action-btn chatbot-action-inquiry';
                    button.textContent = readChatbotMessages(activeLocale).inquiryActionButton;
                    button.addEventListener('click', () => {
                        performInquiryAction();
                    });
                    localizedLogBindings.push({ element: button, type: 'message', key: 'inquiryActionButton' });
                    actionRow.append(button);
                } else if (action.type === 'link') {
                    const safeHref = resolveSafeHref(
                        action.href,
                        document.defaultView?.location?.origin || globalThis.location?.origin
                    );
                    if (!safeHref) continue;
                    const link = document.createElement('a');
                    link.className = 'chatbot-action-link';
                    link.href = safeHref;
                    const labelKey = typeof action.label_key === 'string' ? action.label_key : '';
                    link.textContent = resolveActionLabel(activeLocale, labelKey || safeHref);
                    if (labelKey) {
                        localizedLogBindings.push({ element: link, type: 'actionLabel', key: labelKey });
                    }
                    actionRow.append(link);
                }
            }

            if (actionRow.childElementCount > 0) {
                contentContainer.append(actionRow);
            }
        }

        log.append(wrapper);
        scrollLogToBottom();
        return wrapper;
    }

    function applyLocale(nextLocale) {
        activeLocale = normalizeLocale(nextLocale);
        const dir = activeLocale === 'ar' ? 'rtl' : 'ltr';
        const messages = readChatbotMessages(activeLocale);

        widgetRoot.lang = activeLocale;
        widgetRoot.dir = dir;
        panel.lang = activeLocale;
        panel.dir = dir;

        launcherText.textContent = messages.launcherLabel;
        launcherTagline.textContent = messages.launcherTagline;
        launcherButton.setAttribute('aria-label', messages.launcherAriaLabel);
        titleName.textContent = messages.panelName;
        titleText.textContent = messages.panelTitle;
        closeButton.setAttribute('aria-label', messages.closeLabel);
        notice.textContent = messages.noticeText;
        log.setAttribute('aria-label', messages.logAriaLabel);
        chipsContainer.setAttribute('aria-label', messages.chipsAriaLabel);

        for (const chipButton of chipButtons) {
            const key = chipButton.dataset.chipKey;
            chipButton.textContent = messages[key] || '';
        }

        inputLabel.textContent = messages.inputLabel;
        input.placeholder = messages.inputPlaceholder;
        sendButton.textContent = isSending ? messages.sendingLabel : messages.sendLabel;

        if (hasValidationError) {
            validationError.textContent = messages.inputTooLong;
        }

        for (const binding of localizedLogBindings) {
            if (binding.type === 'role') {
                binding.element.textContent = `${messages[binding.key] || ''}: `;
            } else if (binding.type === 'message') {
                binding.element.textContent = messages[binding.key] || '';
            } else if (binding.type === 'actionLabel') {
                binding.element.textContent = resolveActionLabel(activeLocale, binding.key);
            }
        }
    }

    function setSendingState(pending) {
        isSending = pending;
        const messages = readChatbotMessages(activeLocale);
        sendButton.disabled = pending;
        sendButton.textContent = pending ? messages.sendingLabel : messages.sendLabel;
        for (const chipButton of chipButtons) {
            if (chipButton.dataset.chipKind === 'query') {
                chipButton.disabled = pending;
            }
        }
        if (pending) {
            panel.setAttribute('aria-busy', 'true');
            clearMascotTimer();
            setMascotState('thinking');
        } else {
            panel.removeAttribute('aria-busy');
        }
    }

    function cancelPendingPanelAnimation() {
        if (openFrameId !== null) {
            document.defaultView?.cancelAnimationFrame?.(openFrameId);
            openFrameId = null;
        }
        if (closeCleanup) {
            closeCleanup();
            closeCleanup = null;
        }
    }

    function openPanel() {
        if (isOpen) return;
        cancelPendingPanelAnimation();
        isOpen = true;
        widgetRoot.classList.add('is-panel-open');
        document.documentElement?.classList?.add(MOBILE_OPEN_CLASS);
        launcherTagline.hidden = true;
        if (launcherMouse) launcherMouse.hidden = true;
        panel.classList.remove('is-closing');
        panel.hidden = false;
        launcherButton.setAttribute('aria-expanded', 'true');
        document.addEventListener('keydown', handleDocumentKeydown);
        attachViewportSync();

        if (shouldAnimatePanel(document, animate)) {
            panel.classList.remove('is-open');
            void panel.offsetWidth;
            const raf = document.defaultView.requestAnimationFrame.bind(document.defaultView);
            openFrameId = raf(() => {
                openFrameId = null;
                if (destroyed || !isOpen) return;
                panel.classList.add('is-open');
            });
        } else {
            panel.classList.add('is-open');
        }

        if (!hasGreeted) {
            hasGreeted = true;
            if (!isSending && !prefersReducedMotion(document)) {
                setMascotState('hello');
                scheduleMascotIdle(HELLO_DURATION_MS);
            }
        } else if (isSending) {
            setMascotState('thinking');
        }
        if (!input.disabled) {
            input.focus();
        } else {
            closeButton.focus();
        }
    }

    function closePanel({ restoreFocus = true } = {}) {
        if (!isOpen) return;
        cancelPendingPanelAnimation();
        isOpen = false;
        launcherButton.setAttribute('aria-expanded', 'false');
        document.removeEventListener('keydown', handleDocumentKeydown);
        document.documentElement?.classList?.remove(MOBILE_OPEN_CLASS);
        clearFocusScrollTimer();
        detachViewportSync();
        clearMascotTimer();
        setMascotState(isSending ? 'thinking' : 'idle');

        const finishClose = () => {
            if (destroyed || isOpen) return;
            clearViewportProperties();
            panel.classList.remove('is-open', 'is-closing');
            panel.hidden = true;
            widgetRoot.classList.remove('is-panel-open');
            launcherTagline.hidden = false;
            if (launcherMouse) launcherMouse.hidden = false;
        };

        if (shouldAnimatePanel(document, animate)) {
            panel.classList.remove('is-open');
            panel.classList.add('is-closing');
            let done = false;
            let fallbackTimer = null;
            const finalize = () => {
                if (done) return;
                done = true;
                if (fallbackTimer !== null) {
                    globalThis.clearTimeout(fallbackTimer);
                    fallbackTimer = null;
                }
                panel.removeEventListener('transitionend', handleTransitionEnd);
                closeCleanup = null;
                finishClose();
            };
            const handleTransitionEnd = (event) => {
                if (event.target !== panel) return;
                if (event.propertyName && event.propertyName !== 'opacity' && event.propertyName !== 'transform') return;
                finalize();
            };
            closeCleanup = () => {
                done = true;
                if (fallbackTimer !== null) {
                    globalThis.clearTimeout(fallbackTimer);
                    fallbackTimer = null;
                }
                panel.removeEventListener('transitionend', handleTransitionEnd);
            };
            panel.addEventListener('transitionend', handleTransitionEnd);
            fallbackTimer = globalThis.setTimeout(finalize, PANEL_CLOSE_FALLBACK_MS);
        } else {
            finishClose();
        }

        if (restoreFocus) {
            launcherButton.focus();
        }
    }

    function performInquiryAction() {
        closePanel({ restoreFocus: false });
        const questionsSection = document.getElementById('questions');
        if (!questionsSection) return;
        questionsSection.scrollIntoView?.({
            behavior: prefersReducedMotion(document) ? 'auto' : 'smooth',
            block: 'start'
        });
        const firstField = questionsSection.querySelector(
            'input:not([type="hidden"]):not([disabled]):not([tabindex="-1"]), textarea:not([disabled]):not([tabindex="-1"]), select:not([disabled]):not([tabindex="-1"])'
        );
        firstField?.focus?.();
    }

    function handleDocumentKeydown(event) {
        if (!isOpen) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            closePanel({ restoreFocus: true });
            return;
        }
        if (event.key === 'Tab') {
            const focusable = getFocusableElements(panel);
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (!panel.contains(document.activeElement)) {
                event.preventDefault();
                (event.shiftKey ? last : first).focus();
            } else if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }
    }

    async function sendChatMessage(rawText, { clearInput = false } = {}) {
        if (isSending) return;

        const text = String(rawText ?? '');
        const trimmed = text.trim();
        if (text.length > MAX_MESSAGE_LENGTH || trimmed.length > MAX_MESSAGE_LENGTH) {
            if (clearInput) updateInputMeta();
            return;
        }
        if (trimmed.length === 0) return;

        const nextUserMessage = { role: 'user', content: trimmed };
        const requestMessages = [...conversationHistory, nextUserMessage]
            .slice(-MAX_MESSAGES_IN_REQUEST)
            .map((entry) => ({
                role: entry.role,
                content: String(entry.content || '').slice(0, MAX_MESSAGE_LENGTH)
            }))
            .filter((entry) => entry.content.length > 0);

        if (clearInput) {
            input.value = '';
            updateInputMeta();
        }

        appendMessage({ role: 'user', text: trimmed });

        const fetchFn = resolveFetcher(document, fetcher);
        if (!fetchFn) {
            appendMessage({
                role: 'assistant',
                textKey: 'unavailableMessage',
                actions: [{ type: 'inquiry' }],
                isError: true,
                mascotState: 'handoff'
            });
            setMascotState('handoff');
            scheduleMascotIdle(REPLY_STATE_DURATION_MS);
            return;
        }

        setSendingState(true);
        try {
            const response = await fetchFn(CHAT_ENDPOINT, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: requestMessages,
                    language: activeLocale
                })
            });

            if (destroyed) return;
            if (response.ok) {
                const payload = await response.json();
                if (destroyed) return;
                if (typeof payload?.reply === 'string' && payload.reply.trim().length > 0) {
                    const replyText = payload.reply;
                    const actions = Array.isArray(payload.actions) ? payload.actions : [];
                    const replyState = resolveReplyMascotState(actions);
                    conversationHistory = [
                        ...conversationHistory,
                        nextUserMessage,
                        { role: 'assistant', content: replyText.trim().slice(0, MAX_MESSAGE_LENGTH) }
                    ].slice(-MAX_MESSAGES_IN_REQUEST);
                    appendMessage({ role: 'assistant', text: replyText, actions, mascotState: replyState });
                    setMascotState(replyState);
                    scheduleMascotIdle(REPLY_STATE_DURATION_MS);
                    return;
                }
            }

            const errorKey = (response.status === 400 || response.status === 413)
                ? 'badRequestMessage'
                : 'unavailableMessage';
            const errorState = (response.status === 503 || response.status === 429)
                ? 'sleepy'
                : 'handoff';
            appendMessage({
                role: 'assistant',
                textKey: errorKey,
                actions: [{ type: 'inquiry' }],
                isError: true,
                mascotState: errorState
            });
            setMascotState(errorState);
            scheduleMascotIdle(REPLY_STATE_DURATION_MS);
        } catch {
            if (destroyed) return;
            appendMessage({
                role: 'assistant',
                textKey: 'unavailableMessage',
                actions: [{ type: 'inquiry' }],
                isError: true,
                mascotState: 'handoff'
            });
            setMascotState('handoff');
            scheduleMascotIdle(REPLY_STATE_DURATION_MS);
        } finally {
            if (!destroyed) setSendingState(false);
        }
    }

    const handleLocaleChanged = () => {
        applyLocale(document.documentElement?.lang || activeLocale);
    };

    launcherTagline.addEventListener('click', () => {
        openPanel();
    });

    launcherButton.addEventListener('click', () => {
        if (isOpen) {
            closePanel({ restoreFocus: true });
        } else {
            openPanel();
        }
    });

    closeButton.addEventListener('click', () => {
        closePanel({ restoreFocus: true });
    });

    for (const chipButton of chipButtons) {
        chipButton.addEventListener('click', () => {
            if (chipButton.dataset.chipKind === 'inquiry') {
                performInquiryAction();
                return;
            }
            const chipKey = chipButton.dataset.chipKey;
            const queryText = readChatbotMessages(activeLocale)[chipKey];
            if (queryText) {
                void sendChatMessage(queryText, { clearInput: false });
            }
        });
    }

    input.addEventListener('input', updateInputMeta);
    input.addEventListener('focus', handleInputFocus);

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void sendChatMessage(input.value, { clearInput: true });
        }
    });

    composer.addEventListener('submit', (event) => {
        event.preventDefault();
        void sendChatMessage(input.value, { clearInput: true });
    });

    document.addEventListener('public:locale-changed', handleLocaleChanged);

    appendMessage({ role: 'assistant', textKey: 'welcomeMessage', mascotState: 'idle' });
    applyLocale(activeLocale);
    updateInputMeta();

    const controller = {
        open: openPanel,
        close: () => closePanel({ restoreFocus: true }),
        setLocale(nextLocale) {
            applyLocale(nextLocale);
        },
        destroy() {
            destroyed = true;
            clearMascotTimer();
            clearFocusScrollTimer();
            cancelPendingPanelAnimation();
            detachViewportSync();
            clearViewportProperties();
            document.documentElement?.classList?.remove(MOBILE_OPEN_CLASS);
            input.removeEventListener('focus', handleInputFocus);
            document.removeEventListener('keydown', handleDocumentKeydown);
            document.removeEventListener('public:locale-changed', handleLocaleChanged);
            mountTarget.replaceChildren();
            delete mountTarget.dataset.chatbotInitialized;
            activeControllers.delete(mountTarget);
        }
    };
    activeControllers.set(mountTarget, controller);
    return controller;
}
