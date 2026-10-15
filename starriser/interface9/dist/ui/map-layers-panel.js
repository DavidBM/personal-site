import { mapLayers } from '../contracts/map-layers.js';
import { screenAnchor } from './dock-layout.js';
export function loadMapLayers() { try {
    return mapLayers(JSON.parse(localStorage.getItem('galaxy-map-layers') ?? 'null'));
}
catch {
    return mapLayers(null);
} }
export function createMapLayersPanel(ctx, value, changed) {
    const panel = ctx.panel({ id: 'map-layers-panel', title: 'Map display', className: 'map-layers-panel' });
    panel.element.id = 'map-layers-panel';
    const style = document.createElement('style');
    style.textContent = '.map-layers-panel [hidden]{display:none!important}';
    panel.element.append(style);
    const close = document.createElement('button');
    close.textContent = '×';
    close.className = 'cluster-survey-close';
    close.setAttribute('aria-label', 'Close map display');
    close.onclick = () => window.dispatchEvent(new CustomEvent('galaxy:hide-panel', { detail: 'map-layers-panel' }));
    panel.element.querySelector('.ui-panel-title')?.append(close);
    let section = 'galaxy';
    const tabs = document.createElement('div');
    tabs.role = 'tablist';
    tabs.setAttribute('aria-label', 'Map section');
    tabs.style.cssText = 'display:flex;gap:4px;margin:8px 0';
    panel.content.append(tabs);
    const buttons = new Map(), inputs = new Map();
    function select(key) { section = key; for (const [id, button] of buttons) {
        const active = id === key;
        button.setAttribute('aria-selected', String(active));
        button.style.background = active ? '#21465a' : '#0a1923';
        button.tabIndex = active ? 0 : -1;
    } for (const [id, input] of inputs) {
        input.checked = value[key][id];
        input.parentElement.hidden = key === 'system' ? !['planetOwners', 'ownPlanets'].includes(id) : id === 'planetOwners';
    } }
    for (const key of ['galaxy', 'cluster', 'system']) {
        const b = document.createElement('button');
        b.type = 'button';
        b.role = 'tab';
        b.textContent = key[0].toUpperCase() + key.slice(1);
        b.style.cssText = 'flex:1;padding:6px 0;border:1px solid #345064;color:inherit;font:inherit';
        b.onclick = () => select(key);
        b.onkeydown = event => { if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft')
            return; event.preventDefault(); const keys = [...buttons.keys()], next = keys[(keys.indexOf(section) + (event.key === 'ArrowRight' ? 1 : 2)) % 3]; select(next); buttons.get(next).focus(); };
        buttons.set(key, b);
        tabs.append(b);
    }
    const names = { ownFleets: 'My fleet markers', ownRoutes: 'My fleet routes', ownPlanets: 'My planet pins', systemColors: 'Ownership colors', planetOwners: 'Planet owners and stationed ships' };
    for (const key of Object.keys(names)) {
        const label = document.createElement('label'), input = document.createElement('input');
        input.type = 'checkbox';
        input.dataset.layer = key;
        label.style.cssText = 'display:flex;align-items:center;gap:8px;height:32px';
        label.append(input, document.createTextNode(names[key]));
        panel.content.append(label);
        inputs.set(key, input);
        input.onchange = () => { value = { ...value, [section]: { ...value[section], [key]: input.checked } }; try {
            localStorage.setItem('galaxy-map-layers', JSON.stringify(value));
        }
        catch { } changed(value); };
    }
    const legend = document.createElement('p');
    legend.style.cssText = 'font-size:11px;line-height:18px;height:72px';
    legend.textContent = 'Each map section has its own settings. Green: your planets · Yellow: neutral · Red: enemies. Ship badges require one of your fleets or planets in that system.';
    panel.content.append(legend);
    select(section);
    return { dock: { id: 'map-layers-panel', title: 'Map display', element: panel.element, initiallyHidden: true, anchor: screenAnchor('right', 'top', 56, 12, 320, 338) }, dispose() { panel.element.remove(); } };
}
//# sourceMappingURL=map-layers-panel.js.map