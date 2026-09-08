import { KEPLER_SCALE, SYSTEM_LOCAL_SPAN } from "../solar-system-lod.js";
import { MAP_MSAA_SAMPLES } from "../map-msaa.js";
import { Line2Renderer } from "../../vendor/line2/index.js";
import { keplerInclinationFromCatalogId } from "../math/world-origin.js";
import { KEPLER_ORBIT_RING_SEGMENTS, SCENE_GRID_DIVISIONS, SCENE_GRID_SPAN_MUL, SCENE_JUMP_RAY_R0_MUL, SCENE_SCHEMATIC_DASH_SIZE, SCENE_SCHEMATIC_GAP_SIZE, SCENE_SCHEMATIC_GRID_COLOR, SCENE_SCHEMATIC_RING_COLOR, SCENE_JUMP_RAY_COLOR, capSceneJumpRayLength, packKeplerOrbitRingsViewRel, packSceneGridViewRel, packSceneJumpRaysViewRel } from "../map-overlay-pack.js";
import { parseSolarConnectionKey } from "../../contracts/connection-key.js";
export class SceneSchematics {
    constructor(bootstrap, canvas, topology, coordinates, shouldEncodeKeplerScene) {
        this.galaxyFade = 1;
        this.orbitRings = null;
        this.sceneGrid = null;
        this.sceneJumpRays = null;
        this.lastOrbitRingSegments = 0;
        this.lastJumpRaySegments = 0;
        this.dirty = true;
        this.cachedSystemId = null;
        this.cachedCatalogId = null;
        this.cachedRaysVisible = false;
        this.specs = [];
        this.radii = [];
        this.catalogs = [];
        this.bootstrap = bootstrap;
        this.canvas = canvas;
        this.topology = topology;
        this.coordinates = coordinates;
        this.shouldEncodeKeplerScene = shouldEncodeKeplerScene;
    }
    /** Topology edits invalidate local ray geometry; camera changes never do. */
    invalidate() { this.dirty = true; }
    makeLine(alpha) {
        return new Line2Renderer(this.bootstrap.device, {
            format: this.bootstrap.format, sampleCount: MAP_MSAA_SAMPLES, alphaToCoverage: false,
            material: { color: [1, 1, 1, alpha], linewidth: 1, worldUnits: false, endcaps: false,
                softAA: false, vertexColors: true, depthTest: false, depthWrite: false,
                dashed: true, dashSize: SCENE_SCHEMATIC_DASH_SIZE, gapSize: SCENE_SCHEMATIC_GAP_SIZE },
        });
    }
    geometryChanged() {
        const store = this.topology.solarBodies;
        if (this.dirty || this.cachedSystemId !== store.systemId || this.cachedCatalogId !== store.catalogId)
            return true;
        if (this.cachedRaysVisible !== (this.galaxyFade < 1) || this.radii.length !== store.currentCount)
            return true;
        for (let i = 0; i < store.currentCount; i++) {
            if (this.radii[i] !== store.orbitRadius[i] || this.catalogs[i] !== store.catalogIds[i])
                return true;
        }
        return false;
    }
    collectRings() {
        const store = this.topology.solarBodies;
        this.specs.length = 0;
        this.radii.length = this.catalogs.length = store.currentCount;
        let max = 0;
        for (let i = 0; i < store.currentCount; i++) {
            this.radii[i] = store.orbitRadius[i];
            this.catalogs[i] = store.catalogIds[i] ?? "";
            const radius = KEPLER_SCALE * store.orbitRadius[i];
            if (store.isSun[i] || !(radius > 0))
                continue;
            const inc = keplerInclinationFromCatalogId(this.catalogs[i]);
            this.specs.push({ radius, inclination: inc.i, node: inc.node });
            max = Math.max(max, radius);
        }
        return max;
    }
    upload(line, pack) {
        if (pack.segmentCount === 0) {
            line.clearGeometry();
            return;
        }
        line.setPositions(pack.positions);
        line.setColors(pack.colors);
    }
    rebuildGeometry() {
        const store = this.topology.solarBodies, max = this.collectRings();
        this.sceneGrid ?? (this.sceneGrid = this.makeLine(SCENE_SCHEMATIC_GRID_COLOR[3]));
        this.orbitRings ?? (this.orbitRings = this.makeLine(SCENE_SCHEMATIC_RING_COLOR[3]));
        const half = Math.max(SCENE_GRID_SPAN_MUL * SYSTEM_LOCAL_SPAN, 1.4 * max);
        this.upload(this.sceneGrid, packSceneGridViewRel(0, 0, 0, half, SCENE_GRID_DIVISIONS));
        const rings = packKeplerOrbitRingsViewRel(0, 0, 0, this.specs, KEPLER_ORBIT_RING_SEGMENTS);
        this.upload(this.orbitRings, rings);
        this.lastOrbitRingSegments = rings.segmentCount;
        this.rebuildRays(max);
        this.cachedSystemId = store.systemId;
        this.cachedCatalogId = store.catalogId;
        this.cachedRaysVisible = this.galaxyFade < 1;
        this.dirty = false;
    }
    rebuildRays(max) {
        this.lastJumpRaySegments = 0;
        if (this.galaxyFade >= 1) {
            this.sceneJumpRays?.clearGeometry();
            return;
        }
        const store = this.topology.solarBodies;
        const rays = this.collectSceneJumpRays(store.systemId, store.systemX, store.systemZ);
        const pack = packSceneJumpRaysViewRel(0, 0, 0, rays, SCENE_JUMP_RAY_R0_MUL * max);
        this.sceneJumpRays ?? (this.sceneJumpRays = this.makeLine(SCENE_JUMP_RAY_COLOR[3]));
        this.upload(this.sceneJumpRays, pack);
        this.lastJumpRaySegments = pack.segmentCount;
    }
    encodeLine(line, pass) {
        if (!line)
            return;
        line.setResolution(this.canvas.width, this.canvas.height);
        line.writeViewProjection(this.coordinates.system.view, this.coordinates.projection, this.coordinates.system.origin);
        line.encode(pass);
    }
    /** Draw before discs; geometry is already sun-local, only matrices change. */
    encodeSceneSchematicsViewRel(pass, _origin) {
        const store = this.topology.solarBodies;
        if (store.currentCount === 0 || store.systemId == null || !this.shouldEncodeKeplerScene()) {
            this.clear();
            return;
        }
        if (this.geometryChanged())
            this.rebuildGeometry();
        this.encodeLine(this.sceneGrid, pass);
        this.encodeLine(this.orbitRings, pass);
        this.encodeLine(this.sceneJumpRays, pass);
    }
    clear() {
        if (this.dirty && this.cachedSystemId == null)
            return;
        this.lastOrbitRingSegments = this.lastJumpRaySegments = 0;
        this.orbitRings?.clearGeometry();
        this.sceneGrid?.clearGeometry();
        this.sceneJumpRays?.clearGeometry();
        this.cachedSystemId = null;
        this.dirty = true;
    }
    otherPosition(key, otherId, x, z) {
        const other = this.topology.sceneSystems.get(otherId);
        if (other)
            return other;
        const ends = this.topology.lineStore.getLogicalEndpoints(key);
        if (!ends)
            return null;
        const da = Math.hypot(ends.ax - x, ends.az - z), db = Math.hypot(ends.bx - x, ends.bz - z);
        return da <= db ? { x: ends.bx, z: ends.bz } : { x: ends.ax, z: ends.az };
    }
    collectIncidentKeys(systemId) {
        const keys = new Map();
        const rec = this.topology.sceneSystems.get(systemId);
        const meta = rec ? this.topology.clusterLodMeta.get(rec.clusterId) : undefined;
        if (meta)
            for (const key of meta.lineKeys) {
                const ends = parseSolarConnectionKey(key);
                if (!ends)
                    continue;
                const other = incidentOther(systemId, ends.a, ends.b);
                if (other >= 0)
                    keys.set(key, other);
            }
        for (const [key, jump] of this.topology.jumpEdgesByKey) {
            const other = incidentOther(systemId, jump.jumpGate1, jump.jumpGate2);
            if (other >= 0)
                keys.set(key, other);
        }
        return keys;
    }
    collectSceneJumpRays(systemId, systemX, systemZ) {
        const rays = [];
        for (const [key, other] of this.collectIncidentKeys(systemId)) {
            const pos = this.otherPosition(key, other, systemX, systemZ);
            if (!pos)
                continue;
            const dx = pos.x - systemX, dz = pos.z - systemZ, length = Math.hypot(dx, dz);
            if (!(length > 1e-12))
                continue;
            rays.push({ dirX: dx / length, dirZ: dz / length, length: capSceneJumpRayLength(length, SYSTEM_LOCAL_SPAN) });
        }
        return rays;
    }
    dispose() {
        this.orbitRings?.dispose();
        this.orbitRings = null;
        this.sceneGrid?.dispose();
        this.sceneGrid = null;
        this.sceneJumpRays?.dispose();
        this.sceneJumpRays = null;
    }
}
function incidentOther(system, a, b) {
    if (a === system)
        return b;
    return b === system ? a : -1;
}
//# sourceMappingURL=scene-schematics.js.map