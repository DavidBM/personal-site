import { fleetRelationship } from "../contracts/fleet-relationship.js";
export function createFleetStatusController(options) {
    const byId = new Map();
    const nodeIds = new Map();
    const nodeSnapshots = new Map();
    const emptyIds = Object.freeze([]);
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
        nodeSnapshots.delete(key);
        if (ids?.size === 0)
            nodeIds.delete(key);
        indexedNode.delete(id);
    }
    function index(id, state) {
        const key = nodeKey(state);
        if (indexedNode.get(id) === key)
            return;
        unindex(id);
        nodeSnapshots.delete(key);
        let ids = nodeIds.get(key);
        if (!ids)
            nodeIds.set(key, ids = new Set());
        ids.add(id);
        indexedNode.set(id, key);
    }
    function clear() {
        byId.clear();
        nodeIds.clear();
        nodeSnapshots.clear();
        indexedNode.clear();
        if (listFrame !== 0)
            cancelFrame(listFrame);
        listFrame = 0;
        renderList();
    }
    function remember(fleet) {
        byId.set(fleet.id, { counts: fleet.counts, state: fleet.state, relationship: fleetRelationship(fleet.relationship) });
        index(fleet.id, fleet.state);
    }
    function applyBatch(fleets) {
        for (const fleet of fleets)
            remember(fleet);
        if (renderer.addFleetBatch)
            renderer.addFleetBatch(fleets);
        else
            for (const fleet of fleets)
                renderer.addFleet(fleet.id, fleet.counts, fleet.state, fleet.relationship);
    }
    return {
        byId,
        fleetIdsAt(clusterId, solarSystemId) {
            const key = `${clusterId}:${solarSystemId}`;
            let snapshot = nodeSnapshots.get(key);
            if (!snapshot) {
                const ids = nodeIds.get(key);
                snapshot = ids ? Object.freeze([...ids]) : emptyIds;
                nodeSnapshots.set(key, snapshot);
            }
            return snapshot;
        },
        handleSpawned(id, counts, state, relationship) {
            if (disposed)
                return;
            remember({ id, counts, state, relationship });
            renderer.addFleet(id, counts, state, relationship);
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