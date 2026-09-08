import { create } from '@bufbuild/protobuf';
import { MoveReceiptSchema } from './generated/galaxy/v1/galaxy_pb.js';
import { commandIdentity } from './command-tracker.js';
function unknown(key) {
    return create(MoveReceiptSchema, { key, result: { case: 'unknown', value: { reason: 3 } } });
}
/** Receipt correlation is confined to the network worker. Caller cancellation
 * ends its wait; it cannot cancel or relabel a submitted durable command. */
export function createServiceRequests(control) {
    const pending = new Map();
    const keys = new Map();
    let next = 0;
    let closed = false;
    function complete(requestId, value, error) {
        const item = pending.get(requestId);
        if (!item)
            return;
        clearTimeout(item.timer);
        pending.delete(requestId);
        if (item.identity && keys.get(item.identity) === requestId)
            keys.delete(item.identity);
        if (error)
            item.reject(error);
        else
            item.resolve(value);
    }
    function claim(requestId, key) {
        const item = pending.get(requestId);
        if (!item)
            throw new Error('Receipt operation is no longer pending');
        const identity = commandIdentity(key);
        const owner = keys.get(identity);
        if (owner && owner !== requestId)
            throw new Error('An operation for this command is already pending');
        if (item.identity && item.identity !== identity)
            throw new Error('Receipt operation changed its command key');
        keys.set(identity, requestId);
        item.key = key;
        item.identity = identity;
    }
    function unresolved(requestId) {
        const item = pending.get(requestId);
        if (!item)
            return;
        if (item.key)
            complete(requestId, unknown(item.key));
        else
            complete(requestId, undefined, new Error('Session ended before command preparation'));
    }
    function observe(event) {
        if (event.type === 'pending') {
            claim(event.requestId, event.command.key);
            return pending.get(event.requestId)?.context;
        }
        if (event.type === 'unknown') {
            const context = pending.get(event.requestId)?.context;
            unresolved(event.requestId);
            return context;
        }
        if (event.type === 'state' && event.state === 'closed') {
            for (const id of pending.keys())
                unresolved(id);
        }
        if (event.type === 'receipt')
            return receipt(event.receipt);
    }
    function receipt(value) {
        const id = keys.get(commandIdentity(value.key));
        if (!id)
            return;
        const item = pending.get(id);
        if (item.submitted)
            complete(id, value);
        else
            item.receipt ?? (item.receipt = value);
        return item.context;
    }
    return {
        submit(factory, key, context) {
            if (closed)
                return Promise.reject(new Error('Network receipt service is closed'));
            if (pending.size >= 128)
                return Promise.reject(new Error('Network service receipt capacity exceeded'));
            const requestId = `service-${++next}`;
            const result = new Promise((resolve, reject) => {
                pending.set(requestId, { key, context, submitted: false, resolve, reject, timer: setTimeout(() => unresolved(requestId), 10000) });
            });
            try {
                if (key)
                    claim(requestId, key);
            }
            catch (error) {
                complete(requestId, undefined, error);
                return result;
            }
            void Promise.resolve().then(async () => {
                if (!pending.has(requestId))
                    return;
                await control({ ...factory(requestId), context });
                const item = pending.get(requestId);
                if (!item)
                    return;
                item.submitted = true;
                if (item.receipt)
                    complete(requestId, item.receipt);
            })
                .catch(error => complete(requestId, undefined, error instanceof Error ? error : new Error(String(error))));
            return result;
        },
        observe,
        dispose() { closed = true; for (const id of pending.keys())
            unresolved(id); },
    };
}
//# sourceMappingURL=service-requests.js.map