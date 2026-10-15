import { WORLD_CONTENT_MAX_PAGE_BYTES } from './contracts.js';
export class ContentHttpError extends Error {
    constructor(status) { super(`World content request failed (${status})`); this.status = status; }
}
/** Incremental reads enforce the cap even for missing/false Content-Length. */
export async function readContentBody(response, signal) {
    const length = response.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > WORLD_CONTENT_MAX_PAGE_BYTES)) {
        await response.body?.cancel();
        throw new Error('World content response exceeds page limit');
    }
    if (!response.body)
        throw new Error('Missing world content body');
    const reader = response.body.getReader();
    const bytes = new Uint8Array(WORLD_CONTENT_MAX_PAGE_BYTES);
    let used = 0;
    const abort = () => { void reader.cancel(signal.reason).catch(() => { }); };
    signal.addEventListener('abort', abort, { once: true });
    try {
        while (true) {
            signal.throwIfAborted();
            const chunk = await reader.read();
            signal.throwIfAborted();
            if (chunk.done)
                return bytes.slice(0, used);
            if (used + chunk.value.byteLength > bytes.length)
                throw new Error('World content response exceeds page limit');
            bytes.set(chunk.value, used);
            used += chunk.value.byteLength;
        }
    }
    finally {
        signal.removeEventListener('abort', abort);
        await reader.cancel().catch(() => { });
        reader.releaseLock();
    }
}
export async function requestContent(options, operation) {
    options.signal.throwIfAborted();
    const response = await options.fetch(options.endpoint, { method: 'POST', redirect: 'error', cache: 'no-store', credentials: 'omit',
        headers: { authorization: `Bearer ${options.credential}`, 'content-type': 'application/json' },
        body: JSON.stringify({ worldId: options.worldId, visibilityEpoch: options.visibilityEpoch, ...operation }), signal: options.signal });
    options.signal.throwIfAborted();
    if (response.status !== 200 && response.status !== 204) {
        await response.body?.cancel();
        throw new ContentHttpError(response.status);
    }
    const version = await validateHeaders(response, options.visibilityEpoch);
    if (response.status === 204) {
        await response.body?.cancel();
        return { unchanged: true, version, bytes: new Uint8Array() };
    }
    return { unchanged: false, version, bytes: await readContentBody(response, options.signal) };
}
async function validateHeaders(response, epoch) {
    if (response.headers.get('x-visibility-epoch') !== epoch) {
        await response.body?.cancel();
        throw new Error('Stale world content permission epoch');
    }
    const version = response.headers.get('x-content-version');
    if (version !== null && !/^[a-f0-9]{64}$/.test(version)) {
        await response.body?.cancel();
        throw new Error('Invalid world content version');
    }
    return version;
}
//# sourceMappingURL=http.js.map