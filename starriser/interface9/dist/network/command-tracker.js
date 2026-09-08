import { opaqueIdAt } from '../contracts/opaque-id.js';
import { SESSION_LIMITS } from './session-contracts.js';
export function commandIdentity(key) {
    return `${opaqueIdAt(key.receiptHomeShardId)}:${key.admissionGeneration}:${opaqueIdAt(key.commandId)}`;
}
/** Retains only bounded in-flight outcomes. A timeout is unknown, never a new
 * command. The UI receives the original intent/key before network submission. */
export function createCommandTracker(emit) {
    const pending = new Map();
    function unknown(identity) {
        const item = pending.get(identity);
        if (!item)
            return;
        pending.delete(identity);
        clearTimeout(item.timer);
        emit({ type: 'unknown', requestId: item.requestId, key: item.key });
    }
    return {
        async beforeSend(requestId, command) {
            if (!requestId || requestId.length > 128)
                throw new Error('Invalid command request ID');
            const key = command.key;
            const identity = commandIdentity(key);
            if (pending.has(identity))
                throw new Error('Command is already pending; query its original receipt home');
            if (pending.size >= SESSION_LIMITS.pendingCommands)
                throw new Error('Pending command budget exceeded');
            const timer = setTimeout(() => unknown(identity), SESSION_LIMITS.receiptMs);
            const item = { requestId, key, timer };
            pending.set(identity, item);
            await emit({ type: 'pending', requestId, command: structuredClone(command) });
            if (pending.get(identity) !== item)
                throw new Error('Command preparation expired before submission');
        },
        receipt(receipt) {
            const identity = commandIdentity(receipt.key);
            const item = pending.get(identity);
            if (item) {
                clearTimeout(item.timer);
                pending.delete(identity);
            }
            emit({ type: 'receipt', receipt });
        },
        dispose() { for (const identity of pending.keys())
            unknown(identity); },
        inspect: () => pending.size,
    };
}
//# sourceMappingURL=command-tracker.js.map