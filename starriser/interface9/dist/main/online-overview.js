import { createStrategicView } from './strategic-view.js';
export function createOnlineOverview(panel, current) {
    let view;
    let topology;
    let detail = '';
    let offset = 0;
    function page() { if (topology && view)
        view.select(panel.page(topology, detail, offset)); }
    function previous() { offset = Math.max(0, offset - 32); page(); }
    function next() { if (topology && offset + 32 < topology.systems.length) {
        offset += 32;
        page();
    } }
    function resume() { if (document.visibilityState === 'visible')
        view?.resume(); }
    panel.previous.addEventListener('click', previous);
    panel.next.addEventListener('click', next);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('pageshow', resume);
    return {
        connect(value, selected) {
            view?.dispose();
            topology = value;
            detail = selected;
            offset = 0;
            const session = current();
            if (!session)
                return;
            view = createStrategicView({ generation: session.generation, replace: session.replaceStrategic, query: session.strategicSnapshot, render: panel.render });
            page();
        },
        refresh(value) { view?.refresh(value); },
        clear() { view?.dispose(); view = undefined; topology = undefined; panel.clear(); },
        dispose() {
            view?.dispose();
            panel.clear();
            panel.previous.removeEventListener('click', previous);
            panel.next.removeEventListener('click', next);
            document.removeEventListener('visibilitychange', resume);
            window.removeEventListener('pageshow', resume);
        },
    };
}
//# sourceMappingURL=online-overview.js.map