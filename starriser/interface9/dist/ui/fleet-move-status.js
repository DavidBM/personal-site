import { bindText, setText, setHidden } from './dom-bindings.js';
/** One compact instruction/status surface; it owns no fleet or camera state. */
export function createFleetMoveStatus(parent, cancel) {
    const element = document.createElement('div');
    element.id = 'fleet-move-status';
    element.role = 'status';
    element.setAttribute('aria-live', 'polite');
    element.hidden = true;
    element.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:1100;padding:7px 10px;background:#051017ed;border:1px solid #345064;border-radius:4px;color:#b7d6e4;font:11px/1.4 monospace;width:min(680px,80vw)';
    const label = document.createElement('span');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Cancel';
    button.style.cssText = 'margin-left:10px;border:1px solid #487186;border-radius:3px;background:#132d3b;color:#c6e5f0;font:inherit;cursor:pointer';
    button.addEventListener('click', cancel);
    element.append(label, button);
    parent.append(element);
    const labelText = bindText(label, { width: 'calc(100% - 76px)', height: '2.8em', wrap: true });
    let notice = '', noticeUntil = 0;
    return {
        notice(text) { notice = text; noticeUntil = performance.now() + 2400; },
        update(text, armed = false) {
            const shown = text && performance.now() < noticeUntil ? notice : text;
            setText(labelText, shown);
            setHidden(element, !shown);
            setHidden(button, !armed);
            if (element.dataset.armed !== String(armed))
                element.dataset.armed = String(armed);
        },
        clearNotice() { noticeUntil = 0; },
        dispose() { element.remove(); },
    };
}
//# sourceMappingURL=fleet-move-status.js.map