/**
 * Yetkili panel "Sohbetler" çalışma alanı yöneticisi.
 * Halka açık Topi sohbet oturumlarını listeler, süzer, günlük/7 günlük sayaçları gösterir,
 * oturum turlarını okur ve onaylı tekil/toplu silme işlemlerini yürütür.
 * Tüm kullanıcı/asistan metinleri yalnızca `textContent` ile basılır; sohbet metni konsola yazılmaz.
 */
import { formatApplicationTimestamp } from '../shared/application-timestamps.js';

const STAFF_CHAT_SESSIONS_URL = '/api/staff/chat-sessions';
const STAFF_CHAT_STATS_URL = '/api/staff/chat-stats';
const CHAT_LOGS_TITLE = 'Sohbetler';
const OLDER_DAYS_MIN = 1;
const OLDER_DAYS_MAX = 3650;

const FILTER_OPTIONS = Object.freeze([
    ['all', 'Tümü'],
    ['down', '"Hayır" oyu alanlar'],
    ['handoff', 'Ofise yönlendirilenler'],
    ['refused', 'Reddedilenler'],
    ['fallback', 'Yedek menü']
]);

const OUTCOME_LABELS = Object.freeze({
    ok: 'Yanıtlandı',
    handoff: 'Ofise yönlendirildi',
    refusal: 'Reddedildi',
    fallback: 'Yedek menü',
    knowledge: 'Bilgi tabanı',
    status_lookup: 'Durum sorgusu',
    status_needs_reference: 'Başvuru no istendi',
    status_multiple_references: 'Çoklu başvuru no',
    daily_ip_limit: 'Günlük IP sınırı',
    daily_global_limit: 'Günlük genel sınır'
});

function resolveFetcher(document, customFetcher) {
    if (typeof customFetcher === 'function') return customFetcher;
    const view = document?.defaultView;
    if (typeof view?.fetch === 'function') return view.fetch.bind(view);
    if (typeof globalThis.fetch === 'function') return globalThis.fetch.bind(globalThis);
    return null;
}

function resolveConfirm(document, customConfirm) {
    if (typeof customConfirm === 'function') return customConfirm;
    const view = document?.defaultView;
    if (typeof view?.confirm === 'function') return view.confirm.bind(view);
    if (typeof globalThis.confirm === 'function') return globalThis.confirm.bind(globalThis);
    return () => false;
}

function formatLanguageCode(language) {
    const value = String(language || '').trim().toUpperCase();
    return ['TR', 'EN', 'RU', 'TK', 'AR'].includes(value) ? value : '';
}

function formatOutcomeLabel(outcome) {
    const key = String(outcome || '').trim();
    if (!key) return 'Bilinmiyor';
    return Object.hasOwn(OUTCOME_LABELS, key) ? OUTCOME_LABELS[key] : key;
}

function normalizePeriodStats(period) {
    return {
        answers: Number.isFinite(Number(period?.answers)) ? Math.max(0, Number(period.answers)) : 0,
        up: Number.isFinite(Number(period?.up)) ? Math.max(0, Number(period.up)) : 0,
        down: Number.isFinite(Number(period?.down)) ? Math.max(0, Number(period.down)) : 0
    };
}

function normalizeStats(stats) {
    return {
        today: normalizePeriodStats(stats?.today),
        last7: normalizePeriodStats(stats?.last7)
    };
}

/**
 * Yetkili panel "Sohbetler" yöneticisini verilen kök öğeye bağlar.
 * @param {HTMLElement} rootElement Konteyner öğesi (`#staff-chat-logs-manager`).
 * @param {{fetcher?: typeof fetch, confirm?: (message: string) => boolean}} [options] Testler için isteğe bağlı bağımlılıklar.
 * @returns {{refresh: () => Promise<void>, destroy: () => void}|null} Denetleyici nesnesi.
 */
export function mountChatLogManager(rootElement, { fetcher, confirm } = {}) {
    if (!rootElement) return null;

    const document = rootElement.ownerDocument;
    const state = {
        filter: 'all',
        sessions: [],
        nextCursor: null,
        stats: normalizeStats(null),
        selectedSessionId: null,
        selectedDetail: null,
        loadingList: false,
        loadingMore: false,
        loadingDetail: false,
        deletingSession: false,
        deletingOlder: false,
        olderThanDays: '30',
        errorMessage: '',
        statusMessage: '',
        listRequestSeq: 0,
        detailRequestSeq: 0
    };

    async function requestApi(url, init = {}) {
        const fetchFn = resolveFetcher(document, fetcher);
        if (!fetchFn) {
            throw Object.assign(new Error('Bağlantı kurulamadı. Lütfen tekrar deneyin.'), { status: 0 });
        }
        let response;
        try {
            response = await fetchFn(url, { credentials: 'same-origin', ...init });
        } catch {
            throw Object.assign(new Error('Sunucuya ulaşılamadı. Bağlantınızı kontrol edin.'), { status: 0 });
        }
        if (response.status === 204) {
            return null;
        }
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            const fallbackMessage = response.status === 401
                ? 'Yetkili oturumu sona erdi. Sayfayı yenileyip yeniden giriş yapın.'
                : (response.status === 404
                    ? 'Sohbet kaydı bulunamadı. Listeyi yenileyebilirsiniz.'
                    : 'İşlem tamamlanamadı. Lütfen tekrar deneyin.');
            throw Object.assign(new Error(payload?.error?.message || fallbackMessage), {
                status: response.status,
                code: payload?.error?.code
            });
        }
        return payload;
    }

    async function loadStats({ silentError = false } = {}) {
        try {
            const payload = await requestApi(STAFF_CHAT_STATS_URL, {
                headers: { Accept: 'application/json' }
            });
            state.stats = normalizeStats(payload);
        } catch (error) {
            console.error('Staff chat stats load failed.', { errorName: error?.name || 'Error' });
            if (!silentError) {
                state.errorMessage = error?.message || 'İstatistikler yüklenemedi.';
            }
        }
    }

    async function loadSessions({ filter = state.filter, cursor = null, append = false, silentError = false } = {}) {
        const seq = ++state.listRequestSeq;
        state.filter = filter;
        if (append) {
            state.loadingMore = true;
        } else {
            state.loadingList = true;
            state.errorMessage = '';
        }
        render();

        try {
            const params = new URLSearchParams({ filter: state.filter });
            if (cursor) params.set('cursor', cursor);
            const payload = await requestApi(`${STAFF_CHAT_SESSIONS_URL}?${params.toString()}`, {
                headers: { Accept: 'application/json' }
            });
            if (seq !== state.listRequestSeq) return;
            const incoming = Array.isArray(payload?.items) ? payload.items : [];
            state.sessions = append ? [...state.sessions, ...incoming] : incoming;
            state.nextCursor = typeof payload?.nextCursor === 'string' && payload.nextCursor ? payload.nextCursor : null;
        } catch (error) {
            if (seq !== state.listRequestSeq) return;
            console.error('Staff chat sessions load failed.', { errorName: error?.name || 'Error' });
            if (!silentError) {
                state.errorMessage = error?.message || 'Sohbetler yüklenemedi. Lütfen tekrar deneyin.';
            }
        } finally {
            if (seq === state.listRequestSeq) {
                state.loadingList = false;
                state.loadingMore = false;
                render();
            }
        }
    }

    async function loadAll({ silentError = false } = {}) {
        await Promise.all([
            loadStats({ silentError }),
            loadSessions({ filter: state.filter, cursor: null, append: false, silentError })
        ]);
        render();
    }

    async function openSession(sessionId) {
        if (!sessionId) return;
        const seq = ++state.detailRequestSeq;
        state.selectedSessionId = sessionId;
        state.selectedDetail = null;
        state.loadingDetail = true;
        state.errorMessage = '';
        state.statusMessage = '';
        render();

        try {
            const payload = await requestApi(`${STAFF_CHAT_SESSIONS_URL}/${encodeURIComponent(sessionId)}`, {
                headers: { Accept: 'application/json' }
            });
            if (seq !== state.detailRequestSeq) return;
            state.selectedDetail = {
                session: payload?.session || null,
                turns: Array.isArray(payload?.turns) ? payload.turns : []
            };
        } catch (error) {
            if (seq !== state.detailRequestSeq) return;
            console.error('Staff chat session detail load failed.', { errorName: error?.name || 'Error' });
            state.errorMessage = error?.message || 'Sohbet detayı yüklenemedi.';
        } finally {
            if (seq === state.detailRequestSeq) {
                state.loadingDetail = false;
                render();
            }
        }
    }

    async function handleDeleteCurrentSession() {
        const sessionId = state.selectedSessionId;
        if (!sessionId || state.deletingSession) return;
        const askConfirm = resolveConfirm(document, confirm);
        const confirmed = askConfirm('Bu sohbet ve tüm mesajları kalıcı olarak silinecek. Devam etmek istiyor musunuz?');
        if (!confirmed) return;

        state.deletingSession = true;
        state.errorMessage = '';
        state.statusMessage = '';
        render();

        try {
            await requestApi(`${STAFF_CHAT_SESSIONS_URL}/${encodeURIComponent(sessionId)}`, {
                method: 'DELETE',
                headers: { Accept: 'application/json' }
            });
            state.sessions = state.sessions.filter((item) => item.id !== sessionId);
            state.selectedSessionId = null;
            state.selectedDetail = null;
            state.statusMessage = 'Sohbet kalıcı olarak silindi.';
            await loadStats({ silentError: true });
        } catch (error) {
            console.error('Staff chat session delete failed.', { errorName: error?.name || 'Error' });
            state.errorMessage = error?.message || 'Sohbet silinemedi. Lütfen tekrar deneyin.';
        } finally {
            state.deletingSession = false;
            render();
        }
    }

    async function handleDeleteOlderSessions() {
        if (state.deletingOlder) return;
        const raw = String(state.olderThanDays || '').trim();
        const days = /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : Number.NaN;
        if (!Number.isSafeInteger(days) || days < OLDER_DAYS_MIN || days > OLDER_DAYS_MAX) {
            state.errorMessage = 'Lütfen 1 ile 3650 arasında geçerli bir gün sayısı girin.';
            state.statusMessage = '';
            render();
            return;
        }

        const askConfirm = resolveConfirm(document, confirm);
        const confirmed = askConfirm(
            `${days} günden eski tüm sohbetler ve mesajları kalıcı olarak silinecek. Bu işlem geri alınamaz. Devam etmek istiyor musunuz?`
        );
        if (!confirmed) return;

        state.deletingOlder = true;
        state.errorMessage = '';
        state.statusMessage = '';
        render();

        try {
            const payload = await requestApi(`${STAFF_CHAT_SESSIONS_URL}?older_than_days=${encodeURIComponent(String(days))}`, {
                method: 'DELETE',
                headers: { Accept: 'application/json' }
            });
            const deletedCount = Number.isFinite(Number(payload?.deleted)) ? Number(payload.deleted) : 0;
            state.selectedSessionId = null;
            state.selectedDetail = null;
            state.statusMessage = deletedCount > 0
                ? `${deletedCount} sohbet kalıcı olarak silindi.`
                : `${days} günden eski sohbet bulunamadı.`;
            await loadAll({ silentError: true });
        } catch (error) {
            console.error('Staff chat bulk delete failed.', { errorName: error?.name || 'Error' });
            state.errorMessage = error?.message || 'Eski sohbetler silinemedi. Lütfen tekrar deneyin.';
        } finally {
            state.deletingOlder = false;
            render();
        }
    }

    function createStatsCard(periodKey, headingText, data) {
        const card = document.createElement('section');
        card.className = 'staff-chatlog-stat-card';
        card.setAttribute('aria-label', headingText);

        const title = document.createElement('h4');
        title.className = 'staff-chatlog-stat-title';
        title.textContent = headingText;

        const metrics = document.createElement('dl');
        metrics.className = 'staff-chatlog-stat-metrics';

        for (const [metricKey, label, value] of [
            ['answers', 'Cevap', data.answers],
            ['up', 'Evet', data.up],
            ['down', 'Hayır', data.down]
        ]) {
            const item = document.createElement('div');
            item.className = `staff-chatlog-stat-metric is-${metricKey}`;

            const dt = document.createElement('dt');
            dt.textContent = label;

            const dd = document.createElement('dd');
            dd.dataset.statPeriod = periodKey;
            dd.dataset.statMetric = metricKey;
            dd.textContent = String(value);

            item.append(dt, dd);
            metrics.append(item);
        }

        card.append(title, metrics);
        return card;
    }

    function createSessionListItem(item) {
        const article = document.createElement('article');
        article.className = 'staff-chatlog-item';
        article.dataset.sessionId = String(item.id || '');

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'staff-chatlog-item-btn';
        button.dataset.action = 'open-session';
        button.dataset.sessionId = String(item.id || '');

        const header = document.createElement('div');
        header.className = 'staff-chatlog-item-header';

        const badges = document.createElement('div');
        badges.className = 'staff-chatlog-badges';

        const langCode = formatLanguageCode(item.language);
        if (langCode) {
            const langBadge = document.createElement('span');
            langBadge.className = 'staff-inquiry-lang';
            langBadge.textContent = langCode;
            badges.append(langBadge);
        }

        const turnBadge = document.createElement('span');
        turnBadge.className = 'staff-chatlog-badge';
        turnBadge.textContent = `${Number(item.turn_count) || 0} tur`;
        badges.append(turnBadge);

        if (item.has_down_vote) {
            const downBadge = document.createElement('span');
            downBadge.className = 'staff-chatlog-badge is-down';
            downBadge.textContent = 'Hayır oyu';
            badges.append(downBadge);
        }

        const time = document.createElement('time');
        time.className = 'staff-inquiry-time';
        const ts = item.last_at || item.created_at;
        if (ts) time.dateTime = String(ts);
        time.textContent = formatApplicationTimestamp(ts) || '—';

        header.append(badges, time);

        const preview = document.createElement('p');
        preview.className = 'staff-chatlog-preview';
        preview.textContent = String(item.first_user_text || '—');

        button.append(header, preview);
        button.addEventListener('click', () => {
            void openSession(item.id);
        });

        article.append(button);
        return article;
    }

    function createSessionDetailView() {
        const detail = document.createElement('section');
        detail.className = 'staff-chatlog-detail';
        detail.setAttribute('aria-label', 'Sohbet detayı');

        const detailHeader = document.createElement('div');
        detailHeader.className = 'staff-chatlog-detail-header';

        const backButton = document.createElement('button');
        backButton.type = 'button';
        backButton.className = 'btn btn-outline';
        backButton.dataset.action = 'close-session';
        backButton.textContent = 'Listeye dön';
        backButton.addEventListener('click', () => {
            state.selectedSessionId = null;
            state.selectedDetail = null;
            state.errorMessage = '';
            render();
        });

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'btn btn-outline staff-inquiry-delete-btn';
        deleteButton.dataset.action = 'delete-session';
        deleteButton.disabled = state.deletingSession || state.loadingDetail;
        deleteButton.textContent = state.deletingSession ? 'Siliniyor…' : 'Bu sohbeti sil';
        deleteButton.addEventListener('click', () => {
            void handleDeleteCurrentSession();
        });

        detailHeader.append(backButton, deleteButton);
        detail.append(detailHeader);

        if (state.loadingDetail) {
            const loading = document.createElement('p');
            loading.className = 'staff-inquiries-empty';
            loading.textContent = 'Sohbet yükleniyor…';
            detail.append(loading);
            return detail;
        }

        const session = state.selectedDetail?.session;
        const turns = state.selectedDetail?.turns || [];
        if (!session) {
            const empty = document.createElement('p');
            empty.className = 'staff-inquiries-empty';
            empty.textContent = 'Sohbet kaydı görüntülenemedi.';
            detail.append(empty);
            return detail;
        }

        const meta = document.createElement('div');
        meta.className = 'staff-chatlog-detail-meta';
        const langCode = formatLanguageCode(session.language);
        if (langCode) {
            const langBadge = document.createElement('span');
            langBadge.className = 'staff-inquiry-lang';
            langBadge.textContent = langCode;
            meta.append(langBadge);
        }
        const metaText = document.createElement('span');
        metaText.textContent = `${formatApplicationTimestamp(session.created_at) || '—'} · ${session.turn_count} tur`;
        meta.append(metaText);
        detail.append(meta);

        if (turns.length === 0) {
            const noTurns = document.createElement('p');
            noTurns.className = 'staff-inquiries-empty';
            noTurns.textContent = 'Bu oturumda kayıtlı mesaj yok.';
            detail.append(noTurns);
            return detail;
        }

        const thread = document.createElement('div');
        thread.className = 'staff-chatlog-thread';

        for (const turn of turns) {
            const turnGroup = document.createElement('div');
            turnGroup.className = 'staff-chatlog-turn';

            // Öğrenci balonu
            const userBubble = document.createElement('div');
            userBubble.className = 'staff-chatlog-bubble staff-chatlog-bubble-user';

            const userMeta = document.createElement('div');
            userMeta.className = 'staff-chatlog-bubble-meta';
            const userLabel = document.createElement('strong');
            userLabel.textContent = `Öğrenci (#${turn.seq})`;
            const userTime = document.createElement('time');
            if (turn.created_at) userTime.dateTime = String(turn.created_at);
            userTime.textContent = formatApplicationTimestamp(turn.created_at) || '';
            userMeta.append(userLabel, userTime);

            const userBody = document.createElement('p');
            userBody.className = 'staff-chatlog-bubble-text';
            userBody.textContent = String(turn.user_text || '');

            userBubble.append(userMeta, userBody);

            // Topi balonu
            const topiBubble = document.createElement('div');
            topiBubble.className = 'staff-chatlog-bubble staff-chatlog-bubble-assistant';

            const topiMeta = document.createElement('div');
            topiMeta.className = 'staff-chatlog-bubble-meta';
            const topiLabel = document.createElement('strong');
            topiLabel.textContent = 'Topi';

            const topiBadges = document.createElement('div');
            topiBadges.className = 'staff-chatlog-badges';

            const outcomeBadge = document.createElement('span');
            outcomeBadge.className = `staff-chatlog-badge is-outcome-${String(turn.outcome || 'ok').replace(/[^a-z0-9_-]/gi, '')}`;
            outcomeBadge.textContent = formatOutcomeLabel(turn.outcome);
            topiBadges.append(outcomeBadge);

            if (turn.feedback === 'up' || turn.feedback === 'down') {
                const voteBadge = document.createElement('span');
                voteBadge.className = `staff-chatlog-badge ${turn.feedback === 'up' ? 'is-up' : 'is-down'}`;
                voteBadge.textContent = turn.feedback === 'up' ? 'Oy: Evet' : 'Oy: Hayır';
                topiBadges.append(voteBadge);
            }

            if (Array.isArray(turn.tools) && turn.tools.length > 0) {
                const toolsBadge = document.createElement('span');
                toolsBadge.className = 'staff-chatlog-badge';
                toolsBadge.textContent = `Araç: ${turn.tools.join(', ')}`;
                topiBadges.append(toolsBadge);
            }

            topiMeta.append(topiLabel, topiBadges);

            const topiBody = document.createElement('p');
            topiBody.className = 'staff-chatlog-bubble-text';
            topiBody.textContent = String(turn.assistant_text || '');

            topiBubble.append(topiMeta, topiBody);
            turnGroup.append(userBubble, topiBubble);
            thread.append(turnGroup);
        }

        detail.append(thread);
        return detail;
    }

    function render() {
        const panel = document.createElement('div');
        panel.className = 'staff-inquiries-panel staff-chatlog-panel';

        const topbar = document.createElement('div');
        topbar.className = 'staff-inquiries-topbar';

        const headingGroup = document.createElement('div');
        headingGroup.className = 'staff-inquiries-heading';
        const title = document.createElement('h3');
        title.textContent = CHAT_LOGS_TITLE;
        const subtitle = document.createElement('p');
        subtitle.textContent = 'Öğrencilerin Topi ile sohbetleri ve Evet/Hayır geri bildirimleri. Otomatik silme yoktur.';
        headingGroup.append(title, subtitle);

        const refreshButton = document.createElement('button');
        refreshButton.type = 'button';
        refreshButton.className = 'btn btn-outline';
        refreshButton.dataset.action = 'refresh-chat-logs';
        refreshButton.disabled = state.loadingList;
        refreshButton.textContent = state.loadingList ? 'Yükleniyor…' : 'Yenile';
        refreshButton.addEventListener('click', () => {
            void loadAll();
        });

        topbar.append(headingGroup, refreshButton);

        // Sayaçlar: bugün ve son 7 gün
        const statsGrid = document.createElement('div');
        statsGrid.className = 'staff-chatlog-stats';
        statsGrid.append(
            createStatsCard('today', 'Bugün', state.stats.today),
            createStatsCard('last7', 'Son 7 gün', state.stats.last7)
        );

        // Toplu silme çubuğu
        const bulkBar = document.createElement('div');
        bulkBar.className = 'staff-chatlog-bulk-bar';

        const daysLabel = document.createElement('label');
        daysLabel.className = 'staff-chatlog-bulk-label';
        daysLabel.setAttribute('for', 'staff-chatlog-older-days');
        daysLabel.textContent = 'Gün sayısı:';

        const daysInput = document.createElement('input');
        daysInput.id = 'staff-chatlog-older-days';
        daysInput.type = 'number';
        daysInput.min = String(OLDER_DAYS_MIN);
        daysInput.max = String(OLDER_DAYS_MAX);
        daysInput.step = '1';
        daysInput.className = 'staff-chatlog-days-input';
        daysInput.dataset.olderDaysInput = 'true';
        daysInput.value = state.olderThanDays;
        daysInput.disabled = state.deletingOlder;
        daysInput.addEventListener('input', () => {
            state.olderThanDays = daysInput.value;
        });

        const bulkDeleteButton = document.createElement('button');
        bulkDeleteButton.type = 'button';
        bulkDeleteButton.className = 'btn btn-outline staff-inquiry-delete-btn';
        bulkDeleteButton.dataset.action = 'delete-older-sessions';
        bulkDeleteButton.disabled = state.deletingOlder;
        bulkDeleteButton.textContent = state.deletingOlder
            ? 'Siliniyor…'
            : 'N günden eski sohbetleri sil';
        bulkDeleteButton.addEventListener('click', () => {
            void handleDeleteOlderSessions();
        });

        bulkBar.append(daysLabel, daysInput, bulkDeleteButton);

        // Süzgeç çipleri
        const filters = document.createElement('div');
        filters.className = 'staff-inquiries-tabs';
        filters.setAttribute('role', 'group');
        filters.setAttribute('aria-label', 'Sohbet süzgeçleri');

        for (const [filterKey, label] of FILTER_OPTIONS) {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'staff-inquiries-tab';
            chip.dataset.chatlogFilter = filterKey;
            const isSelected = state.filter === filterKey;
            chip.setAttribute('aria-pressed', String(isSelected));
            chip.classList.toggle('is-active', isSelected);
            chip.textContent = label;
            chip.addEventListener('click', () => {
                state.selectedSessionId = null;
                state.selectedDetail = null;
                state.statusMessage = '';
                void loadSessions({ filter: filterKey, cursor: null, append: false });
            });
            filters.append(chip);
        }

        panel.append(topbar, statsGrid, bulkBar, filters);

        if (state.errorMessage) {
            const errorBox = document.createElement('p');
            errorBox.className = 'staff-inquiries-error';
            errorBox.setAttribute('role', 'alert');
            errorBox.textContent = state.errorMessage;
            panel.append(errorBox);
        }

        const statusRegion = document.createElement('p');
        statusRegion.className = 'staff-inquiries-status';
        statusRegion.setAttribute('role', 'status');
        statusRegion.setAttribute('aria-live', 'polite');
        statusRegion.textContent = state.statusMessage;
        statusRegion.hidden = !state.statusMessage;
        panel.append(statusRegion);

        if (state.selectedSessionId) {
            panel.append(createSessionDetailView());
        } else if (state.loadingList && state.sessions.length === 0) {
            const loadingMsg = document.createElement('p');
            loadingMsg.className = 'staff-inquiries-empty';
            loadingMsg.textContent = 'Sohbetler yükleniyor…';
            panel.append(loadingMsg);
        } else if (state.sessions.length === 0) {
            const emptyMsg = document.createElement('p');
            emptyMsg.className = 'staff-inquiries-empty';
            emptyMsg.textContent = 'Bu süzgece uyan sohbet kaydı yok.';
            panel.append(emptyMsg);
        } else {
            const list = document.createElement('div');
            list.className = 'staff-inquiries-list staff-chatlog-list';
            list.append(...state.sessions.map((item) => createSessionListItem(item)));
            panel.append(list);

            if (state.nextCursor) {
                const moreButton = document.createElement('button');
                moreButton.type = 'button';
                moreButton.className = 'btn btn-outline staff-chatlog-more-btn';
                moreButton.dataset.action = 'load-more-sessions';
                moreButton.disabled = state.loadingMore;
                moreButton.textContent = state.loadingMore ? 'Yükleniyor…' : 'Daha fazla yükle';
                moreButton.addEventListener('click', () => {
                    void loadSessions({ filter: state.filter, cursor: state.nextCursor, append: true });
                });
                panel.append(moreButton);
            }
        }

        rootElement.replaceChildren(panel);
    }

    const handleWorkspaceViewChanged = (event) => {
        if (event.detail?.viewName === 'chat-logs') {
            void loadAll();
        }
    };

    // workspaceNavigation.js `chat-logs` anahtarını henüz içermiyorsa tıklama sonrası görünümü açar.
    const handleFallbackNavClick = (event) => {
        const trigger = event.target?.closest?.('button[data-workspace-view="chat-logs"]');
        if (!trigger) return;
        const viewPanel = document.getElementById('view-chat-logs');
        if (!viewPanel || !viewPanel.hidden) return;
        const homeScreen = document.getElementById('home-screen');
        const workspaceContent = document.getElementById('workspace-content');
        const workspaceTitle = document.getElementById('workspace-title');
        if (homeScreen) homeScreen.hidden = true;
        if (workspaceContent) workspaceContent.hidden = false;
        if (workspaceTitle) workspaceTitle.textContent = CHAT_LOGS_TITLE;
        document.querySelectorAll('.view-panel').forEach((panel) => {
            panel.hidden = panel !== viewPanel;
        });
        document.querySelectorAll('[data-workspace-view]').forEach((btn) => {
            const active = btn.dataset.workspaceView === 'chat-logs';
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-current', active ? 'page' : 'false');
        });
        const CustomEventCtor = document.defaultView?.CustomEvent || globalThis.CustomEvent;
        if (CustomEventCtor) {
            document.dispatchEvent(new CustomEventCtor('workspace:view-changed', { detail: { viewName: 'chat-logs' } }));
        }
        document.getElementById('chat-logs-title')?.focus();
    };

    document.addEventListener('workspace:view-changed', handleWorkspaceViewChanged);
    document.addEventListener('click', handleFallbackNavClick);

    render();
    void loadAll({ silentError: true });

    return {
        refresh: () => loadAll(),
        destroy() {
            document.removeEventListener('workspace:view-changed', handleWorkspaceViewChanged);
            document.removeEventListener('click', handleFallbackNavClick);
        }
    };
}
