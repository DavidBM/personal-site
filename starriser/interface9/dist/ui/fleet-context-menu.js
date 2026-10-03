import { menuBottomInset } from './mobile-layout.js';
import { bindText, setText } from './dom-bindings.js';
/** Small fleet-only menu. Async picks cannot reopen a dismissed or superseded menu. */
export function createFleetContextMenu(parent, actions) {
    const menu = document.createElement('div');
    menu.id = 'fleet-context-menu';
    menu.role = 'menu';
    menu.hidden = true;
    Object.assign(menu.style, { position: 'fixed', zIndex: '1200', width: '190px', padding: '5px', maxHeight: '80vh', overflowY: 'auto', contain: 'layout paint',
        background: 'rgba(5,12,23,.97)', border: '1px solid #345064', borderRadius: '5px',
        color: '#c5d6e4', font: '11px/1.4 monospace', boxShadow: '0 4px 20px #0008' });
    const style = document.createElement('style');
    style.textContent = '#fleet-context-menu [hidden]{display:none}#fleet-context-menu button{width:100%;display:flex;justify-content:space-between;gap:6px;padding:4px 6px;background:transparent;border:0;border-radius:3px;color:inherit;font:inherit;cursor:pointer;text-align:left}#fleet-context-menu button:hover,#fleet-context-menu button:focus-visible{background:#173347;color:#91efff;outline:1px solid #477b94}';
    menu.append(style);
    parent.append(menu);
    let generation = 0, closed = false;
    function hide() { generation++; menu.hidden = true; }
    function button(label, detail, action, host = menu) {
        const b = document.createElement('button');
        b.type = 'button';
        b.role = 'menuitem';
        const name = document.createElement('span'), meta = document.createElement('span');
        name.textContent = label;
        meta.textContent = detail;
        meta.style.color = '#8ab6cc';
        b.append(name, meta);
        b.addEventListener('click', () => { hide(); action(); });
        host.append(b);
        return { element: b, name: bindText(name, { width: '68%' }), meta: bindText(meta, { width: '32%' }) };
    }
    let current = null;
    const title = document.createElement('div'), titleText = bindText(title, { height: '28px' });
    title.style.cssText += ';padding:3px 6px 5px;color:#83a4ba;font-size:10px';
    menu.append(title);
    const select = button('Select fleet', '↖', () => { if (current)
        actions.select(current.id); });
    const move = button('Move fleet…', 'RMB', () => { if (current)
        actions.move?.(current.id); });
    button('Follow a ship', '→', () => { if (current)
        actions.follow(current.id); });
    const types = document.createElement('div');
    menu.append(types);
    const typeButtons = new Map();
    const rotation = button('Camera rotation', '', () => actions.setFollowRotation?.(!actions.followRotation?.()));
    const stop = button('Stop following', '■', actions.stop);
    const attack = button('Fight', '→', () => { if (current)
        actions.attack(current.id); });
    const endBattle = button('End battle', '■', () => { if (current)
        actions.endBattle?.(current.id); });
    function syncTypes(fleet) {
        const live = new Set();
        let cursor = types.firstChild;
        for (const type of fleet.types) {
            live.add(type.type);
            let row = typeButtons.get(type.type);
            if (!row) {
                row = button('', '', () => { if (current)
                    actions.follow(current.id, type.type); }, types);
                typeButtons.set(type.type, row);
            }
            setText(row.name, type.name);
            setText(row.meta, `${type.count}  →`);
            if (cursor !== row.element)
                types.insertBefore(row.element, cursor);
            cursor = row.element.nextSibling;
        }
        for (const [id, row] of typeButtons)
            if (!live.has(id)) {
                row.element.remove();
                typeButtons.delete(id);
            }
    }
    function populate(fleet) {
        current = fleet;
        endBattle.element.hidden = !fleet.battle;
        setText(titleText, `FLEET · ${fleet.types.reduce((n, row) => n + row.count, 0)} ships in view`);
        if (title.title !== fleet.id)
            title.title = fleet.id;
        move.element.hidden = !fleet.move;
        stop.element.hidden = !fleet.following;
        attack.element.hidden = !fleet.attack;
        rotation.element.hidden = !fleet.following;
        setText(rotation.meta, actions.followRotation?.() === false ? 'Fixed' : 'Hull');
        syncTypes(fleet);
    }
    async function openAt(x, y, load, onEmpty) {
        hide();
        const token = generation;
        let fleet;
        try {
            fleet = await load();
        }
        catch {
            return;
        }
        if (closed || token !== generation)
            return;
        if (!fleet) {
            onEmpty?.();
            return;
        }
        if (!fleet.types.length)
            return;
        populate(fleet);
        menu.hidden = false;
        const rect = menu.getBoundingClientRect();
        menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - rect.width - 4))}px`;
        menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - rect.height - menuBottomInset()))}px`;
        select.element.focus({ preventScroll: true });
    }
    const outside = (event) => { if (!menu.contains(event.target))
        hide(); };
    const key = (event) => { if (event.key === 'Escape')
        hide(); };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', key);
    return { openAt, hide, dispose() {
            closed = true;
            current = null;
            typeButtons.clear();
            hide();
            menu.remove();
            document.removeEventListener('pointerdown', outside, true);
            document.removeEventListener('keydown', key);
        } };
}
//# sourceMappingURL=fleet-context-menu.js.map