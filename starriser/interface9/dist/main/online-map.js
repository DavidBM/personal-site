import { pickViewportSystem } from './online-viewport.js';
import { createOnlineConnections } from './online-connections.js';
const opaque = (kind, id) => `0000000${kind}0000000000000000${id.toString(16).padStart(8, '0')}`;
const edgeKey = (edge) => [edge.a, edge.b].sort().join(':');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** Sole numeric-handle owner for one connection. Removed handles are tombstones,
 * not reusable slots. Atlas pages cannot install systems or route authority. */
export function createOnlineMap(drawConnections = () => { }) {
    let nextCluster = 1, nextSystem = 1, worldId;
    const clusterHandles = new Map(), systemHandles = new Map();
    const connections = createOnlineConnections(drawConnections, id => clusterHandles.get(id));
    const atlas = new Map(), clusters = new Map();
    const systems = new Map(), edges = new Map();
    let view;
    let selectedContent;
    let previewContent;
    function handle(table, id, cluster) {
        const previous = table.get(id);
        if (previous !== undefined)
            return previous;
        const value = cluster ? nextCluster++ : nextSystem++;
        if (value > 0xffffff)
            throw new Error('Online handle capacity exhausted');
        table.set(id, value);
        return value;
    }
    function node(id) {
        const system = systems.get(id);
        if (!system)
            throw new Error('System is outside strategic projection');
        return { clusterId: system.clusterId, solarSystemId: system.id };
    }
    function clusterPayload(row) {
        const catalog = atlas.get(row.id);
        if (catalog)
            return catalog;
        return { id: handle(clusterHandles, row.id, true), name: row.name, position: { x: row.x, y: 0, z: row.z },
            radius: row.radius, publicAtlas: atlas.has(row.id) || undefined, color: atlas.get(row.id)?.color ?? 0x609bd5, maxSystemDistance: row.radius, connectedTo: [] };
    }
    function systemPayload(row, desired) {
        const cluster = desired.get(row.clusterId);
        if (!cluster)
            throw new Error('Strategic projection references missing cluster');
        const previous = systems.get(row.id);
        return { id: handle(systemHandles, row.id, false), clusterId: cluster.id, name: row.name,
            position: { x: row.x, y: 0, z: row.z }, catalogId: previous?.catalogId ?? selectedCatalog(row) };
    }
    function selectedCatalog(row) {
        return matchingCatalog(selectedContent, row) ?? matchingCatalog(previewContent, row) ?? null;
    }
    function matchingCatalog(content, row) {
        if (content && opaque(3, content.id) === row.id && opaque(2, content.clusterId) === row.clusterId)
            return content.catalogId;
    }
    function replace(next, retainedDetailSystem) {
        if (worldId && next.worldId !== worldId)
            throw new Error('Online map world changed');
        worldId = next.worldId;
        const desiredClusters = new Map(atlas);
        for (const row of next.clusters)
            desiredClusters.set(row.id, clusterPayload(row));
        const desiredSystems = new Map(next.systems.map(row => [row.id, systemPayload(row, desiredClusters)]));
        const retained = retainedDetailSystem ? systems.get(retainedDetailSystem) : undefined;
        if (retained && !desiredSystems.has(retainedDetailSystem)) {
            desiredSystems.set(retainedDetailSystem, retained);
            for (const [id, cluster] of clusters)
                if (cluster.id === retained.clusterId)
                    desiredClusters.set(id, cluster);
        }
        const desiredEdges = new Map(next.connections.map(edge => [edgeKey(edge), edge]));
        const ops = reconcile(desiredClusters, desiredSystems, desiredEdges);
        view = next;
        connections.replace(next);
        return ops;
    }
    function reconcile(wantedClusters, wantedSystems, wantedEdges) {
        const ops = [];
        const replaced = new Set([...clusters].filter(([id, row]) => !same(row, wantedClusters.get(id))).map(([id]) => id));
        const replacedHandles = new Set([...replaced].map(id => clusters.get(id).id));
        const removed = new Set([...systems].filter(([id, row]) => !same(row, wantedSystems.get(id)) || replacedHandles.has(row.clusterId)).map(([id]) => id));
        removePrevious(ops, replaced, removed, wantedEdges);
        addDesired(ops, wantedClusters, wantedSystems, wantedEdges);
        return ops;
    }
    function removePrevious(ops, replaced, removed, wantedEdges) {
        for (const [id, edge] of edges) {
            if (!wantedEdges.has(id) || removed.has(edge.a) || removed.has(edge.b)) {
                ops.push(edgeOp(edge, true));
                edges.delete(id);
            }
        }
        for (const id of removed) {
            const value = systems.get(id);
            ops.push({ type: 'removeSolarSystem', payload: { clusterId: value.clusterId, solarSystemId: value.id } });
            systems.delete(id);
        }
        for (const id of replaced) {
            ops.push({ type: 'removeCluster', payload: { clusterId: clusters.get(id).id } });
            clusters.delete(id);
        }
    }
    function addDesired(ops, wantedClusters, wantedSystems, wantedEdges) {
        for (const [id, value] of wantedClusters)
            if (!clusters.has(id)) {
                clusters.set(id, value);
                ops.push({ type: 'addCluster', payload: { ...value, solarSystems: [] } });
            }
        for (const [id, value] of wantedSystems)
            if (!systems.has(id)) {
                systems.set(id, value);
                ops.push({ type: 'addSolarSystem', payload: value });
            }
        for (const [id, edge] of wantedEdges)
            if (!edges.has(id)) {
                ops.push(edgeOp(edge, false));
                edges.set(id, edge);
            }
    }
    function edgeOp(edge, remove) {
        const a = node(edge.a), b = node(edge.b);
        if (a.clusterId === b.clusterId)
            return { type: remove ? 'removeSolarSystemConnection' : 'connectSolarSystems',
                payload: { clusterId: a.clusterId, solarSystemId1: a.solarSystemId, solarSystemId2: b.solarSystemId } };
        return { type: remove ? 'removeConnection' : 'connectClusters', payload: { clusterId1: a.clusterId, clusterId2: b.clusterId,
                jumpGate1: { id: a.solarSystemId }, jumpGate2: { id: b.solarSystemId } } };
    }
    function acceptAtlas(rows) {
        if (rows.length > 64 || atlas.size + rows.filter(row => !atlas.has(opaque(2, row.id))).length > 8192)
            throw new Error('Atlas capacity exceeded');
        const ops = [];
        for (const row of rows) {
            const id = opaque(2, row.id);
            const value = { name: row.name, radius: row.radius, color: row.color, maxSystemDistance: row.maxSystemDistance,
                publicAtlas: true, id: handle(clusterHandles, id, true),
                position: { x: row.position[0], y: row.position[1], z: row.position[2] }, connectedTo: [] };
            const previous = atlas.get(id);
            if (previous && !same(previous, value))
                throw new Error('Conflicting immutable atlas record');
            if (previous)
                continue;
            atlas.set(id, value);
            const installed = clusters.get(id);
            if (installed) {
                installed.publicAtlas = true;
                ops.push({ type: 'setClusterAtlas', payload: { clusterId: installed.id, publicAtlas: true } });
                continue;
            }
            clusters.set(id, value);
            ops.push({ type: 'addCluster', payload: { ...value, solarSystems: [] } });
        }
        connections.acceptAtlas(rows);
        return ops;
    }
    function acceptSystem(row, preview = false) {
        if (preview)
            previewContent = row;
        else
            selectedContent = row;
        const id = opaque(3, row.id), previous = systems.get(id);
        if (!previous || row.catalogId === undefined)
            return [];
        if (clusterHandles.get(opaque(2, row.clusterId)) !== previous.clusterId)
            throw new Error('Selected system cluster mismatch');
        if (previous.catalogId === row.catalogId)
            return [];
        previous.catalogId = row.catalogId;
        return [{ type: 'setSystemCatalog', payload: { ...node(id), catalogId: row.catalogId } }];
    }
    function resetContent() {
        connections.reset();
        selectedContent = undefined;
        previewContent = undefined;
        atlas.clear();
        const ops = [];
        for (const [id, system] of systems) {
            if (system.catalogId == null)
                continue;
            system.catalogId = null;
            ops.push({ type: 'setSystemCatalog', payload: { ...node(id), catalogId: null } });
        }
        return [...ops, ...(view ? replace(view) : reconcile(new Map(), new Map(), new Map()))];
    }
    function handles() { return view?.systems.map(row => ({ systemId: row.id, clusterId: row.clusterId, node: node(row.id) })) ?? []; }
    function clusterIdentity(handle) {
        for (const [id, cluster] of clusters)
            if (cluster.id === handle)
                return id;
        return undefined;
    }
    function systemIdentity(node) {
        for (const [id, row] of systems)
            if (row.id === node.solarSystemId && row.clusterId === node.clusterId)
                return id;
        return undefined;
    }
    return { replace, acceptAtlas, acceptSystem, node, handles, clusterIdentity, systemIdentity,
        // Reserve identities only; a roster location is not a system topology/detail grant.
        surveyNode(systemId, clusterId) {
            return { clusterId: handle(clusterHandles, clusterId, true), solarSystemId: handle(systemHandles, systemId, false) };
        },
        pickSystem(camera, x, y) { return view && pickViewportSystem(camera, view, x, y); },
        clearView(retainedDetailSystem) {
            view = undefined;
            const keep = retainedDetailSystem ? systems.get(retainedDetailSystem) : undefined;
            const wantedClusters = new Map(atlas);
            if (keep)
                for (const [id, cluster] of clusters)
                    if (cluster.id === keep.clusterId)
                        wantedClusters.set(id, cluster);
            return reconcile(wantedClusters, keep ? new Map([[retainedDetailSystem, keep]]) : new Map(), new Map());
        },
        resetContent,
        reset() { connections.reset(); view = undefined; selectedContent = previewContent = undefined; atlas.clear(); clusters.clear(); systems.clear(); edges.clear(); },
        inspect: () => ({ clusters: clusters.size, systems: systems.size, clusterHandles: clusterHandles.size, systemHandles: systemHandles.size }), };
}
//# sourceMappingURL=online-map.js.map