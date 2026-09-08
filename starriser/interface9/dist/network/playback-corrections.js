import { create } from '@bufbuild/protobuf';
import { PlaybackClockRequestSchema } from './generated/galaxy/v1/galaxy_pb.js';
import { opaqueIdAt, opaqueIdBytes } from '../contracts/opaque-id.js';
import { matchesPlaybackBaseline } from '../render/remote/playback-correction.js';
/** Event-driven clock observations. Loss ends only this optional wait; no retry
 * timer, simulated tick, authority mutation or admission-clock adjustment. */
export function createPlaybackCorrections(options) {
    let pending;
    let timer, serial = 0n, sequence = 0n, last = -Infinity, closed = false;
    function clear() { clearTimeout(timer); timer = undefined; pending = undefined; }
    return {
        refresh() {
            const baseline = options.baseline(), now = options.now();
            if (closed || pending || !baseline || !Number.isFinite(now) || now - last < 5000 || serial === 0xffffffffffffffffn)
                return;
            const id = ++serial;
            last = now;
            pending = { id, sentAt: now, baseline };
            const expire = () => { if (pending?.id === id)
                clear(); };
            timer = setTimeout(expire, 2000);
            void options.send(makeRequest(baseline, id)).catch(expire);
        },
        receive(value) {
            const request = pending;
            if (closed || !request || request.id !== value.requestId || value.sequence <= sequence)
                return;
            const at = options.now(), elapsed = at - request.sentAt;
            // Timers can be throttled through suspension. Expiry follows the clock,
            // including the exact deadline, before accepting any sequence or anchor.
            if (!(elapsed >= 0 && elapsed < 2000)) {
                clear();
                return;
            }
            const scope = value.scope, cursor = value.baseline;
            const baseline = { scope: { worldId: opaqueIdAt(scope.worldId), shardId: opaqueIdAt(scope.shardId),
                    systemId: opaqueIdAt(scope.systemId), ownerEpoch: scope.ownerEpoch, recoveryGeneration: scope.recoveryGeneration },
                subscriptionId: opaqueIdAt(cursor.subscriptionId), streamGeneration: cursor.generation, sequence: cursor.sequence, systemRevision: value.systemRevision };
            if (!matchesPlaybackBaseline(baseline, request.baseline) || !matchesPlaybackBaseline(baseline, options.baseline()))
                return;
            clear();
            sequence = value.sequence;
            options.apply({ baseline, sequence, clock: { serverMs: value.serverTimeMs, monotonicMs: at,
                    timeOriginMs: options.timeOriginMs, roundTripMs: elapsed } });
        },
        inspect: () => ({ pending: !!pending, sequence }),
        dispose() { closed = true; clear(); },
    };
}
function makeRequest(b, requestId) {
    return create(PlaybackClockRequestSchema, { scope: { worldId: opaqueIdBytes(b.scope.worldId), shardId: opaqueIdBytes(b.scope.shardId),
            systemId: opaqueIdBytes(b.scope.systemId), ownerEpoch: b.scope.ownerEpoch, recoveryGeneration: b.scope.recoveryGeneration },
        baseline: { subscriptionId: opaqueIdBytes(b.subscriptionId), generation: b.streamGeneration, sequence: b.sequence },
        systemRevision: b.systemRevision, requestId });
}
//# sourceMappingURL=playback-corrections.js.map