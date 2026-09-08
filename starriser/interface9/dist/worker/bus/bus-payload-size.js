/** Conservative retained-payload policy, not an exact V8 heap measurement. */
export const DEFAULT_BUS_BYTES = 16 * 1024 * 1024;
export function estimateBusPayloadBytes(value, limit = DEFAULT_BUS_BYTES) {
    let bytes = 0;
    const seen = new Set();
    const pending = [value];
    function charge(amount) {
        bytes += amount;
        if (!Number.isSafeInteger(bytes) || bytes > limit)
            throw new Error('Bus payload exceeds queue byte capacity');
    }
    function object(value) {
        if (seen.has(value)) {
            charge(8);
            return;
        }
        seen.add(value);
        charge(128);
        if (buffer(value)) {
            charge(value.byteLength);
            return;
        }
        if (ArrayBuffer.isView(value)) {
            pending.push(value.buffer);
            return;
        }
        if (typeof MessagePort !== 'undefined' && value instanceof MessagePort)
            return;
        if (collection(value))
            return;
        fields(value);
    }
    function collection(value) {
        if (value instanceof Date) {
            charge(16);
            return true;
        }
        if (value instanceof Map) {
            charge(value.size * 64);
            for (const [key, item] of value)
                pending.push(key, item);
            return true;
        }
        if (value instanceof Set) {
            charge(value.size * 32);
            for (const item of value)
                pending.push(item);
            return true;
        }
        if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
            throw new Error('Bus payload must use supported structured-clone data');
        return false;
    }
    function fields(value) {
        if (Array.isArray(value))
            charge(value.length * 16);
        const keys = Object.keys(value);
        charge(keys.length * 64);
        for (const key of keys) {
            charge(32 + key.length * 2);
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!('value' in descriptor))
                throw new Error('Bus payload accessors are unsupported; send plain data');
            pending.push(descriptor.value);
        }
    }
    while (pending.length) {
        const item = pending.pop();
        if (item === null || item === undefined) {
            charge(8);
            continue;
        }
        if (typeof item === 'object') {
            object(item);
            continue;
        }
        if (typeof item === 'string') {
            charge(32 + item.length * 2);
            continue;
        }
        if (typeof item === 'bigint') {
            charge(32 + item.toString(16).length);
            continue;
        }
        if (typeof item === 'function' || typeof item === 'symbol')
            throw new Error('Bus payload must be structured-clone data');
        charge(16);
    }
    return bytes;
}
function buffer(value) {
    return value instanceof ArrayBuffer || typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer;
}
//# sourceMappingURL=bus-payload-size.js.map