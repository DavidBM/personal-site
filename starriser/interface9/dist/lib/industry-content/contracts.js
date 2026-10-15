export function id(value) { if (typeof value !== 'string' || !/^[a-f0-9]{32}$/.test(value) || /^0+$/.test(value))
    throw new Error('Invalid industry identity'); return value; }
export function decimal(value) { if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value) || BigInt(value) > 18446744073709551615n)
    throw new Error('Invalid industry time or revision'); return BigInt(value); }
function integer(value, max) { if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max)
    throw new Error('Invalid industry quantity'); return value; }
function bool(value) { if (typeof value !== 'boolean')
    throw new Error('Invalid industry state'); return value; }
function object(value) { if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid industry object'); return value; }
export function quantities(value) { if (!Array.isArray(value) || value.length !== 6)
    throw new Error('Six resource quantities required'); return value.map(v => integer(v, 1e12)); }
function brief(value) { const v = object(value); return { id: id(v.id), kind: integer(v.kind, 2), x: integer(v.x, 8191), y: integer(v.y, 4095) }; }
function batch(value) {
    if (value === null)
        return null;
    const v = object(value), startedMs = decimal(v.startedMs), deadlineMs = decimal(v.deadlineMs), recipeVersion = integer(v.recipeVersion, 4294967295);
    if (recipeVersion === 0 || deadlineMs - startedMs < 60000n)
        throw new Error('Invalid accepted batch timing');
    return { id: id(v.id), recipeVersion, startedMs, deadlineMs, inputs: quantities(v.inputs), outputs: quantities(v.outputs) };
}
function facility(value) {
    const v = object(value), amounts = quantities(v.amounts), reserved = quantities(v.reserved), capacity = quantities(v.capacity);
    if (amounts.some((n, i) => n + reserved[i] > capacity[i]))
        throw new Error('Invalid inventory capacity');
    return { ...brief(v), revision: decimal(v.revision), amounts, reserved, capacity, batch: batch(v.batch) };
}
function shipment(value) {
    const v = object(value), startedMs = decimal(v.startedMs), deadlineMs = decimal(v.deadlineMs);
    if (deadlineMs - startedMs < 60000n)
        throw new Error('Invalid accepted shipment timing');
    return { id: id(v.id), sourceId: id(v.sourceId), destinationId: id(v.destinationId), cargo: quantities(v.cargo), startedMs, deadlineMs, completed: bool(v.completed), energyWh: integer(v.energyWh, 1e12) };
}
export function validateOperation(operation) {
    switch (operation.action) {
        case 'list':
            if (operation.after)
                id(operation.after);
            return;
        case 'read':
            id(operation.facilityId);
            return;
        case 'batch':
            id(operation.batchId);
            id(operation.facilityId);
            return;
        case 'build':
            id(operation.commandId);
            id(operation.facilityId);
            id(operation.supplyId);
            decimal(operation.planetRevision);
            integer(operation.x, 8191);
            integer(operation.y, 4095);
            if (![1, 2].includes(operation.kind))
                throw new Error('Invalid factory type');
            return;
        case 'ship':
            id(operation.shipmentId);
            id(operation.sourceId);
            id(operation.destinationId);
            quantities(operation.cargo);
            if (operation.cargo.every(v => v === 0))
                throw new Error('Empty cargo');
            return;
    }
}
export function parseProjection(input, bodyId, operation) {
    const value = object(input), base = { bodyId: id(value.bodyId), planetRevision: decimal(value.planetRevision), serverNowMs: decimal(value.serverNowMs) };
    if (base.bodyId !== bodyId)
        throw new Error('Industry body changed');
    switch (value.kind) {
        case 'rejected': return parseRejected(value, base, operation);
        case 'page': return parsePage(value, base, operation);
        case 'facility': return parseFacility(value, base, operation);
        case 'shipment': return parseShipment(value, base, operation);
        default: throw new Error('Unknown industry response');
    }
}
function parsePage(value, base, operation) {
    if (operation.action !== 'list' || !Array.isArray(value.facilities) || value.facilities.length > 8)
        throw new Error('Invalid facility page');
    const facilities = value.facilities.map(brief), after = value.after === null ? null : id(value.after);
    validatePageOrder(facilities, operation.after);
    if (after !== null && (facilities.length !== 8 || after !== facilities[facilities.length - 1]?.id))
        throw new Error('Invalid industry cursor');
    return { ...base, kind: 'page', facilities, after };
}
function validatePageOrder(facilities, after) {
    if (new Set(facilities.map(v => v.id)).size !== facilities.length)
        throw new Error('Duplicate facility');
    if (facilities.some((v, i) => (i > 0 && v.id <= facilities[i - 1].id) || (!!after && v.id <= after)))
        throw new Error('Unordered industry page');
}
function parseFacility(value, base, operation) {
    if (!['read', 'batch', 'build'].includes(operation.action))
        throw new Error('Unexpected facility response');
    const result = facility(value.facility);
    if (!('facilityId' in operation) || result.id !== operation.facilityId)
        throw new Error('Industry facility changed');
    return { ...base, kind: 'facility', facility: result, replayed: bool(value.replayed) };
}
function parseShipment(value, base, operation) {
    if (operation.action !== 'ship')
        throw new Error('Unexpected shipment response');
    const result = shipment(value.shipment);
    if (result.id !== operation.shipmentId || result.sourceId !== operation.sourceId || result.destinationId !== operation.destinationId || result.cargo.some((n, i) => n !== operation.cargo[i]))
        throw new Error('Industry shipment changed');
    return { ...base, kind: 'shipment', shipment: result, replayed: bool(value.replayed) };
}
function parseRejected(value, base, operation) {
    const expected = commandIdentity(operation), commandId = id(value.commandId), reason = integer(value.reason, 9);
    if (!expected || commandId !== expected || reason < 1)
        throw new Error('Invalid durable industry rejection');
    return { ...base, kind: 'rejected', commandId, reason };
}
function commandIdentity(operation) {
    switch (operation.action) {
        case 'build': return operation.commandId;
        case 'batch': return operation.batchId;
        case 'ship': return operation.shipmentId;
        default: return undefined;
    }
}
//# sourceMappingURL=contracts.js.map