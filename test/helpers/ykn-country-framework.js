function createOptionWidgets(select) {
    const children = Array.from(select.options).map((option, index) => {
        option.id ||= `${select.id}-option-${index}`;
        return { uuid: option.id, className: 'zul.sel.Option', nextSibling: null };
    });
    children.forEach((child, index) => { child.nextSibling = children[index + 1] || null; });
    return children;
}

function completeCountryRequest(framework, selection) {
    const { select, widget, name, payload } = selection;
    const selected = Array.from(select.options).find(option => option.id === payload.reference);
    if (name === 'onSelect' && selected && payload.items?.includes(selected.id)) {
        framework.serverValues.set(select.id, framework.options.reject ? '' : selected.value);
        if (framework.options.reject) widget.setSelectedIndex(0);
    }
    if (framework.options.rerender) {
        const replacement = select.cloneNode(true);
        replacement.value = framework.serverValues.get(select.id) || '';
        select.replaceWith(replacement);
        mountCountrySelect(framework, replacement);
    }
    framework.isProcessing = false;
    if (!framework.options.noResponse) for (const listener of framework.listeners) listener.onResponse();
}

function createCountryWidget(framework, select) {
    return {
        className: 'zul.sel.Select', firstChild: createOptionWidgets(select)[0],
        _selectedIndex: framework.options.staleWidget ? -1 : select.selectedIndex,
        getSelectedIndex() { return this._selectedIndex; },
        setSelectedIndex(index) { this._selectedIndex = index; select.selectedIndex = index; },
        // Live zul.sel.Select._doChange sends option widget IDs through onSelect.
        _doChange() {
            if (this._selectedIndex === select.selectedIndex) return;
            this.setSelectedIndex(select.selectedIndex);
            const reference = select.options[select.selectedIndex].id;
            this.fire('onSelect', { items: [reference], reference });
        },
        fire(name, payload) {
            framework.events.push({ id: select.id, name, payload });
            framework.isProcessing = true;
            framework.window.queueMicrotask(() => completeCountryRequest(framework, { select, widget: this, name, payload }));
        }
    };
}

function mountCountrySelect(framework, select) {
    framework.widgets.set(select, createCountryWidget(framework, select));
}

/**
 * Installs the observed ZK Select/onSelect contract and a separate server model.
 * @param {Window} window JSDOM target window.
 * @param {object} options Response, rejection and rerender scenarios.
 * @returns {object} Recorded AU events, server values and response listeners.
 */
export function installCountryFramework(window, options = {}) {
    const framework = { window, options, widgets: new WeakMap(), listeners: new Set(),
        events: [], serverValues: new Map(), isProcessing: false };
    for (const select of window.document.querySelectorAll('select')) mountCountrySelect(framework, select);
    window.zk = { Widget: { $: element => framework.widgets.get(element) }, Desktop: { all: { current: {} } } };
    window.zAu = { processing: () => framework.isProcessing, getAuRequests: () => options.queue || [] };
    window.zWatch = {
        listen: ({ onResponse }) => framework.listeners.add(onResponse),
        unlisten: ({ onResponse }) => framework.listeners.delete(onResponse)
    };
    return { events: framework.events, serverValues: framework.serverValues, listeners: framework.listeners };
}
