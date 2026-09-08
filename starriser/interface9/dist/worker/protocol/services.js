function descriptor(kind, id, options) {
    const capacity = options.capacity ?? 128;
    const summary = options.summary ?? 'none';
    validateDescriptor(id, capacity, summary);
    return { id, kind, priority: options.priority ?? 1, capacity, summary,
        ordered: options.ordered, bytes: options.bytes };
}
function validateDescriptor(id, capacity, summary) {
    if (!id || id.length > 128)
        throw new Error('Service contract requires a bounded ID');
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 1024)
        throw new Error('Invalid service capacity');
    if (summary.length > 128)
        throw new Error('Service summary policy must be bounded');
}
export const defineCommand = (id, options = {}) => descriptor('command', id, options);
export const defineQuery = (id, options = {}) => descriptor('query', id, options);
export const defineEvent = (id, options = {}) => descriptor('event', id, options);
/** Stream descriptors register ownership only. Payloads use their direct port and credit protocol. */
export const defineStream = (id) => descriptor('stream', id, {});
export const ShipOrders = {
    move: defineCommand('shipOrders.move', { ordered: 'shipOrders', capacity: 128 }),
    transfer: defineCommand('shipOrders.transfer', { ordered: 'shipOrders', capacity: 128 }),
    retry: defineCommand('shipOrders.retry', { ordered: 'shipOrders', capacity: 128 }),
    receipt: defineQuery('shipOrders.receipt'),
};
export const ShipProjection = { batches: defineStream('shipProjection.batches') };
export const FleetServices = {
    generate: defineCommand('fleets.generate', { ordered: 'fleets' }),
    generateBulk: defineCommand('fleets.generateBulk', { ordered: 'fleets' }),
    spawned: defineEvent('fleets.spawned', { ordered: 'fleets' }),
    batch: defineEvent('fleets.batch', { ordered: 'fleets' }),
    state: defineEvent('fleets.state', { ordered: 'fleets' }),
    removed: defineEvent('fleets.removed', { ordered: 'fleets' }),
};
//# sourceMappingURL=services.js.map