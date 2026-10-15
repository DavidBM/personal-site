import { orbitBuffers } from '../../../contracts/fleet-orbit.js';
import { isOpaqueId } from '../../../contracts/opaque-id.js';
import { MAX_RULE_SEED_FLEETS } from './contracts.js';
const MAX_SEED_BYTES = MAX_RULE_SEED_FLEETS * (128 + 14 * 24 + 4) + 4;
const u64 = (value) => typeof value === 'bigint' && value >= 0n && value <= 0xffffffffffffffffn;
export function copyToken(token) {
    return { connectionGeneration: token.connectionGeneration, watermark: { ...token.watermark, scope: { ...token.watermark.scope } } };
}
export function validateToken(token) {
    const w = token.watermark, s = w.scope;
    if (!Number.isSafeInteger(token.connectionGeneration) || token.connectionGeneration < 1)
        throw new Error('Invalid domain connection generation');
    if (![s.worldId, s.systemId, s.shardId, w.subscriptionId].every(isOpaqueId))
        throw new Error('Invalid domain scope identity');
    if (![s.ownerEpoch, s.recoveryGeneration, w.streamGeneration, w.systemRevision].every(value => u64(value) && value > 0n)
        || !u64(w.sequence))
        throw new Error('Invalid domain watermark');
}
function fields(token) {
    const w = token.watermark, s = w.scope;
    return [token.connectionGeneration, s.worldId, s.systemId, s.shardId, s.ownerEpoch, s.recoveryGeneration,
        w.subscriptionId, w.streamGeneration, w.sequence, w.systemRevision];
}
export function sameToken(a, b) {
    const right = fields(b);
    return fields(a).every((value, index) => value === right[index]);
}
export function requireSeedSuccessor(previous, next) {
    validateToken(next);
    if (!previous || next.connectionGeneration > previous.connectionGeneration)
        return;
    if (next.connectionGeneration < previous.connectionGeneration)
        throw new Error('Stale domain seed connection');
    const a = previous.watermark, b = next.watermark;
    if (b.streamGeneration > a.streamGeneration)
        return;
    requireForwardRevision(a, b);
    const aligned = { ...next, watermark: { ...b, sequence: a.sequence, systemRevision: a.systemRevision } };
    if (!sameToken(previous, aligned))
        throw new Error('Domain scope changed without a new stream generation');
    if (b.sequence === a.sequence && b.systemRevision !== a.systemRevision)
        throw new Error('Inconsistent domain seed revision');
}
function requireForwardRevision(a, b) {
    if (b.streamGeneration < a.streamGeneration || b.sequence < a.sequence || b.systemRevision < a.systemRevision)
        throw new Error('Stale domain seed projection');
}
/** Shape/buffer ownership validation only; all restored-state rules stay Rust. */
export function seedBuffers(seed) {
    const n = seed.revisions.length;
    const views = [seed.identities, seed.revisions, seed.positions, seed.times];
    const types = [Uint8Array, BigUint64Array, Float64Array, BigUint64Array];
    const dimensions = seed.positionDimensions ?? 2;
    if (dimensions !== 2 && dimensions !== 3)
        throw new Error("Invalid domain coordinate layout");
    const lengths = [48 * n, 8 * n, 16 * dimensions * n, 24 * n];
    if (n > MAX_RULE_SEED_FLEETS)
        throw new Error('Domain seed exceeds 256 fleets');
    const buffers = new Set();
    for (let i = 0; i < views.length; i++) {
        const view = views[i];
        if (!(view instanceof types[i]) || view.byteLength !== lengths[i] || !(view.buffer instanceof ArrayBuffer))
            throw new Error('Invalid domain seed columns');
        buffers.add(view.buffer);
    }
    if (seed.pathOffsets || seed.pathPoints) {
        const offsets = seed.pathOffsets, points = seed.pathPoints;
        if (!(offsets instanceof Uint32Array) || offsets.length !== n + 1 || offsets[0] !== 0 || !(points instanceof Float64Array)
            || !(offsets.buffer instanceof ArrayBuffer) || !(points.buffer instanceof ArrayBuffer) || points.length !== offsets[n] * 3 || !points.every(Number.isFinite))
            throw new Error('Invalid seed paths');
        for (let i = 0; i < n; i++)
            if (offsets[i + 1] < offsets[i] || offsets[i + 1] - offsets[i] > 14)
                throw new Error('Seed path exceeds bound');
        buffers.add(offsets.buffer);
        buffers.add(points.buffer);
    }
    if (seed.orbitOffsets || seed.orbitBytes)
        for (const buffer of orbitBuffers(n, seed.orbitOffsets, seed.orbitBytes))
            buffers.add(buffer);
    let bytes = 0;
    for (const buffer of buffers)
        bytes += buffer.byteLength;
    if (bytes > Math.min(MAX_SEED_BYTES, n * (128 + 14 * 24 + 4) + 4))
        throw new Error('Domain seed backing storage exceeds its bound');
    return [...buffers];
}
export function validateSeed(seed) {
    validateToken(seed.token);
    seedBuffers(seed);
    if (seed.movementContext) {
        const c = seed.movementContext;
        if (c.version !== 3 || typeof c.catalogId !== 'string' || c.catalogId.length > 64 || !c.catalogId
            || ![c.speedPerSecond, c.clearance, c.extent, c.sunClearance].every(Number.isFinite)
            || c.speedPerSecond < 0.000001 || c.speedPerSecond > 1 || c.clearance < 0 || c.clearance > 1
            || c.extent < 0.01 || c.extent > 100 || c.sunClearance < 0 || c.sunClearance > 1)
            throw new Error('Invalid movement context');
    }
    if (seed.transferPolicy)
        validateTransferPolicy(seed.transferPolicy);
    if (!isOpaqueId(seed.playerId) || !u64(seed.committedTimeMs) || !Number.isSafeInteger(seed.ruleVersion) || seed.ruleVersion < 1)
        throw new Error('Invalid domain seed metadata');
}
export function validateTransferPolicy(policy) {
    if (![policy.jumpMs, policy.cooldownMs, policy.configurationRevision, policy.modifierRevision].every(u64)
        || policy.configurationRevision === 0n || policy.modifierRevision === 0n)
        throw new Error('Invalid transfer policy metadata');
}
//# sourceMappingURL=seed.js.map