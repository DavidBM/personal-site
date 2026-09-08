/**
 * Headless map topology projection. Owns points, connection visibility and the
 * single compact solar scene. No canvas, GPU device, Bus, or wall-clock access.
 * Rendering consumes dirty stores; scenario fixtures drive the same methods.
 */
import { SolarPointStore } from "../solar-point-store.js";
import { ConnectionLineStore } from "../connection-line-store.js";
import { SolarBodyStore } from "../solar-body-store.js";
import { catalogIdFromSystemId } from "../solar-catalog-id.js";
import { buildCompactKepler } from "../compact-kepler.js";
import { fillSceneCandidatesForCluster, oneSceneWithHysteresis, pickLookAtClusterId } from "../solar-system-lod.js";
import { SYSTEM_POINT_DIAMETER_PX, billboardScaleForDiameterPx, clusterImpostorWithHysteresis } from "../galaxy-point-lod.js";
import { buildModelTopologyContext, parseInterClusterConnectionKey } from "../fleet-lod.js";
import { solarConnectionClusterId } from "../../contracts/connection-key.js";
const EMPTY_SYSTEM_IDS = [];
const EMPTY_PREVIEW_KEEP = new Set();
/** Bound CPU packing/upload work while many clusters cross one LOD threshold. */
export const CLUSTER_LOD_RECORD_BUDGET = 20000;
export class MapTopologyPresentation {
    constructor(previews, onSceneChanged) {
        this.store = new SolarPointStore();
        this.impostorStore = new SolarPointStore();
        this.lineStore = new ConnectionLineStore();
        this.solarBodies = new SolarBodyStore();
        this.sceneSystems = new Map();
        this.clusterLodMeta = new Map();
        this.jumpEdgesByKey = new Map();
        this.sceneHysteresis = { sceneId: null, holdStartMs: 0 };
        this.lastSceneSpanPx = 0;
        this.pointWorldScale = 1;
        this.storeDirty = true;
        this.impostorStoreDirty = true;
        this.linesDirty = true;
        this.sceneHiddenBufferIndex = null;
        this.lastPointLodD = -1;
        this.lastPointLodViewportH = -1;
        this.lastPointLodFovy = -1;
        this.clusterLodPending = true;
        this.lastSceneLookAtX = Number.NaN;
        this.lastSceneLookAtZ = Number.NaN;
        this.lastSceneBufferH = -1;
        this.sceneCandidateScratch = [];
        this.sceneIds = new Set();
        this.modelClusterCenters = [];
        this.modelClusterCentersDirty = true;
        this.modelTopologyContext = null;
        this.previews = previews;
        this.onSceneChanged = onSceneChanged;
    }
    /** Model selection reuses topology snapshots until topology actually changes. */
    getModelClusterCenters() {
        if (!this.modelClusterCentersDirty)
            return this.modelClusterCenters;
        this.modelClusterCenters.length = 0;
        for (const meta of this.clusterLodMeta.values()) {
            this.modelClusterCenters.push({ id: meta.clusterId, x: meta.x, z: meta.z, radius: meta.radius });
        }
        this.modelClusterCentersDirty = false;
        return this.modelClusterCenters;
    }
    getModelTopologyContext(focusId) {
        if (this.modelTopologyContext?.focusClusterId !== focusId) {
            this.modelTopologyContext = buildModelTopologyContext(focusId, [...this.jumpEdgesByKey.values()]);
        }
        return this.modelTopologyContext;
    }
    publishScene(id) {
        this.sceneIds.clear();
        if (id != null)
            this.sceneIds.add(id);
        // Bodies have already been rebuilt: fleet scene flags consume that identity.
        this.onSceneChanged(this.sceneIds);
    }
    addSolarSystem(cluster, solarSystem) {
        this.modelClusterCentersDirty = true;
        const clusterColor = cluster.color || 0xffffff;
        const idx = this.store.add({
            x: solarSystem.position.x,
            z: solarSystem.position.z,
            color: {
                isJumpGate: solarSystem.isJumpGate,
                clusterColor,
            },
        });
        solarSystem._bufferIndex = idx;
        this.storeDirty = true;
        this.sceneSystems.set(solarSystem.id, {
            id: solarSystem.id,
            bufferIndex: idx,
            x: solarSystem.position.x,
            z: solarSystem.position.z,
            clusterId: cluster.id,
        });
        const meta = this.ensureClusterLodMeta(cluster, clusterColor);
        meta.systemIndices.push(idx);
        meta.systemIds.push(solarSystem.id);
        meta.x = cluster.position.x;
        meta.z = cluster.position.z;
        meta.radius = cluster.radius || meta.radius;
        // If cluster is currently impostored, hide this system and keep impostor center fresh.
        if (meta.wasImpostor) {
            this.store.setLodHidden(idx, true);
            this.writeImpostorPoint(meta, true);
            this.impostorStoreDirty = true;
        }
        // Force LOD re-eval (radius / membership changed)
        this.lastPointLodD = -1;
    }
    removeSolarSystem(cluster, solarSystem) {
        this.modelClusterCentersDirty = true;
        const idx = solarSystem._bufferIndex;
        if (typeof idx !== "number")
            return;
        this.store.hide(idx);
        this.storeDirty = true;
        this.sceneSystems.delete(solarSystem.id);
        if (this.sceneHiddenBufferIndex === idx) {
            this.sceneHiddenBufferIndex = null;
        }
        const meta = this.clusterLodMeta.get(cluster.id);
        if (!meta)
            return;
        const i = meta.systemIndices.indexOf(idx);
        if (i !== -1)
            meta.systemIndices.splice(i, 1);
        const si = meta.systemIds.indexOf(solarSystem.id);
        if (si !== -1)
            meta.systemIds.splice(si, 1);
        if (meta.systemIndices.length === 0) {
            // Hide impostor when cluster has no systems left
            this.impostorStore.hide(meta.impostorIndex);
            meta.wasImpostor = false;
            this.impostorStoreDirty = true;
            this.clusterLodMeta.delete(cluster.id);
        }
        else if (meta.wasImpostor) {
            this.writeImpostorPoint(meta, true);
            this.impostorStoreDirty = true;
        }
        this.lastPointLodD = -1;
    }
    updateSolarSystemPositions(systems) {
        this.modelClusterCentersDirty = true;
        const touched = new Set();
        for (const system of systems)
            this.updateSystemPosition(system, touched);
        this.storeDirty = true;
        // Topology moves must re-pick even when the camera has not moved.
        this.lastPointLodD = -1;
        for (const id of touched) {
            const meta = this.clusterLodMeta.get(id);
            if (meta?.wasImpostor) {
                this.writeImpostorPoint(meta, true);
                this.impostorStoreDirty = true;
            }
        }
    }
    updateSystemPosition(system, touched) {
        const idx = system._bufferIndex;
        if (typeof idx !== "number")
            return;
        const { x, z } = system.position;
        this.store.updatePosition(idx, x, z);
        const rec = this.sceneSystems.get(system.id);
        if (rec) {
            rec.x = x;
            rec.z = z;
        }
        if (this.solarBodies.systemId === system.id)
            this.solarBodies.setSystemPosition(x, z);
        const cluster = system.cluster;
        if (!cluster)
            return;
        const meta = this.clusterLodMeta.get(cluster.id);
        if (!meta)
            return;
        meta.x = cluster.position.x;
        meta.z = cluster.position.z;
        meta.radius = cluster.radius || meta.radius;
        touched.add(cluster.id);
    }
    addConnection(key, a, b, color = 0x00ffff) {
        if (!this.lineStore.add(key, a, b, color))
            return;
        this.linesDirty = true;
        // Inter-cluster jump edges feed model topology LOD.
        const jump = parseInterClusterConnectionKey(key);
        if (jump) {
            this.jumpEdgesByKey.set(key, jump);
            this.modelTopologyContext = null;
            return;
        }
        // Track solar edges under their cluster so impostor can hide them.
        const clusterId = solarConnectionClusterId(key);
        if (clusterId == null)
            return;
        const meta = this.clusterLodMeta.get(clusterId);
        if (!meta)
            return;
        meta.lineKeys.push(key);
        meta.lineIndices.push(this.lineStore.keyToIndex.get(key));
        if (meta.wasImpostor) {
            this.lineStore.setLodHidden(key, true);
        }
    }
    updateConnectionEndpoints(key, a, b) {
        const ok = this.lineStore.updateEndpoints(key, a, b);
        if (ok)
            this.linesDirty = true;
        return ok;
    }
    removeConnection(key) {
        this.lineStore.remove(key);
        this.linesDirty = true;
        if (this.jumpEdgesByKey.delete(key))
            this.modelTopologyContext = null;
        const clusterId = solarConnectionClusterId(key);
        if (clusterId == null)
            return;
        const meta = this.clusterLodMeta.get(clusterId);
        if (!meta)
            return;
        const i = meta.lineKeys.indexOf(key);
        if (i !== -1) {
            meta.lineKeys.splice(i, 1);
            meta.lineIndices.splice(i, 1);
        }
    }
    /** Signal that inter-cluster edges may need refresh (handled by view bridge). */
    markClusterConnectionsDirty(_clusterId) {
        this.linesDirty = true;
    }
    setConnectionColor(key, color) {
        this.lineStore.setColor(key, color);
        this.linesDirty = true;
    }
    /** Apply BFS/connection color map (keys match makeConnectionKey form). */
    setConnectionColors(map) {
        if (!map)
            return;
        const entries = map instanceof Map ? map.entries() : Object.entries(map);
        for (const [key, color] of entries) {
            this.lineStore.setColor(key, color);
        }
        this.linesDirty = true;
    }
    finalizeFromGalaxy(galaxy) {
        this.modelClusterCentersDirty = true;
        const writes = [];
        this.clusterLodMeta.clear();
        this.impostorStore.clear();
        for (const cluster of galaxy.clusters) {
            const clusterColor = cluster.color || 0xffffff;
            const meta = this.ensureClusterLodMeta(cluster, clusterColor);
            meta.systemIndices.length = 0;
            meta.systemIds.length = 0;
            for (const solarSystem of cluster.solarSystems) {
                const idx = writes.length;
                writes.push({
                    x: solarSystem.position.x,
                    z: solarSystem.position.z,
                    color: {
                        isJumpGate: solarSystem.isJumpGate,
                        clusterColor,
                    },
                });
                solarSystem._bufferIndex = idx;
                meta.systemIndices.push(idx);
                meta.systemIds.push(solarSystem.id);
            }
            meta.x = cluster.position.x;
            meta.z = cluster.position.z;
            meta.radius = cluster.radius || meta.radius;
            meta.wasImpostor = false;
            meta.lineKeys.length = 0;
            meta.lineIndices.length = 0;
            // Impostor starts hidden; applyGalaxyPointLod will show if needed
            this.writeImpostorPoint(meta, false);
        }
        this.store.rebuild(writes);
        this.sceneSystems.clear();
        for (const cluster of galaxy.clusters) {
            for (const solarSystem of cluster.solarSystems) {
                const idx = solarSystem._bufferIndex;
                if (typeof idx !== "number")
                    continue;
                this.sceneSystems.set(solarSystem.id, {
                    id: solarSystem.id,
                    bufferIndex: idx,
                    x: solarSystem.position.x,
                    z: solarSystem.position.z,
                    clusterId: cluster.id,
                });
            }
        }
        this.resetSystemSceneLod();
        this.storeDirty = true;
        this.impostorStoreDirty = true;
        this.linesDirty = true;
        this.lastPointLodD = -1;
    }
    clearPoints() {
        this.modelClusterCentersDirty = true;
        this.store.clear();
        this.impostorStore.clear();
        this.clusterLodMeta.clear();
        this.sceneSystems.clear();
        this.resetSystemSceneLod();
        this.storeDirty = true;
        this.impostorStoreDirty = true;
        this.lastPointLodD = -1;
    }
    clearLines() {
        this.lineStore.clear();
        this.jumpEdgesByKey.clear();
        this.modelTopologyContext = null;
        for (const meta of this.clusterLodMeta.values()) {
            meta.lineKeys.length = 0;
            meta.lineIndices.length = 0;
        }
        this.linesDirty = true;
    }
    ensureClusterLodMeta(cluster, clusterColor) {
        let meta = this.clusterLodMeta.get(cluster.id);
        if (meta) {
            meta.color = clusterColor;
            meta.radius = cluster.radius || meta.radius;
            meta.x = cluster.position.x;
            meta.z = cluster.position.z;
            return meta;
        }
        const impostorIndex = this.impostorStore.add({
            x: cluster.position.x,
            z: cluster.position.z,
            color: { isJumpGate: false, clusterColor },
        });
        // Start hidden until LOD says show impostor
        this.impostorStore.setLodHidden(impostorIndex, true);
        this.impostorStoreDirty = true;
        meta = {
            clusterId: cluster.id,
            radius: cluster.radius || 250,
            x: cluster.position.x,
            z: cluster.position.z,
            color: clusterColor,
            systemIndices: [],
            systemIds: [],
            lineKeys: [],
            lineIndices: [],
            impostorIndex,
            wasImpostor: false,
        };
        this.clusterLodMeta.set(cluster.id, meta);
        return meta;
    }
    /** Write impostor center/color; show or LOD-hide without zeroing colors. */
    writeImpostorPoint(meta, show) {
        this.impostorStore.writeAt(meta.impostorIndex, {
            x: meta.x,
            z: meta.z,
            color: { isJumpGate: false, clusterColor: meta.color },
        });
        if (!show)
            this.impostorStore.setLodHidden(meta.impostorIndex, true);
    }
    updateClusterLod(d, fovy, viewportH) {
        const cameraChanged = this.lastPointLodD < 0 ||
            Math.abs(d - this.lastPointLodD) > 1e-3 ||
            viewportH !== this.lastPointLodViewportH || fovy !== this.lastPointLodFovy;
        if (!cameraChanged && !this.clusterLodPending)
            return false;
        this.lastPointLodD = d;
        this.lastPointLodViewportH = viewportH;
        this.lastPointLodFovy = fovy;
        const result = this.applyClusterLodBudget(d, fovy, viewportH);
        this.clusterLodPending = result.pending;
        return cameraChanged || result.processedRecords > 0;
    }
    applyClusterLodBudget(d, fovy, viewportH) {
        let processedRecords = 0;
        for (const meta of this.clusterLodMeta.values()) {
            if (meta.systemIndices.length === 0)
                continue;
            const want = clusterImpostorWithHysteresis(d, meta.radius, meta.wasImpostor, fovy, viewportH);
            if (want === meta.wasImpostor)
                continue;
            const records = meta.systemIndices.length + meta.lineIndices.length + 1;
            if (processedRecords > 0 && processedRecords + records > CLUSTER_LOD_RECORD_BUDGET) {
                return { processedRecords, pending: true };
            }
            this.setClusterImpostor(meta, want);
            processedRecords += records;
        }
        return { processedRecords, pending: false };
    }
    setClusterImpostor(meta, hidden) {
        meta.wasImpostor = hidden;
        this.store.setLodHiddenIndices(meta.systemIndices, hidden);
        this.lineStore.setLodHiddenIndices(meta.lineIndices, hidden);
        this.writeImpostorPoint(meta, hidden);
        this.storeDirty = true;
        this.impostorStoreDirty = true;
        this.linesDirty = true;
    }
    /**
     * O(clusters) point LOD: constant ~5px billboards; cluster impostors with hysteresis.
     * Geometry changes are capped per frame so a shared threshold cannot produce
     * one systems+edges-sized CPU/upload spike.
     * Runs when camera distance / viewport / fovy change (not every frame if stable).
     * Band B (one SCENE) uses drawing-buffer height and the same d/H/fovy cadence
     * plus look-at xz and a hold-pending tick (`holdStartMs > 0` only) so 2500 ms
     * exit can fire without a camera nudge.
     */
    updateLod(d, viewportH, bufferH, fovy, lookAtX, lookAtZ, nowMs) {
        this.pointWorldScale = billboardScaleForDiameterPx(SYSTEM_POINT_DIAMETER_PX, d, fovy, viewportH);
        const dChanged = this.updateClusterLod(d, fovy, viewportH);
        const holdPending = this.sceneHysteresis.holdStartMs > 0;
        const lookAtChanged = Math.abs(lookAtX - this.lastSceneLookAtX) > 1e-3 ||
            Math.abs(lookAtZ - this.lastSceneLookAtZ) > 1e-3;
        if (dChanged || holdPending || lookAtChanged || bufferH !== this.lastSceneBufferH) {
            this.applySystemSceneLod(d, fovy, bufferH, lookAtX, lookAtZ, nowMs);
            this.lastSceneLookAtX = lookAtX;
            this.lastSceneLookAtZ = lookAtZ;
            this.lastSceneBufferH = bufferH;
        }
    }
    resetSystemSceneLod() {
        this.sceneHysteresis.sceneId = null;
        this.sceneHysteresis.holdStartMs = 0;
        this.sceneHiddenBufferIndex = null;
        this.lastSceneSpanPx = 0;
        this.solarBodies.clear();
        this.previews.retainPreviews(EMPTY_PREVIEW_KEEP);
        this.publishScene(null);
    }
    /**
     * One sticky compact Kepler SCENE. Parks the winner's 5px slot.
     * Neighbors stay 5px (no extra catalog bind).
     *
     * Pick is O(clusters) + O(systems in the look-at cluster) — never a
     * full-galaxy `sceneSystems` walk (default 15000×80).
     */
    applySystemSceneLod(d, fovy, bufferH, lookAtX, lookAtZ, nowMs) {
        const clusterId = pickLookAtClusterId((visit) => {
            for (const meta of this.clusterLodMeta.values()) {
                if (meta.systemIds.length === 0)
                    continue;
                visit(meta.clusterId, meta.x, meta.z);
            }
        }, lookAtX, lookAtZ);
        const clusterMeta = clusterId != null ? this.clusterLodMeta.get(clusterId) : undefined;
        const prevSceneId = this.sceneHysteresis.sceneId;
        const candidates = fillSceneCandidatesForCluster(this.sceneCandidateScratch, clusterMeta ? clusterMeta.systemIds : EMPTY_SYSTEM_IDS, this.sceneSystems, prevSceneId);
        const next = oneSceneWithHysteresis({
            candidates,
            lookAtX,
            lookAtZ,
            d,
            viewportH: bufferH,
            fovyDeg: fovy,
            nowMs,
            prev: this.sceneHysteresis,
        });
        this.sceneHysteresis.sceneId = next.sceneId;
        this.sceneHysteresis.holdStartMs = next.holdStartMs;
        this.lastSceneSpanPx = next.spanPx;
        const sceneId = next.sceneId;
        const rec = sceneId != null ? this.sceneSystems.get(sceneId) : undefined;
        this.syncScenePointVisibility(prevSceneId, rec?.bufferIndex ?? null);
        if (sceneId == null || !rec) {
            if (this.solarBodies.systemId != null)
                this.solarBodies.clear();
            this.previews.retainPreviews(EMPTY_PREVIEW_KEEP);
            this.publishScene(null);
            return;
        }
        this.loadCompactScene(rec);
        this.publishScene(sceneId);
    }
    restoreScenePoint(sceneId, index) {
        if (index == null)
            return;
        const rec = sceneId != null ? this.sceneSystems.get(sceneId) : undefined;
        const impostor = rec != null && this.clusterLodMeta.get(rec.clusterId)?.wasImpostor === true;
        if (impostor)
            return;
        this.store.setLodHidden(index, false);
        this.storeDirty = true;
    }
    syncScenePointVisibility(previousId, nextIndex) {
        if (this.sceneHiddenBufferIndex !== nextIndex) {
            this.restoreScenePoint(previousId, this.sceneHiddenBufferIndex);
            this.sceneHiddenBufferIndex = nextIndex;
        }
        // The cluster transition may just have unhidden every system in this cluster.
        if (nextIndex != null && !this.store.lodHidden[nextIndex]) {
            this.store.setLodHidden(nextIndex, true);
            this.storeDirty = true;
        }
    }
    loadCompactScene(rec) {
        const sceneId = rec.id;
        // Rebuild Kepler *before* setSystemScene so fleetLocMatchesKepler
        // sees the new systemId when re-OR-ing bit 7 (not the previous jewel).
        if (this.solarBodies.systemId !== sceneId) {
            const catalogId = catalogIdFromSystemId(sceneId);
            const kepler = buildCompactKepler(catalogId);
            this.solarBodies.rebuild(kepler, sceneId, rec.x, rec.z);
            const keep = new Set();
            for (let i = 0; i < kepler.planets.length; i++) {
                keep.add(kepler.planets[i].id);
            }
            this.previews.retainPreviews(keep);
            for (const id of keep) {
                this.previews.requestPreview(id);
            }
        }
        else {
            this.solarBodies.setSystemPosition(rec.x, rec.z);
        }
    }
    dismissCompactScene() {
        this.restoreScenePoint(this.sceneHysteresis.sceneId, this.sceneHiddenBufferIndex);
        this.resetSystemSceneLod();
    }
}
//# sourceMappingURL=topology-presentation.js.map