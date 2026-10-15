import { PLANET_METADATA_BYTES, PLANET_PAGE_BYTES, assertPlanetIdentity, bytesPerCell, planetIndexLayout } from './contracts.js';
import { decodePlanetPage, readVerifiedPlanetPage } from './codec.js';
import { parsePlanetManifest } from './manifest.js';
import { PlanetHttpError, requestPlanet } from './http.js';
function sameIdentity(a, b) {
    return a.worldId === b.worldId && a.systemId === b.systemId && a.bodyId === b.bodyId && a.profileVersion === b.profileVersion;
}
function descriptor(bytes, identity, version) {
    const d = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (d.schemaVersion !== 1 || !sameIdentity(d.identity, identity) || d.version !== version || d.pageBytes !== PLANET_PAGE_BYTES
        || !Number.isInteger(d.byteLength) || d.byteLength < 1 || d.byteLength > PLANET_METADATA_BYTES || d.pageCount !== Math.ceil(d.byteLength / PLANET_PAGE_BYTES)) {
        throw new Error('Invalid planet descriptor');
    }
    return d;
}
async function manifest(options) {
    assertPlanetIdentity(options.identity);
    if (!/^[1-9][0-9]*$/.test(options.visibilityEpoch) || BigInt(options.visibilityEpoch) > 0xffffffffffffffffn)
        throw new Error('Invalid visibility epoch');
    const initial = await requestPlanet(options, { kind: 'descriptor' });
    if (initial.unchanged)
        throw new Error('Unexpected unchanged descriptor');
    const d = descriptor(initial.bytes, options.identity, initial.version), bytes = new Uint8Array(d.byteLength);
    for (let page = 0; page < d.pageCount; page++) {
        const value = await requestPlanet(options, { kind: 'manifest', version: d.version, page });
        if (value.unchanged || value.version !== d.version || value.bytes.length !== Math.min(PLANET_PAGE_BYTES, bytes.length - page * PLANET_PAGE_BYTES))
            throw new Error('Invalid planet manifest page');
        bytes.set(value.bytes, page * PLANET_PAGE_BYTES);
    }
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    options.signal.throwIfAborted();
    if (Array.from(hash, b => b.toString(16).padStart(2, '0')).join('') !== d.version)
        throw new Error('Planet manifest integrity mismatch');
    const result = parsePlanetManifest(bytes);
    if (!sameIdentity(result.identity, options.identity))
        throw new Error('Planet manifest identity mismatch');
    return { manifest: result, version: d.version };
}
function indexRange(level, offset, length) {
    const layout = planetIndexLayout(level.pageCount);
    const indexLevel = layout.findIndex(l => offset >= l.offset && offset < l.offset + l.byteLength);
    if (indexLevel < 0)
        throw new Error('Invalid planet index range');
    const local = offset - layout[indexLevel].offset;
    if (local % PLANET_PAGE_BYTES || length !== Math.min(PLANET_PAGE_BYTES, layout[indexLevel].byteLength - local))
        throw new Error('Invalid planet index page');
    return { indexLevel, page: local / PLANET_PAGE_BYTES };
}
function abortable(work, signal) {
    return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted)
            abort();
        const cleanup = () => signal.removeEventListener('abort', abort);
        work.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    });
}
/** One body and one permission lifetime. Owner must abort on logout, reconnect or epoch change. */
export async function openPlanetContent(input) {
    const options = { ...input, identity: { ...input.identity } };
    const loaded = await abortable(manifest(options), options.signal), m = loaded.manifest, version = loaded.version;
    const cache = new Map();
    let queued = 0, tail = Promise.resolve(), retired = null;
    function active() { options.signal.throwIfAborted(); if (retired)
        throw retired; }
    async function requestRange(operation) {
        try {
            return await requestPlanet(options, operation);
        }
        catch (error) {
            if (error instanceof PlanetHttpError && [401, 403].includes(error.status)) {
                retired = error;
                cache.clear();
            }
            throw error;
        }
    }
    options.signal.addEventListener('abort', () => cache.clear(), { once: true });
    function select(name, width) {
        const field = Object.prototype.hasOwnProperty.call(m.fields, name) ? m.fields[name] : undefined;
        const level = field?.levels.find(l => l.width === width);
        if (!field || !level)
            throw new Error('Unknown planet field/level');
        return { field, level };
    }
    async function range(name, level, kind, offset, length) {
        active();
        const key = `${name}/${level.width}/${kind}/${offset}`;
        const cached = cache.get(key);
        if (cached)
            return cached;
        const selection = kind === 'index' ? indexRange(level, offset, length) : { page: offset / PLANET_PAGE_BYTES };
        const result = await requestRange({ kind, version, field: name, width: level.width, ...selection });
        active();
        if (result.unchanged || result.version !== version || result.bytes.length !== length)
            throw new Error('Invalid planet range response');
        // Individual ranges remain untrusted until the Merkle reader verifies them; caching cannot bypass that verification.
        if (cache.size >= 16)
            cache.delete(cache.keys().next().value);
        cache.set(key, result.bytes);
        return result.bytes;
    }
    async function read(name, width, page) {
        const { field, level } = select(name, width);
        const bytes = await readVerifiedPlanetPage(level, page, (kind, offset, length) => range(name, level, kind, offset, length));
        active();
        return decodePlanetPage(bytes, field);
    }
    function readPage(name, width, page) {
        active();
        if (queued >= 8)
            return Promise.reject(new Error('Planet read queue is full'));
        queued++;
        const task = tail.then(() => read(name, width, page));
        tail = task.then(() => { }, () => { }).finally(() => { queued--; });
        return abortable(task, options.signal);
    }
    return { manifest: structuredClone(m), version, readPage, async readPixel(name, width, x, y) {
            active();
            const { field, level } = select(name, width);
            if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= width || y < 0 || y >= level.height)
                throw new Error('Invalid planet pixel');
            const cell = y * width + x, perPage = PLANET_PAGE_BYTES / bytesPerCell(field);
            return (await readPage(name, width, Math.floor(cell / perPage)))[cell % perPage];
        } };
}
//# sourceMappingURL=consumer.js.map