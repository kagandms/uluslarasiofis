import { IS_PHYSICAL_INTAKE_ENABLED } from '../config/physical-intake-policy.js';
import { animateWorkspaceView } from './workspace-motion.js';
import { initStaffHomePresentation } from './staff-home-presentation.js';
const VIEW_TITLES = {
    ...(IS_PHYSICAL_INTAKE_ENABLED ? { intake: 'İkamet Başvuruları', physical: 'Fiziksel Teslimler' } : {}),
    applications: IS_PHYSICAL_INTAKE_ENABLED ? 'Online Başvurular' : 'İkamet Başvuruları',
    archive: 'Arşiv',
    ykn: 'YKN',
    cover: 'Kapak Hazırla',
    teblig: 'Tebliğ Bul',
    documents: 'Belgeler',
    print: 'Yazdırma',
    'work-hours': 'Çalışma Saatleri',
    'yoksis-audit': 'YÖKSİS Eksik Evrak'
};

function getWorkspaceElements() {
    return {
        homeScreen: document.getElementById('home-screen'),
        workspaceContent: document.getElementById('workspace-content'),
        workspaceTitle: document.getElementById('workspace-title'),
        homeButton: document.getElementById('btn-workspace-home')
    };
}

function getViewButtons() {
    return [...document.querySelectorAll('[data-workspace-view]')];
}

function getViewPanel(viewName) {
    return document.getElementById(`view-${viewName}`);
}

function focusView(viewName) {
    const targetId = viewName === 'print'
        ? 'print-status-title'
        : (viewName === 'teblig'
        ? 'workspace-title'
        : (viewName === 'ykn'
            ? 'ykn-title'
            : (viewName === 'archive'
                ? (document.getElementById('staff-archive-search') ? 'staff-archive-search' : 'archive-title')
                : `${viewName}-title`)));
    document.getElementById(targetId)?.focus();
}

function openTebligatSearch() {
    const searchBody = document.getElementById('tebligat-search-body');
    const toggleButton = document.getElementById('tebligat-search-toggle');

    if (searchBody?.style.display !== 'block') toggleButton?.click();
}

function updateActiveView(viewName) {
    getViewButtons().forEach((button) => {
        const isActive = button.dataset.workspaceView === viewName;
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-current', isActive ? 'page' : 'false');
    });

    Object.keys(VIEW_TITLES).forEach((name) => {
        getViewPanel(name)?.toggleAttribute('hidden', name !== viewName);
    });
}

function showWorkspaceView(viewName) {
    if (!Object.hasOwn(VIEW_TITLES, viewName)) return;

    const { homeScreen, workspaceContent, workspaceTitle } = getWorkspaceElements();
    homeScreen.hidden = true;
    workspaceContent.hidden = false;
    workspaceTitle.textContent = VIEW_TITLES[viewName];
    updateActiveView(viewName);
    animateWorkspaceView(workspaceContent);
    if (viewName === 'teblig') openTebligatSearch();
    const event = new document.defaultView.CustomEvent('workspace:view-changed', { detail: { viewName } });
    document.dispatchEvent(event);
    focusView(viewName);
}

function showHomeScreen() {
    const { homeScreen, workspaceContent } = getWorkspaceElements();
    workspaceContent.hidden = true;
    homeScreen.hidden = false;
    animateWorkspaceView(homeScreen);
}

function hasOpenDialog() {
    return [...document.querySelectorAll('dialog[open], [aria-modal="true"]')].some((dialog) =>
        !dialog.hidden && document.defaultView.getComputedStyle(dialog).display !== 'none');
}

function handleNavigationShortcut(event) {
    if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (!/^[1-9]$/.test(event.key) && event.key !== 'Escape') return;
    if (document.getElementById('app-content')?.hidden || hasOpenDialog()) return;
    const { homeScreen, workspaceContent } = getWorkspaceElements();
    if (homeScreen.hidden && workspaceContent.hidden) return;
    if (event.key === 'Escape') {
        if (workspaceContent.hidden) return;
        event.preventDefault();
        focusHomeScreen();
        return;
    }
    if (event.target instanceof document.defaultView.Element && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;
    const cards = document.querySelectorAll('#home-screen .home-action');
    const card = cards[Number(event.key) - 1];
    if (!card) return;
    event.preventDefault();
    card.click();
}

function focusHomeScreen() {
    showHomeScreen();
    document.getElementById('home-screen-title')?.focus();
}

/** Initializes navigation without changing application business logic. */
export function initWorkspaceNavigation() {
    const { homeScreen, workspaceContent, homeButton } = getWorkspaceElements();
    if (!homeScreen || !workspaceContent || !homeButton) return;
    initStaffHomePresentation();
    document.addEventListener('keydown', handleNavigationShortcut);

    if (IS_PHYSICAL_INTAKE_ENABLED) {
        document.querySelectorAll('[data-intake-entry]').forEach(button => {
            button.dataset.workspaceView = 'intake';
            button.setAttribute('aria-controls', 'view-intake');
        });
    }
    getViewButtons().forEach((button) => {
        button.addEventListener('click', () => showWorkspaceView(button.dataset.workspaceView));
    });
    homeButton.addEventListener('click', focusHomeScreen);
    document.getElementById('btn-go-home-global')?.addEventListener('click', focusHomeScreen);
    document.getElementById('staff-home-link')?.addEventListener('click', (event) => {
        event.preventDefault();
        focusHomeScreen();
    });
    showHomeScreen();
}
