import { featureRequest, FeatureError } from '../../features/http-worker/client.js';
import { PlanetHttpError } from './http.js';
import { buildCompactKepler } from '../../gpu/compact-kepler.js';
import { catalogById } from '../../gpu/planet-lib/planet-catalog.js';
import { PLANET_CATALOG_MAX_BODIES, PLANET_CATALOG_MAX_BYTES } from './catalog-contract.js';
import { assertPlanetIdentity, PLANET_PAGE_BYTES } from './contracts.js';
import { requestPlanetEnvelope } from './http.js';
const CLASSES = new Set(['rocky', 'ocean', 'temperate', 'gas', 'ice', 'exotic']);
function key(value) { return typeof value === 'string' && /^[a-z0-9-]{1,64}$/.test(value); }
function validName(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 80 && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}
function body(value, worldId, systemId) {
    if (value.surface === null)
        throw new Error('Invalid planet surface reference');
    assertPlanetIdentity({ worldId, systemId, bodyId: value.bodyId, profileVersion: value.surface?.profileVersion ?? 1 });
    if (!validName(value.name)
        || !CLASSES.has(value.planetClass) || (value.visualCatalogId !== undefined && !key(value.visualCatalogId)))
        throw new Error('Invalid planet catalog body');
    if (value.surface && !/^[0-9a-f]{64}$/.test(value.surface.version))
        throw new Error('Invalid planet surface version');
}
export function parsePlanetCatalog(bytes, worldId, systemId) {
    assertPlanetIdentity({ worldId, systemId, bodyId: systemId, profileVersion: 1 });
    if (!bytes.length || bytes.length > PLANET_CATALOG_MAX_BYTES)
        throw new Error('Planet catalog exceeds budget');
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    catalogHeader(value, worldId, systemId);
    const seen = new Set();
    for (const row of value.bodies) {
        body(row, worldId, systemId);
        if (seen.has(row.bodyId))
            throw new Error('Duplicate planet body identity');
        seen.add(row.bodyId);
    }
    validateVisualBindings(value);
    return value;
}
function catalogHeader(value, worldId, systemId) {
    if (value.schemaVersion !== 1 || value.worldId !== worldId || value.systemId !== systemId
        || !Array.isArray(value.bodies) || value.bodies.length > PLANET_CATALOG_MAX_BODIES
        || (value.catalogId !== undefined && !key(value.catalogId)))
        throw new Error('Invalid planet catalog identity');
}
/** One bounded authorized system roster; no galaxy-wide body list or persisted permission. */
export async function loadPlanetCatalog(options) {
    if (typeof window !== 'undefined' && !options.fetch)
        return remoteCatalog(options);
    assertPlanetIdentity({ ...options, bodyId: options.systemId, profileVersion: 1 });
    if (!/^[1-9][0-9]*$/.test(options.visibilityEpoch) || BigInt(options.visibilityEpoch) > 0xffffffffffffffffn)
        throw new Error('Invalid visibility epoch');
    const identity = { worldId: options.worldId, systemId: options.systemId };
    const result = await requestPlanetEnvelope(options, identity, { kind: 'descriptor' });
    const d = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(result.bytes));
    descriptor(d, options, result.version);
    const bytes = new Uint8Array(d.byteLength);
    for (let page = 0; page < d.pageCount; page++) {
        const part = await requestPlanetEnvelope(options, identity, { kind: 'page', version: result.version, page });
        const length = Math.min(PLANET_PAGE_BYTES, bytes.length - page * PLANET_PAGE_BYTES);
        if (part.unchanged || part.version !== result.version || part.bytes.length !== length)
            throw new Error('Planet catalog page changed');
        bytes.set(part.bytes, page * PLANET_PAGE_BYTES);
    }
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
    options.signal.throwIfAborted();
    if (hash !== result.version)
        throw new Error('Planet catalog hash mismatch');
    return { catalog: parsePlanetCatalog(bytes, options.worldId, options.systemId), version: result.version };
}
function descriptor(d, options, version) {
    const length = d.byteLength;
    if (d.schemaVersion !== 1 || d.worldId !== options.worldId || d.systemId !== options.systemId || d.version !== version
        || !Number.isInteger(length) || length < 1 || length > PLANET_CATALOG_MAX_BYTES
        || d.pageBytes !== PLANET_PAGE_BYTES || d.pageCount !== Math.ceil(length / PLANET_PAGE_BYTES))
        throw new Error('Invalid planet catalog descriptor');
}
/** A visual ID is a template binding, never an alias for two durable bodies. */
function validateVisualBindings(value) {
    const seen = new Set();
    const selected = value.catalogId && catalogById(value.catalogId) ? new Set(buildCompactKepler(value.catalogId).planets.map(body => body.id)) : undefined;
    for (const body of value.bodies) {
        const id = body.visualCatalogId;
        if (!id)
            continue;
        if (!selected?.has(id) || catalogById(id)?.planetClass !== body.planetClass || seen.has(id))
            throw new Error('Invalid planet visual binding');
        seen.add(id);
    }
}
async function remoteCatalog(options) {
    const { signal, fetch, ...scope } = options;
    try {
        return await featureRequest('planetCatalog', [scope], signal);
    }
    catch (e) {
        if (e instanceof FeatureError && e.status !== undefined)
            throw new PlanetHttpError(e.status);
        throw e;
    }
}
//# sourceMappingURL=catalog.js.map