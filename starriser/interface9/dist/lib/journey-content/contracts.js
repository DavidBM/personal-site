import { isOpaqueId } from '../../contracts/opaque-id.js';
const U64_MAX = 18446744073709551615n;
export function decimal(value, positive = false) {
    if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value))
        throw new Error('Invalid journey integer');
    const result = BigInt(value);
    if (result > U64_MAX || (positive && result === 0n))
        throw new Error('Invalid journey integer');
    return result;
}
export function validateOperation(value) {
    if (value.action === 'lookup') {
        if (!isOpaqueId(value.fleetId))
            throw new Error('Invalid journey fleet');
        return;
    }
    if (!isOpaqueId(value.journeyId) || !isOpaqueId(value.sourceSystem))
        throw new Error('Invalid journey identity');
    if (value.action === 'navigate') {
        decimal(value.fleetRevision, true);
        if (!isOpaqueId(value.fleetId))
            throw new Error('Invalid journey fleet');
        validateLeg({ systemId: value.destinationSystem, position: value.position }, value.sourceSystem);
        if (value.arrival && value.arrival.kind !== 'position' && value.arrival.kind !== 'orbit')
            throw new Error('Invalid arrival kind');
        if (value.arrival?.kind === 'orbit' && !boundedInteger(value.arrival.bodyIndex, 1, 255))
            throw new Error('Invalid orbit destination');
        return;
    }
    if (value.action !== 'accept')
        return;
    decimal(value.fleetRevision, true);
    if (!isOpaqueId(value.fleetId) || value.legs.length < 1 || value.legs.length > 16)
        throw new Error('A journey needs 1–16 destinations');
    let source = value.sourceSystem;
    for (const leg of value.legs) {
        validateLeg(leg, source);
        source = leg.systemId;
    }
}
function validateLeg(leg, source) {
    if (!isOpaqueId(leg.systemId) || leg.systemId === source || leg.position.length !== 3 || !leg.position.every(Number.isFinite))
        throw new Error('Invalid journey destination');
}
export function parseProjection(value, operation) {
    if (!value || typeof value !== 'object')
        throw new Error('Invalid journey response');
    const v = value;
    const ids = projectionIdentity(v, operation), progress = projectionProgress(v);
    return { ...ids, ...progress, ...navigation(v), ...finalDestination(v), revision: decimal(v.revision, true), serverNowMs: decimal(v.serverNowMs), phase: phase(v) };
}
function navigation(v) {
    if (v.currentSystem === undefined)
        return {};
    if (typeof v.currentSystem !== 'string' || !isOpaqueId(v.currentSystem))
        throw new Error('Invalid journey system');
    if (v.destinationSystem != null && (typeof v.destinationSystem !== 'string' || !isOpaqueId(v.destinationSystem)))
        throw new Error('Invalid journey destination');
    const p = v.arrivalPosition;
    if (p != null && (!Array.isArray(p) || p.length !== 3 || !p.every(Number.isFinite)))
        throw new Error('Invalid accepted gate');
    return { currentSystem: v.currentSystem, destinationSystem: v.destinationSystem,
        arrivalPosition: p == null ? undefined : p };
}
function finalDestination(v) {
    if (v.finalSystem === undefined)
        return {};
    if (typeof v.finalSystem !== 'string' || !isOpaqueId(v.finalSystem) || !Array.isArray(v.finalPosition) || v.finalPosition.length !== 3 || !v.finalPosition.every(Number.isFinite))
        throw new Error('Invalid final destination');
    if (v.orbitBody != null && !boundedInteger(v.orbitBody, 1, 255))
        throw new Error('Invalid orbit destination');
    return { finalSystem: v.finalSystem, finalPosition: v.finalPosition, orbitBody: v.orbitBody == null ? undefined : v.orbitBody };
}
function projectionIdentity(v, operation) {
    for (const key of ['journeyId', 'sourceSystem', 'fleetId']) {
        if (typeof v[key] !== 'string' || !isOpaqueId(v[key]))
            throw new Error('Invalid journey response identity');
    }
    if (operation.action !== 'lookup' && (v.journeyId !== operation.journeyId || v.sourceSystem !== operation.sourceSystem))
        throw new Error('Journey response identity mismatch');
    if ('fleetId' in operation && v.fleetId !== operation.fleetId)
        throw new Error('Journey fleet mismatch');
    return { journeyId: v.journeyId, sourceSystem: v.sourceSystem, fleetId: v.fleetId };
}
function projectionProgress(v) {
    const total = v.totalLegs, done = v.completedLegs;
    if (!boundedInteger(total, 1, 1024) || !boundedInteger(done, 0, total) || typeof v.cancelRequested !== 'boolean')
        throw new Error('Invalid journey progress');
    return { totalLegs: total, completedLegs: done, cancelRequested: v.cancelRequested };
}
function boundedInteger(value, low, high) {
    return typeof value === 'number' && Number.isInteger(value) && value >= low && value <= high;
}
function phase(value) {
    switch (value.phase) {
        case 'ready': return { phase: 'ready', readyMs: decimal(value.readyMs) };
        case 'transit': {
            const departureMs = decimal(value.departureMs), arrivalMs = decimal(value.arrivalMs);
            if (arrivalMs <= departureMs)
                throw new Error('Invalid accepted journey timing');
            return { phase: 'transit', departureMs, arrivalMs };
        }
        case 'arriving':
        case 'approaching':
        case 'dispatching':
        case 'completed':
        case 'cancelled':
        case 'failed': return { phase: value.phase };
        default: throw new Error('Unknown journey phase');
    }
}
export function parseReply(value, operation) {
    if (!value || typeof value !== 'object')
        throw new Error('Invalid journey response');
    const v = value;
    if (v.phase === 'none') {
        if (operation.action !== 'lookup' || v.fleetId !== operation.fleetId)
            throw new Error('Invalid journey lookup');
        return { kind: 'none', fleetId: operation.fleetId, serverNowMs: decimal(v.serverNowMs) };
    }
    if (v.phase !== 'rejected')
        return parseProjection(value, operation);
    const identity = projectionIdentity(v, operation);
    if (v.durable !== true || !['invalid', 'fleetUnavailable', 'stale', 'busy', 'capacity', 'route'].includes(v.reason))
        throw new Error('Unconfirmed journey rejection');
    return { ...identity, kind: 'rejected', durable: true, reason: v.reason, serverNowMs: decimal(v.serverNowMs) };
}
//# sourceMappingURL=contracts.js.map