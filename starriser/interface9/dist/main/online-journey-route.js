import { opaqueIdAt } from '../contracts/opaque-id.js';
/** The staged export increments fleet revision once; acceptance guards its source. */
export function journeyDraft(result, selection, topology) {
    const { legs, revision } = routeBounds(result);
    const ids = Array.from({ length: legs + 1 }, (_, i) => opaqueIdAt(result.path, i * 16));
    const labels = new Map(topology.systems.map(s => [s.id, s.name]));
    if (ids[0] !== result.token.watermark.scope.systemId || ids[ids.length - 1] !== selection.destinationSystemId || ids.some(id => !labels.has(id)))
        throw new Error('Route identity changed. Preview again.');
    return { sourceSystem: ids[0], fleetId: selection.fleetId, fleetRevision: revision - 1n,
        names: ids.map(id => labels.get(id)), legs: ids.slice(1).map((systemId, index) => ({ systemId,
            position: index === legs - 1 ? [selection.target.x, 0, selection.target.z] : [0, 0, 0] })) };
}
function routeBounds(result) {
    const legs = result.path.byteLength / 16 - 1, revision = result.proposal?.meta[5];
    if (result.code || !result.proposal || !Number.isInteger(legs) || legs < 1 || legs > 16 || !revision || revision < 2n)
        throw new Error('A journey needs a current route of 1–16 jumps.');
    return { legs, revision };
}
//# sourceMappingURL=online-journey-route.js.map