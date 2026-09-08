import { opaqueIdBytes } from '../contracts/opaque-id.js';
import { sameToken } from '../features/fleets/domain/seed.js';
/** A transport-free adapter for the permitted graph. Rust owns route choice. */
export function ruleTopology(view, connectionGeneration) {
    const systemIds = new Uint8Array(view.systems.length * 16);
    const indices = new Map();
    view.systems.forEach((system, index) => { indices.set(system.id, index); systemIds.set(opaqueIdBytes(system.id), index * 16); });
    const edgeIndices = new Uint32Array(view.connections.length * 2);
    view.connections.forEach((edge, index) => {
        const a = indices.get(edge.a), b = indices.get(edge.b);
        if (a === undefined || b === undefined)
            throw new Error('Route edge references an unavailable system');
        edgeIndices.set([a, b], index * 2);
    });
    return { token: { connectionGeneration, worldId: view.worldId, revision: view.revision }, systemIds, edgeIndices };
}
export async function previewOnlineRoute(session, worker, topology, selection) {
    const graph = ruleTopology(topology, session.generation);
    await worker.request({ type: 'seedTopology', topology: graph });
    const page = await session.ownedShips({ shipId: selection.shipId });
    const token = page.seed.token;
    await worker.request({ type: 'seed', seed: page.seed });
    const result = await worker.request({ type: 'previewRoute', route: {
            token, topology: graph.token, shipId: selection.shipId, destinationSystemId: selection.destinationSystemId,
            targetX: selection.target.x, targetZ: selection.target.z, nowMs: page.serverNowMs,
            expectedSystemRevision: token.watermark.systemRevision,
        } });
    if (!('kind' in result) || result.kind !== 'route-preview')
        throw new Error('Shared rules returned an unexpected route result');
    return result;
}
export function routeStillCurrent(session, result, topology) {
    const watermark = session.received();
    return !!watermark && sameToken(result.token, { connectionGeneration: session.generation, watermark })
        && result.topology.connectionGeneration === session.generation && result.topology.worldId === topology.worldId
        && result.topology.revision === topology.revision;
}
export function sameRouteSelection(a, b) {
    return a.shipId === b.shipId && a.destinationSystemId === b.destinationSystemId
        && a.target.x === b.target.x && a.target.z === b.target.z;
}
//# sourceMappingURL=online-route-preview.js.map