import { FeatureError } from './client.js';
/** Same-origin cookie APIs have their own CSRF boundary; never bearer credentials. */
export async function requestAuth(url, csrf, body, signal) {
    validateEndpoint(url);
    const response = await fetch(url, requestOptions(csrf, body, signal));
    if (response.status === 204)
        return;
    const value = await read(response, signal);
    if (!response.ok)
        throw new FeatureError(typeof value?.error === 'string' ? value.error.slice(0, 400) : 'Authentication request failed', response.status);
    if (value === null)
        throw new FeatureError('Invalid authentication response', 502);
    return value;
}
function validateEndpoint(url) {
    const endpoint = new URL(url);
    if (endpoint.origin !== self.location.origin || !/(?:\/auth\/|\/admin\/api\/)/.test(endpoint.pathname) || endpoint.hash || endpoint.username || endpoint.password)
        throw new Error('Invalid authentication endpoint');
}
function requestOptions(csrf, body, signal) {
    const headers = { Accept: 'application/json' };
    const encoded = body === undefined ? undefined : JSON.stringify(body);
    if (encoded !== undefined) {
        headers['Content-Type'] = 'application/json';
        if (new TextEncoder().encode(encoded).length > 16384)
            throw new Error('Authentication request exceeds budget');
    }
    if (csrf)
        headers['X-CSRF-Token'] = csrf;
    return { method: encoded === undefined ? 'GET' : 'POST', headers, body: encoded, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal };
}
async function read(response, signal) {
    const reader = response.body?.getReader();
    if (!reader)
        return null;
    const bytes = new Uint8Array(65536);
    let n = 0;
    try {
        for (;;) {
            signal.throwIfAborted();
            const part = await reader.read();
            if (part.done)
                break;
            if (n + part.value.length > bytes.length)
                throw new Error('Authentication response exceeds budget');
            bytes.set(part.value, n);
            n += part.value.length;
        }
    }
    finally {
        await reader.cancel().catch(() => { });
        reader.releaseLock();
    }
    try {
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, n)));
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=auth.js.map