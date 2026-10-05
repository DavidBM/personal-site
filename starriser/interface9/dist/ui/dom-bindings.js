/** Mount-time binding for a text-only leaf. Its owner retains this Text until teardown.
 * Never bind a container with controls/children; give the label its own span instead. */
export function bindText(element, bounds = {}) {
    const child = element.firstChild;
    if (child && !(child.nodeType === 3 && !child.nextSibling))
        throw new Error('bindText requires an empty or text-only leaf');
    boundText(element, bounds);
    if (child?.nodeType === 3 && !child.nextSibling)
        return child;
    const node = document.createTextNode('');
    element.appendChild(node);
    return node;
}
/** Reserve layout space at mount, including a local scroll area for long messages. */
function boundText(leaf, bounds) {
    if (!document.getElementById('ui-live-text-styles')) {
        const style = document.createElement('style');
        style.id = 'ui-live-text-styles';
        style.textContent = '.ui-live-text[hidden]{display:none!important}';
        document.head.appendChild(style);
    }
    leaf.classList.add('ui-live-text');
    // All sizing is mount-time. A glyph update never changes these rules or the box.
    Object.assign(leaf.style, {
        display: 'inline-block', boxSizing: 'border-box', verticalAlign: 'middle',
        width: bounds.width ?? '100%', height: bounds.height ?? '1.4em', minWidth: '0',
        lineHeight: bounds.lineHeight ?? '1.4', contain: 'strict',
        // A single-line label clips; it does not need its own scroll container.
        overflow: bounds.wrap ? 'auto' : 'clip', whiteSpace: bounds.wrap ? 'normal' : 'nowrap',
        overflowWrap: bounds.wrap ? 'anywhere' : 'normal', textOverflow: 'ellipsis',
    });
    if (bounds.wrap)
        leaf.tabIndex = 0;
}
/** No DOM mutation when the displayed value is unchanged. */
export function setText(node, value) {
    if (node.data !== value)
        node.data = value;
}
/** Native select options retain identity and selection across observation events. */
export function bindOptions(select) {
    const rows = new Map();
    return {
        update(values, key, label) {
            const selected = select.value, live = new Set();
            let cursor = select.firstChild;
            for (const value of values) {
                const id = key(value);
                live.add(id);
                let row = rows.get(id);
                if (!row) {
                    const element = document.createElement('option');
                    element.value = id;
                    // Native option labels inherit the select's reserved width and overflow.
                    const text = document.createTextNode('');
                    element.append(text);
                    row = { element, text };
                    rows.set(id, row);
                }
                setText(row.text, label(value));
                if (cursor !== row.element)
                    select.insertBefore(row.element, cursor);
                cursor = row.element.nextSibling;
            }
            for (const [id, row] of rows)
                if (!live.has(id)) {
                    row.element.remove();
                    rows.delete(id);
                }
            if (rows.has(selected))
                select.value = selected;
        },
        clear() { rows.clear(); select.replaceChildren(); },
    };
}
export function setHidden(element, hidden) {
    if (element.hidden !== hidden)
        element.hidden = hidden;
}
export function setDisabled(element, disabled) {
    if (element.disabled !== disabled)
        element.disabled = disabled;
}
//# sourceMappingURL=dom-bindings.js.map