import { opaqueIdAt } from '../contracts/opaque-id.js';
// The generated literal type prevents wire-number drift without importing the
// Protobuf runtime into the unbundled main thread.
const EXPIRED = 2;
const keyOf = (key) => `${opaqueIdAt(key.receiptHomeShardId)}:${key.admissionGeneration}:${opaqueIdAt(key.commandId)}`;
const sameBytes = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
function sameScope(a, b) {
    return !!a && !!b && sameBytes(a.worldId, b.worldId) && sameBytes(a.shardId, b.shardId)
        && sameBytes(a.systemId, b.systemId) && a.ownerEpoch === b.ownerEpoch && a.recoveryGeneration === b.recoveryGeneration;
}
function samePosition(a, b) {
    return Object.is(a?.x, b?.x) && Object.is(a?.z, b?.z);
}
function sameTarget(a, b) {
    if (a.$typeName === 'galaxy.v1.TransferCommand' && b.$typeName === 'galaxy.v1.TransferCommand') {
        return sameBytes(a.destinationSystemId, b.destinationSystemId)
            && samePosition(a.destinationPosition, b.destinationPosition);
    }
    return a.$typeName === 'galaxy.v1.MoveCommand' && b.$typeName === 'galaxy.v1.MoveCommand'
        && samePosition(a.target, b.target);
}
function sameIntent(a, b) {
    return sameScope(a.scope, b.scope) && sameBytes(a.shipId, b.shipId) && sameBytes(a.admissionToken, b.admissionToken)
        && a.expectedSystemRevision === b.expectedSystemRevision && sameTarget(a, b);
}
/** Page-lifetime recovery evidence. Reconnection keeps the original command;
 * refreshing the page does not yet persist this ledger. */
export function createOnlineIntents() {
    const pending = new Map();
    return {
        remember(command) {
            const id = keyOf(command.key);
            const original = pending.get(id);
            if (original) {
                if (!sameIntent(original.command, command))
                    throw new Error('An original order cannot be replaced with a different intent');
                return;
            }
            if (pending.size >= 128)
                throw new Error('Resolve pending orders before submitting more');
            pending.set(id, { command: structuredClone(command), expired: false, continued: false });
        },
        observe(receipt) {
            const original = pending.get(keyOf(receipt.key));
            if (receipt.result.case === 'accepted' || receipt.result.case === 'rejected')
                pending.delete(keyOf(receipt.key));
            if (original && receipt.result.case === 'unknown' && receipt.result.value.reason === EXPIRED)
                original.expired = true;
            return original && structuredClone(original.command);
        },
        continueExpired(key) {
            const retained = pending.get(key);
            if (!retained?.expired)
                throw new Error('An explicit expiry response is required before continuing');
            retained.continued = true;
        },
        canIssue: () => pending.size < 128 && Array.from(pending.values()).every(value => value.continued),
        list: () => Array.from(pending, ([key, value]) => ({ key,
            commandId: opaqueIdAt(value.command.key.commandId), shipId: opaqueIdAt(value.command.shipId), expired: value.expired, continued: value.continued })),
        get: (key) => { const value = pending.get(key); return value && structuredClone(value.command); },
        size: () => pending.size,
    };
}
//# sourceMappingURL=online-intents.js.map