// Replies carry bounded result data and must progress while ordinary handlers
// wait for them. This pool includes lifecycle traffic and request completion.
const CONTROL_BYTES = 512 * 1024;
function limit(value, fallback) {
    if (value === undefined)
        return fallback;
    if (!Number.isSafeInteger(value) || value < 1)
        throw new Error('Bus limits must be positive safe integers');
    return value;
}
/** Waiters retain small admission metadata, never the sender's payload. */
export function createBusCapacity(options) {
    const limits = { count: limit(options.maxQueuedMessages, 10240), bytes: limit(options.maxQueuedBytes, 16 * 1024 * 1024),
        control: limit(options.maxControlMessages, 128) };
    const ordinary = new Map(), control = new Map();
    let count = 0, bytes = 0, unknown = 0, controls = 0, controlBytes = 0, next = 0, disposed = false;
    function fits(size) {
        return size.control ? controls < limits.control && controlBytes + (size.bytes ?? 0) <= CONTROL_BYTES
            : count < limits.count && bytes + (size.bytes ?? 0) <= limits.bytes;
    }
    function charge(size, direction) {
        if (size.control) {
            controls += direction;
            controlBytes += direction * (size.bytes ?? 0);
            return;
        }
        count += direction;
        bytes += direction * (size.bytes ?? 0);
        if (size.bytes === undefined)
            unknown += direction;
    }
    function permit(size) {
        charge(size, 1);
        let released = false, claimed = false;
        return { ...size,
            claim() { if (released || claimed || disposed)
                throw new Error('Bus reservation is unavailable'); claimed = true; },
            release() {
                if (released || disposed)
                    return;
                released = true;
                charge(size, -1);
                pump(control);
                pump(ordinary);
            },
        };
    }
    function pump(queue) {
        while (!disposed && queue.size) {
            const [id, item] = queue.entries().next().value;
            if (!fits(item))
                return;
            queue.delete(id);
            item.grant();
        }
    }
    function reserve(size, signal) {
        if (disposed)
            return Promise.reject(new Error('Bus destroyed'));
        if (signal?.aborted)
            return Promise.reject(signal.reason);
        if (!validSize(size.bytes))
            return Promise.reject(new Error('Invalid Bus byte estimate'));
        if ((size.bytes ?? 0) > (size.control ? CONTROL_BYTES : limits.bytes))
            return Promise.reject(new Error('Bus payload exceeds queue byte capacity'));
        const queue = size.control ? control : ordinary;
        return new Promise((resolve, reject) => {
            const id = ++next;
            function cleanup() { queue.delete(id); signal?.removeEventListener('abort', cancel); }
            function cancel() { cleanup(); reject(signal?.reason ?? new Error('Bus admission canceled')); pump(queue); }
            queue.set(id, { ...size, grant() { cleanup(); resolve(permit(size)); }, reject(error) { cleanup(); reject(error); } });
            signal?.addEventListener('abort', cancel, { once: true });
            pump(queue);
        });
    }
    return { reserve,
        tryReserve(size) {
            if (disposed || (size.control ? control : ordinary).size || !fits(size))
                return undefined;
            return permit(size);
        },
        stats: () => ({ pendingMessages: count, knownBytes: bytes, unknownSizedMessages: unknown,
            controlMessages: controls, controlKnownBytes: controlBytes, waitingAdmissions: ordinary.size + control.size }),
        dispose() {
            disposed = true;
            for (const queue of [ordinary, control])
                for (const item of queue.values())
                    item.reject(new Error('Bus destroyed'));
            count = bytes = unknown = controls = controlBytes = 0;
        }, };
}
function validSize(bytes) { return bytes === undefined || Number.isSafeInteger(bytes) && bytes >= 0; }
//# sourceMappingURL=bus-capacity.js.map