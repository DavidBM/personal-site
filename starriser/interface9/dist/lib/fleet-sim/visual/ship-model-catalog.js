/** Static hull catalog: loaded once; the GPU selects class and LOD per ship. */
import { parseGlb } from './gltf-static-mesh.js';
import { computeMeshOriginRadius } from './model-visibility.js';
import { DEFAULT_HULL_LOD, parseHullLod } from './hull-lod.js';
export const SHIP_MODEL_CATALOG_URL = 'models/fleet-v2/catalog.json';
export const MODEL_CATALOG_MAX_CLASSES = 8;
/** An ordinary and an optional selected-only mesh for each simulation class. */
export const MODEL_CATALOG_MAX_BATCHES = MODEL_CATALOG_MAX_CLASSES * 2;
export function parseShipModelCatalog(value) {
    const catalog = value;
    if (!validCatalogHeader(catalog)) {
        throw new Error('Unsupported ship model catalog');
    }
    for (let i = 0; i < catalog.ships.length; i++) {
        const entry = catalog.ships[i];
        if (entry.classId !== i || !validMeshPath(entry.high) || !validMeshPath(entry.low)
            || [entry.far, entry.dart, entry.veryHigh].some((path) => path !== undefined && !validMeshPath(path))) {
            throw new Error('Catalog classes must be contiguous with relative GLB paths');
        }
        parseHullLod(entry.lod);
    }
    if (catalog.ships.length + catalog.ships.filter(ship => ship.veryHigh).length > MODEL_CATALOG_MAX_BATCHES) {
        throw new Error('Too many catalog full-detail batches');
    }
    return catalog;
}
/** Ordinary class slots stay stable; selected-only meshes append to the full layer. */
export function catalogModelFiles(catalog, level) {
    const files = catalog.ships.map(ship => ship[level] ?? ship.low);
    const selectedClasses = [];
    if (level === 'high')
        for (const ship of catalog.ships) {
            if (!ship.veryHigh)
                continue;
            files.push(ship.veryHigh);
            selectedClasses.push(ship.classId);
        }
    return { files, selectedClasses };
}
/** Per-class detail ranges, indexed by classId. */
export function catalogHullLod(catalog) {
    return catalog.ships.map((entry) => parseHullLod(entry.lod, DEFAULT_HULL_LOD));
}
function validCatalogHeader(catalog) {
    return catalog?.version === 1 && catalog.forward === '+Z' && catalog.up === '+Y'
        && catalog.originRadius === 1 && Array.isArray(catalog.ships)
        && catalog.ships.length > 0 && catalog.ships.length <= MODEL_CATALOG_MAX_CLASSES;
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
    if (!material)
        return;
    for (const key of ['baseColorImage', 'normalImage', 'diffuseSpecularImage']) {
        if (!sameImage(material, mesh, key))
            throw new Error('Catalog meshes must share palette textures');
    }
}
function attachSelectedRanges(ranges, selectedClasses = []) {
    const baseCount = ranges.length - selectedClasses.length;
    if (baseCount < 1 || new Set(selectedClasses).size !== selectedClasses.length)
        throw new Error('Invalid selected mesh classes');
    selectedClasses.forEach((sourceClass, i) => {
        if (!Number.isInteger(sourceClass) || sourceClass < 0 || sourceClass >= baseCount)
            throw new Error('Invalid selected mesh class');
        ranges[sourceClass].selectedVariant = baseCount + i;
        ranges[baseCount + i].sourceClass = sourceClass;
    });
}
/**
 * Merge once at load time; indices address shared geometry, poses remain untouched.
 * With sharedMaterial every class must carry the same palette images; otherwise
 * each range keeps its own images (bound per class batch).
 */
export function mergeModelCatalog(buffers, originRadius = 1, sharedMaterial = true, selectedClasses) {
    if (!buffers.length || buffers.length > MODEL_CATALOG_MAX_BATCHES)
        throw new Error('Invalid catalog mesh count');
    const meshes = buffers.map(parseGlb), material = meshes[0];
    let vertexCount = 0, indexCount = 0;
    for (const mesh of meshes) {
        validateMesh(mesh, sharedMaterial ? material : null, originRadius);
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
    attachSelectedRanges(ranges, selectedClasses);
    return { mesh: { ...material, interleaved, indices, vertexCount, indexCount }, ranges, originRadius,
        materials: sharedMaterial ? meshes.map(() => material) : meshes };
}
//# sourceMappingURL=ship-model-catalog.js.map