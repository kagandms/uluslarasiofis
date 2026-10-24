(() => {
    const VERSION = '1.2.109';
    if (globalThis.YknFieldTargets?.version === VERSION) return;
    const LABEL_SELECTOR = 'label, td, th, span, div, dt, b, strong, legend';
    const TEXT_TYPES = new Set(['hidden', 'button', 'submit', 'reset', 'file', 'checkbox', 'radio']);

    function normalize(value) {
        return String(value || '').toLocaleLowerCase('tr-TR').replace(/ı/g, 'i')
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
    }

    function isVisible(control, kind) {
        if (!control?.isConnected || (control.disabled && kind !== 'existing-text')) return false;
        for (let ancestor = control; ancestor; ancestor = ancestor.parentElement) {
            const style = ancestor.ownerDocument.defaultView.getComputedStyle(ancestor);
            if (ancestor.hidden || ancestor.getAttribute('aria-hidden') === 'true'
                || style.display === 'none' || style.visibility === 'hidden') return false;
        }
        return true;
    }

    function isSearchControl(control) {
        const metadata = normalize([control.placeholder, control.title, control.name, control.id].join(' '));
        return ['pasaportbelgeno', 'kabul', 'sorgula', 'search'].some(label => metadata.includes(label));
    }

    function isUsable(control, kind) {
        if (!isVisible(control, kind) || isSearchControl(control)) return false;
        if (kind === 'select') return control.tagName === 'SELECT';
        if (kind === 'radio') return control.tagName === 'INPUT' && control.type === 'radio';
        return ['INPUT', 'TEXTAREA'].includes(control.tagName) && !TEXT_TYPES.has(control.type);
    }

    function readControls(scope, kind) {
        return Array.from(scope.querySelectorAll('input, textarea, select')).filter(control => isUsable(control, kind));
    }

    function readSingleControl(scope, kind) {
        if (!scope) return null;
        if (isUsable(scope, kind)) return scope;
        const controls = readControls(scope, kind);
        return controls.length === 1 ? controls[0] : null;
    }

    function readScopes(root, kind) {
        const headings = Array.from(root.querySelectorAll(LABEL_SELECTOR))
            .filter(node => normalize(node.textContent) === 'ogrencibilgileri');
        if (headings.length === 0) return [root];
        const scopes = new Set();
        for (const heading of headings) {
            for (let scope = heading.parentElement; scope; scope = scope.parentElement) {
                const controls = Array.from(scope.querySelectorAll('input, textarea, select'));
                if (controls.some(isSearchControl)) break;
                if (controls.filter(control => isUsable(control, kind === 'existing-text' ? kind : 'text')).length < 2) continue;
                scopes.add(scope);
                break;
            }
        }
        return [...scopes];
    }

    function readAssociatedControl(node, scope, kind) {
        const targetId = node.getAttribute('for');
        const explicit = targetId ? node.ownerDocument.getElementById(targetId) : null;
        if (explicit && scope.contains(explicit) && isUsable(explicit, kind)) return explicit;
        if (!node.id) return null;
        const controls = readControls(scope, kind).filter(control =>
            (control.getAttribute('aria-labelledby') || '').split(/\s+/).includes(node.id));
        return controls.length === 1 ? controls[0] : null;
    }

    function readPairedControl(node, kind) {
        const cell = node.closest('td, th, .z-cell');
        if (cell && !cell.querySelector('input, textarea, select')) {
            const adjacent = readSingleControl(cell.nextElementSibling, kind);
            if (adjacent) return adjacent;
        }
        if (node.tagName === 'LABEL') {
            const nested = readSingleControl(node, kind);
            if (nested) return nested;
        }
        const sibling = readSingleControl(node.nextElementSibling, kind);
        if (sibling) return sibling;
        const parent = node.parentElement;
        if (!parent || parent.matches('body, html, table, tr, tbody') || parent.querySelector('table')) return null;
        return readSingleControl(parent, kind);
    }

    function readLabelCandidates(scope, labels, kind) {
        const candidates = new Set();
        for (const node of scope.querySelectorAll(LABEL_SELECTOR)) {
            if (!labels.has(normalize(node.textContent))) continue;
            if (node.tagName !== 'LABEL' && node.querySelector('input, textarea, select, table')) continue;
            const control = readAssociatedControl(node, scope, kind) || readPairedControl(node, kind);
            if (control && scope.contains(control)) candidates.add(control);
        }
        return candidates;
    }

    function readMetadataCandidates(scope, labels, kind) {
        return readControls(scope, kind).filter(control =>
            ['aria-label', 'placeholder', 'title', 'name', 'id'].some(attribute => labels.has(normalize(control.getAttribute(attribute)))));
    }

    /**
     * Resolves one student field; existing-text also inspects disabled record controls.
     * @param {{root: Document, labels: readonly string[], kind: string}} options Exact aliases and control kind.
     * @returns {HTMLElement|null} Unique matching control, or null for unavailable/ambiguous fields.
     */
    function find(options) {
        const labels = new Set(options.labels.map(normalize).filter(Boolean));
        const candidates = new Set();
        for (const scope of readScopes(options.root, options.kind)) {
            const matches = readLabelCandidates(scope, labels, options.kind);
            const controls = matches.size ? matches : readMetadataCandidates(scope, labels, options.kind);
            for (const control of controls) candidates.add(control);
        }
        return candidates.size === 1 ? [...candidates][0] : null;
    }

    globalThis.YknFieldTargets = Object.freeze({ version: VERSION, find });
})();
