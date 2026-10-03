const VIEW_TITLES = {
    applications: 'İkamet Başvuruları',
    archive: 'Arşiv',
    ykn: 'YKN',
    cover: 'Kapak Hazırla',
    teblig: 'Tebliğ Bul',
    documents: 'Belgeler'
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
    const targetId = viewName === 'teblig'
        ? 'tebligat-search-input'
        : (viewName === 'ykn'
            ? 'ykn-passport-input'
            : (viewName === 'archive'
                ? (document.getElementById('staff-archive-search') ? 'staff-archive-search' : 'archive-title')
                : `${viewName}-title`));
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

function animateWorkspaceView(element) {
    element.classList.add('is-view-entering');
    element.addEventListener('animationend', () => element.classList.remove('is-view-entering'), { once: true });
}

function focusHomeScreen() {
    showHomeScreen();
    document.getElementById('home-screen-title')?.focus();
}

/** Initializes navigation without changing application business logic. */
export function initWorkspaceNavigation() {
    const { homeScreen, workspaceContent, homeButton } = getWorkspaceElements();
    if (!homeScreen || !workspaceContent || !homeButton) return;

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
