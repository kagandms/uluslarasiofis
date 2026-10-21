const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

function createLaser(card) {
    const laser = card.ownerDocument.createElementNS(SVG_NAMESPACE, 'svg');
    laser.classList.add('home-action-laser');
    laser.setAttribute('aria-hidden', 'true');
    laser.setAttribute('focusable', 'false');
    laser.setAttribute('preserveAspectRatio', 'none');
    for (let index = 0; index < 2; index += 1) {
        const path = card.ownerDocument.createElementNS(SVG_NAMESPACE, 'path');
        path.setAttribute('pathLength', '1000');
        laser.append(path);
    }
    card.append(laser);
    return laser;
}

function updateLaser(card) {
    const width = card.clientWidth;
    const height = card.clientHeight;
    if (!width || !height) return;
    const laser = card.querySelector('.home-action-laser');
    const radius = Math.min(Number.parseFloat(card.ownerDocument.defaultView.getComputedStyle(card).borderTopLeftRadius), height / 2, width / 2);
    const edge = 1.5;
    laser.setAttribute('viewBox', `0 0 ${width} ${height}`);
    laser.children[0].setAttribute('d', `M ${width / 2} ${edge} H ${width - radius - edge} Q ${width - edge} ${edge} ${width - edge} ${radius + edge} V ${height - radius - edge} Q ${width - edge} ${height - edge} ${width - radius - edge} ${height - edge} H ${width / 2}`);
    laser.children[1].setAttribute('d', `M ${width / 2} ${edge} H ${radius + edge} Q ${edge} ${edge} ${edge} ${radius + edge} V ${height - radius - edge} Q ${edge} ${height - edge} ${radius + edge} ${height - edge} H ${width / 2}`);
}

function numberCard(card, index) {
    if (card.querySelector('.home-action-shortcut')) return;
    const shortcut = String(index + 1);
    const badge = card.ownerDocument.createElement('span');
    badge.className = 'home-action-shortcut';
    badge.textContent = shortcut;
    badge.setAttribute('aria-hidden', 'true');
    card.setAttribute('aria-keyshortcuts', shortcut);
    card.append(badge);
    createLaser(card);
}

/**
 * Adds numbered cards and border lasers to the authenticated staff homepage.
 * @param {Document} root Staff document.
 * @returns {void} Observes card size changes without running an animation loop.
 */
export function initStaffHomePresentation(root = document) {
    const cards = [...root.querySelectorAll('#home-screen .home-action')];
    cards.forEach(numberCard);
    const Observer = root.defaultView?.ResizeObserver;
    if (!Observer) return;
    const observer = new Observer((entries) => entries.forEach(({ target }) => updateLaser(target)));
    cards.forEach((card) => observer.observe(card));
}
