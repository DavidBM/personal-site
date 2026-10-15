import { mapLayers } from '../contracts/map-layers.js';
/** Event-owned route cache. Frame work only compares selection/local revision. */
export function createMapRoutes(state) {
    let layers = mapLayers(null);
    let enabled = false, selected = null, localRevision = -1;
    const routes = new Map(), localKeys = [];
    function remove(row) { for (const key of row.keys)
        state.view.removeConnection(key); row.keys.length = 0; }
    function draw(id, row) {
        remove(row);
        if (!enabled || id === state.selectedFleetId)
            return;
        for (let n = row.completed + 1; n < row.nodes.length; n++) {
            const a = row.nodes[n - 1], b = row.nodes[n];
            if (!a || !b)
                continue;
            const key = `travel:owned:${id}:${n}`;
            state.view.addConnection(key, a, b, 0x72eaff);
            row.keys.push(key);
        }
    }
    function clear() { for (const row of routes.values())
        remove(row); routes.clear(); clearLocal(); localRevision = -1; }
    function update(value) {
        if (value.reset) {
            clear();
            return;
        }
        const id = value.fleetId;
        if (!value.path && value.completedLegs === undefined) {
            const old = routes.get(id);
            if (old)
                remove(old);
            routes.delete(id);
            return;
        }
        let row = routes.get(id);
        const path = value.path;
        if (path && (path.offset < 0 || path.nodes.length > 16 || path.offset + path.nodes.length > 1025))
            return;
        if (path && row?.journeyId !== path.journeyId) {
            if (row)
                remove(row);
            row = { journeyId: path.journeyId, nodes: [], completed: 0, keys: [] };
            routes.set(id, row);
        }
        if (!row)
            return;
        if (path)
            path.nodes.forEach((node, i) => row.nodes[path.offset + i] = node);
        if (value.completedLegs !== undefined)
            row.completed = value.completedLegs;
        draw(id, row);
    }
    function clearLocal() { for (const key of localKeys)
        state.view.removeConnection(key); localKeys.length = 0; }
    function drawLocal() {
        clearLocal();
        if (!enabled)
            return;
        for (const [id, s] of state.view.survey.fleetTotals().localJumps) {
            if (id === state.selectedFleetId)
                continue;
            const a = s.startPosition ?? state.galaxy.getSolarSystemById(s.startNode.clusterId, s.startNode.solarSystemId)?.position;
            const b = s.endPosition ?? state.galaxy.getSolarSystemById(s.endNode.clusterId, s.endNode.solarSystemId)?.position;
            if (a && b) {
                const key = `travel:local-all:${id}`;
                state.view.addConnection(key, a, b, 0x72eaff);
                localKeys.push(key);
            }
        }
    }
    function options(value) { layers = value; applyOptions(); }
    function applyOptions() { const scope = state.view.getSceneFleetNode() ? 'system' : state.view.survey.layout.visible.some(a => a.systemId !== undefined) ? 'cluster' : 'galaxy'; const on = layers[scope].ownRoutes; if (on === enabled)
        return; enabled = on; for (const [id, row] of routes)
        draw(id, row); drawLocal(); }
    function tick() {
        applyOptions();
        if (selected !== state.selectedFleetId) {
            const old = selected;
            selected = state.selectedFleetId;
            for (const id of [old, selected]) {
                const row = id && routes.get(id);
                if (id && row)
                    draw(id, row);
            }
            drawLocal();
        }
        const totals = state.view.survey.fleetTotals();
        if (localRevision !== totals.localJumpRevision) {
            localRevision = totals.localJumpRevision;
            drawLocal();
        }
    }
    return { update, options, tick, clear, inspect: () => ({ enabled, routes: routes.size, segments: [...routes.values()].reduce((n, r) => n + r.keys.length, localKeys.length) }) };
}
//# sourceMappingURL=map-routes.js.map