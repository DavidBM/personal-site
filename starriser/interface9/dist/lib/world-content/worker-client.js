import { featureRequest, FeatureError, featureControl } from '../../features/http-worker/client.js';
import { ContentHttpError } from './http.js';
/** One opaque worker cache owner. The main thread never hashes/parses/cache-copies pages. */
export function createWorkerWorldLoader(options) {
    const id = crypto.randomUUID(), lifetime = new AbortController();
    let closed = false;
    const { fetch, persistence, pace, ...settings } = options;
    const ready = call('open', [settings], lifetime.signal);
    void ready.catch(() => { });
    async function call(operation, args, signal) {
        try {
            return await featureRequest('world', [id, operation, ...args], signal);
        }
        catch (e) {
            if (e instanceof FeatureError && e.status !== undefined)
                throw new ContentHttpError(e.status);
            throw e;
        }
    }
    async function request(operation, args, signal) {
        if (closed)
            throw new Error('World content loader disposed');
        await ready;
        return call(operation, args, signal ?? lifetime.signal);
    }
    const loadOptions = (o) => { if (o?.onPage)
        throw new Error('Worker content uses segment-level display pacing'); return o?.signal; };
    return {
        load: (key, o) => request('load', [key], loadOptions(o)),
        loadSystem: (id, o) => request('system', [id], loadOptions(o)),
        loadAtlas: (index, o) => request('atlas', [index], loadOptions(o)),
        loadManifest: signal => request('manifest', [], signal),
        reconnect(scope) { void request('reconnect', [scope]).catch(() => { }); },
        abandon(key) { void request('abandon', [key]).catch(() => { }); },
        async dispose(forget = false) { if (closed)
            return; closed = true; lifetime.abort(); await ready.catch(() => { }); featureControl('worldDispose', [id, forget]); },
        inspect: () => ({ remote: true, cachedSegments: 0, cachedBytes: 0, pendingSegments: 0, pendingBytes: 0, active: 0, queued: 0 }),
    };
}
export async function forgetWorkerContent(partition) {
    await featureRequest('world', ['', 'forget', partition], new AbortController().signal);
}
//# sourceMappingURL=worker-client.js.map