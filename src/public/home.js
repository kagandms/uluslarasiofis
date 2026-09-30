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
    const policies = listPublicDocumentOverview();

    policies.filter((policy) => !policy.group_key).forEach((policy) => {
        const item = document.createElement('li');
        const title = document.createElement('h3');
        const description = document.createElement('p');
        item.className = 'public-document-card';
        title.textContent = messages[policy.label_key] || policy.label_key;
        description.textContent = messages[policy.description_key] || '';
        item.append(title, description);
        if (policy.scope_key === 'homeDocumentUnder18') {
            const badge = document.createElement('span');
            badge.className = 'public-document-badge';
            badge.textContent = messages.homeDocumentUnder18Badge;
            item.append(badge);
        }
        if (policy.scope_key === 'homeDocumentRenewal') {
            const badge = document.createElement('span');
            badge.className = 'public-document-badge is-renewal';
            badge.textContent = messages.homeDocumentRenewal;
            item.append(badge);
        }
        list.append(item);
    });

    const addressPolicies = policies.filter((policy) => policy.group_key === 'address_evidence');
    if (addressPolicies.length) list.append(createAddressEvidenceCard(document, messages, addressPolicies));

    root.replaceChildren(list);
}

function createAddressEvidenceCard(document, messages, policies) {
    const card = document.createElement('li');
    const heading = document.createElement('h3');
    const introduction = document.createElement('p');
    const choices = document.createElement('ul');
    card.className = 'public-document-card public-document-card-address';
    heading.textContent = messages.homeAddressEvidenceHeading;
    introduction.textContent = messages.homeAddressEvidenceIntro;
    choices.className = 'address-evidence-options';
    policies.filter((policy) => policy.parent_code == null).forEach((policy) => {
        const option = document.createElement('li');
        const title = document.createElement('h4');
        const description = document.createElement('p');
        option.className = 'address-evidence-option';
        title.textContent = messages[policy.label_key] || policy.label_key;
        description.textContent = messages[policy.description_key] || '';
        option.append(title, description);
        const supportingDocuments = policies.filter((candidate) => candidate.parent_code === policy.code);
        if (supportingDocuments.length) option.append(createSupportingDocuments(document, messages, supportingDocuments));
        choices.append(option);
    });
    card.append(heading, introduction, choices);
    return card;
}

function createSupportingDocuments(document, messages, policies) {
    const list = document.createElement('ul');
    list.className = 'address-evidence-supporting-docs';
    policies.forEach((policy) => {
        const item = document.createElement('li');
        const title = document.createElement('strong');
        const description = document.createElement('p');
        title.textContent = messages[policy.label_key] || policy.label_key;
        description.textContent = messages[policy.description_key] || '';
        item.append(title, description);
        list.append(item);
    });
    return list;
}
