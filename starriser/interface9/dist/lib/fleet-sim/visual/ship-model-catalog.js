/** Static hull catalog: loaded once; the GPU selects class and LOD per ship. */
import { parseGlb } from './gltf-static-mesh.js';
import { computeMeshOriginRadius } from './model-visibility.js';
export const SHIP_MODEL_CATALOG_URL = 'models/aster-vale/catalog.json';
export const MODEL_CATALOG_MAX_BATCHES = 8;
export const LEGACY_MODEL_DETAIL_PX = Object.freeze([55, 50]);
export const CATALOG_MODEL_DETAIL_PX = Object.freeze([55, 50]);
export function parseShipModelCatalog(value) {
    const catalog = value;
    if (!validCatalogHeader(catalog)) {
        throw new Error('Unsupported ship model catalog');
    }
    for (let i = 0; i < catalog.ships.length; i++) {
        const entry = catalog.ships[i];
        if (entry.classId !== i || !validMeshPath(entry.high) || !validMeshPath(entry.low)) {
            throw new Error('Catalog classes must be contiguous with relative GLB paths');
        }
    }
    return catalog;
}
function validCatalogHeader(catalog) {
    return catalog?.version === 1 && catalog.forward === '+Z' && catalog.up === '+Y'
        && catalog.originRadius === 1 && Array.isArray(catalog.ships)
        && catalog.ships.length > 0 && catalog.ships.length <= MODEL_CATALOG_MAX_BATCHES;
}
function validMeshPath(path) {
    return typeof path === 'string' && /^[a-z0-9-]+\.glb$/.test(path);
}
function sameImage(a, b, index) {
    const ai = a.images[a[index]], bi = b.images[b[index]];
    if (!ai || !bi)
        return ai === bi;
    return ai.mimeType === bi.mimeType && ai.data.length === bi.data.length && ai.data.every((v, i) => v === bi.data[i]);
}
function validateMesh(mesh, material, radius) {
    if (!mesh.vertexCount || !mesh.indexCount || mesh.indexCount % 3 !== 0
        || !mesh.interleaved.every(Number.isFinite) || mesh.indices.some(i => i >= mesh.vertexCount)) {
        throw new Error('Catalog mesh contains invalid geometry');
    }
    if (computeMeshOriginRadius(mesh.interleaved) > radius * 1.001)
        throw new Error('Catalog mesh exceeds its common origin radius');
    for (const key of ['baseColorImage', 'normalImage', 'diffuseSpecularImage']) {
        if (!sameImage(material, mesh, key))
            throw new Error('Catalog meshes must share palette textures');
    }
}
/** Merge once at load time; indices address shared geometry, poses remain untouched. */
export function mergeModelCatalog(buffers, originRadius = 1) {
    if (!buffers.length || buffers.length > MODEL_CATALOG_MAX_BATCHES)
        throw new Error('Invalid catalog mesh count');
    const meshes = buffers.map(parseGlb), material = meshes[0];
    let vertexCount = 0, indexCount = 0;
    for (const mesh of meshes) {
        validateMesh(mesh, material, originRadius);
        vertexCount += mesh.vertexCount;
        indexCount += mesh.indexCount;
    }
    const interleaved = new Float32Array(vertexCount * 8), indices = new Uint32Array(indexCount);
    const ranges = [];
    let vertex = 0, firstIndex = 0;
    for (const mesh of meshes) {
        interleaved.set(mesh.interleaved, vertex * 8);
        for (let i = 0; i < mesh.indices.length; i++)
            indices[firstIndex + i] = mesh.indices[i] + vertex;
        ranges.push({ firstIndex, indexCount: mesh.indexCount });
        vertex += mesh.vertexCount;
        firstIndex += mesh.indexCount;
    }
    return { mesh: { ...material, interleaved, indices, vertexCount, indexCount }, ranges, originRadius };
}
//# sourceMappingURL=ship-model-catalog.js.map