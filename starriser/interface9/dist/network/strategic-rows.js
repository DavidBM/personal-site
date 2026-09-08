import { opaqueIdAt } from '../contracts/opaque-id.js';
function counts(value) {
    return value && { systemRevision: value.systemRevision, committedServerTimeMs: value.committedServerTimeMs,
        presentShips: value.presentShips, movingShips: value.movingShips };
}
function legacyRow(value) {
    const scope = value.scope;
    return { scope: { worldId: opaqueIdAt(scope.worldId), shardId: opaqueIdAt(scope.shardId), systemId: opaqueIdAt(scope.systemId),
            ownerEpoch: scope.ownerEpoch, recoveryGeneration: scope.recoveryGeneration }, counts: counts(value.counts) };
}
function compactRows(view, worldId) {
    const result = [];
    for (const group of view.groups) {
        const shardId = opaqueIdAt(group.shardId);
        for (const value of group.systems) {
            result.push({ scope: { worldId, shardId, systemId: opaqueIdAt(value.systemId),
                    ownerEpoch: group.ownerEpoch, recoveryGeneration: group.recoveryGeneration }, counts: counts(value.counts) });
        }
    }
    return result;
}
/** Normalize an already structurally validated complete result. Format, requested
 * membership and arrival order belong to the caller; no prior view is consulted. */
export function normalizeStrategicRows(message) {
    if (message.result.case === 'view')
        return message.result.value.systems.map(legacyRow);
    if (message.result.case === 'compactView')
        return compactRows(message.result.value, opaqueIdAt(message.worldId));
    return [];
}
//# sourceMappingURL=strategic-rows.js.map