import { isOpaqueId, opaqueIdAt, opaqueIdBytes } from '../../../contracts/opaque-id.js';
import { copyToken } from './seed.js';
const MAX_SYSTEMS = 4096, MAX_EDGES = 16384;
const MAX_BYTES = MAX_SYSTEMS * 16 + MAX_EDGES * 8;
function validateToken(token) {
    if (!Number.isSafeInteger(token.connectionGeneration) || token.connectionGeneration < 1 || !isOpaqueId(token.worldId)
        || typeof token.revision !== 'bigint' || token.revision < 1n || token.revision > 0xffffffffffffffffn)
        throw new Error('Invalid topology token');
}
export function sameTopologyToken(a, b) {
    return a.connectionGeneration === b.connectionGeneration && a.worldId === b.worldId && a.revision === b.revision;
}
export function topologyBuffers(value) {
    const ids = value.systemIds, edges = value.edgeIndices;
    if (!(ids instanceof Uint8Array) || !(edges instanceof Uint32Array) || ids.length % 16 || edges.length % 2
        || ids.length > MAX_SYSTEMS * 16 || edges.length > MAX_EDGES * 2)
        throw new Error('Invalid topology columns');
    const buffers = [...new Set([ids.buffer, edges.buffer])];
    if (buffers.some(buffer => !(buffer instanceof ArrayBuffer)) || buffers.reduce((sum, buffer) => sum + buffer.byteLength, 0) > MAX_BYTES) {
        throw new Error('Invalid topology backing storage');
    }
    return buffers;
}
function sameColumns(a, b) {
    return a.systemIds.length === b.systemIds.length && a.edgeIndices.length === b.edgeIndices.length
        && a.systemIds.every((value, i) => value === b.systemIds[i]) && a.edgeIndices.every((value, i) => value === b.edgeIndices[i]);
}
function requireSuccessor(previous, value) {
    if (!previous || value.token.connectionGeneration > previous.token.connectionGeneration)
        return;
    const a = previous.token, b = value.token;
    if (b.connectionGeneration < a.connectionGeneration || b.worldId !== a.worldId || b.revision < a.revision)
        throw new Error('Stale topology seed');
    if (b.revision === a.revision && !sameColumns(previous, value))
        throw new Error('Topology changed without a new revision');
}
/** Owns one immutable permitted graph. Route decisions and travel arithmetic
 * stay in Rust; this adapter owns column lifetimes and rejects stale contexts. */
export function createRoutePreview(rules) {
    let current = null, routes = null;
    return {
        seed(value) {
            validateToken(value.token);
            topologyBuffers(value);
            requireSuccessor(current, value);
            if (!current || !sameTopologyToken(current.token, value.token)) {
                const replacement = new rules.RuleRoutes(value.systemIds, value.edgeIndices);
                routes?.free();
                routes = replacement;
                current = { token: { ...value.token }, systemIds: value.systemIds.slice(), edgeIndices: value.edgeIndices.slice() };
            }
            return { kind: 'topology', token: { ...value.token } };
        },
        preview(state, playerId, input) {
            validateToken(input.topology);
            if (!routes || !current || !sameTopologyToken(current.token, input.topology)
                || input.token.connectionGeneration !== current.token.connectionGeneration || input.token.watermark.scope.worldId !== current.token.worldId) {
                throw new Error('Stale or missing route topology');
            }
            return preview(rules, routes, state, playerId, input);
        },
        dispose() { routes?.free(); routes = null; current = null; },
    };
}
function preview(rules, routes, state, playerId, input) {
    const base = { kind: 'route-preview', token: copyToken(input.token), topology: { ...input.topology } };
    const rejected = (code) => ({ ...base, code, path: new Uint8Array(), totalTravelMs: 0n, arrivalMs: 0n, firstLeg: null, proposal: null });
    try {
        if (!Number.isFinite(input.targetX) || !Number.isFinite(input.targetZ))
            return rejected(2);
        const path = routes.select(opaqueIdBytes(input.token.watermark.scope.systemId), opaqueIdBytes(input.destinationSystemId));
        const legs = path.length / 16 - 1;
        const arrivalMs = rules.route_arrival_ms(input.nowMs, legs);
        const firstLeg = { destinationSystemId: opaqueIdAt(path, 16), targetX: legs === 1 ? input.targetX : 0,
            targetZ: legs === 1 ? input.targetZ : 0, arrivalMs: rules.route_arrival_ms(input.nowMs, 1) };
        const code = state.stage_export(opaqueIdBytes(playerId), opaqueIdBytes(input.shipId), opaqueIdBytes(firstLeg.destinationSystemId), firstLeg.targetX, firstLeg.targetZ, input.nowMs, firstLeg.arrivalMs, input.expectedSystemRevision);
        if (code !== 0)
            return rejected(code);
        return { ...base, code, path, totalTravelMs: arrivalMs - input.nowMs, arrivalMs, firstLeg,
            proposal: { ids: state.pending_transfer_ids(), meta: state.pending_transfer_meta(), positions: state.pending_transfer_positions() } };
    }
    catch (error) {
        if (typeof error === 'number')
            return rejected(error);
        throw error;
    }
    finally {
        state.discard();
    }
}
export function routePreviewBuffers(result) {
    const buffers = [result.path.buffer];
    if (result.proposal)
        buffers.push(result.proposal.ids.buffer, result.proposal.meta.buffer, result.proposal.positions.buffer);
    return buffers;
}
//# sourceMappingURL=routes.js.map