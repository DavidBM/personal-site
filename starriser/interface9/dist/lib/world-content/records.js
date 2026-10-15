import { WORLD_CONTENT_MAX_PAGE_BYTES } from './contracts.js';
function object(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== keys)
        throw new Error('Invalid content record');
}
function id(value) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
        throw new Error('Invalid content ID');
}
function name(value) {
    if (typeof value !== 'string' || !value.length || value.length > WORLD_CONTENT_MAX_PAGE_BYTES)
        throw new Error('Invalid content name');
}
function position(value) {
    if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite))
        throw new Error('Invalid content position');
}
function parse(bytes) {
    if (!bytes.length || bytes.length > WORLD_CONTENT_MAX_PAGE_BYTES)
        throw new Error('Content record page limit');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
function color(value) {
    const packed = Number.isInteger(value) && value >= 0 && value <= 0xffffff;
    const rgb = Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
    if (!packed && !rgb)
        throw new Error('Invalid cluster color');
}
function cluster(value) {
    const hasLinks = !!value && typeof value === 'object' && 'links' in value;
    object(value, hasLinks ? 'color,connectedTo,id,links,maxSystemDistance,name,position,radius' : 'color,connectedTo,id,maxSystemDistance,name,position,radius');
    id(value.id);
    name(value.name);
    position(value.position);
    extent(value.radius, value.maxSystemDistance);
    color(value.color);
    if (!Array.isArray(value.connectedTo))
        throw new Error('Invalid cluster edges');
    value.connectedTo.forEach(id);
    if (new Set(value.connectedTo).size !== value.connectedTo.length)
        throw new Error('Duplicate cluster edge');
    if (hasLinks)
        validateLinks(value.links, value.connectedTo, value.id);
    return value;
}
function extent(radius, maxSystemDistance) {
    if (!Number.isFinite(radius) || radius <= 0 || !Number.isFinite(maxSystemDistance)
        || maxSystemDistance < 0)
        throw new Error('Invalid cluster extent');
}
function validateLinks(value, connectedTo, clusterId) {
    if (!Array.isArray(value))
        throw new Error('Invalid cluster links');
    const seen = new Set();
    for (const link of value) {
        object(link, 'clusterId,from,to');
        id(link.clusterId);
        position(link.from);
        position(link.to);
        if (link.clusterId <= clusterId || !connectedTo.includes(link.clusterId))
            throw new Error('Invalid cluster link target');
        const key = JSON.stringify([link.clusterId, link.from, link.to]);
        if (seen.has(key))
            throw new Error('Duplicate cluster link');
        seen.add(key);
    }
}
export function parseContentAtlas(bytes) {
    const value = parse(bytes);
    object(value, 'clusters');
    if (!Array.isArray(value.clusters) || !value.clusters.length || value.clusters.length > 64)
        throw new Error('Invalid atlas page');
    const clusters = value.clusters.map(cluster);
    if (new Set(clusters.map(c => c.id)).size !== clusters.length)
        throw new Error('Duplicate atlas cluster');
    return { clusters };
}
export function parseContentSystem(bytes, expectedId) {
    const value = parse(bytes);
    const hasCatalog = !!value && typeof value === 'object' && 'catalogId' in value;
    object(value, hasCatalog ? 'catalogId,clusterId,id,isJumpGate,name,position' : 'clusterId,id,isJumpGate,name,position');
    if (hasCatalog && (typeof value.catalogId !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(value.catalogId)))
        throw new Error('Invalid system catalog');
    id(value.id);
    id(value.clusterId);
    name(value.name);
    position(value.position);
    if (value.id !== expectedId || typeof value.isJumpGate !== 'boolean')
        throw new Error('Invalid selected system content');
    return value;
}
/** Explicit authoring ID mapping, never a truncated opaque runtime ID. */
export function contentSystemId(opaque) {
    if (!/^000000030000000000000000[0-9a-f]{8}$/.test(opaque))
        return;
    return Number.parseInt(opaque.slice(24), 16);
}
//# sourceMappingURL=records.js.map