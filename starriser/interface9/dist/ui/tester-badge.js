/** Mount-time annotation, not a permission check. */
export function markTester(element) {
    if (element.dataset.tester === 'true')
        return;
    element.dataset.tester = 'true';
    const badge = document.createElement('span');
    badge.textContent = 'T';
    badge.title = 'Tester tool';
    badge.setAttribute('aria-label', 'Tester tool');
    badge.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:13px;height:13px;min-width:13px;margin-right:5px;border:1px solid #43cf7c;background:#143924;color:#63ee99;font:bold 10px/1 monospace;vertical-align:middle;box-sizing:border-box;contain:strict';
    // Keep an existing label's first grid/flex cell intact; adding a sibling would
    // shift its input/value into the next column or row. This runs only at mount.
    const first = element.firstChild;
    if (element.children.length && first?.nodeType === Node.TEXT_NODE) {
        const title = document.createElement('span');
        element.insertBefore(title, first);
        title.append(badge, first);
    }
    else
        element.prepend(badge);
}
//# sourceMappingURL=tester-badge.js.map