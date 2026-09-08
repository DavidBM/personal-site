export function createFleetStatusController(options) {
    const byId = new Map();
    const nodeIds = new Map();
    const indexedNode = new Map();
    const { renderer, onListChanged, onApplied } = options;
    const requestFrame = options.requestFrame ?? requestAnimationFrame;
    const cancelFrame = options.cancelFrame ?? cancelAnimationFrame;
    let listFrame = 0;
    let disposed = false;
    const renderList = () => { if (!disposed)
        onListChanged(byId); };
    function scheduleList() {
        if (disposed || listFrame !== 0)
            return;
        listFrame = requestFrame(() => { listFrame = 0; renderList(); });
    }
    const nodeKey = (state) => {
        const node = state.state === "jumping" ? state.endNode : state.node;
        return `${node.clusterId}:${node.solarSystemId}`;
    };
    function unindex(id) {
        const key = indexedNode.get(id);
        if (!key)
            return;
        const ids = nodeIds.get(key);
        ids?.delete(id);
        if (ids?.size === 0)
            nodeIds.delete(key);
        indexedNode.delete(id);
    }
    function index(id, state) {
        unindex(id);
        const key = nodeKey(state);
        let ids = nodeIds.get(key);
        if (!ids)
            nodeIds.set(key, ids = new Set());
        ids.add(id);
        indexedNode.set(id, key);
    }
    function clear() {
        byId.clear();
        nodeIds.clear();
        indexedNode.clear();
        if (listFrame !== 0)
            cancelFrame(listFrame);
        listFrame = 0;
        renderList();
    }
    function remember(fleet) {
        byId.set(fleet.id, { counts: fleet.counts, state: fleet.state });
        index(fleet.id, fleet.state);
    }
    function applyBatch(fleets) {
        for (const fleet of fleets)
            remember(fleet);
        if (renderer.addFleetBatch)
            renderer.addFleetBatch(fleets);
        else
            for (const fleet of fleets)
                renderer.addFleet(fleet.id, fleet.counts, fleet.state);
    }
    return {
        byId,
        fleetIdsAt(clusterId, solarSystemId) {
            return [...(nodeIds.get(`${clusterId}:${solarSystemId}`) ?? [])];
        },
        handleSpawned(id, counts, state) {
            if (disposed)
                return;
            remember({ id, counts, state });
            renderer.addFleet(id, counts, state);
            onApplied?.(1);
            scheduleList();
        },
        handleSpawnedBatch(fleets) {
            if (disposed || fleets.length === 0)
                return;
            applyBatch(fleets);
            onApplied?.(fleets.length);
            scheduleList();
        },
        handleState(id, state) {
            if (disposed)
                return;
            const existing = byId.get(id);
            if (existing) {
                existing.state = state;
                index(id, state);
            }
            renderer.updateFleetState(id, state);
            scheduleList();
        },
        handleRemoved(id) {
            if (disposed)
                return;
            byId.delete(id);
            unindex(id);
            renderer.removeFleet(id);
            scheduleList();
        },
        clear,
        renderList,
        getPendingApplyCount: () => 0,
        dispose() { disposed = true; clear(); },
    };
}
//# sourceMappingURL=fleet-status-controller.js.map