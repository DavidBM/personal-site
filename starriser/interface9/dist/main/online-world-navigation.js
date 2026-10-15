import { atlasClusterId, createViewportRequests, viewportClusters, ONLINE_VIEWPORT } from './online-viewport.js';
import { waitForOnlineView } from './online-view-ready.js';
export function createOnlineWorldNavigation(options) {
    const atlas = new Map();
    let enabled = false, nextSample = 0, retained = new Set(), scene = '';
    const requests = createViewportRequests({
        async load(ids, signal) {
            const session = options.session();
            if (!session)
                return;
            options.status(ids.length ? 'Loading nearby systems…' : 'Galaxy map');
            const status = await session.replaceView('overview', ids.length ? { kind: 'overview', scope: { kind: 'clusters', ids } } : undefined);
            await waitForOnlineView(session, status, signal);
            signal.throwIfAborted();
            options.status('Connected · Scroll to explore. Double-click a system to enter.');
        },
        error(error) { options.status(error instanceof Error ? error.message : String(error)); },
    });
    function update(camera, systemId) {
        if (!enabled || performance.now() < nextSample)
            return;
        nextSample = performance.now() + ONLINE_VIEWPORT.intervalMs;
        const ids = viewportClusters(camera, atlas.values(), retained);
        const selected = options.session()?.subscription()?.systemId;
        const pinned = options.topology()?.systems.find(row => row.id === selected)?.clusterId;
        if (pinned && !ids.includes(pinned))
            ids.push(pinned);
        retained = new Set(ids);
        requests.update(ids);
        enterScene(systemId);
    }
    function enterScene(systemId) {
        if (!systemId || systemId === scene)
            return;
        scene = systemId;
        void options.selectScene(systemId).catch(error => options.status(error instanceof Error ? error.message : String(error)));
    }
    return {
        update,
        selected(systemId) { scene = systemId; },
        atlas(rows) { for (const row of rows)
            atlas.set(atlasClusterId(row.id), row); nextSample = 0; },
        focus(id) { const row = atlas.get(id); if (row)
            options.focus(row.position[0], row.position[2], row.radius * 4); },
        pause() { enabled = false; requests.reset(); },
        resume() { enabled = true; nextSample = 0; },
        reset() { enabled = false; requests.reset(); atlas.clear(); retained.clear(); scene = ''; nextSample = 0; },
        resetContent() { requests.reset(); atlas.clear(); retained.clear(); scene = ''; nextSample = 0; },
    };
}
//# sourceMappingURL=online-world-navigation.js.map