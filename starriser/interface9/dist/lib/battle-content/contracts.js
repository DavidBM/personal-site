export function identifier(value) { if (typeof value !== 'string' || !/^[a-f0-9]{32}$/.test(value) || /^0+$/.test(value))
    throw new Error('Invalid battle identity'); return value; }
export function decimal(value) { if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value))
    throw new Error('Invalid battle integer'); const number = BigInt(value); if (number > 18446744073709551615n)
    throw new Error('Battle integer overflow'); return number; }
export function integer(value, minimum, maximum) { if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new Error('Invalid battle count'); return value; }
export function object(value) { if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid battle response'); return value; }
export function validateOperation(fleet, operation) {
    identifier(fleet.systemId);
    identifier(fleet.fleetId);
    if (operation.action === 'read') {
        integer(operation.page ?? 0, 0, 31);
        if (operation.revision !== undefined) {
            decimal(operation.revision);
            identifier(operation.battleId);
        }
        if ((operation.page ?? 0) > 0 && operation.revision === undefined)
            throw new Error('Battle page needs its accepted revision');
        return;
    }
    identifier(operation.battleId);
    identifier(operation.commandId);
    if (decimal(operation.nextTurn) < 1n)
        throw new Error('Invalid next turn');
    decimal(operation.planRevision);
    if (operation.action === 'strategy') {
        integer(operation.role, 1, 6);
        integer(operation.strategy, 0, 8);
    }
    else if (operation.action !== 'retreat')
        throw new Error('Invalid battle action');
}
//# sourceMappingURL=contracts.js.map