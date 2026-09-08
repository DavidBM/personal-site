import { isOpaqueId } from '../../contracts/opaque-id.js';
import { validateServerClock } from '../../contracts/server-clock.js';
import { sameScope } from './projection-state.js';
export function matchesPlaybackBaseline(a, b) {
    return !!b && sameScope(a.scope, b.scope) && a.subscriptionId === b.subscriptionId
        && a.streamGeneration === b.streamGeneration && a.sequence === b.sequence && a.systemRevision === b.systemRevision;
}
export function validatePlaybackCorrection(value) {
    const b = value.baseline, s = b.scope;
    if (![s.worldId, s.shardId, s.systemId, b.subscriptionId].every(isOpaqueId))
        throw new Error('Invalid playback identity');
    for (const n of [s.ownerEpoch, s.recoveryGeneration, b.streamGeneration, b.systemRevision, value.sequence]) {
        if (typeof n !== 'bigint' || n <= 0n || n > 0xffffffffffffffffn)
            throw new Error('Invalid playback generation');
    }
    if (typeof b.sequence !== 'bigint' || b.sequence < 0n || b.sequence > 0xffffffffffffffffn)
        throw new Error('Invalid playback baseline');
    validateServerClock(value.clock);
}
//# sourceMappingURL=playback-correction.js.map