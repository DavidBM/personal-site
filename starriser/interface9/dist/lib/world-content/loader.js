import { createWorkerWorldLoader } from './worker-client.js';
import { parseContentAtlas, parseContentSystem } from './records.js';
import { createWorldContentCache, validateWorldContentDescriptor } from './cache.js';
import { ContentHttpError, requestContent } from './http.js';
import { createContentScheduler, waitForConsumer } from './scheduler.js';
import { gameHttpEndpoint } from '../../contracts/game-http-endpoint.js';
function validateScope(scope) {
    if (!/^[a-f0-9]{64}$/.test(scope.credential) || !/^[1-9]\d{0,19}$/.test(scope.visibilityEpoch)
        || BigInt(scope.visibilityEpoch) > 0xffffffffffffffffn)
        throw new Error('Invalid content session scope');
}
function endpoint(value, allowLoopback) {
    const url = new URL(value);
    if (!gameHttpEndpoint(url, allowLoopback))
        throw new Error('Invalid content endpoint');
    return url.href;
}
function parseJson(bytes) { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
function manifest(bytes, worldId) {
    const value = parseJson(bytes);
    if (!value || Object.keys(value).sort().join(',') !== 'atlas,coordinates,idMapping,schemaVersion,worldId'
        || value.schemaVersion !== 1 || value.worldId !== worldId || value.coordinates !== 'galaxy-world-x-y-z'
        || value.idMapping !== 'kind-u32-prefix-id-u32-suffix-be-v1')
        throw new Error('Invalid world manifest');
    validateAtlas(value.atlas);
    return value;
}
function validateAtlas(atlas) {
    if (!atlas || Object.keys(atlas).sort().join(',') !== 'keyPrefix,segmentCount,version'
        || atlas.keyPrefix !== 'atlas/' || !Number.isInteger(atlas.segmentCount)
        || atlas.segmentCount < 1 || atlas.segmentCount > 0xffffffff || !/^[a-f0-9]{64}$/.test(atlas.version)) {
        throw new Error('Invalid world atlas');
    }
}
function validateKey(key) {
    if (!/^(atlas|system)\/(0|[1-9]\d{0,9})$/.test(key) || Number(key.split('/')[1]) > 0xffffffff)
        throw new Error('Invalid deliverable content key');
}
export function createWorldContentLoader(options) {
    if (typeof window !== 'undefined' && !options.fetch && !options.persistence && !options.pace)
        return createWorkerWorldLoader(options);
    let scope = { credential: options.credential, visibilityEpoch: options.visibilityEpoch };
    validateScope(scope);
    const url = endpoint(options.endpoint, options.allowLoopbackHttp ?? false);
    const cache = createWorldContentCache({ worldId: options.worldId });
    const scheduler = createContentScheduler(options.concurrency ?? 1, options.maxQueued ?? 16);
    const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    const pace = options.pace ?? (() => new Promise(resolve => setTimeout(resolve, 0)));
    const controllers = new Set();
    const keys = new Map();
    const inactive = new Set();
    let disposed = false;
    let generation = 0;
    let persistenceBarrier = Promise.resolve();
    function invalidate(forget = true) {
        generation++;
        cache.clear();
        keys.clear();
        inactive.clear();
        for (const controller of controllers)
            controller.abort(new Error('World content scope invalidated'));
        if (forget)
            persistenceBarrier = persistenceBarrier.then(() => options.persistence?.clear()).catch(() => { });
    }
    function requestFailed(error, expected) {
        if (expected === generation && error instanceof ContentHttpError && [401, 403].includes(error.status))
            invalidate();
        throw error;
    }
    async function run(key, signal, work) {
        if (disposed)
            throw new Error('World content loader disposed');
        if (keys.has(key))
            throw new Error('World content key already loading');
        signal?.throwIfAborted();
        const controller = new AbortController();
        const expected = generation;
        const selected = scope;
        const abort = () => controller.abort(signal?.reason);
        signal?.addEventListener('abort', abort, { once: true });
        controllers.add(controller);
        keys.set(key, controller);
        inactive.delete(key);
        function check() {
            controller.signal.throwIfAborted();
            if (expected !== generation || disposed)
                throw new Error('Stale world content lifetime');
        }
        async function requestContentBound(operation) {
            check();
            const value = await requestContent({ ...selected, worldId: options.worldId, endpoint: url, fetch: fetcher, signal: controller.signal }, operation);
            check();
            return value;
        }
        try {
            return await scheduler.run(controller.signal, () => work(requestContentBound, check, controller.signal));
        }
        catch (error) {
            return requestFailed(error, expected);
        }
        finally {
            signal?.removeEventListener('abort', abort);
            controllers.delete(controller);
            if (keys.get(key) === controller)
                keys.delete(key);
            if (expected === generation && cache.hasPending(key))
                inactive.add(key);
        }
    }
    function begin(descriptor) {
        for (;;) {
            try {
                return cache.begin(descriptor);
            }
            catch (error) {
                if (!(error instanceof Error) || error.message !== 'World content backpressure' || inactive.size === 0)
                    throw error;
                const oldest = inactive.values().next().value;
                inactive.delete(oldest);
                cache.cancel(oldest);
            }
        }
    }
    async function persistent(work, check) {
        await persistenceBarrier;
        check();
        try {
            return options.persistence && await work(options.persistence);
        }
        catch {
            check();
            return undefined;
        } // Browser quota/private-mode failure only removes the optimization.
    }
    async function saved(key, signal, check) {
        const value = await persistent(store => store.read(key, signal), check);
        check();
        if (!value)
            return;
        try {
            validateWorldContentDescriptor(value.descriptor, options.worldId);
            if (value.descriptor.key !== key || !(value.bytes instanceof Uint8Array)
                || value.bytes.byteLength !== value.descriptor.byteLength)
                throw new Error('Invalid persistent content');
            return value;
        }
        catch {
            await persistent(store => store.forget(key), check);
        }
    }
    async function restore(value, check) {
        const d = value.descriptor;
        if (begin(d) !== 'cached') {
            for (const index of cache.missing(d.key))
                cache.page(d.key, d.version, index, value.bytes.subarray(index * d.pageBytes, Math.min(value.bytes.length, (index + 1) * d.pageBytes)));
            if (!await cache.finish(d.key, d.version))
                throw new Error('Persistent content verification superseded');
        }
        check();
        return cache.read(d.key, d.version);
    }
    async function reuse(key, known, received, disk, check) {
        if (!known || received !== known)
            throw new Error('Unchanged content has no matching complete cache');
        const memory = cache.read(key, known);
        if (memory)
            return memory;
        if (!disk)
            throw new Error('Unchanged content has no matching complete cache');
        try {
            return await restore(disk, check);
        }
        catch {
            check();
            cache.forget(key);
            await persistent(store => store.forget(key), check);
            return undefined; // Corrupt disk copy needs a fresh descriptor and pages.
        }
    }
    async function download(key, response, request, check, signal, loadOptions) {
        if (response.unchanged)
            throw new Error('Unchanged content has no matching complete cache');
        const descriptor = parseJson(response.bytes);
        if (descriptor.key !== key || descriptor.version !== response.version)
            throw new Error('Content descriptor response mismatch');
        if (begin(descriptor) === 'cached')
            return cache.read(key, descriptor.version);
        for (const page of cache.missing(key)) {
            await waitForConsumer(pace(), signal);
            check();
            const result = await request({ kind: 'page', key, version: descriptor.version, page });
            if (result.unchanged || result.version !== descriptor.version)
                throw new Error('Content page response mismatch');
            cache.page(key, descriptor.version, page, result.bytes);
            await waitForConsumer(Promise.resolve(loadOptions.onPage?.(page, descriptor.pageCount)), signal);
            check();
        }
        if (!await cache.finish(key, descriptor.version))
            throw new Error('Content verification superseded');
        check();
        const bytes = cache.read(key, descriptor.version);
        await persistent(store => store.write({ descriptor, bytes }, signal), check);
        check();
        return bytes;
    }
    async function load(key, loadOptions = {}) {
        validateKey(key);
        return run(key, loadOptions.signal, async (request, check, signal) => {
            const disk = cache.version(key) ? undefined : await saved(key, signal, check);
            const known = cache.version(key) ?? disk?.descriptor.version;
            let response = await request({ kind: 'descriptor', key, version: known });
            if (response.unchanged) {
                const bytes = await reuse(key, known, response.version, disk, check);
                if (bytes)
                    return bytes;
                response = await request({ kind: 'descriptor', key });
            }
            return download(key, response, request, check, signal, loadOptions);
        });
    }
    return { load,
        async loadSystem(id, options) { return parseContentSystem(await load(`system/${id}`, options), id); },
        async loadAtlas(index, options) { return parseContentAtlas(await load(`atlas/${index}`, options)).clusters; },
        loadManifest(signal) {
            return run('manifest', signal, async (request) => {
                const value = await request({ kind: 'manifest' });
                if (value.unchanged)
                    throw new Error('Manifest requires a body');
                return manifest(value.bytes, options.worldId);
            });
        },
        reconnect(next) {
            validateScope(next);
            if (next.credential !== scope.credential || next.visibilityEpoch !== scope.visibilityEpoch)
                invalidate();
            scope = { ...next };
        },
        abandon(key) {
            validateKey(key);
            keys.get(key)?.abort(new Error('World content abandoned'));
            cache.cancel(key);
            inactive.delete(key);
        },
        dispose(forget = false) {
            disposed = true;
            invalidate(forget);
            return persistenceBarrier.finally(() => options.persistence?.close());
        },
        inspect() { return { ...cache.inspect(), ...scheduler.inspect() }; }, };
}
//# sourceMappingURL=loader.js.map