import { searchNationalityCountries as searchCountryNames } from './countryData.js';

let nextListId = 0;

/** @param {string} query @param {string} locale @returns {Array<{code: string, name: string}>} */
export function searchNationalityCountries(query, locale) {
    return searchCountryNames(query, locale);
}

/** @param {string} locale @returns {Array<{code: string, name: string}>} */
export { listNationalityCountries } from './countryData.js';

/** @param {Document} document @param {{value: string, locale: string, messages: object}} options @returns {HTMLElement} */
export function createNationalityField(document, { value, locale, messages }) {
    const wrapper = document.createElement('div');
    const label = document.createElement('label');
    const input = document.createElement('input');
    const list = document.createElement('ul');
    const listId = `nationality-options-${++nextListId}`;
    wrapper.className = 'nationality-field application-form-field';
    label.htmlFor = 'field-nationality';
    label.textContent = messages.nationality;
    input.id = 'field-nationality';
    input.name = 'nationality';
    input.type = 'text';
    input.required = true;
    input.setAttribute('aria-required', 'true');
    input.maxLength = 255;
    input.autocomplete = 'country-name';
    input.value = value ?? '';
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', listId);
    list.id = listId;
    list.className = 'nationality-suggestions';
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    let activeOptionIndex = -1;
    let isDispatchingSelection = false;

    function close() {
        list.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
        activeOptionIndex = -1;
        list.querySelectorAll('[role="option"]').forEach((option) => {
            option.setAttribute('aria-selected', 'false');
            option.classList.remove('is-active');
        });
    }
    function setActiveOption(index) {
        const options = [...list.querySelectorAll('[role="option"]')];
        activeOptionIndex = index;
        options.forEach((option, optionIndex) => {
            const isActive = optionIndex === activeOptionIndex;
            option.setAttribute('aria-selected', String(isActive));
            option.classList.toggle('is-active', isActive);
        });
        const activeOption = options[activeOptionIndex];
        if (!activeOption) return;
        input.setAttribute('aria-activedescendant', activeOption.id);
        activeOption.scrollIntoView?.({ block: 'nearest' });
    }
    function showSuggestions() {
        activeOptionIndex = -1;
        input.removeAttribute('aria-activedescendant');
        const suggestions = searchCountryNames(input.value, locale);
        list.replaceChildren(...suggestions.map((country, index) => {
            const option = document.createElement('li');
            option.id = `${listId}-option-${index}`;
            option.role = 'option';
            option.setAttribute('aria-selected', 'false');
            option.dataset.countryCode = country.code;
            option.textContent = country.name;
            option.addEventListener('mousedown', (event) => event.preventDefault());
            option.addEventListener('click', () => {
                input.value = country.name;
                close();
                isDispatchingSelection = true;
                try {
                    input.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
                } finally {
                    isDispatchingSelection = false;
                }
            });
            return option;
        }));
        list.hidden = suggestions.length === 0;
        input.setAttribute('aria-expanded', String(suggestions.length > 0));
    }
    input.addEventListener('input', () => {
        if (!isDispatchingSelection) showSuggestions();
    });
    input.addEventListener('keydown', (event) => {
        const options = [...list.querySelectorAll('[role="option"]')];
        if (event.key === 'ArrowDown' && options.length) {
            event.preventDefault();
            setActiveOption(Math.min(activeOptionIndex + 1, options.length - 1));
        }
        if (event.key === 'ArrowUp' && activeOptionIndex >= 0) {
            event.preventDefault();
            setActiveOption(Math.max(activeOptionIndex - 1, 0));
        }
        if (event.key === 'Enter' && activeOptionIndex >= 0) {
            event.preventDefault();
            options[activeOptionIndex].click();
        }
        if (event.key === 'Escape') close();
    });
    input.addEventListener('blur', () => close());
    wrapper.append(label, input, list);
    return wrapper;
}
