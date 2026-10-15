import { WORLD_CONTENT_MAX_PAGE_BYTES, WORLD_CONTENT_MAX_SEGMENT_BYTES, WORLD_CONTENT_MAX_SEGMENT_PAGES, WORLD_CONTENT_SCHEMA_VERSION } from './contracts.js';
export function validateWorldContentDescriptor(value, worldId) {
    if (value.schemaVersion !== WORLD_CONTENT_SCHEMA_VERSION || value.worldId !== worldId
        || !/^(atlas|system|navigation|cluster-systems)\/(0|[1-9]\d{0,9})$/.test(value.key)
        || Number(value.key.split('/')[1]) > 0xffffffff || !/^[a-f0-9]{64}$/.test(value.version)
        || !Number.isSafeInteger(value.byteLength) || value.byteLength < 1 || value.byteLength > WORLD_CONTENT_MAX_SEGMENT_BYTES
        || !Number.isSafeInteger(value.pageBytes) || value.pageBytes < 1 || value.pageBytes > WORLD_CONTENT_MAX_PAGE_BYTES
        || value.pageCount > WORLD_CONTENT_MAX_SEGMENT_PAGES || value.pageCount !== Math.ceil(value.byteLength / value.pageBytes)) {
        throw new Error('Invalid world content descriptor');
    }
}
function same(a, b) {
    return a.version === b.version && a.byteLength === b.byteLength && a.pageBytes === b.pageBytes && a.pageCount === b.pageCount;
}
function positive(value) {
    if (!Number.isSafeInteger(value) || value < 1)
        throw new Error('Invalid content cache limit');
    return value;
}
/** Session-scoped byte cache. The caller owns permission checks and clears on visibility epoch changes. */
export function createWorldContentCache(options) {
    if (!/^[a-f0-9]{32}$/.test(options.worldId))
        throw new Error('Invalid content world ID');
    const worldId = options.worldId;
    const maxCacheBytes = positive(options.maxCacheBytes ?? 16 * 1024 * 1024);
    const maxCacheSegments = positive(options.maxCacheSegments ?? 4096);
    const maxPendingBytes = positive(options.maxPendingBytes ?? 4 * 1024 * 1024);
    const maxPendingSegments = positive(options.maxPendingSegments ?? 16);
    const complete = new Map();
    const pending = new Map();
    let cachedBytes = 0;
    let pendingBytes = 0;
    let pendingSegments = 0;
    function cancel(key) {
        const entry = pending.get(key);
        if (!entry)
            return;
        pending.delete(key);
        // WebCrypto cannot be cancelled: keep its allocation charged until it settles.
        if (!entry.sealing) {
            pendingBytes -= entry.bytes.byteLength;
            pendingSegments--;
        }
    }
    function begin(value) {
        validateWorldContentDescriptor(value, worldId);
        const cached = complete.get(value.key);
        if (cached?.descriptor.version === value.version) {
            if (!same(cached.descriptor, value))
                throw new Error('Conflicting content descriptor');
            cancel(value.key);
            complete.delete(value.key);
            complete.set(value.key, cached);
            return 'cached';
        }
        const previous = pending.get(value.key);
        if (previous?.descriptor.version === value.version) {
            if (!same(previous.descriptor, value))
                throw new Error('Conflicting content descriptor');
            return 'pending';
        }
        const reclaimable = previous && !previous.sealing;
        if (value.byteLength > maxCacheBytes || value.byteLength + pendingBytes - (reclaimable ? previous.bytes.byteLength : 0) > maxPendingBytes
            || pendingSegments - (reclaimable ? 1 : 0) >= maxPendingSegments)
            throw new Error('World content backpressure');
        cancel(value.key);
        pending.set(value.key, { descriptor: Object.freeze({ ...value }), bytes: new Uint8Array(value.byteLength),
            received: new Uint8Array(value.pageCount), remaining: value.pageCount, sealing: false });
        pendingBytes += value.byteLength;
        pendingSegments++;
        return 'pending';
    }
    function missing(key) {
        const entry = pending.get(key);
        if (!entry || entry.sealing)
            return [];
        const result = [];
        for (let i = 0; i < entry.received.length; i++)
            if (!entry.received[i])
                result.push(i);
        return result;
    }
    function page(key, version, index, bytes) {
        const entry = pending.get(key);
        if (!entry || entry.descriptor.version !== version)
            throw new Error('Unknown content transfer');
        if (entry.sealing)
            throw new Error('Content transfer is being verified');
        const { pageCount, pageBytes, byteLength } = entry.descriptor;
        if (!Number.isSafeInteger(index) || index < 0 || index >= pageCount
            || bytes.byteLength !== Math.min(pageBytes, byteLength - index * pageBytes))
            throw new Error('Invalid content page');
        const offset = index * pageBytes;
        if (entry.received[index]) {
            if (!bytes.every((byte, i) => byte === entry.bytes[offset + i])) {
                cancel(key);
                throw new Error('Conflicting duplicate content page');
            }
            return;
        }
        entry.bytes.set(bytes, offset);
        entry.received[index] = 1;
        entry.remaining--;
    }
    async function finish(key, version) {
        const entry = pending.get(key);
        if (!entry || entry.descriptor.version !== version || entry.remaining || entry.sealing)
            throw new Error('Content transfer is incomplete');
        entry.sealing = true;
        try {
            const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', entry.bytes));
            if (pending.get(key) !== entry)
                return false; // Cancelled or superseded during verification.
            if (Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('') !== version)
                throw new Error('Content hash mismatch');
            remove(key);
            while (cachedBytes + entry.bytes.byteLength > maxCacheBytes || complete.size >= maxCacheSegments)
                remove(complete.keys().next().value);
            complete.set(key, { descriptor: entry.descriptor, bytes: entry.bytes });
            cachedBytes += entry.bytes.byteLength;
            return true;
        }
        finally {
            if (pending.get(key) === entry)
                pending.delete(key);
            pendingBytes -= entry.bytes.byteLength;
            pendingSegments--;
        }
    }
    function remove(key) {
        const entry = complete.get(key);
        if (entry) {
            cachedBytes -= entry.bytes.byteLength;
            complete.delete(key);
        }
    }
    function read(key, version) {
        const entry = complete.get(key);
        if (!entry || entry.descriptor.version !== version)
            return undefined;
        complete.delete(key);
        complete.set(key, entry);
        return entry.bytes.slice();
    }
    return { begin, missing, page, finish, read, cancel,
        forget(key) { cancel(key); remove(key); },
        clear() { for (const key of pending.keys())
            cancel(key); complete.clear(); cachedBytes = 0; },
        hasPending(key) { return pending.has(key); },
        version(key) { return complete.get(key)?.descriptor.version; },
        inspect() { return { cachedSegments: complete.size, cachedBytes, pendingSegments, pendingBytes }; }, };
}
//# sourceMappingURL=cache.js.map