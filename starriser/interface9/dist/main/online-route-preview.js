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
    const page = await session.ownedFleets({ fleetId: selection.fleetId, travelPolicy: true });
    const token = page.seed.token;
    const row = page.fleets.findIndex(fleet => fleet.id === selection.fleetId);
    if (row < 0)
        throw new Error('Fleet is no longer in this system');
    const ready = page.seed.times[row * 3 + 2];
    const departure = ready > page.serverNowMs ? ready : page.serverNowMs;
    await worker.request({ type: 'seed', seed: page.seed });
    const result = await worker.request({ type: 'previewRoute', route: {
            token, topology: graph.token, fleetId: selection.fleetId, destinationSystemId: selection.destinationSystemId,
            targetX: selection.target.x, targetZ: selection.target.z, nowMs: departure,
            expectedSystemRevision: token.watermark.systemRevision,
        } });
    if (!('kind' in result) || result.kind !== 'route-preview')
        throw new Error('Shared rules returned an unexpected route result');
    return { ...result, totalTravelMs: result.totalTravelMs + departure - page.serverNowMs };
}
export function routeStillCurrent(session, result, topology) {
    const watermark = session.received();
    return !!watermark && sameToken(result.token, { connectionGeneration: session.generation, watermark })
        && result.topology.connectionGeneration === session.generation && result.topology.worldId === topology.worldId
        && result.topology.revision === topology.revision;
}
export function sameRouteSelection(a, b) {
    return a.fleetId === b.fleetId && a.destinationSystemId === b.destinationSystemId
        && a.target.x === b.target.x && a.target.z === b.target.z;
}
//# sourceMappingURL=online-route-preview.js.map