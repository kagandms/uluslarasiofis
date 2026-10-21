const entranceHandlers = new WeakMap();

/**
 * Replays a workspace entrance and releases its animation styles on completion.
 * @param {HTMLElement} element Home or workspace section.
 * @returns {void} Installs a single completion handler for this entrance.
 */
export function animateWorkspaceView(element) {
    const previous = entranceHandlers.get(element);
    if (previous) previous.target.removeEventListener('animationend', previous.handler);
    element.classList.remove('is-entering');
    if (element.ownerDocument.defaultView.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const isHome = element.id === 'home-screen';
    const target = isHome ? element.querySelector('.home-action:last-child') : element;
    if (!target) return;
    const animationName = isHome ? 'staff-home-card-enter' : 'staff-home-content-enter';
    const handler = (event) => {
        if (event.target !== target || event.animationName !== animationName) return;
        element.classList.remove('is-entering');
        target.removeEventListener('animationend', handler);
        entranceHandlers.delete(element);
    };
    element.getBoundingClientRect();
    element.classList.add('is-entering');
    target.addEventListener('animationend', handler);
    entranceHandlers.set(element, { target, handler });
}
