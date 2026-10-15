import { SURVEY_RELATIONSHIP_COLORS, SURVEY_RELATIONSHIP_NAMES } from '../contracts/survey-signals.js';
import { bindText, setText } from './dom-bindings.js';
import { screenAnchor } from './dock-layout.js';
const SECTIONS = ['fleets', 'systems', 'inbound', 'outbound', 'planets', 'battles', 'details'];
const TITLES = { fleets: 'Fleets', systems: 'Systems', inbound: 'Inbound', outbound: 'Outbound', planets: 'Planets', battles: 'Battles', details: 'Details' };
const PAGE_SIZE = 32;
/** One retained sidebar, 32 reusable rows, refreshed only while open (at most once/second). */
export function createClusterSurveyPanel(ctx, options) {
    const panel = ctx.panel({ id: 'cluster-survey-panel', title: 'Cluster', className: 'cluster-survey-panel' });
    panel.element.id = 'cluster-survey-panel';
    const close = button('×', () => window.dispatchEvent(new CustomEvent('galaxy:hide-panel', { detail: 'cluster-survey-panel' })));
    close.className = 'cluster-survey-close';
    close.setAttribute('aria-label', 'Close cluster sidebar');
    panel.element.querySelector('.ui-panel-title')?.append(close);
    const heading = leaf('h3'), summary = leaf('p'), status = leaf('p', '4.3em');
    const legend = document.createElement('div');
    legend.className = 'cluster-survey-legend';
    const relationships = SURVEY_RELATIONSHIP_NAMES.map((name, i) => {
        const label = leaf('span');
        label.element.style.color = `rgb(${SURVEY_RELATIONSHIP_COLORS[i].map(c => Math.round(c * 255)).join(',')})`;
        legend.append(label.element);
        return { ...label, name };
    });
    const tabs = document.createElement('div');
    tabs.className = 'cluster-survey-tabs';
    const list = document.createElement('div');
    list.className = 'cluster-survey-list';
    const footer = document.createElement('div');
    footer.className = 'cluster-survey-footer';
    const count = leaf('span');
    let hit = null, offset = 0, total = 0, generation = 0, busy = false, disposed = false;
    const tabButtons = SECTIONS.map(section => button(TITLES[section], () => {
        if (hit)
            open({ ...hit, section });
    }));
    tabs.append(...tabButtons);
    const rows = Array.from({ length: PAGE_SIZE }, () => createRow((row, section) => { if (hit)
        options.focus(row, section ?? hit.section); }));
    list.append(...rows.map(row => row.element));
    const previous = button('Previous', () => changePage(-PAGE_SIZE));
    const next = button('Next', () => changePage(PAGE_SIZE));
    footer.append(previous, count.element, next);
    panel.content.append(heading.element, summary.element, tabs, status.element, legend, list, footer);
    setText(status.text, 'Choose a cluster ribbon on the map.');
    const timer = window.setInterval(() => { if (hit && !panel.element.classList.contains('dock-user-hidden'))
        void refresh(); }, 1000);
    const dock = { id: 'cluster-survey-panel', title: 'Cluster', element: panel.element,
        initiallyHidden: true, anchor: screenAnchor('right', 'top', 56, 12, 340, 580) };
    function reset() {
        generation++;
        busy = false;
        hit = null;
        total = 0;
        offset = 0;
        for (const row of rows)
            row.update(null);
        legend.hidden = true;
        setText(heading.text, 'Cluster');
        setText(summary.text, '');
        setText(count.text, '');
        setText(status.text, 'Choose a cluster ribbon on the map.');
        previous.disabled = next.disabled = true;
    }
    function open(value) {
        reset();
        hit = value;
        tabButtons.forEach((button, i) => button.setAttribute('aria-pressed', String(SECTIONS[i] === value.section)));
        setText(status.text, 'Loading known cluster information…');
        window.dispatchEvent(new CustomEvent('galaxy:show-panel', { detail: dock.id }));
        void refresh();
    }
    function changePage(delta) {
        offset = Math.max(0, Math.min(Math.max(0, total - 1), offset + delta));
        generation++;
        busy = false;
        void refresh();
    }
    async function refresh() {
        if (!hit || busy || disposed)
            return;
        busy = true;
        const current = generation;
        try {
            const page = await options.query(hit, offset);
            if (current !== generation)
                return;
            if (!page) {
                reset();
                setText(status.text, 'This cluster is no longer available.');
                return;
            }
            paint(page);
        }
        catch {
            if (current === generation) {
                reset();
                setText(status.text, 'Cluster information is unavailable. Select its ribbon to retry.');
            }
        }
        finally {
            if (current === generation)
                busy = false;
        }
    }
    function paint(page) {
        total = page.total;
        if (offset >= total && offset > 0) {
            offset = Math.max(0, Math.floor((total - 1) / PAGE_SIZE) * PAGE_SIZE);
            return;
        }
        setText(heading.text, page.name);
        setText(summary.text, summaryText(page));
        setText(status.text, statusText(page, options.online));
        legend.hidden = !page.relationships?.some(n => n > 0);
        relationships.forEach((label, i) => {
            const n = page.relationships?.[i] ?? 0;
            label.element.hidden = n === 0;
            setText(label.text, `${label.name} · ${n} ships`);
        });
        for (let i = 0; i < rows.length; i++)
            rows[i].update(page.rows[i] ?? null, page.section);
        setText(count.text, total ? `${offset + 1}–${Math.min(offset + PAGE_SIZE, total)} / ${total}` : '');
        previous.disabled = offset === 0;
        next.disabled = offset + PAGE_SIZE >= total;
        footer.hidden = page.section === 'details' || total <= PAGE_SIZE;
    }
    const dispose = () => { disposed = true; generation++; window.clearInterval(timer); };
    ctx.root.register({ id: 'cluster-survey-lifetime', kind: 'container', element: panel.content, destroy: dispose });
    return { dock, open, reset, dispose };
}
function statusText(page, online) {
    if (!page.loaded && !page.fleets && !page.planets)
        return 'System information is not loaded yet. Move closer to explore this cluster.';
    if (page.section === 'battles')
        return battleStatus(page, online);
    if (page.owned && page.section === 'fleets')
        return 'Your fleets in this view, including incoming and outgoing journeys. Choose Focus to visit.';
    if (page.owned && page.section === 'planets')
        return 'Your planets in this view. Choose Planet when its map is available, or System to visit.';
    if (page.section === 'planets')
        return 'Choose Planet to view the planet, or System to enter its solar system. Other systems may contain more.';
    if (page.section === 'details')
        return `${page.inbound} inbound · ${page.outbound} outbound. Choose a section above; Focus moves the camera.`;
    if (page.section === 'systems')
        return 'Known systems. Choose Focus to enter a system.';
    if (page.total === 0)
        return online ? 'No observed fleets here. Unobserved forces may still be present.' : 'No known fleets in this view.';
    return online ? 'Your fleet roster and visible fleets. Choose Focus to visit; other forces may be unknown.'
        : `${TITLES[page.section]} in this cluster. Choose Focus to visit; browsing keeps the camera in place.`;
}
function battleStatus(page, online) {
    return online ? `${page.alertsPartial ? 'First 64 known alerts. ' : ''}Red center: your forces in battle. Alerts update independently of the open system.` : 'Red center: your forces in battle. Amber: allied forces. Only current, known battles are listed.';
}
function createRow(focus) {
    const element = document.createElement('div');
    element.className = 'cluster-survey-row';
    element.hidden = true;
    const info = document.createElement('div'), name = leaf('strong'), detail = leaf('span');
    info.append(name.element, detail.element);
    let value = null;
    const action = button('Focus', () => { if (value)
        focus(value); });
    const actionText = action.firstChild;
    const system = button('System', () => { if (value)
        focus(value, 'systems'); });
    system.hidden = true;
    element.append(info, action, system);
    return { element, update(row, section) {
            value = row;
            element.hidden = row === null;
            if (!row)
                return;
            setText(name.text, row.name);
            setText(detail.text, row.relationship ? `${row.relationship.toUpperCase()} · ${row.ships === undefined ? 'Ships unknown' : `${row.ships} ships`} · ${row.state}` : planetDetail(row));
            element.dataset.relationship = row.relationship ?? '';
            const planet = section === 'planets';
            system.hidden = !planet;
            system.setAttribute('aria-label', `View system for ${row.name}`);
            setText(actionText, planet ? 'Planet' : row.kind === 'battle' ? 'View system' : 'Focus');
            action.setAttribute('aria-label', `${planet ? 'View planet' : 'Focus'} ${row.name}`);
            element.title = row.id;
        } };
}
function planetDetail(row) {
    if (row.mapReady === undefined)
        return row.kind ?? 'Solar system';
    return `${row.kind} · ${row.mapReady ? 'Map ready' : 'Map unprepared'}${row.catalogId ? '' : ' · No visual link'}`;
}
function leaf(tag, height = '1.5em') {
    const element = document.createElement(tag);
    return { element, text: bindText(element, { height, wrap: height !== '1.5em' }) };
}
function button(label, click) {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = label;
    element.addEventListener('click', click);
    return element;
}
function summaryText(page) {
    if (!page.loaded)
        return `${page.fleets} known fleets · System map not loaded`;
    const scope = page.systemId === undefined ? `${page.systems} systems · ` : '';
    return `${scope}${page.fleets} known fleets · ${page.planets ?? 0} known planets`;
}
//# sourceMappingURL=cluster-survey-panel.js.map