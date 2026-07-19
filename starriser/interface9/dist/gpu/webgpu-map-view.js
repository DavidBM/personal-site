/**
 * Sole map/fleets GPU backend (C1): clear + solar points + fat Line2 connections + fleets.
 * L3/L5: continuous fleet + per-ship non-holonomic pose via compute integrate
 * (no per-frame CPU base walk).
 * Fleet spawn/remove: free-list + tombstone (fleet-slot-allocator). Formation
 * packed once at add; GPU shader LOD owns NEAR/MID/FAR (no host re-pack on zoom).
 * L5b: trail ring samples + fixed-slot line expand in integrate; draw before ships.
 * M4: map overlay — fat Line2 rings/axes + triangle-list plane fills (pack on dirty).
 */
import { createWebGpuBootstrap, } from "./device.js";
import { SolarPointStore } from "./solar-point-store.js";
import { SolarPointGpuLayer } from "./layers/solar-point-gpu-layer.js";
import { ConnectionLineStore } from "./connection-line-store.js";
import { ConnectionLineGpuLayer } from "./layers/connection-line-gpu-layer.js";
import { FleetInstanceGpuLayer } from "./layers/fleet-instance-gpu-layer.js";
import { MapOverlayGpuLayer } from "./layers/map-overlay-gpu-layer.js";
import { MAP_MSAA_SAMPLES } from "./map-msaa.js";
import { Line2Renderer } from "../vendor/line2/index.js";
import { hashStringSeed, writeFleetFormation, initShipSimFromDrawFormation, FLEET_SHIP_DRAW_FLOATS, } from "./fleet-ship-pack.js";
import { CAP_NEAR, GLOBAL_MAX_INSTANCES, GPU_FLEET_CAPACITY_MIN, GPU_SHIP_CAPACITY_MIN, WARM_FRAMES, countShips, nextGrowCapacity, scaleCountsToBudget, } from "./fleet-lod.js";
import { createFleetSlotAllocator } from "./fleet-slot-allocator.js";
import { SYSTEM_POINT_DIAMETER_PX, billboardScaleForDiameterPx, cameraDistanceToTarget, clusterImpostorWithHysteresis, } from "./galaxy-point-lod.js";
import { FLEET_GPU_STRIDE, FLEET_FLAG_ALIVE, FLEET_FLAG_JUMPING, FLEET_FLAG_COOLDOWN, FLEET_FLAG_WARM, FleetGpuFields, hashFleetId, writeFleetGpu, } from "./fleet-layout.js";
import { SHIP_SIM_STRIDE, ShipSimFields } from "./ship-sim-layout.js";
import { SHIP_MODE_PAUSED } from "./ship-flight-ref.js";
import { mat4CameraRight, mat4CameraUp, mat4Identity, mat4Invert, mat4LookAt, mat4Perspective, mat4ViewProj, } from "./math/mat4.js";
import { frameDebugBegin, frameDebugFrameTotal, frameDebugTime, } from "./frame-debug.js";
import { hitEditHandleAtGround, layoutFromRadius, } from "./math/edit-handle-hit.js";
import { intersectRayPlaneY0, rayFromNdc, } from "./math/ground-pick.js";
import { LINE2_OVERLAY_COLOR_FLOATS, LINE2_OVERLAY_POS_FLOATS, OVERLAY_COLOR_HOVER, OVERLAY_COLOR_SELECT, packEditHandleGizmoLine2, packRingLine2, } from "./map-overlay-pack.js";
import { MAP_OVERLAY_FLOATS_PER_VERT } from "./shaders/map-overlay.wgsl.js";
import { RENDER_PLANE_Y } from "../contracts/render-constants.js";
import { solarConnectionClusterId } from "../contracts/connection-key.js";
import { resolveFleetVisualPosition, } from "./fleet-motion-ref.js";
import { integrateFleetPos } from "./fleet-integrate-ref.js";
import { rebuildWebGpuConnectionsFromGalaxy } from "../main/webgpu-view-bridge.js";
/** Max concurrent fleet GPU rows (free-list high-water cap). */
const MAX_FLEET_SLOTS = 100000;
/** Screen-space overlay stroke width (buffer pixels; Line2 `worldUnits=false`). */
const OVERLAY_LINEWIDTH_PX = 2.5;
/**
 * Owns canvas + WebGPU device + map layers. Call {@link WebGpuMapView.create}.
 */
export class WebGpuMapView {
    constructor(canvas, bootstrap, fovyDeg) {
        this.fleets = new Map();
        /**
         * Fleets still in R5 warm-up (`warmFramesLeft > 0`). tickWarmFleets only
         * walks this set — O(warming), not O(all fleets). Scanning 10k fleets every
         * frame was ~4ms and tanked steady-state FPS after bulk spawn.
         */
        this.warmingFleetIds = new Set();
        /**
         * Free-list: stable fleetSlot + ship ranges. High-water never shrinks;
         * remove tombstones (ALIVE=0 / size 0) and returns slots to the free lists.
         */
        this.slotAlloc = createFleetSlotAllocator({
            maxFleets: MAX_FLEET_SLOTS,
            maxShips: GLOBAL_MAX_INSTANCES,
        });
        /**
         * Optional cap on ships packed per new fleet (bulk fairness under
         * GLOBAL_MAX_INSTANCES). null = normal CAP_NEAR path.
         */
        this.bulkShipBudgetHint = null;
        this.positionLookup = null;
        /** CPU instance buffer: grow-only up to GLOBAL_MAX_INSTANCES; bases by L5. */
        this.instanceData = new Float32Array(0);
        /** Dispatch/draw ship bound = slotAlloc.shipHighWater (size-0 holes OK). */
        this.instanceLiveCount = 0;
        /**
         * CPU FleetGpu mirror (stride 64). Uploaded sparsely on state change;
         * compute integrates each frame. Index = fleetSlot (stable).
         */
        this.fleetGpuBytes = new ArrayBuffer(0);
        this.fleetGpuView = new DataView(this.fleetGpuBytes);
        this.fleetGpuU8 = new Uint8Array(this.fleetGpuBytes);
        /**
         * CPU ShipSim mirror (stride 64). One row per ship slot (high-water).
         * Inited on spawn; compute integrates each frame (GPU is pose source of truth).
         */
        this.shipSimBytes = new ArrayBuffer(0);
        this.shipSimView = new DataView(this.shipSimBytes);
        this.shipSimU8 = new Uint8Array(this.shipSimBytes);
        /**
         * Deferred GPU upload (flush once per frame before integrate).
         * Bulk spawn used to call writeBuffer 3–4× per fleet + 48× per warm-end —
         * that murdered FPS. CPU is authoritative until flush.
         */
        this.dirtyFleetSlots = [];
        this.dirtyShipRanges = [];
        /** Ship high-water last successfully flushed to GPU (grow-preserve bound). */
        this.flushedShipHw = 0;
        this.flushedFleetHw = 0;
        /**
         * Wall-clock origin so GPU times fit in f32 (Unix epoch does not).
         * Set once at create; `toGpuTime(wall) = wall - timeOriginMs`.
         */
        this.timeOriginMs = 0;
        /** Previous frame GPU-relative ms for dt; 0 means first frame. */
        this.prevNowRel = 0;
        this.statsPanels = [];
        this.proj = mat4Identity();
        this.view = mat4Identity();
        this.viewProj = mat4Identity();
        this.cameraRight = new Float32Array(3);
        this.cameraUp = new Float32Array(3);
        this.cameraX = 0;
        this.cameraY = 2000;
        /** Start above origin; controller applies height-linked tilt look-at. */
        this.cameraZ = 0;
        this.targetX = 0;
        this.targetZ = 0;
        this.cssWidth = 1;
        this.cssHeight = 1;
        /** Projection clip planes — single source for resize + pick. */
        this.near = 10;
        this.far = 1e10;
        this.raf = 0;
        this.disposed = false;
        /**
         * Optional pre-lookAt tick (camera damp). App wires controller.update.
         * Receives clamped dt in ms.
         */
        this.beforeFrame = null;
        this.lastFrameNowMs = 0;
        this.storeDirty = true;
        this.impostorStoreDirty = true;
        this.linesDirty = true;
        /**
         * Galaxy point LOD: per-cluster radius/center + system indices + sticky impostor.
         * Impostor also parks intra-cluster lines (lineKeys); inter-cluster edges stay.
         */
        this.clusterLodMeta = new Map();
        /** Last camera distance used for point LOD (skip recompute when stable). */
        this.lastPointLodD = -1;
        this.lastPointLodViewportH = -1;
        this.lastPointLodFovy = -1;
        /** Current billboard half-extent for systems + impostors (5px diameter). */
        this.pointWorldScale = 1;
        // --- M4 edit handles + selection/hover rings ---
        this.activeHandles = null;
        this.editLayout = null;
        this.editClusterId = null;
        this.editCenter = { x: 0, z: 0 };
        this.hoverRing = null;
        this.selectRing = null;
        this.overlayDirty = false;
        /** Scratch inv(view·proj) for edit-handle ground pick. */
        this.invViewProj = mat4Identity();
        /**
         * Multisampled color target for the map pass (resolve → swapchain).
         * Size tracks the drawing buffer; recreated on resize.
         */
        this.msaaColor = null;
        this.msaaColorView = null;
        this.msaaW = 0;
        this.msaaH = 0;
        this.onResize = () => {
            this.resize(window.innerWidth, window.innerHeight);
        };
        /** Last renderFrame wall time (ms) — independent of display vsync. */
        this.lastFrameCpuMs = 0;
        /** Last isolated GPU frame cost (ms). */
        this.lastFrameGpuMs = 0;
        this.frameCpuSampleSum = 0;
        this.frameCpuSampleCount = 0;
        this.frameGpuSampleSum = 0;
        this.frameGpuSampleCount = 0;
        this.canvas = canvas;
        this.bootstrap = bootstrap;
        this.fovyDeg = fovyDeg;
        this.timeOriginMs = Date.now();
        this.store = new SolarPointStore();
        this.impostorStore = new SolarPointStore();
        this.lineStore = new ConnectionLineStore();
        this.points = new SolarPointGpuLayer(bootstrap);
        this.impostorPoints = new SolarPointGpuLayer(bootstrap);
        this.lines = new ConnectionLineGpuLayer(bootstrap);
        this.fleetsLayer = new FleetInstanceGpuLayer(bootstrap);
        this.overlay = new MapOverlayGpuLayer(bootstrap);
        // Color-only map pass: depthFormat null. MSAA + a2c for Line2 long edges.
        const msaa = { sampleCount: MAP_MSAA_SAMPLES };
        this.overlayLines = new Line2Renderer(bootstrap.device, {
            format: bootstrap.format,
            sampleCount: MAP_MSAA_SAMPLES,
            alphaToCoverage: true,
            material: {
                color: [1, 1, 1, 1],
                linewidth: OVERLAY_LINEWIDTH_PX,
                worldUnits: false,
                softAA: true,
                vertexColors: true,
                depthTest: false,
                depthWrite: false,
            },
        });
        this.points.init(msaa);
        this.impostorPoints.init(msaa);
        this.lines.init(msaa);
        this.fleetsLayer.init(msaa);
        this.overlay.init(msaa);
    }
    /** Grow/recreate the MSAA color attachment to match the drawing buffer. */
    ensureMsaaColor(width, height) {
        const w = Math.max(1, width | 0);
        const h = Math.max(1, height | 0);
        if (this.msaaColor && this.msaaW === w && this.msaaH === h)
            return;
        this.msaaColor?.destroy();
        this.msaaColor = this.bootstrap.device.createTexture({
            label: "map-msaa-color",
            size: { width: w, height: h },
            sampleCount: MAP_MSAA_SAMPLES,
            format: this.bootstrap.format,
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
        this.msaaColorView = this.msaaColor.createView();
        this.msaaW = w;
        this.msaaH = h;
    }
    static async create(options) {
        const canvas = document.createElement("canvas");
        // Fixed fullscreen so hit-testing matches window CSS size used for pick/NDC.
        canvas.style.display = "block";
        canvas.style.position = "fixed";
        canvas.style.inset = "0";
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        canvas.style.touchAction = "none";
        canvas.style.zIndex = "0";
        options.container.appendChild(canvas);
        let viewRef = null;
        const bootstrap = await createWebGpuBootstrap({
            canvas,
            label: "galaxy-webgpu-map",
            onDeviceLost: () => {
                viewRef?.stopLoop();
            },
        });
        const view = new WebGpuMapView(canvas, bootstrap, options.fovyDeg ?? 60);
        viewRef = view;
        view.resize(window.innerWidth, window.innerHeight);
        // Do not start rAF here — concurrent first frames + Worker launch can
        // destroy the WebGPU device under headless SwiftShader. Callers start
        // the loop after workers are ready via startRenderLoop().
        window.addEventListener("resize", view.onResize);
        return view;
    }
    /** Start the map rAF loop (idempotent). Prefer after workers are online. */
    startRenderLoop() {
        if (this.disposed || this.bootstrap.isLost)
            return;
        if (this.raf)
            return;
        this.startLoop();
    }
    isDeviceLost() {
        return this.disposed || this.bootstrap.isLost;
    }
    /** GPU-relative ms for f32 uniforms / FleetGpu.t0 (wall - origin). */
    toGpuTime(wallMs) {
        return wallMs - this.timeOriginMs;
    }
    getCameraState() {
        return {
            eyeX: this.cameraX,
            eyeY: this.cameraY,
            eyeZ: this.cameraZ,
            targetX: this.targetX,
            targetZ: this.targetZ,
            fovyDeg: this.fovyDeg,
            near: this.near,
            far: this.far,
            viewportW: this.cssWidth,
            viewportH: this.cssHeight,
        };
    }
    resize(width, height) {
        if (this.bootstrap.isLost)
            return;
        this.cssWidth = Math.max(1, width);
        this.cssHeight = Math.max(1, height);
        this.bootstrap.configureContext(this.cssWidth, this.cssHeight);
        const aspect = this.cssWidth / this.cssHeight;
        mat4Perspective(this.proj, (this.fovyDeg * Math.PI) / 180, aspect, this.near, this.far);
        // Line2 expansion uses drawing-buffer pixels (DPR-scaled canvas size).
        const bufW = this.canvas.width;
        const bufH = this.canvas.height;
        this.overlayLines.setResolution(bufW, bufH);
        this.lines.setResolution(bufW, bufH);
        this.ensureMsaaColor(bufW, bufH);
    }
    setCameraLookAt(eyeX, eyeY, eyeZ, targetX, targetZ) {
        this.cameraX = eyeX;
        this.cameraY = eyeY;
        this.cameraZ = eyeZ;
        this.targetX = targetX;
        this.targetZ = targetZ;
    }
    /**
     * Run once per rAF before look-at / LOD / draw (e.g. damped camera update).
     * Pass null to clear.
     */
    setBeforeFrame(fn) {
        this.beforeFrame = fn;
    }
    setFleetPositionProvider(lookup) {
        this.positionLookup = lookup;
        // Sparse re-write path endpoints; no structure rebuild (slots stay stable).
        if (this.fleets.size === 0)
            return;
        for (const f of this.fleets.values()) {
            if (this.writeFleetGpuFromState(f, f.state, f.fleetSlot)) {
                this.markFleetDirty(f.fleetSlot);
            }
        }
    }
    addSolarSystem(cluster, solarSystem) {
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
        const meta = this.ensureClusterLodMeta(cluster, clusterColor);
        meta.systemIndices.push(idx);
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
        const idx = solarSystem._bufferIndex;
        if (typeof idx !== "number")
            return;
        this.store.hide(idx);
        this.storeDirty = true;
        const meta = this.clusterLodMeta.get(cluster.id);
        if (!meta)
            return;
        const i = meta.systemIndices.indexOf(idx);
        if (i !== -1)
            meta.systemIndices.splice(i, 1);
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
        const touched = new Set();
        for (const s of systems) {
            const idx = s._bufferIndex;
            if (typeof idx !== "number")
                continue;
            this.store.updatePosition(idx, s.position.x, s.position.z);
            const cluster = s.cluster;
            if (cluster) {
                const meta = this.clusterLodMeta.get(cluster.id);
                if (meta) {
                    meta.x = cluster.position.x;
                    meta.z = cluster.position.z;
                    meta.radius = cluster.radius || meta.radius;
                    touched.add(cluster.id);
                }
            }
        }
        this.storeDirty = true;
        // If impostored, move the impostor center with the cluster drag.
        for (const id of touched) {
            const meta = this.clusterLodMeta.get(id);
            if (meta?.wasImpostor) {
                this.writeImpostorPoint(meta, true);
                this.impostorStoreDirty = true;
            }
        }
    }
    addConnection(key, a, b, color = 0x00ffff) {
        if (!this.lineStore.add(key, a, b, color))
            return;
        this.linesDirty = true;
        // Track solar edges under their cluster so impostor can hide them.
        const clusterId = solarConnectionClusterId(key);
        if (clusterId == null)
            return;
        const meta = this.clusterLodMeta.get(clusterId);
        if (!meta)
            return;
        meta.lineKeys.push(key);
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
        const clusterId = solarConnectionClusterId(key);
        if (clusterId == null)
            return;
        const meta = this.clusterLodMeta.get(clusterId);
        if (!meta)
            return;
        const i = meta.lineKeys.indexOf(key);
        if (i !== -1)
            meta.lineKeys.splice(i, 1);
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
        const writes = [];
        this.clusterLodMeta.clear();
        this.impostorStore.clear();
        for (const cluster of galaxy.clusters) {
            const clusterColor = cluster.color || 0xffffff;
            const meta = this.ensureClusterLodMeta(cluster, clusterColor);
            meta.systemIndices.length = 0;
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
            }
            meta.x = cluster.position.x;
            meta.z = cluster.position.z;
            meta.radius = cluster.radius || meta.radius;
            meta.wasImpostor = false;
            meta.lineKeys.length = 0;
            // Impostor starts hidden; applyGalaxyPointLod will show if needed
            this.writeImpostorPoint(meta, false);
        }
        this.store.rebuild(writes);
        this.storeDirty = true;
        this.impostorStoreDirty = true;
        this.linesDirty = true;
        this.lastPointLodD = -1;
    }
    finalizeBuffers(galaxy) {
        this.finalizeFromGalaxy(galaxy);
        rebuildWebGpuConnectionsFromGalaxy(this, galaxy);
        this.linesDirty = true;
    }
    clearPoints() {
        this.store.clear();
        this.impostorStore.clear();
        this.clusterLodMeta.clear();
        this.storeDirty = true;
        this.impostorStoreDirty = true;
        this.lastPointLodD = -1;
    }
    clearLines() {
        this.lineStore.clear();
        for (const meta of this.clusterLodMeta.values()) {
            meta.lineKeys.length = 0;
        }
        this.linesDirty = true;
    }
    clear() {
        this.clearPoints();
        this.clearLines();
        this.clearFleets();
        // Drop edit gizmo + rings so clear-galaxy leaves no ghost overlay.
        this.hideEditHandles();
        this.setHoverRing(null);
        this.setSelectRing(null);
        this.clearOverlay();
        this.overlayDirty = false;
    }
    setStatsPanels(panels) {
        this.statsPanels = panels ?? [];
    }
    // --- M4 overlay geometry (low-level) ---
    /**
     * Upload fat Line2 overlay segments (positions xyz×2 + RGB×2 per segment).
     * Prefer high-level setHoverRing / setSelectRing / showEditHandles.
     */
    setOverlayLine2(pack) {
        if (pack.segmentCount <= 0) {
            this.overlayLines.clearGeometry();
            return;
        }
        this.overlayLines.setPositions(pack.positions.subarray(0, pack.segmentCount * LINE2_OVERLAY_POS_FLOATS));
        this.overlayLines.setColors(pack.colors.subarray(0, pack.segmentCount * LINE2_OVERLAY_COLOR_FLOATS));
    }
    /** Upload triangle-list overlay verts (pos.xyz + rgba). count = vertices. */
    setOverlayFills(data, vertexCount) {
        this.overlay.setFillVertices(data, vertexCount);
    }
    /** Clear overlay fat lines + fill streams. */
    clearOverlay() {
        this.overlayLines.clearGeometry();
        this.overlay.clear();
    }
    // --- M4 high-level edit handles + rings ---
    showEditHandles(clusterId, handles, radius) {
        const list = [];
        for (let i = 0; i < handles.length; i++) {
            const h = handles[i];
            list.push({
                id: h.id,
                x: h.x,
                z: h.z,
                kind: h.kind,
                clusterId: h.clusterId,
            });
        }
        this.activeHandles = list;
        this.editLayout = layoutFromRadius(radius);
        this.editClusterId = clusterId;
        if (list.length > 0) {
            this.editCenter.x = list[0].x;
            this.editCenter.z = list[0].z;
        }
        this.overlayDirty = true;
    }
    hideEditHandles() {
        if (this.activeHandles == null &&
            this.editLayout == null &&
            this.editClusterId == null) {
            return;
        }
        this.activeHandles = null;
        this.editLayout = null;
        this.editClusterId = null;
        this.overlayDirty = true;
    }
    /**
     * Move edit gizmo center (and handle hit positions) during cluster drag.
     * No-op if no handles are active or clusterId does not match.
     */
    updateEditOverlayPosition(clusterId, pos) {
        if (this.editClusterId !== clusterId || !this.activeHandles)
            return;
        this.editCenter.x = pos.x;
        this.editCenter.z = pos.z;
        for (let i = 0; i < this.activeHandles.length; i++) {
            const h = this.activeHandles[i];
            h.x = pos.x;
            h.z = pos.z;
        }
        this.overlayDirty = true;
    }
    setHoverRing(ring) {
        const prev = this.hoverRing;
        if (ring == null && prev == null)
            return;
        if (ring &&
            prev &&
            prev.x === ring.x &&
            prev.z === ring.z &&
            prev.radius === ring.radius) {
            return;
        }
        this.hoverRing = ring
            ? { x: ring.x, z: ring.z, radius: ring.radius }
            : null;
        this.overlayDirty = true;
    }
    setSelectRing(ring) {
        const prev = this.selectRing;
        if (ring == null && prev == null)
            return;
        if (ring &&
            prev &&
            prev.x === ring.x &&
            prev.z === ring.z &&
            prev.radius === ring.radius) {
            return;
        }
        this.selectRing = ring
            ? { x: ring.x, z: ring.z, radius: ring.radius }
            : null;
        this.overlayDirty = true;
    }
    hasEditHandles() {
        return this.activeHandles != null && this.activeHandles.length > 0;
    }
    /**
     * Ground-plane hit against active edit handles.
     * Recomputes view·proj from current camera so picks match the last setCameraLookAt.
     */
    getEditHandleHit(ndcX, ndcY) {
        if (!this.activeHandles || !this.editLayout)
            return null;
        mat4LookAt(this.view, this.cameraX, this.cameraY, this.cameraZ, this.targetX, 0, this.targetZ);
        mat4ViewProj(this.viewProj, this.proj, this.view);
        if (mat4Invert(this.invViewProj, this.viewProj) == null)
            return null;
        const ray = rayFromNdc(ndcX, ndcY, this.invViewProj);
        const ground = intersectRayPlaneY0(ray.origin, ray.direction);
        if (!ground)
            return null;
        return hitEditHandleAtGround(ground.x, ground.z, this.activeHandles, this.editLayout);
    }
    /**
     * Pack gizmo + rings into overlay GPU buffers when dirty.
     * Fat lines → Line2; plane fills → MapOverlayGpuLayer.
     * Called once per dirty frame before encode (not every frame).
     */
    packOverlaysIfDirty() {
        if (!this.overlayDirty)
            return;
        this.overlayDirty = false;
        const lineChunks = [];
        const fillChunks = [];
        if (this.activeHandles && this.editLayout) {
            const gizmo = packEditHandleGizmoLine2(this.editCenter.x, this.editCenter.z, this.editLayout);
            lineChunks.push(gizmo.lines);
            fillChunks.push(gizmo.fills);
        }
        if (this.hoverRing) {
            lineChunks.push(packRingLine2(this.hoverRing.x, this.hoverRing.z, this.hoverRing.radius, 48, OVERLAY_COLOR_HOVER));
        }
        if (this.selectRing) {
            lineChunks.push(packRingLine2(this.selectRing.x, this.selectRing.z, this.selectRing.radius, 48, OVERLAY_COLOR_SELECT));
        }
        if (lineChunks.length === 0 && fillChunks.length === 0) {
            this.clearOverlay();
            return;
        }
        this.setOverlayLine2(concatLine2OverlayChunks(lineChunks));
        const fills = concatOverlayChunks(fillChunks);
        this.setOverlayFills(fills.data, fills.vertexCount);
    }
    // --- FleetStatusRenderer surface ---
    /**
     * Fair per-fleet ship budget for bulk add (null = full CAP_NEAR when space).
     * 50k fleets: hint = min(48, floor(500k/50k)) = 10; 1k → 48.
     */
    setBulkShipBudgetHint(n) {
        if (n == null || !Number.isFinite(n) || n <= 0) {
            this.bulkShipBudgetHint = null;
            return;
        }
        this.bulkShipBudgetHint = Math.max(1, Math.min(CAP_NEAR, n | 0));
    }
    getBulkShipBudgetHint() {
        return this.bulkShipBudgetHint;
    }
    getFleetCount() {
        return this.fleets.size;
    }
    /** Free-list ship high-water (visual instance index space). */
    getShipHighWater() {
        return this.slotAlloc.shipHighWater;
    }
    /**
     * Pre-grow CPU + GPU buffers once for bulk so mid-apply does not thrash
     * geometric doubles + full dead trail inits (device-lost risk at ~500k).
     */
    reserveFleetCapacity(fleetCount, shipsPerFleet) {
        const fleets = Math.max(0, fleetCount | 0);
        const per = Math.max(0, Math.min(CAP_NEAR, shipsPerFleet | 0));
        const fleetNeed = Math.min(MAX_FLEET_SLOTS, this.slotAlloc.fleetHighWater + fleets);
        const shipNeed = Math.min(GLOBAL_MAX_INSTANCES, this.slotAlloc.shipHighWater + fleets * per);
        this.ensureFleetGpuCapacity(fleetNeed);
        this.ensureCpuInstanceCapacity(shipNeed);
        this.ensureCpuShipSimCapacity(shipNeed);
        if (fleetNeed > 0) {
            this.fleetsLayer.ensureFleetCapacity(fleetNeed);
        }
        // Prefer one-shot GPU grow (avoids mid-bulk thrash). Soft-fail: headless
        // SwiftShader may lose the device on huge trail allocs; addFleet then
        // grows geometrically with chunked dead-init.
        if (shipNeed > 0 && !this.bootstrap.isLost) {
            try {
                this.ensureGpuShipCapacity(shipNeed);
            }
            catch (err) {
                console.warn("[fleets] reserveFleetCapacity GPU grow failed; will grow on apply", err);
            }
        }
    }
    /**
     * Visual ship slots for this spawn under CAP_NEAR + bulk hint + grow remaining.
     * When high-water is full, still return hint/want so free-list holes can fit.
     */
    chooseShipBudget(counts) {
        const want = Math.min(countShips(counts), CAP_NEAR);
        if (want <= 0)
            return 0;
        let n = want;
        if (this.bulkShipBudgetHint != null) {
            n = Math.min(n, Math.max(1, this.bulkShipBudgetHint));
        }
        const remaining = Math.max(0, GLOBAL_MAX_INSTANCES - this.slotAlloc.shipHighWater);
        if (remaining > 0) {
            n = Math.min(n, remaining);
        }
        return Math.max(1, n);
    }
    /**
     * Free-list spawn: alloc fleetSlot + N ship slots (chooseShipBudget),
     * pack formation once, init ShipSim on CPU. GPU upload is **deferred** to the
     * next frame flush (coalesced) so bulk spawn is not N× writeBuffer.
     * Re-add of the same id tombstones the prior slot first.
     */
    addFleet(id, counts, state) {
        if (this.fleets.has(id)) {
            this.removeFleet(id);
        }
        let N = this.chooseShipBudget(counts);
        if (N <= 0) {
            // Domain counts empty — still try zero-size ship range so fleet row exists.
            N = 0;
        }
        const fleetSlot = this.slotAlloc.allocFleetSlot();
        if (fleetSlot === null) {
            console.warn(`[fleets] fleet slot exhausted (max ${MAX_FLEET_SLOTS})`);
            return;
        }
        let range = this.slotAlloc.allocShipRange(N);
        // If chosen N does not fit a free hole / grow room, fall back to icon (N=1).
        if (range === null && N > 1) {
            N = 1;
            range = this.slotAlloc.allocShipRange(1);
        }
        if (range === null) {
            this.slotAlloc.freeFleetSlot(fleetSlot);
            console.warn("[fleets] ship instance budget exhausted");
            return;
        }
        const visual = {
            id,
            counts,
            state,
            seed: hashStringSeed(id),
            fleetSlot,
            instanceStart: range.start,
            instanceCapacity: N,
            instanceActive: N,
            warmFramesLeft: N > 0 ? WARM_FRAMES : 0,
        };
        this.fleets.set(id, visual);
        if (visual.warmFramesLeft > 0)
            this.warmingFleetIds.add(id);
        this.ensureFleetGpuCapacity(this.slotAlloc.fleetHighWater);
        this.ensureCpuInstanceCapacity(this.slotAlloc.shipHighWater);
        this.ensureCpuShipSimCapacity(this.slotAlloc.shipHighWater);
        this.instanceLiveCount = this.slotAlloc.shipHighWater;
        // GPU ship index space (instances + ShipSim + trails) must cover high-water
        // as soon as slots exist — not only on flush. Otherwise remove/killTrail
        // OOB when fleets complete before the first deferred upload.
        this.ensureGpuShipCapacity(this.slotAlloc.shipHighWater);
        // Pack formation at current visual base (path miss → origin; first integrate fixes).
        const base = this.fleetSpawnBase(state);
        if (N > 0) {
            const visualCounts = scaleCountsToBudget(counts, N);
            writeFleetFormation(this.instanceData, range.start, visualCounts, visual.seed, base.x, base.y, base.z);
        }
        // FleetGpu first so initShipSim can read path/heading from the row.
        if (!this.writeFleetGpuFromState(visual, state, fleetSlot)) {
            this.writeFleetGpuParkedScatter(visual, fleetSlot, base.x, base.z);
        }
        if (N > 0) {
            this.initShipSimForFleet(visual);
        }
        this.markFleetDirty(fleetSlot);
        if (N > 0)
            this.markShipDirty(range.start, N);
    }
    /**
     * Discrete phase / path command only. ShipSim pose lives on the GPU after the
     * last integrate — the CPU mirror is **stale** and must never be re-uploaded on
     * jump edge (that caused one-frame position/heading snaps).
     * A jump is just: pathStart/pathEnd/t0/durationMs + JUMPING flag. Integrate steers
     * each ship from its current world pose toward pathEnd+slot over the duration.
     */
    updateFleetState(id, state) {
        const f = this.fleets.get(id);
        if (!f)
            return;
        f.state = state;
        this.ensureFleetGpuCapacity(this.slotAlloc.fleetHighWater);
        // Skip mark on lookup miss — keep prior FleetGpu row (no origin teleport).
        if (this.writeFleetGpuFromState(f, state, f.fleetSlot)) {
            this.markFleetDirty(f.fleetSlot);
        }
    }
    /**
     * Tombstone remove: clear FLEET_FLAG_ALIVE, pause ships + size 0, free slots.
     * No fleetOrder renumber, no full structure rebuild. GPU upload deferred.
     */
    removeFleet(id) {
        const f = this.fleets.get(id);
        if (!f)
            return;
        const slot = f.fleetSlot;
        const start = f.instanceStart;
        const cap = f.instanceCapacity;
        // Clear ALIVE on CPU FleetGpu mirror.
        const o = slot * FLEET_GPU_STRIDE;
        if (o + 4 <= this.fleetGpuBytes.byteLength) {
            const flags = this.fleetGpuView.getUint32(o + FleetGpuFields.flags, true);
            this.fleetGpuView.setUint32(o + FleetGpuFields.flags, (flags & ~FLEET_FLAG_ALIVE) >>> 0, true);
            this.markFleetDirty(slot);
        }
        // Tombstone ships: PAUSED + draw size 0 + kill trails immediately.
        // Trail draw still covers high-water; without a wipe, segments ghost after
        // ships disappear (PAUSED integrate used to skip trail clear).
        if (cap > 0) {
            this.ensureCpuInstanceCapacity(start + cap);
            this.ensureCpuShipSimCapacity(start + cap);
            for (let i = 0; i < cap; i++) {
                const inst = start + i;
                const drawO = inst * FLEET_SHIP_DRAW_FLOATS;
                if (drawO + 8 <= this.instanceData.length) {
                    this.instanceData[drawO + 7] = 0; // size
                }
                const simO = inst * SHIP_SIM_STRIDE;
                if (simO + 4 <= this.shipSimBytes.byteLength) {
                    this.shipSimView.setUint32(simO + ShipSimFields.mode, SHIP_MODE_PAUSED, true);
                    this.shipSimView.setFloat32(simO + ShipSimFields.speed, 0, true);
                }
            }
            this.markShipDirty(start, cap);
            // Same indices as draw/ShipSim; capacity already ≥ high-water from add.
            this.fleetsLayer.killTrailRange(start, cap);
        }
        this.slotAlloc.freeShipRange(start, cap);
        this.slotAlloc.freeFleetSlot(slot);
        this.warmingFleetIds.delete(id);
        this.fleets.delete(id);
    }
    clearFleets() {
        this.fleets.clear();
        this.warmingFleetIds.clear();
        this.slotAlloc.reset();
        this.instanceLiveCount = 0;
        this.flushedShipHw = 0;
        this.flushedFleetHw = 0;
        this.dirtyFleetSlots.length = 0;
        this.dirtyShipRanges.length = 0;
        this.fleetsLayer.setInstances(new Float32Array(0), 0);
        this.fleetsLayer.setFleetGpuData(new Uint8Array(0), 0);
        this.fleetsLayer.setShipSimData(new Uint8Array(0), 0);
        // Drop trail sample/line buffers so no ghost lines remain.
        this.fleetsLayer.ensureTrailCapacity(0);
    }
    /** Grow CPU draw buffer; never past GLOBAL_MAX_INSTANCES. */
    ensureCpuInstanceCapacity(neededInstances) {
        const capped = Math.min(Math.max(0, neededInstances | 0), GLOBAL_MAX_INSTANCES);
        const floats = capped * FLEET_SHIP_DRAW_FLOATS;
        if (floats <= this.instanceData.length)
            return;
        const maxFloats = GLOBAL_MAX_INSTANCES * FLEET_SHIP_DRAW_FLOATS;
        const oldShips = Math.floor(this.instanceData.length / FLEET_SHIP_DRAW_FLOATS);
        const nextShips = nextGrowCapacity(capped, oldShips, GPU_SHIP_CAPACITY_MIN, GLOBAL_MAX_INSTANCES);
        const next = Math.min(maxFloats, nextShips * FLEET_SHIP_DRAW_FLOATS);
        const grown = new Float32Array(next);
        grown.set(this.instanceData);
        this.instanceData = grown;
    }
    /** Grow CPU ShipSim mirror; never past GLOBAL_MAX_INSTANCES. */
    ensureCpuShipSimCapacity(neededInstances) {
        const capped = Math.min(Math.max(0, neededInstances | 0), GLOBAL_MAX_INSTANCES);
        const bytes = capped * SHIP_SIM_STRIDE;
        if (bytes <= this.shipSimBytes.byteLength)
            return;
        const maxBytes = GLOBAL_MAX_INSTANCES * SHIP_SIM_STRIDE;
        const oldShips = Math.floor(this.shipSimBytes.byteLength / SHIP_SIM_STRIDE);
        const nextShips = nextGrowCapacity(capped, oldShips, GPU_SHIP_CAPACITY_MIN, GLOBAL_MAX_INSTANCES);
        const next = Math.min(maxBytes, nextShips * SHIP_SIM_STRIDE);
        const grown = new ArrayBuffer(next);
        if (this.shipSimU8.byteLength > 0) {
            new Uint8Array(grown).set(this.shipSimU8);
        }
        this.shipSimBytes = grown;
        this.shipSimView = new DataView(grown);
        this.shipSimU8 = new Uint8Array(grown);
    }
    /**
     * Spawn-time pack base from discrete state. Unresolved → origin (GPU path
     * command still lands ships once lookup is ready).
     */
    fleetSpawnBase(state) {
        const pos = this.positionLookup
            ? resolveFleetVisualPosition(state, Date.now(), this.positionLookup)
            : null;
        if (!pos)
            return { x: 0, y: RENDER_PLANE_Y, z: 0 };
        return { x: pos.x, y: RENDER_PLANE_Y, z: pos.z };
    }
    ensureFleetGpuCapacity(fleetCount) {
        const needed = fleetCount * FLEET_GPU_STRIDE;
        if (needed <= this.fleetGpuBytes.byteLength)
            return;
        const oldFleets = Math.floor(this.fleetGpuBytes.byteLength / FLEET_GPU_STRIDE);
        // Same geometric policy as GPU fleet buffer.
        const nextFleets = nextGrowCapacity(fleetCount, oldFleets, GPU_FLEET_CAPACITY_MIN, GLOBAL_MAX_INSTANCES);
        const next = nextFleets * FLEET_GPU_STRIDE;
        const grown = new ArrayBuffer(next);
        new Uint8Array(grown).set(this.fleetGpuU8);
        this.fleetGpuBytes = grown;
        this.fleetGpuView = new DataView(grown);
        this.fleetGpuU8 = new Uint8Array(grown);
    }
    markFleetDirty(slot) {
        if (slot < 0)
            return;
        this.dirtyFleetSlots.push(slot | 0);
    }
    markShipDirty(start, count) {
        if (count <= 0 || start < 0)
            return;
        this.dirtyShipRanges.push({ start: start | 0, count: count | 0 });
    }
    /**
     * Grow GPU instance / ShipSim / trail buffers so every ship high-water index
     * is valid. Same geometric capacity; data uploads stay deferred to flush.
     * Preserve bound = last flushed high-water (live GPU poses).
     */
    ensureGpuShipCapacity(shipHw) {
        const hw = Math.max(0, shipHw | 0);
        if (hw <= 0)
            return;
        const preserve = this.flushedShipHw;
        if (hw > this.fleetsLayer.getInstanceCapacity()) {
            this.fleetsLayer.growInstancesPreserving(hw, preserve, this.instanceData, 0, 0);
        }
        if (hw > this.fleetsLayer.getShipSimCapacity()) {
            this.fleetsLayer.growShipSimPreserving(hw, preserve, this.shipSimU8, 0, 0);
        }
        // Trails share the ship index space — always ≥ high-water after this.
        this.fleetsLayer.ensureTrailCapacity(hw);
    }
    /** Merge overlapping/adjacent [start, start+count) ranges; sort by start. */
    static coalesceRanges(ranges) {
        if (ranges.length === 0)
            return [];
        const sorted = ranges
            .filter((r) => r.count > 0 && r.start >= 0)
            .map((r) => ({ start: r.start, count: r.count }))
            .sort((a, b) => a.start - b.start);
        if (sorted.length === 0)
            return [];
        const out = [];
        let cur = { ...sorted[0] };
        for (let i = 1; i < sorted.length; i++) {
            const r = sorted[i];
            const curEnd = cur.start + cur.count;
            if (r.start <= curEnd) {
                cur.count = Math.max(curEnd, r.start + r.count) - cur.start;
            }
            else {
                out.push(cur);
                cur = { ...r };
            }
        }
        out.push(cur);
        return out;
    }
    /**
     * Push pending CPU fleet/ship packs to the GPU once per frame (before integrate).
     * Coalesces dirty ranges so 250 spawns → a handful of writeBuffers, not ~1000.
     */
    flushFleetGpuDirt() {
        const fleetHw = this.slotAlloc.fleetHighWater;
        const shipHw = this.slotAlloc.shipHighWater;
        this.instanceLiveCount = shipHw;
        const hasFleetDirt = this.dirtyFleetSlots.length > 0;
        const hasShipDirt = this.dirtyShipRanges.length > 0;
        if (!hasFleetDirt &&
            !hasShipDirt &&
            shipHw === this.flushedShipHw &&
            fleetHw === this.flushedFleetHw) {
            return;
        }
        this.ensureFleetGpuCapacity(fleetHw);
        this.ensureCpuInstanceCapacity(shipHw);
        this.ensureCpuShipSimCapacity(shipHw);
        // --- Fleet rows ---
        if (fleetHw <= 0) {
            this.fleetsLayer.setFleetGpuData(new Uint8Array(0), 0);
            this.flushedFleetHw = 0;
            this.dirtyFleetSlots.length = 0;
        }
        else {
            const fleetGrew = this.fleetsLayer.ensureFleetCapacity(fleetHw);
            if (fleetGrew || this.flushedFleetHw === 0) {
                // New buffer / first fill: one upload of full high-water from CPU.
                this.fleetsLayer.setFleetGpuData(this.fleetGpuU8, fleetHw);
            }
            else if (hasFleetDirt) {
                const slots = this.dirtyFleetSlots;
                slots.sort((a, b) => a - b);
                let i = 0;
                while (i < slots.length) {
                    const start = slots[i];
                    while (i + 1 < slots.length && slots[i + 1] === start)
                        i++;
                    let end = start + 1;
                    i++;
                    while (i < slots.length) {
                        const s = slots[i];
                        if (s < end) {
                            i++;
                            continue; // duplicate / already covered
                        }
                        if (s === end) {
                            end = s + 1;
                            i++;
                            continue;
                        }
                        break;
                    }
                    this.fleetsLayer.uploadFleetGpuRange(this.fleetGpuU8, start, end - start);
                }
                // Tip extension: logical fleetCount must cover high-water for dispatch.
                if (this.fleetsLayer.getFleetCount() < fleetHw) {
                    const from = this.fleetsLayer.getFleetCount();
                    this.fleetsLayer.uploadFleetGpuRange(this.fleetGpuU8, from, fleetHw - from);
                }
            }
            this.flushedFleetHw = fleetHw;
            this.dirtyFleetSlots.length = 0;
        }
        // --- Ships (instances + ShipSim + trails) ---
        if (shipHw <= 0) {
            this.fleetsLayer.setInstances(new Float32Array(0), 0);
            this.fleetsLayer.setShipSimData(new Uint8Array(0), 0);
            this.fleetsLayer.ensureTrailCapacity(0);
            this.flushedShipHw = 0;
            this.dirtyShipRanges.length = 0;
            return;
        }
        const shipRanges = WebGpuMapView.coalesceRanges(this.dirtyShipRanges);
        this.dirtyShipRanges.length = 0;
        // Capacity already kept in lockstep on add; still ensure (clear/reload edge).
        this.ensureGpuShipCapacity(shipHw);
        this.fleetsLayer.setLiveInstanceCount(shipHw);
        for (let i = 0; i < shipRanges.length; i++) {
            const r = shipRanges[i];
            this.fleetsLayer.uploadInstancesRange(this.instanceData, r.start, r.count);
            this.fleetsLayer.uploadShipSimRange(this.shipSimU8, r.start, r.count);
        }
        this.flushedShipHw = shipHw;
    }
    /**
     * Pack one FleetGpu row from discrete fleet state.
     * shipBudget := visual.instanceCapacity (fixed N; shader LOD owns band),
     * instanceStart := visual.instanceStart (draw + ShipSim base),
     * countsPacked from domain TRUE counts.
     * t0 is GPU-relative (toGpuTime); duration stays wall ms delta (same scale).
     *
     * @returns false if path nodes are unknown — sparse upload should skip
     * (keeps prior row on updateFleetState). Spawn follows with
     * {@link writeFleetGpuParkedScatter} so shipBudget/instanceStart never go stale.
     */
    writeFleetGpuFromState(visual, state, fleetSlot) {
        const o = fleetSlot * FLEET_GPU_STRIDE;
        const lookup = this.positionLookup;
        if (!lookup)
            return false;
        let pathStartX = 0;
        let pathStartZ = 0;
        let pathEndX = 0;
        let pathEndZ = 0;
        let t0 = 0;
        let durationMs = 1;
        let flags = FLEET_FLAG_ALIVE;
        let heading = 0;
        let posX = 0;
        let posZ = 0;
        if (state.state === "jumping") {
            const start = lookup(state.startNode);
            const end = lookup(state.endNode);
            if (!start || !end)
                return false;
            pathStartX = start.x;
            pathStartZ = start.z;
            pathEndX = end.x;
            pathEndZ = end.z;
            t0 = this.toGpuTime(state.startTime);
            durationMs = state.durationMs;
            flags = FLEET_FLAG_ALIVE | FLEET_FLAG_JUMPING;
            // Keep prior formation heading — do NOT snap to path dir on hop start
            // (that reorients every ship slot in one frame). First hop uses 0.
            heading = this.fleetGpuView.getFloat32(o + FleetGpuFields.heading, true);
            const integrated = integrateFleetPos({
                jumping: true,
                pathStartX,
                pathStartZ,
                pathEndX,
                pathEndZ,
                t0,
                durationMs,
                now: this.toGpuTime(Date.now()),
            });
            posX = integrated.x;
            posZ = integrated.z;
        }
        else if (state.state === "cooldown" || state.state === "awaiting") {
            const node = lookup(state.node);
            if (!node)
                return false;
            pathStartX = pathEndX = node.x;
            pathStartZ = pathEndZ = node.z;
            posX = node.x;
            posZ = node.z;
            // Keep formation heading (stable slot frame across hops).
            heading = this.fleetGpuView.getFloat32(o + FleetGpuFields.heading, true);
            if (state.state === "cooldown") {
                flags = FLEET_FLAG_ALIVE | FLEET_FLAG_COOLDOWN;
                t0 = this.toGpuTime(state.startTime);
                durationMs = state.durationMs > 0 ? state.durationMs : 1;
            }
            else {
                flags = FLEET_FLAG_ALIVE;
                durationMs = 1;
            }
        }
        else {
            return false;
        }
        // R5: spawn warm-up (cs_ships sims + size 0). Shader LOD owns MID/FAR proxy.
        if (visual.warmFramesLeft > 0)
            flags |= FLEET_FLAG_WARM;
        writeFleetGpu(this.fleetGpuView, o, {
            posX,
            posZ,
            heading,
            pathStartX,
            pathStartZ,
            pathEndX,
            pathEndZ,
            t0,
            durationMs,
            flags,
            // Fixed capacity N — not host LOD count
            shipBudget: visual.instanceCapacity,
            red: visual.counts.red,
            blue: visual.counts.blue,
            green: visual.counts.green,
            instanceStart: visual.instanceStart,
            fleetIdHash: hashFleetId(visual.id),
        });
        return true;
    }
    /**
     * Safe FleetGpu row when path lookup misses on spawn: ALIVE only (no JUMPING),
     * park at given/last pos, duration 1. Always writes shipBudget/instanceStart.
     */
    writeFleetGpuParkedScatter(visual, fleetSlot, parkX = 0, parkZ = 0) {
        const o = fleetSlot * FLEET_GPU_STRIDE;
        let posX = parkX;
        let posZ = parkZ;
        let heading = 0;
        if (o + FLEET_GPU_STRIDE <= this.fleetGpuBytes.byteLength) {
            const priorX = this.fleetGpuView.getFloat32(o + FleetGpuFields.posX, true);
            const priorZ = this.fleetGpuView.getFloat32(o + FleetGpuFields.posZ, true);
            // Prefer explicit park when prior is empty zero (fresh slot).
            if (priorX !== 0 || priorZ !== 0) {
                posX = priorX;
                posZ = priorZ;
            }
            heading = this.fleetGpuView.getFloat32(o + FleetGpuFields.heading, true);
        }
        let flags = FLEET_FLAG_ALIVE;
        if (visual.warmFramesLeft > 0)
            flags |= FLEET_FLAG_WARM;
        writeFleetGpu(this.fleetGpuView, o, {
            posX,
            posZ,
            heading,
            pathStartX: posX,
            pathStartZ: posZ,
            pathEndX: posX,
            pathEndZ: posZ,
            t0: 0,
            durationMs: 1,
            flags,
            shipBudget: visual.instanceCapacity,
            red: visual.counts.red,
            blue: visual.counts.blue,
            green: visual.counts.green,
            instanceStart: visual.instanceStart,
            fleetIdHash: hashFleetId(visual.id),
        });
    }
    /** Path endpoints from the FleetGpu row (stable fleetSlot). */
    fleetGpuPath(visual) {
        const fleetSlot = visual.fleetSlot;
        if (fleetSlot < 0)
            return null;
        const o = fleetSlot * FLEET_GPU_STRIDE;
        if (o + FLEET_GPU_STRIDE > this.fleetGpuBytes.byteLength)
            return null;
        return {
            pathStartX: this.fleetGpuView.getFloat32(o + FleetGpuFields.pathStartX, true),
            pathStartZ: this.fleetGpuView.getFloat32(o + FleetGpuFields.pathStartZ, true),
            pathEndX: this.fleetGpuView.getFloat32(o + FleetGpuFields.pathEndX, true),
            pathEndZ: this.fleetGpuView.getFloat32(o + FleetGpuFields.pathEndZ, true),
        };
    }
    /**
     * L5 — init ShipSim from just-packed draw centers. fleetIndex = stable fleetSlot.
     * Always formation agents (paused=false); GPU shader LOD owns MID/FAR hide.
     */
    initShipSimForFleet(visual) {
        const count = visual.instanceCapacity;
        if (count <= 0)
            return;
        const path = this.fleetGpuPath(visual);
        if (!path)
            return;
        const formationHeading = this.fleetGpuView.getFloat32(visual.fleetSlot * FLEET_GPU_STRIDE + FleetGpuFields.heading, true);
        initShipSimFromDrawFormation(this.instanceData, this.shipSimView, visual.instanceStart, count, path.pathStartX, path.pathStartZ, path.pathEndX, path.pathEndZ, false, formationHeading, visual.fleetSlot, visual.seed, false);
    }
    /**
     * R5 — after each integrate: count a warm frame for spawn warm-up.
     * Only fleets in {@link warmingFleetIds} (not a full map scan).
     * When warm ends: clear FLEET_FLAG_WARM only. cs_ships already restores draw
     * size from color when size was zeroed under WARM.
     */
    tickWarmFleets() {
        if (this.warmingFleetIds.size === 0)
            return;
        // Snapshot ids — we mutate the set as fleets finish warm.
        const ids = [...this.warmingFleetIds];
        for (let i = 0; i < ids.length; i++) {
            const id = ids[i];
            const f = this.fleets.get(id);
            if (!f || f.warmFramesLeft <= 0) {
                this.warmingFleetIds.delete(id);
                continue;
            }
            f.warmFramesLeft -= 1;
            if (f.warmFramesLeft > 0)
                continue;
            this.warmingFleetIds.delete(id);
            const slot = f.fleetSlot;
            const o = slot * FLEET_GPU_STRIDE;
            if (o + 4 <= this.fleetGpuBytes.byteLength) {
                const flags = this.fleetGpuView.getUint32(o + FleetGpuFields.flags, true);
                this.fleetGpuView.setUint32(o + FleetGpuFields.flags, (flags & ~FLEET_FLAG_WARM) >>> 0, true);
                this.markFleetDirty(slot);
            }
        }
    }
    /**
     * Ensure cluster has LOD meta + an impostor store slot (starts hidden).
     */
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
            lineKeys: [],
            impostorIndex,
            wasImpostor: false,
        };
        this.clusterLodMeta.set(cluster.id, meta);
        return meta;
    }
    /** Write impostor center/color; show or LOD-hide without zeroing colors. */
    writeImpostorPoint(meta, show) {
        const idx = meta.impostorIndex;
        if (show) {
            // writeAt clears lodHidden and places at x,z with color
            this.impostorStore.writeAt(idx, {
                x: meta.x,
                z: meta.z,
                color: { isJumpGate: false, clusterColor: meta.color },
            });
        }
        else {
            // Ensure color is correct for later show, then park
            this.impostorStore.writeAt(idx, {
                x: meta.x,
                z: meta.z,
                color: { isJumpGate: false, clusterColor: meta.color },
            });
            this.impostorStore.setLodHidden(idx, true);
        }
    }
    /**
     * O(clusters) point LOD: constant ~5px billboards; cluster impostors with hysteresis.
     * Runs when camera distance / viewport / fovy change (not every frame if stable).
     */
    applyGalaxyPointLod() {
        const d = cameraDistanceToTarget({ x: this.cameraX, y: this.cameraY, z: this.cameraZ }, { x: this.targetX, z: this.targetZ });
        const viewportH = this.cssHeight;
        const fovy = this.fovyDeg;
        // Always refresh worldScale when d/H/fovy move (smooth zoom sizing).
        const dChanged = Math.abs(d - this.lastPointLodD) > 1e-3 ||
            viewportH !== this.lastPointLodViewportH ||
            fovy !== this.lastPointLodFovy;
        this.pointWorldScale = billboardScaleForDiameterPx(SYSTEM_POINT_DIAMETER_PX, d, fovy, viewportH);
        if (!dChanged && this.lastPointLodD >= 0) {
            return;
        }
        this.lastPointLodD = d;
        this.lastPointLodViewportH = viewportH;
        this.lastPointLodFovy = fovy;
        for (const meta of this.clusterLodMeta.values()) {
            if (meta.systemIndices.length === 0)
                continue;
            const wantImpostor = clusterImpostorWithHysteresis(d, meta.radius, meta.wasImpostor, fovy, viewportH);
            if (wantImpostor === meta.wasImpostor)
                continue;
            meta.wasImpostor = wantImpostor;
            if (wantImpostor) {
                for (let i = 0; i < meta.systemIndices.length; i++) {
                    this.store.setLodHidden(meta.systemIndices[i], true);
                }
                for (let i = 0; i < meta.lineKeys.length; i++) {
                    this.lineStore.setLodHidden(meta.lineKeys[i], true);
                }
                this.writeImpostorPoint(meta, true);
            }
            else {
                for (let i = 0; i < meta.systemIndices.length; i++) {
                    // Internal lodRestore cache (kept current by updatePosition while hidden)
                    this.store.setLodHidden(meta.systemIndices[i], false);
                }
                for (let i = 0; i < meta.lineKeys.length; i++) {
                    this.lineStore.setLodHidden(meta.lineKeys[i], false);
                }
                this.writeImpostorPoint(meta, false);
            }
            this.storeDirty = true;
            this.impostorStoreDirty = true;
            this.linesDirty = true;
        }
    }
    getLastFrameCpuMs() {
        return this.lastFrameCpuMs;
    }
    getLastFrameGpuMs() {
        return this.lastFrameGpuMs;
    }
    beginFrameCpuSample() {
        this.frameCpuSampleSum = 0;
        this.frameCpuSampleCount = 0;
        this.frameGpuSampleSum = 0;
        this.frameGpuSampleCount = 0;
    }
    getFrameCpuSampleAvg() {
        if (this.frameCpuSampleCount <= 0)
            return 0;
        return this.frameCpuSampleSum / this.frameCpuSampleCount;
    }
    getFrameCpuSampleCount() {
        return this.frameCpuSampleCount;
    }
    getFrameGpuSampleAvg() {
        if (this.frameGpuSampleCount <= 0)
            return 0;
        return this.frameGpuSampleSum / this.frameGpuSampleCount;
    }
    getFrameGpuSampleCount() {
        return this.frameGpuSampleCount;
    }
    /**
     * Isolated e2e GPU cost: drain queue → renderFrame → wait for GPU.
     * Not polluted by multi-frame backlog (unlike bare submit→done on a busy queue).
     * Stops rAF for the duration; caller may restart.
     */
    async measureOneGpuFrameMs() {
        if (this.disposed || this.bootstrap.isLost)
            return 0;
        this.stopLoop();
        const queue = this.bootstrap.device.queue;
        if (queue.onSubmittedWorkDone) {
            await queue.onSubmittedWorkDone();
        }
        const t0 = performance.now();
        this.renderFrame();
        if (queue.onSubmittedWorkDone) {
            await queue.onSubmittedWorkDone();
        }
        const ms = performance.now() - t0;
        this.lastFrameGpuMs = ms;
        this.lastFrameCpuMs = ms;
        this.frameGpuSampleSum += ms;
        this.frameGpuSampleCount++;
        this.frameCpuSampleSum += ms;
        this.frameCpuSampleCount++;
        return ms;
    }
    startLoop() {
        const frame = () => {
            if (this.disposed || this.bootstrap.isLost) {
                this.raf = 0;
                return;
            }
            for (let i = 0; i < this.statsPanels.length; i++) {
                this.statsPanels[i].begin();
            }
            const t0 = performance.now();
            this.renderFrame();
            this.lastFrameCpuMs = performance.now() - t0;
            this.frameCpuSampleSum += this.lastFrameCpuMs;
            this.frameCpuSampleCount++;
            for (let i = 0; i < this.statsPanels.length; i++) {
                this.statsPanels[i].end();
            }
            if (this.disposed || this.bootstrap.isLost) {
                this.raf = 0;
                return;
            }
            this.raf = requestAnimationFrame(frame);
        };
        this.raf = requestAnimationFrame(frame);
    }
    stopLoop() {
        if (this.raf) {
            cancelAnimationFrame(this.raf);
            this.raf = 0;
        }
    }
    renderFrame() {
        if (this.bootstrap.isLost)
            return;
        frameDebugBegin();
        // Camera damp / interaction pose before look-at + LOD consume the pose.
        const now = typeof performance !== "undefined" ? performance.now() : Date.now();
        let dtMs = this.lastFrameNowMs > 0 ? now - this.lastFrameNowMs : 16.67;
        this.lastFrameNowMs = now;
        // Match camera-zoom DT clamp (~1–50 ms) so hitch frames don't explode damp.
        if (dtMs < 1)
            dtMs = 1;
        if (dtMs > 50)
            dtMs = 50;
        if (this.beforeFrame) {
            frameDebugTime("beforeFrame", () => this.beforeFrame(dtMs));
        }
        frameDebugTime("mat4LookAt+viewProj", () => {
            mat4LookAt(this.view, this.cameraX, this.cameraY, this.cameraZ, this.targetX, 0, this.targetZ);
            mat4ViewProj(this.viewProj, this.proj, this.view);
            mat4CameraRight(this.view, this.cameraRight);
            mat4CameraUp(this.view, this.cameraUp);
        });
        // Galaxy point LOD: O(clusters) on camera/viewport change (hysteresis sticky).
        frameDebugTime("applyGalaxyPointLod", () => this.applyGalaxyPointLod());
        if (this.storeDirty) {
            frameDebugTime("points.syncFromStore", () => {
                this.points.syncFromStore(this.store);
                this.storeDirty = false;
            });
        }
        if (this.impostorStoreDirty) {
            frameDebugTime("impostorPoints.syncFromStore", () => {
                this.impostorPoints.syncFromStore(this.impostorStore);
                this.impostorStoreDirty = false;
            });
        }
        if (this.linesDirty) {
            frameDebugTime("lines.syncFromStore", () => {
                this.lines.syncFromStore(this.lineStore);
                this.linesDirty = false;
            });
        }
        // Fleet LOD is GPU-side (cs_fleets / cs_ships); host does not re-pack on
        // pan/height/hold. Spawn/remove is free-list + sparse upload only.
        // L3: no CPU jump base walk — compute integrates every frame.
        // M4: pack overlay verts only when dirty (handles / rings).
        frameDebugTime("packOverlaysIfDirty", () => this.packOverlaysIfDirty());
        // One coalesced GPU upload for all fleets/ships dirtied since last frame.
        frameDebugTime("flushFleetGpuDirt", () => this.flushFleetGpuDirt());
        try {
            const texture = frameDebugTime("getCurrentTexture", () => this.bootstrap.context.getCurrentTexture());
            const encoder = this.bootstrap.device.createCommandEncoder({
                label: "webgpu-map-frame",
            });
            // L5 continuous pose: nowRel = Date.now() - timeOriginMs (f32-safe).
            const nowRel = this.toGpuTime(Date.now());
            let simDtMs = nowRel - this.prevNowRel;
            if (this.prevNowRel === 0)
                simDtMs = 16;
            if (simDtMs < 0)
                simDtMs = 0;
            else if (simDtMs > 50)
                simDtMs = 50;
            this.prevNowRel = nowRel;
            // CPU time to *record* dispatches — not GPU execution time.
            // Dispatch high-water (includes tombstone holes). GPU LOD via camera params.
            const fleetHw = this.slotAlloc.fleetHighWater;
            const shipHw = this.instanceLiveCount;
            const fovyRadIntegrate = (this.fovyDeg * Math.PI) / 180;
            frameDebugTime("dispatchIntegrate (encode)", () => this.fleetsLayer.dispatchIntegrate(encoder, nowRel, simDtMs, fleetHw, shipHw, {
                cameraY: this.cameraY,
                targetX: this.targetX,
                targetZ: this.targetZ,
                viewportH: this.cssHeight,
                tanHalfFov: Math.tan(fovyRadIntegrate * 0.5),
            }), `fleets=${fleetHw} ships=${shipHw}`);
            // R5: after integrate counts as one warm frame; clear WARM + repack sizes.
            frameDebugTime("tickWarmFleets", () => this.tickWarmFleets());
            // MSAA ×4 color → resolve into the swapchain (Line2 long-edge AA +
            // softer points/ships). storeOp discard: only the resolve is needed.
            this.ensureMsaaColor(texture.width, texture.height);
            const pass = encoder.beginRenderPass({
                colorAttachments: [
                    {
                        view: this.msaaColorView,
                        resolveTarget: texture.createView(),
                        clearValue: this.bootstrap.clearColor,
                        loadOp: "clear",
                        storeOp: "discard",
                    },
                ],
            });
            // Topology connections: fat Line2 (separate view + proj, not viewProj).
            frameDebugTime("encode.lines", () => this.lines.encode(pass, this.view, this.proj));
            // Systems then cluster impostors — same worldScale (~5px diameter).
            frameDebugTime("encode.points", () => this.points.encode(pass, this.viewProj, this.pointWorldScale, this.store.currentCount, this.cameraRight, this.cameraUp));
            frameDebugTime("encode.impostors", () => this.impostorPoints.encode(pass, this.viewProj, this.pointWorldScale, this.impostorStore.currentCount, this.cameraRight, this.cameraUp));
            // L5b: fat Line2-style trails under ships (NEAR + MID lead). FAR: none.
            // GPU expand buffer → instanced ribbons; wide head / thin tail from age α.
            frameDebugTime("encode.trails", () => this.fleetsLayer.encodeTrails(pass, this.view, this.proj, this.canvas.width, this.canvas.height, this.cameraY));
            // W4: pass cameraY / viewportH / tanHalfFov for screen-space icon sizing.
            const fovyRad = (this.fovyDeg * Math.PI) / 180;
            frameDebugTime("encode.fleets", () => this.fleetsLayer.encode(pass, this.viewProj, 0.95, {
                cameraY: this.cameraY,
                viewportH: this.cssHeight,
                tanHalfFov: Math.tan(fovyRad * 0.5),
            }));
            // M4: translucent plane fills under fat Line2 rings/axes.
            frameDebugTime("encode.overlay", () => {
                this.overlay.encode(pass, this.viewProj);
                // Line2 needs separate view + projection (not fused viewProj).
                this.overlayLines.writeViewProjection(this.view, this.proj);
                this.overlayLines.encode(pass);
            });
            pass.end();
            frameDebugTime("queue.submit", () => this.bootstrap.device.queue.submit([encoder.finish()]));
        }
        catch (err) {
            console.error("[WebGPU] renderFrame failed:", err);
            this.stopLoop();
        }
        // If total ≥ 5ms: console.error full span breakdown (even sub-5ms children).
        frameDebugFrameTotal("renderFrame TOTAL");
    }
    dispose() {
        this.disposed = true;
        this.stopLoop();
        window.removeEventListener("resize", this.onResize);
        this.points.dispose();
        this.impostorPoints.dispose();
        this.lines.dispose();
        this.fleetsLayer.dispose();
        this.overlayLines.dispose();
        this.overlay.dispose();
        this.msaaColor?.destroy();
        this.msaaColor = null;
        this.msaaColorView = null;
        this.bootstrap.destroy();
        this.canvas.remove();
    }
}
/** Grow-only scratch for fill concat (upload copies immediately; safe to reuse). */
let overlayConcatScratch = new Float32Array(0);
const EMPTY_OVERLAY = new Float32Array(0);
/** Grow-only scratch for Line2 segment concat. */
let line2PosScratch = new Float32Array(0);
let line2ColScratch = new Float32Array(0);
const EMPTY_LINE2 = {
    positions: EMPTY_OVERLAY,
    colors: EMPTY_OVERLAY,
    segmentCount: 0,
};
/** Concatenate overlay fill vertex chunks into one buffer for upload. */
function concatOverlayChunks(chunks) {
    let vertexCount = 0;
    for (let i = 0; i < chunks.length; i++) {
        vertexCount += chunks[i].vertexCount;
    }
    if (vertexCount === 0) {
        return { data: EMPTY_OVERLAY, vertexCount: 0 };
    }
    const need = vertexCount * MAP_OVERLAY_FLOATS_PER_VERT;
    if (overlayConcatScratch.length < need) {
        overlayConcatScratch = new Float32Array(need);
    }
    const data = overlayConcatScratch;
    let o = 0;
    for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        data.set(c.data.subarray(0, c.vertexCount * MAP_OVERLAY_FLOATS_PER_VERT), o);
        o += c.vertexCount * MAP_OVERLAY_FLOATS_PER_VERT;
    }
    return { data, vertexCount };
}
/** Concatenate Line2 overlay packs (positions + RGB colors) into one upload. */
function concatLine2OverlayChunks(chunks) {
    let segmentCount = 0;
    for (let i = 0; i < chunks.length; i++) {
        segmentCount += chunks[i].segmentCount;
    }
    if (segmentCount === 0)
        return EMPTY_LINE2;
    const needP = segmentCount * LINE2_OVERLAY_POS_FLOATS;
    const needC = segmentCount * LINE2_OVERLAY_COLOR_FLOATS;
    if (line2PosScratch.length < needP) {
        line2PosScratch = new Float32Array(needP);
    }
    if (line2ColScratch.length < needC) {
        line2ColScratch = new Float32Array(needC);
    }
    const positions = line2PosScratch;
    const colors = line2ColScratch;
    let po = 0;
    let co = 0;
    for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        const nP = c.segmentCount * LINE2_OVERLAY_POS_FLOATS;
        const nC = c.segmentCount * LINE2_OVERLAY_COLOR_FLOATS;
        positions.set(c.positions.subarray(0, nP), po);
        colors.set(c.colors.subarray(0, nC), co);
        po += nP;
        co += nC;
    }
    return { positions, colors, segmentCount };
}
//# sourceMappingURL=webgpu-map-view.js.map