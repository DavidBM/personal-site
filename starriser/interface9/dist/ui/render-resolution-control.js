import { bindText, bindOptions, setText } from './dom-bindings.js';
export function renderResolutionControl(actions) {
    const row = document.createElement('label');
    row.className = 'quality-select-row';
    Object.assign(row.style, { display: 'grid', gridTemplateColumns: '62px 110px', alignItems: 'center', height: '30px', contain: 'layout style paint' });
    const label = document.createElement('span');
    setText(bindText(label, { width: '62px', height: '18px' }), 'Render');
    const select = document.createElement('select');
    select.id = 'render-resolution';
    select.setAttribute('aria-label', 'Rendering resolution');
    Object.assign(select.style, { width: '110px', height: '28px', font: '10px monospace', color: '#b2c7d8', background: '#09131e' });
    bindOptions(select).update([1, 0.5], String, n => n === 1 ? 'Full · 1×' : 'Half · ½×');
    select.value = String(actions.getRenderScale?.() ?? 1);
    select.title = 'Half width and height (one quarter of the pixels). UI remains full resolution. Applies immediately.';
    select.addEventListener('change', () => actions.setRenderScale?.(Number(select.value)));
    row.append(label, select);
    return row;
}
//# sourceMappingURL=render-resolution-control.js.map