import { CHATBOT_MESSAGES } from './i18n/chatbot-messages.js';
import { INQUIRY_MESSAGES } from './i18n/inquiry-messages.js';
import { PUBLIC_MESSAGES, SESSION3_MESSAGES, SUPPORTED_LOCALES } from './i18n/messages.js';

export const CHATBOT_PILOT_QUERY_GATE = 'bot';

const CHAT_ENDPOINT = '/api/public/chat';
const MAX_MESSAGES_IN_REQUEST = 10;
const MAX_MESSAGE_LENGTH = 500;
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

function resolveSafeHref(href) {
    if (typeof href !== 'string') return null;
    const trimmed = href.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;
    if (trimmed.startsWith('#')) return trimmed;
    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol === 'https:') return parsed.toString();
    } catch {
        return null;
    }
    return null;
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

function getFocusableElements(container) {
    const selector = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return [...container.querySelectorAll(selector)].filter(
        (element) => !element.hidden && !element.closest('[hidden]') && element.getAttribute('aria-hidden') !== 'true'
    );
}

function createLauncherIcon(document) {
    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');

    const path = document.createElementNS(svgNs, 'path');
    path.setAttribute('d', 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z');
    svg.append(path);
    return svg;
}

/**
 * Mounts and manages the pilot home-page chatbot widget inside `#home-chatbot-root`.
 * Conversation state stays strictly in memory (no browser storage).
 * @param {{locale?: string, root?: Document, mountElement?: HTMLElement, fetcher?: typeof fetch}} [options]
 * @returns {{open: () => void, close: () => void, setLocale: (nextLocale: string) => void, destroy: () => void}|null}
 */
export function initHomeChatbot({ locale, root = globalThis.document, mountElement, fetcher } = {}) {
    const document = mountElement?.ownerDocument || root;
    if (!document) return null;

    const mountTarget = mountElement || document.getElementById('home-chatbot-root');
    if (!mountTarget) return null;

    const existing = activeControllers.get(mountTarget);
    if (existing) existing.destroy();

    let activeLocale = normalizeLocale(locale || document.documentElement?.lang);
    let isOpen = false;
    let isSending = false;
    let destroyed = false;
    let hasValidationError = false;
    let conversationHistory = [];
    const localizedLogBindings = [];

    const widgetRoot = document.createElement('div');
    widgetRoot.className = 'chatbot-root';

    const launcherButton = document.createElement('button');
    launcherButton.type = 'button';
    launcherButton.id = 'home-chatbot-launcher';
    launcherButton.className = 'chatbot-launcher';
    launcherButton.setAttribute('aria-expanded', 'false');
    launcherButton.setAttribute('aria-controls', 'home-chatbot-panel');
    const launcherIcon = createLauncherIcon(document);
    const launcherText = document.createElement('span');
    launcherText.className = 'chatbot-launcher-text';
    launcherButton.append(launcherIcon, launcherText);

    const panel = document.createElement('section');
    panel.id = 'home-chatbot-panel';
    panel.className = 'chatbot-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'chatbot-panel-title');
    panel.hidden = true;

    const header = document.createElement('div');
    header.className = 'chatbot-header';
    const title = document.createElement('h2');
    title.id = 'chatbot-panel-title';
    title.className = 'chatbot-title';
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'chatbot-close';
    closeButton.textContent = '✕';
    header.append(title, closeButton);

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
    widgetRoot.append(launcherButton, panel);
    mountTarget.replaceChildren(widgetRoot);
    mountTarget.dataset.chatbotInitialized = 'true';

    function scrollLogToBottom() {
        log.scrollTop = log.scrollHeight;
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

    function appendMessage({ role, text = '', textKey = '', actions = [], isError = false }) {
        const wrapper = document.createElement('div');
        wrapper.className = `chatbot-message chatbot-message-${isError ? 'error' : role}`;

        const roleLabel = document.createElement('span');
        roleLabel.className = 'chatbot-sr-only';
        const roleKey = role === 'user' ? 'userRoleLabel' : 'assistantRoleLabel';
        roleLabel.textContent = `${readChatbotMessages(activeLocale)[roleKey]}: `;
        localizedLogBindings.push({ element: roleLabel, type: 'role', key: roleKey });

        const bubble = document.createElement('p');
        bubble.className = 'chatbot-bubble';
        if (textKey) {
            bubble.textContent = readChatbotMessages(activeLocale)[textKey] || '';
            localizedLogBindings.push({ element: bubble, type: 'message', key: textKey });
        } else {
            // Render all user and model text strictly via textContent so HTML cannot execute or inject DOM nodes.
            bubble.textContent = String(text);
        }

        wrapper.append(roleLabel, bubble);

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
                    const safeHref = resolveSafeHref(action.href);
                    if (!safeHref) continue;
                    const link = document.createElement('a');
                    link.className = 'chatbot-action-link';
                    link.href = safeHref;
                    if (safeHref.startsWith('https://')) {
                        link.target = '_blank';
                        link.rel = 'noopener noreferrer';
                    }
                    const labelKey = typeof action.label_key === 'string' ? action.label_key : '';
                    link.textContent = resolveActionLabel(activeLocale, labelKey || safeHref);
                    if (labelKey) {
                        localizedLogBindings.push({ element: link, type: 'actionLabel', key: labelKey });
                    }
                    actionRow.append(link);
                }
            }

            if (actionRow.childElementCount > 0) {
                wrapper.append(actionRow);
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
        launcherButton.setAttribute('aria-label', messages.launcherAriaLabel);
        title.textContent = messages.panelTitle;
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
        } else {
            panel.removeAttribute('aria-busy');
        }
    }

    function openPanel() {
        if (isOpen) return;
        isOpen = true;
        panel.hidden = false;
        launcherButton.setAttribute('aria-expanded', 'true');
        document.addEventListener('keydown', handleDocumentKeydown);
        if (!input.disabled) {
            input.focus();
        } else {
            closeButton.focus();
        }
    }

    function closePanel({ restoreFocus = true } = {}) {
        if (!isOpen) return;
        isOpen = false;
        panel.hidden = true;
        launcherButton.setAttribute('aria-expanded', 'false');
        document.removeEventListener('keydown', handleDocumentKeydown);
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
                isError: true
            });
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
                    conversationHistory = [
                        ...conversationHistory,
                        nextUserMessage,
                        { role: 'assistant', content: replyText.trim().slice(0, MAX_MESSAGE_LENGTH) }
                    ].slice(-MAX_MESSAGES_IN_REQUEST);
                    appendMessage({ role: 'assistant', text: replyText, actions });
                    return;
                }
            }

            const errorKey = (response.status === 400 || response.status === 413)
                ? 'badRequestMessage'
                : 'unavailableMessage';
            appendMessage({
                role: 'assistant',
                textKey: errorKey,
                actions: [{ type: 'inquiry' }],
                isError: true
            });
        } catch {
            if (destroyed) return;
            appendMessage({
                role: 'assistant',
                textKey: 'unavailableMessage',
                actions: [{ type: 'inquiry' }],
                isError: true
            });
        } finally {
            if (!destroyed) setSendingState(false);
        }
    }

    const handleLocaleChanged = () => {
        applyLocale(document.documentElement?.lang || activeLocale);
    };

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

    appendMessage({ role: 'assistant', textKey: 'welcomeMessage' });
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
