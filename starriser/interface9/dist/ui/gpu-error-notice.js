import { bindText, setText } from './dom-bindings.js';
/** Runtime GPU errors do not terminate the worker: a different view may work. */
export function createGpuErrorNotice(parent) {
    const element = document.createElement('section');
    element.hidden = true;
    element.role = 'status';
    element.style.cssText = 'position:fixed;left:50%;bottom:calc(64px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:1101;width:min(540px,85vw);box-sizing:border-box;padding:10px;background:#111720f5;border:1px solid #b47b70;color:#edb2a6;font:11px/1.4 monospace';
    const heading = document.createElement('div');
    heading.textContent = 'GPU frame error · first reported causes';
    const detail = document.createElement('div');
    const text = bindText(detail, { height: '12em', wrap: true });
    detail.style.cssText += ';overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;user-select:text';
    const close = document.createElement('button');
    close.textContent = 'Dismiss';
    close.addEventListener('click', () => { element.hidden = true; });
    element.append(heading, detail, close);
    parent.append(element);
    const messages = [];
    return {
        update(message) {
            if (messages.length >= 3 || messages.includes(message))
                return;
            messages.push(message);
            setText(text, messages.join('\n\n'));
            element.hidden = false;
        },
        dispose() { element.remove(); },
    };
}
//# sourceMappingURL=gpu-error-notice.js.map