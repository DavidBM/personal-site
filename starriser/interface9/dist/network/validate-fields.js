export function check(condition, field) {
    if (!condition)
        throw new Error(`Invalid protocol ${field}`);
}
export function present(value, field) {
    check(value !== undefined, field);
    return value;
}
export function id(bytes) {
    check(bytes.byteLength === 16 && bytes.some((byte) => byte !== 0), "identity");
}
export function token(bytes) {
    check(bytes.byteLength > 0 && bytes.byteLength <= 4096, "credential length");
}
export function key(value) {
    const item = present(value, "command key");
    id(item.commandId);
    id(item.receiptHomeShardId);
    check(item.admissionGeneration > 0n, "admission generation");
}
export function scope(value) {
    const item = present(value, "authority scope");
    id(item.worldId);
    id(item.shardId);
    id(item.systemId);
    check(item.ownerEpoch > 0n && item.recoveryGeneration > 0n, "authority generation");
}
export function position(value) {
    const item = present(value, "local position");
    check(Number.isFinite(item.x) && Number.isFinite(item.z), "local position");
}
export function cursor(value) {
    const item = present(value, "stream cursor");
    id(item.subscriptionId);
    check(item.generation > 0n, "stream generation");
}
export function ship(value) {
    id(value.shipId);
    position(value.position);
    if (!value.movement)
        return;
    if (value.movement.orderId.byteLength)
        id(value.movement.orderId);
    position(value.movement.from);
    position(value.movement.to);
    check(value.movement.arrivalServerMs > value.movement.departureServerMs, "movement deadline");
}
//# sourceMappingURL=validate-fields.js.map