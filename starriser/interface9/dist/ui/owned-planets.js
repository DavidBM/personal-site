import { bindText, setText, setDisabled } from './dom-bindings.js';
/** Retained, bounded page. Thumbnails use existing preview assets, lazy decoded
 * by the browser; no scene rendering, readback or per-frame DOM work. */
export function createOwnedPlanetsPanel(parent, actions) {
    const root = document.createElement('section');
    root.className = 'owned-planets';
    root.setAttribute('aria-label', 'Your planets');
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    const label = bindText(status, { height: '38px', lineHeight: '18px', wrap: true });
    const list = document.createElement('div');
    list.className = 'owned-planet-list';
    const footer = document.createElement('div');
    footer.className = 'owned-planet-actions';
    const button = (parent, text) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; parent.append(b); return b; };
    const first = button(footer, 'First page'), next = button(footer, 'Next page');
    first.disabled = next.disabled = true;
    root.append(status, list, footer);
    parent.append(root);
    let state = { loading: false, first: true, message: '' }, busy = false, closed = false;
    const rows = new Map();
    function createRow(value) {
        const element = document.createElement('article');
        element.className = 'owned-planet';
        const miniature = document.createElement('div');
        miniature.className = 'owned-planet-miniature';
        miniature.setAttribute('aria-hidden', 'true');
        const image = document.createElement('img');
        image.alt = '';
        image.width = image.height = 56;
        image.loading = 'lazy';
        image.decoding = 'async';
        miniature.append(image);
        image.onerror = () => { image.hidden = true; };
        const info = document.createElement('div');
        info.className = 'owned-planet-info';
        const heading = document.createElement('strong'), meta = document.createElement('span');
        info.append(heading, meta);
        const name = bindText(heading, { height: '20px' }), kind = bindText(meta, { height: '18px' });
        const controls = document.createElement('div');
        controls.className = 'owned-planet-actions';
        info.append(controls);
        const go = button(controls, 'Go to'), develop = button(controls, 'Develop');
        element.append(miniature, info);
        const row = { element, image, name, kind, go, develop, value };
        async function run(action) { if (busy || state.loading)
            return; busy = true; render(state); setText(label, 'Travelling to planet…'); try {
            await action(row.value);
            if (!closed)
                setText(label, state.message || 'Your planets across the galaxy');
        }
        catch (e) {
            if (!closed)
                setText(label, e instanceof Error ? e.message : 'Unable to open planet.');
        }
        finally {
            busy = false;
            if (!closed)
                controlsState();
        } }
        go.onclick = () => void run(actions.go);
        develop.onclick = () => void run(actions.develop);
        return row;
    }
    function controlsState() { for (const row of rows.values()) {
        setDisabled(row.go, busy || state.loading);
        setDisabled(row.develop, busy || state.loading);
    } setDisabled(first, busy || state.loading); setDisabled(next, busy || state.loading || !state.page?.next); }
    function render(value) {
        state = value;
        const keep = new Set();
        let position = list.firstChild;
        for (const planet of value.page?.rows ?? []) {
            keep.add(planet.bodyId);
            let row = rows.get(planet.bodyId);
            if (!row) {
                row = createRow(planet);
                rows.set(planet.bodyId, row);
            }
            row.value = planet;
            setText(row.name, planet.name);
            setText(row.kind, planet.kind);
            if (row.element.title !== planet.name)
                row.element.title = planet.name;
            if ((row.image.getAttribute('src') ?? undefined) !== planet.thumbnail) {
                if (planet.thumbnail) {
                    row.image.hidden = false;
                    row.image.src = planet.thumbnail;
                }
                else {
                    row.image.removeAttribute('src');
                    row.image.hidden = true;
                }
            }
            if (row.element !== position)
                list.insertBefore(row.element, position);
            position = row.element.nextSibling;
        }
        for (const [id, row] of rows)
            if (!keep.has(id)) {
                row.element.remove();
                rows.delete(id);
            }
        setText(label, value.loading ? 'Loading your planets…' : value.message || 'Your planets across the galaxy');
        controlsState();
    }
    return { render, first, next, dispose() { closed = true; rows.clear(); root.remove(); } };
}
//# sourceMappingURL=owned-planets.js.map