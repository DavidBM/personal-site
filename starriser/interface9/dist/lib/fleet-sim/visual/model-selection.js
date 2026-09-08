/** Allocation-stable model selection: height/cull neighborhoods, then nearest-first budget. */
import { MODEL_LOD_MAX_INSTANCES, MODEL_LOD_REF_WORLD_SIZE, MODEL_LOD_MIN_SCREEN_PX, MODEL_LOD_EXIT_SCREEN_PX, MODEL_LOD_NEIGHBOR_RADIUS, MODEL_LOD_VIEW_CULL_STICKY_SCALE, projectedWorldSizeAtDistanceToScreenPx, modelLodViewCullRadius, } from "./fleet-lod.js";
export function createModelSelectionWorkspace() {
    return {
        work: [], pool: [], eligible: [], indices: [],
        parent: new Int32Array(0), componentFlags: new Uint8Array(0),
        seen: new Map(), generation: 0,
        enterPx: 0, exitPx: 0, nadirPx: 0,
    };
}
function updateHeight(work, camera) {
    work.enterPx = camera.minScreenPx ?? MODEL_LOD_MIN_SCREEN_PX;
    work.exitPx = camera.exitScreenPx ?? MODEL_LOD_EXIT_SCREEN_PX;
    work.nadirPx = projectedWorldSizeAtDistanceToScreenPx(camera.worldSize ?? MODEL_LOD_REF_WORLD_SIZE, camera.cameraY, camera.viewportH ?? 800, camera.tanHalfFov);
}
function heightAllowed(work, camera, sticky) {
    if (camera.assumeHeightGate === true)
        return true;
    if (work.nadirPx < work.exitPx)
        return false;
    return work.nadirPx >= work.enterPx || (sticky != null && sticky.size > 0);
}
function fillWork(workspace, fleets, camera, sticky) {
    const enter = modelLodViewCullRadius(camera.cameraY, camera.tanHalfFov);
    const exit = enter * MODEL_LOD_VIEW_CULL_STICKY_SCALE;
    const work = workspace.work;
    work.length = 0;
    for (const fleet of fleets) {
        if ((fleet.shipBudget | 0) <= 0)
            continue;
        const index = work.length;
        let item = workspace.pool[index];
        if (!item)
            workspace.pool[index] = item = { instanceStart: 0, shipBudget: 0, posX: 0, posZ: 0, distLook2: 0, wasOn: false, inCull: false };
        item.instanceStart = fleet.instanceStart | 0;
        item.shipBudget = fleet.shipBudget | 0;
        item.posX = fleet.posX;
        item.posZ = fleet.posZ;
        item.wasOn = sticky?.get(item.instanceStart) === true;
        const dx = item.posX - camera.targetX, dz = item.posZ - camera.targetZ;
        item.distLook2 = dx * dx + dz * dz;
        item.inCull = item.distLook2 <= (item.wasOn ? exit * exit : enter * enter);
        work.push(item);
    }
}
function initializeComponents(workspace) {
    const count = workspace.work.length;
    if (workspace.parent.length < count) {
        const capacity = Math.max(count, workspace.parent.length * 2, 16);
        workspace.parent = new Int32Array(capacity);
        workspace.componentFlags = new Uint8Array(capacity);
    }
    for (let i = 0; i < count; i++)
        workspace.parent[i] = i;
    workspace.componentFlags.fill(0, 0, count);
}
function findRoot(parent, index) {
    let root = index;
    while (parent[root] !== root) {
        parent[root] = parent[parent[root]];
        root = parent[root];
    }
    return root;
}
function uniteNeighbors(workspace, neighborRadius) {
    const { work, parent } = workspace;
    const radius2 = neighborRadius * neighborRadius;
    if (oneNeighborhood(work, radius2)) {
        parent.fill(0, 0, work.length);
        return;
    }
    for (let i = 0; i < work.length; i++) {
        for (let j = i + 1; j < work.length; j++) {
            const dx = work[i].posX - work[j].posX, dz = work[i].posZ - work[j].posZ;
            if (dx * dx + dz * dz > radius2)
                continue;
            const a = findRoot(parent, i), b = findRoot(parent, j);
            if (a !== b)
                parent[b] = a;
        }
    }
}
/** If the bounding diagonal fits, every pair is a neighbor. Compact scenes
 * commonly satisfy this exact proof; other layouts keep the pairwise policy. */
function oneNeighborhood(work, radius2) {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const item of work) {
        if (!Number.isFinite(item.posX) || !Number.isFinite(item.posZ))
            return false;
        minX = Math.min(minX, item.posX);
        maxX = Math.max(maxX, item.posX);
        minZ = Math.min(minZ, item.posZ);
        maxZ = Math.max(maxZ, item.posZ);
    }
    const dx = maxX - minX, dz = maxZ - minZ;
    return dx * dx + dz * dz <= radius2;
}
function collectComponentFlags(workspace) {
    const { work, parent, componentFlags } = workspace;
    for (let i = 0; i < work.length; i++) {
        const root = findRoot(parent, i);
        if (work[i].inCull)
            componentFlags[root] |= 1;
        if (work[i].wasOn)
            componentFlags[root] |= 2;
    }
}
function componentEnabled(workspace, index) {
    const flags = workspace.componentFlags[findRoot(workspace.parent, index)];
    if ((flags & 1) === 0)
        return false;
    return workspace.nadirPx >= ((flags & 2) !== 0 ? workspace.exitPx : workspace.enterPx);
}
function collectEligible(workspace, sticky) {
    const { eligible, work, seen } = workspace;
    const generation = ++workspace.generation;
    eligible.length = 0;
    for (let i = 0; i < work.length; i++) {
        const item = work[i];
        seen.set(item.instanceStart, generation);
        if (componentEnabled(workspace, i)) {
            eligible.push(item);
            sticky?.set(item.instanceStart, true);
        }
        else
            sticky?.delete(item.instanceStart);
    }
    for (const [id, version] of seen) {
        if (version === generation)
            continue;
        sticky?.delete(id);
        seen.delete(id);
    }
    pruneUnseenSticky(workspace, sticky);
}
function pruneUnseenSticky(workspace, sticky) {
    if (!sticky)
        return;
    for (const id of sticky.keys())
        if (!workspace.seen.has(id))
            sticky.delete(id);
}
const nearestFirst = (a, b) => a.distLook2 - b.distLook2 || a.instanceStart - b.instanceStart;
function fillIndices(workspace, cap) {
    workspace.eligible.sort(nearestFirst);
    const out = workspace.indices;
    for (const fleet of workspace.eligible) {
        const count = Math.min(fleet.shipBudget, cap - out.length);
        for (let i = 0; i < count; i++)
            out.push(fleet.instanceStart + i);
        if (out.length >= cap)
            break;
    }
}
/** Reuses all work records, arrays and output. Caller must consume before its next call. */
export function selectModelShipIndicesInto(workspace, fleets, camera, maxInstances = MODEL_LOD_MAX_INSTANCES, sticky) {
    const cap = Math.max(0, maxInstances | 0);
    workspace.indices.length = 0;
    updateHeight(workspace, camera);
    if (cap <= 0 || fleets.length === 0 || !heightAllowed(workspace, camera, sticky)) {
        sticky?.clear();
        workspace.seen.clear();
        return workspace.indices;
    }
    fillWork(workspace, fleets, camera, sticky);
    initializeComponents(workspace);
    uniteNeighbors(workspace, camera.neighborRadius ?? MODEL_LOD_NEIGHBOR_RADIUS);
    collectComponentFlags(workspace);
    collectEligible(workspace, sticky);
    fillIndices(workspace, cap);
    return workspace.indices;
}
//# sourceMappingURL=model-selection.js.map