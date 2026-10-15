import { WORLD_CONTENT_MAX_SEGMENT_BYTES } from './contracts.js';
const DATABASE = 'galaxy-world-content-v1';
const MAX_BYTES = 16 * 1024 * 1024, MAX_RECORDS = 4096;
function result(request) {
    return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
function open(factory, name) {
    return new Promise((resolve, reject) => {
        let expired = false;
        const request = factory.open(name, 1);
        const timer = setTimeout(() => { expired = true; reject(new Error('Content storage open timed out')); }, 3000);
        request.onupgradeneeded = () => {
            const values = request.result.createObjectStore('values', { keyPath: 'id' });
            values.createIndex('partition', 'partition');
            values.createIndex('used', 'used');
            request.result.createObjectStore('accounting');
        };
        request.onerror = () => { clearTimeout(timer); reject(request.error); };
        request.onsuccess = () => {
            clearTimeout(timer);
            if (expired) {
                request.result.close();
                return;
            }
            request.result.onversionchange = () => request.result.close();
            resolve(request.result);
        };
    });
}
function completion(transaction, signal) {
    return new Promise((resolve, reject) => {
        const abort = () => { try {
            transaction.abort();
        }
        catch { /* Already complete. */ } };
        signal?.addEventListener('abort', abort, { once: true });
        function finish(error) { signal?.removeEventListener('abort', abort); if (error)
            reject(error);
        else
            resolve(); }
        transaction.oncomplete = () => finish();
        transaction.onabort = () => finish(signal?.reason ?? transaction.error ?? new Error('Content storage transaction aborted'));
        transaction.onerror = () => { }; // onabort owns the final transaction result.
        if (signal?.aborted)
            abort();
    });
}
async function partitionId(scope) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(scope));
    return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
}
function charge(value) {
    if (!(value.bytes instanceof Uint8Array) || value.bytes.byteLength < 1 || value.bytes.byteLength > WORLD_CONTENT_MAX_SEGMENT_BYTES)
        throw new Error('Content storage payload limit');
    return value.bytes.byteLength + new TextEncoder().encode(JSON.stringify(value.descriptor)).byteLength + 256;
}
async function accounting(store) {
    return await result(store.get('total')) ?? { bytes: 0, count: 0, sequence: 0 };
}
async function erase(values, stats, id) {
    const previous = await result(values.get(id));
    if (!previous)
        return;
    values.delete(id);
    stats.bytes -= previous.size;
    stats.count--;
}
async function evict(values, stats, size, maxBytes, maxRecords) {
    await new Promise((resolve, reject) => {
        const request = values.index('used').openCursor();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const cursor = request.result;
            if (stats.bytes + size <= maxBytes && stats.count < maxRecords) {
                resolve();
                return;
            }
            if (!cursor) {
                reject(new Error('Content storage accounting mismatch'));
                return;
            }
            const old = cursor.value;
            cursor.delete();
            stats.bytes -= old.size;
            stats.count--;
            cursor.continue();
        };
    });
}
function limits(options) {
    const maxBytes = options.maxBytes ?? MAX_BYTES, maxRecords = options.maxRecords ?? MAX_RECORDS;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BYTES
        || !Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > MAX_RECORDS)
        throw new Error('Content storage budget limit');
    return { maxBytes, maxRecords };
}
/** Shared origin budget, enforced in one serial IDB read/write transaction even
 * across tabs. Scope contains authenticated endpoint/world/player, never secrets.
 * Quota/unavailable storage is optional: the loader falls back to its RAM cache. */
export function createIndexedContentStore(options) {
    if (!options.scope || options.scope.length > 4096)
        throw new Error('Content storage scope limit');
    const { maxBytes, maxRecords } = limits(options);
    let closed = false;
    const factory = options.factory ?? globalThis.indexedDB;
    const database = factory ? open(factory, options.database ?? DATABASE) : Promise.reject(new Error('Browser content storage unavailable'));
    void database.catch(() => { });
    const partition = partitionId(options.scope);
    async function transaction(mode, work, signal) {
        signal?.throwIfAborted();
        if (closed)
            throw new Error('Content storage closed');
        const [db, prefix] = await Promise.all([database, partition]);
        signal?.throwIfAborted();
        if (closed)
            throw new Error('Content storage closed');
        const tx = db.transaction(['values', 'accounting'], mode), done = completion(tx, signal);
        void done.catch(() => { });
        try {
            const value = await work(tx.objectStore('values'), tx.objectStore('accounting'), prefix);
            await done;
            signal?.throwIfAborted();
            return value;
        }
        catch (error) {
            try {
                tx.abort();
            }
            catch { /* Completed or aborted. */ }
            await done.catch(() => { });
            throw error;
        }
    }
    async function remove(key) {
        await transaction('readwrite', async (values, meta, prefix) => {
            const stats = await accounting(meta);
            if (key !== undefined)
                await erase(values, stats, `${prefix}:${key}`);
            else
                await new Promise((resolve, reject) => {
                    const request = values.index('partition').openCursor(IDBKeyRange.only(prefix));
                    request.onerror = () => reject(request.error);
                    request.onsuccess = () => {
                        const cursor = request.result;
                        if (!cursor) {
                            resolve();
                            return;
                        }
                        const old = cursor.value;
                        cursor.delete();
                        stats.bytes -= old.size;
                        stats.count--;
                        cursor.continue();
                    };
                });
            meta.put(stats, 'total');
        });
    }
    return {
        read(key, signal) {
            return transaction('readwrite', async (values, meta, prefix) => {
                const entry = await result(values.get(`${prefix}:${key}`));
                if (!entry)
                    return;
                const stats = await accounting(meta);
                entry.used = ++stats.sequence;
                values.put(entry);
                meta.put(stats, 'total');
                return { descriptor: entry.descriptor, bytes: entry.bytes };
            }, signal);
        },
        async write(value, signal) {
            const size = charge(value);
            if (size > maxBytes)
                return;
            await transaction('readwrite', async (values, meta, prefix) => {
                const stats = await accounting(meta), id = `${prefix}:${value.descriptor.key}`;
                await erase(values, stats, id);
                await evict(values, stats, size, maxBytes, maxRecords);
                values.put({ ...value, id, partition: prefix, size, used: ++stats.sequence });
                stats.bytes += size;
                stats.count++;
                meta.put(stats, 'total');
            }, signal);
        },
        forget: key => remove(key), clear: () => remove(),
        close() { closed = true; void database.then(db => db.close()).catch(() => { }); },
    };
}
//# sourceMappingURL=indexed-cache.js.map