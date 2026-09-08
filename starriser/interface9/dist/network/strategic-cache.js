import { opaqueIdAt, opaqueIdBytes } from '../contracts/opaque-id.js';
import { STRATEGIC_PAGE_SIZE } from './strategic-contracts.js';
import { normalizeStrategicRows } from './strategic-rows.js';
function canonical(ids) {
    if (ids.length > STRATEGIC_PAGE_SIZE)
        throw new Error('Strategic interest exceeds 32 systems');
    const result = ids.map(value => opaqueIdAt(opaqueIdBytes(value))).sort();
    if (new Set(result).size !== result.length)
        throw new Error('Duplicate strategic system');
    return result;
}
/** The codec owns structural validation; this owner checks requested membership
 * and arrival order before replacing the optional cache. */
export function createStrategicCache(connectionGeneration, subscriptionId, changed) {
    let worldId = '';
    let ids = [];
    let closed = false;
    let requestedEncoding = 0;
    let value = { connectionGeneration, interestGeneration: 0n, sequence: 0n, status: 'unavailable', systems: [] };
    function frontier() {
        return { connectionGeneration, interestGeneration: value.interestGeneration, sequence: value.sequence };
    }
    function initialize(id, encoding = 0) {
        if (closed || worldId)
            throw new Error('Strategic connection was already initialized or closed');
        if (encoding !== 0 && encoding !== 1)
            throw new Error('Unsupported strategic encoding');
        worldId = opaqueIdAt(opaqueIdBytes(id));
        requestedEncoding = encoding;
    }
    function replace(interest) {
        if (closed || !worldId || interest.connectionGeneration !== connectionGeneration)
            throw new Error('Strategic connection is unavailable');
        if (interest.interestGeneration <= 0n || interest.interestGeneration > 0xffffffffffffffffn)
            throw new Error('Invalid strategic generation');
        const next = canonical(interest.systemIds);
        if (interest.interestGeneration < value.interestGeneration)
            throw new Error('Obsolete strategic interest');
        if (interest.interestGeneration === value.interestGeneration && next.join() !== ids.join())
            throw new Error('Strategic generation changed its systems');
        if (interest.interestGeneration > value.interestGeneration) {
            ids = next;
            value = { connectionGeneration, interestGeneration: interest.interestGeneration, sequence: 0n, status: 'pending', systems: [] };
            changed(frontier());
        }
        return { worldId: opaqueIdBytes(worldId), subscriptionId: opaqueIdBytes(subscriptionId), interestGeneration: value.interestGeneration,
            systemIds: ids.map(opaqueIdBytes), requestedEncoding };
    }
    function receive(message) {
        if (closed || opaqueIdAt(message.worldId) !== worldId || opaqueIdAt(message.subscriptionId) !== subscriptionId)
            return;
        if (message.interestGeneration !== value.interestGeneration || message.sequence <= value.sequence)
            return;
        const systems = members(message);
        value = { ...frontier(), sequence: message.sequence, status: message.result.case === 'rejected' ? 'rejected' : 'view', systems,
            rejectionReason: message.result.case === 'rejected' ? message.result.value.reason : undefined };
        changed(frontier());
    }
    function members(message) {
        if (message.result.case === 'rejected')
            return [];
        const expected = requestedEncoding === 1 ? 'compactView' : 'view';
        if (message.result.case !== expected)
            throw new Error('Strategic result changed requested encoding');
        const systems = normalizeStrategicRows(message);
        const actual = systems.map(item => item.scope.systemId).sort();
        if (actual.join() !== ids.join() || systems.some(item => item.scope.worldId !== worldId))
            throw new Error('Strategic result changed requested membership');
        return systems;
    }
    return { replace, receive, initialize,
        snapshot() { if (closed)
            throw new Error('Strategic connection is unavailable'); return structuredClone(value); },
        dispose() { closed = true; ids = []; value = { ...frontier(), status: 'unavailable', systems: [] }; } };
}
//# sourceMappingURL=strategic-cache.js.map