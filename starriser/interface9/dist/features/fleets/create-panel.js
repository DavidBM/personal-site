import { bindText, setText } from '../../ui/dom-bindings.js';
import { menuBottomInset } from '../../ui/mobile-layout.js';
import { MAX_AUTHORED_SHIPS } from './contracts.js';
/** Retained local-authoring form. Six counts cross the worker boundary once. */
export function createFleetCreationMenu(parent, submit) {
    const menu = document.createElement('div');
    menu.id = 'fleet-create-menu';
    menu.hidden = true;
    menu.style.cssText = 'position:fixed;z-index:1200;width:240px;padding:8px;background:#050c17f7;border:1px solid #345064;border-radius:5px;color:#c5d6e4;font:11px/1.5 monospace;overflow-y:auto;max-height:75vh';
    const start = document.createElement('button');
    start.className = 'micro-btn';
    start.textContent = 'Create fleet…';
    start.type = 'button';
    const form = document.createElement('form');
    form.hidden = true;
    const names = ['Interceptors', 'Fighters', 'Bombers', 'Frigates', 'Battleships', 'Colossi'];
    const inputs = names.map((name, i) => {
        const label = document.createElement('label');
        label.style.cssText = 'display:flex;justify-content:space-between;margin:5px 0';
        label.append(document.createTextNode(name));
        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'ui-input';
        input.min = '0';
        input.max = String(MAX_AUTHORED_SHIPS);
        input.step = '1';
        input.value = i === 1 ? '1000' : '0';
        input.style.cssText = 'width:80px;box-sizing:border-box;font:inherit';
        input.name = name;
        label.append(input);
        form.append(label);
        return input;
    });
    const relationship = document.createElement('select');
    relationship.className = 'ui-select';
    relationship.style.font = 'inherit';
    relationship.name = 'relationship';
    relationship.setAttribute('aria-label', 'Fleet relationship');
    for (const name of ['own', 'enemy', 'ally', 'neutral']) {
        const o = document.createElement('option');
        o.value = name;
        o.textContent = name;
        relationship.append(o);
    }
    form.append(relationship);
    const status = document.createElement('div'), text = bindText(status, { width: '224px', height: '36px', wrap: true });
    form.append(status);
    const create = document.createElement('button');
    create.className = 'micro-btn';
    create.type = 'submit';
    create.textContent = 'Create fleet';
    form.append(create);
    const cancel = document.createElement('button');
    cancel.className = 'micro-btn';
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    form.append(cancel);
    menu.append(start, form);
    parent.append(menu);
    let request = null;
    const hide = () => { menu.hidden = true; request = null; };
    const counts = () => inputs.map(i => Number(i.value));
    function validate() {
        const values = counts(), total = values.reduce((a, b) => a + b, 0);
        const valid = inputs.every(i => i.value !== '' && i.validity.valid) && Number.isInteger(total) && total > 0 && total <= MAX_AUTHORED_SHIPS;
        create.disabled = !valid;
        setText(text, valid ? `${total.toLocaleString()} / ${MAX_AUTHORED_SHIPS.toLocaleString()} ships · scene budget applies` : `Choose 1–${MAX_AUTHORED_SHIPS.toLocaleString()} ships in total`);
        return valid;
    }
    function place(x, y) { const r = menu.getBoundingClientRect(); menu.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`; menu.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - menuBottomInset()))}px`; }
    let x = 0, y = 0;
    start.onclick = () => { start.hidden = true; form.hidden = false; validate(); place(x, y); inputs[0].focus(); };
    form.oninput = validate;
    cancel.onclick = hide;
    form.onsubmit = e => {
        e.preventDefault();
        if (!request || !validate())
            return;
        const value = { ...request, classes: counts(), relationship: relationship.value };
        hide();
        submit(value);
    };
    const outside = (e) => { if (!menu.contains(e.target))
        hide(); };
    const key = (e) => { if (e.key === 'Escape')
        hide(); };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', key);
    return { open(atX, atY, value) { request = value; x = atX; y = atY; start.hidden = false; form.hidden = true; menu.hidden = false; place(x, y); start.focus(); }, hide,
        dispose() { hide(); menu.remove(); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', key); } };
}
//# sourceMappingURL=create-panel.js.map