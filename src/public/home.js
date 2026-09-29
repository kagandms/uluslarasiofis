import { SESSION3_MESSAGES, PUBLIC_MESSAGES } from './i18n/messages.js';
import { listPublicDocumentOverview } from '../server/domain/documentPolicy.js';

function readMessages(locale) {
    return { ...(SESSION3_MESSAGES[locale] || SESSION3_MESSAGES.tr), ...(PUBLIC_MESSAGES[locale] || PUBLIC_MESSAGES.tr) };
}

/**
 * Renders the current residence-document policy as concise public guidance.
 * @param {HTMLElement} root Document overview mount element.
 * @param {string} locale Active public locale.
 * @returns {void} Replaces the document overview content.
 */
export function renderPublicDocumentOverview(root, locale) {
    const document = root.ownerDocument;
    const messages = readMessages(locale);
    const list = document.createElement('ul');
    list.className = 'public-document-list';

    listPublicDocumentOverview().forEach((policy) => {
        const item = document.createElement('li');
        const title = document.createElement('h3');
        const scope = document.createElement('p');
        item.className = 'public-document-card';
        title.textContent = messages[policy.label_key] || policy.label_key;
        scope.textContent = messages[policy.scope_key];
        item.append(title, scope);
        if (policy.scope_key === 'homeDocumentUnder18') {
            const badge = document.createElement('span');
            badge.className = 'public-document-badge';
            badge.textContent = messages.homeDocumentUnder18Badge;
            item.append(badge);
        }
        list.append(item);
    });

    root.replaceChildren(list);
}
