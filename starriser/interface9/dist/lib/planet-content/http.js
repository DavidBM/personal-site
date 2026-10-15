import { PLANET_PAGE_BYTES } from './contracts.js';
import { gameHttpEndpoint } from '../../contracts/game-http-endpoint.js';
export class PlanetHttpError extends Error {
    constructor(status) { super(`Planet content request failed (${status})`); this.status = status; }
}
async function body(response, signal) {
    const length = response.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > PLANET_PAGE_BYTES)) {
        await response.body?.cancel();
        throw new Error('Planet response exceeds page budget');
    }
    if (!response.body)
        throw new Error('Missing planet response');
    const reader = response.body.getReader(), bytes = new Uint8Array(PLANET_PAGE_BYTES);
    let used = 0;
    const abort = () => { void reader.cancel(signal.reason).catch(() => { }); };
    signal.addEventListener('abort', abort, { once: true });
    try {
        for (;;) {
            signal.throwIfAborted();
            const chunk = await reader.read();
            signal.throwIfAborted();
            if (chunk.done)
                return bytes.slice(0, used);
            if (used + chunk.value.byteLength > bytes.length)
                throw new Error('Planet response exceeds page budget');
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
function validateEndpoint(options) {
    const url = new URL(options.endpoint);
    if (!gameHttpEndpoint(url, true) || !/^[0-9a-f]{64}$/.test(options.credential)) {
        throw new Error('Invalid planet endpoint or credential');
    }
}
async function responseVersion(response, epoch) {
    const version = response.headers.get('x-content-version');
    if (response.headers.get('x-visibility-epoch') !== epoch || !version || !/^[a-f0-9]{64}$/.test(version)) {
        await response.body?.cancel();
        throw new Error('Invalid planet response identity/epoch');
    }
    return version;
}
export async function requestPlanet(options, operation) {
    return requestPlanetEnvelope(options, options.identity, operation);
}
export async function requestPlanetEnvelope(options, identity, operation) {
    options.signal.throwIfAborted();
    validateEndpoint(options);
    const response = await (options.fetch ?? globalThis.fetch.bind(globalThis))(options.endpoint, { method: 'POST', redirect: 'error', cache: 'no-store', credentials: 'omit',
        headers: { authorization: `Bearer ${options.credential}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ...identity, visibilityEpoch: options.visibilityEpoch, ...operation }), signal: options.signal });
    if (options.signal.aborted) {
        await response.body?.cancel();
        options.signal.throwIfAborted();
    }
    if (response.status !== 200 && response.status !== 204) {
        await response.body?.cancel();
        throw new PlanetHttpError(response.status);
    }
    const version = await responseVersion(response, options.visibilityEpoch);
    if (response.status === 204) {
        await response.body?.cancel();
        return { version, bytes: new Uint8Array(), unchanged: true };
    }
    return { version, bytes: await body(response, options.signal), unchanged: false };
}
//# sourceMappingURL=http.js.map