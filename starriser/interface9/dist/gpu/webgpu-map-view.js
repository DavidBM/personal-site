/**
 * Sole map/fleets GPU backend (C1): clear + solar points + fat Line2 connections + fleets.
 * L3/L5: continuous fleet + per-ship non-holonomic pose via compute integrate
 * (no per-frame CPU base walk).
 * Fleet spawn/remove: free-list + tombstone (fleet-slot-allocator). Formation
 * packed once at add; GPU shader LOD owns NEAR/MID/FAR (no host re-pack on zoom).
 * L5b: trail ring samples + fixed-slot line expand in integrate.
 * Strategic trails: color-only pass. Model pot trails: depth pass after models.
 * M4: map overlay — fat Line2 rings/axes + triangle-list plane fills (pack on dirty).
 */
import { createWebGpuBootstrap, } from "./device.js";
import { readGpuTextureRgba8 } from "./buffer-readback.js";
import { SolarPointStore } from "./solar-point-store.js";
import { SolarPointGpuLayer } from "./layers/solar-point-gpu-layer.js";
import { SolarBodyStore } from "./solar-body-store.js";
import { SolarBodyGpuLayer } from "./layers/solar-body-gpu-layer.js";
import { SolarCatalogResidency } from "./solar-catalog-residency.js";
import { catalogIdFromSystemId } from "./solar-catalog-id.js";
import { buildCompactKepler } from "./compact-kepler.js";
import { KEPLER_SCALE, SYSTEM_LOCAL_SPAN, fillSceneCandidatesForCluster, oneSceneWithHysteresis, pickLookAtClusterId, pickSceneParkBodyIndex, } from "./solar-system-lod.js";
import { ConnectionLineStore } from "./connection-line-store.js";
import { ConnectionLineGpuLayer } from "./layers/connection-line-gpu-layer.js";
import { FleetInstanceGpuLayer } from "./layers/fleet-instance-gpu-layer.js";
import { FleetModelGpuLayer } from "./layers/fleet-model-gpu-layer.js";
import { MapOverlayGpuLayer } from "./layers/map-overlay-gpu-layer.js";
import { MAP_MSAA_SAMPLES } from "./map-msaa.js";
import { Line2Renderer } from "../vendor/line2/index.js";
import { hashStringSeed, FLEET_SHIP_DRAW_FLOATS, } from "./fleet-ship-pack.js";
import { CAP_NEAR, GLOBAL_MAX_INSTANCES, GPU_FLEET_CAPACITY_MIN, GPU_SHIP_CAPACITY_MIN, BASE_SHIP_SIZE, MODEL_LOD_DEFAULT_SCALE, MODEL_LOD_MAX_INSTANCES, WARM_FRAMES, buildModelTopologyContext, countShips, fleetLocInSystemScene, fleetTopologyLocFromState, isFleetModelTopologyEligible, isModelLodActiveSticky, modelLodFleetCullPos, nextGrowCapacity, parseInterClusterConnectionKey, resolveModelFocusClusterId, scaleCountsToBudget, selectModelShipIndices, shouldForceIncludeFollowedFleet, shouldResetFleetTrails, } from "./fleet-lod.js";
import { createFleetSlotAllocator } from "./fleet-slot-allocator.js";
import { SYSTEM_POINT_DIAMETER_PX, billboardScaleForDiameterPx, cameraDistanceToTarget, clusterImpostorWithHysteresis, } from "./galaxy-point-lod.js";
import { MAP_NEAR } from "./camera-zoom.js";
import { SCENE_AGENT_SCALE, SCENE_SHIP_VISUAL_MUL, } from "./ship-motion-config.js";
import { FLEET_GPU_STRIDE, FLEET_FLAG_ALIVE, FLEET_FLAG_JUMPING, FLEET_FLAG_COOLDOWN, FLEET_FLAG_WARM, FLEET_FLAG_SPACE3D, FLEET_FLAG_SYSTEM_SCENE, FleetGpuFields, hashFleetId, } from "./fleet-layout.js";
import { SHIP_SIM_STRIDE, ShipSimFields, readShipSim, writeShipSim, } from "./ship-sim-layout.js";
import { SHIP_MODE_ORBIT, SHIP_MODE_PAUSED } from "./ship-flight-ref.js";
import { followPoseFromAgent, stepFollowShipAgent, } from "./follow-cam-pose.js";
import { fleetCenter, initShipsFromFormation, packFormation, writePathCommand, } from "./fleet-motion-api.js";
import { mat4CameraRight, mat4CameraUp, mat4Identity, mat4Invert, mat4LookAt, mat4Perspective, mat4ViewProj, } from "./math/mat4.js";
import { chooseFrameOrigin, discWorldRelativeF32, ensureShipIndexInList, keplerInclinationFromCatalogId, mat4LookAtRelative, } from "./math/world-origin.js";
import { compactBodySunLocal } from "./system-scene/frame.js";
import { buildSystemSceneView } from "./system-scene/view.js";
import { frameDebugBegin, frameDebugFrameTotal, frameDebugTime, } from "./frame-debug.js";
import { hitEditHandleAtGround, layoutFromRadius, } from "./math/edit-handle-hit.js";
import { intersectRayPlaneY0, rayFromNdc, } from "./math/ground-pick.js";
import { KEPLER_ORBIT_RING_SEGMENTS, LINE2_OVERLAY_COLOR_FLOATS, LINE2_OVERLAY_POS_FLOATS, OVERLAY_COLOR_HOVER, OVERLAY_COLOR_SELECT, SCENE_GRID_DIVISIONS, SCENE_GRID_SPAN_MUL, SCENE_JUMP_RAY_R0_MUL, SCENE_SCHEMATIC_DASH_SIZE, SCENE_SCHEMATIC_GAP_SIZE, SCENE_SCHEMATIC_GRID_COLOR, SCENE_SCHEMATIC_RING_COLOR, SCENE_JUMP_RAY_COLOR, capSceneJumpRayLength, packEditHandleGizmoLine2, packKeplerOrbitRingsViewRel, packRingLine2, packSceneGridViewRel, packSceneJumpRaysViewRel, shiftLine2PackByOrigin, } from "./map-overlay-pack.js";
import { MAP_OVERLAY_FLOATS_PER_VERT } from "./shaders/map-overlay.wgsl.js";
import { RENDER_PLANE_Y } from "../contracts/render-constants.js";
import { parseSolarConnectionKey, solarConnectionClusterId, } from "../contracts/connection-key.js";
import { resolveFleetVisualPosition, } from "./fleet-motion-ref.js";
import { rebuildWebGpuConnectionsFromGalaxy } from "../main/webgpu-view-bridge.js";
import { createPassSetFlags, fillPassSetFlags, hashPassSet, solarStoreHasDisc, solarStoreHasSun, } from "./pass-set.js";
/** Max concurrent fleet GPU rows (free-list high-water cap). */
const MAX_FLEET_SLOTS = 100000;
/** Screen-space overlay stroke width (buffer pixels; Line2 `worldUnits=false`). */
/** Fat selection/hover/edit rings (screen px). Slightly wider so select is obvious. */
const OVERLAY_LINEWIDTH_PX = 3.5;
const EMPTY_SYSTEM_IDS = [];
const EMPTY_PREVIEW_KEEP = new Set();
/** Skip 5px galaxy points (and topology is already off) below this fade. */
const GALAXY_FADE_SKIP = 0.02;
/** Skip Kepler discs/schematics while orbit exit is almost done (fade < 1). */
const KEPLER_ENCODE_FADE_MAX = 0.88;
/**
 * Owns canvas + WebGPU device + map layers. Call {@link WebGpuMapView.create}.
 */
export class WebGpuMapView {
    constructor(canvas, bootstrap, fovyDeg, skipShipModel = false) {
        this.fleets = new Map();
        /**
         * CPU SystemSceneSet (topology SolarSystem.id). S2 writes 0–1 look-at winner.
         * S3B ORs FLEET_FLAG_SYSTEM_SCENE from this set.
         */
        this.systemSceneIds = new Set();
        /** Scratch world pose for SCENE planet parking (no per-fleet alloc). */
        this.parkWorldScratch = { x: 0, y: 0, z: 0 };
        /** Topology systems for Band B pick (id → xz + 5px slot). */
        this.sceneSystems = new Map();
        this.sceneHysteresis = {
            sceneId: null,
            holdStartMs: 0,
        };
        this.sceneHiddenBufferIndex = null;
        this.lastSceneSpanPx = 0;
        /** Band C focused compact-body slot (null = none). */
        this.focusedBodyIndex = null;
        this.lastOverlayWorld = null;
        this.lastPassResolveHadDepth = false;
        this.lastOrbitRingSegments = 0;
        this.lastJumpRaySegments = 0;
        /** Last color-pass: topology Line2 was encoded (galaxyFade ≥ 1). */
        this.lastGalaxyTopologyEncoded = true;
        /** 1 = full galaxy; 0 = orbiting SCENE (topology replaced by local rays). */
        this.galaxyFade = 1;
        /** Last overlay pack included hover/select rings (false while SCENE / fade). */
        this.lastPackedGalaxyRings = false;
        /**
         * Year-1 hashed sticky pass-set. One reused flags object + a number.
         * Skip unused encode; do not allocate PassData / a plan per rAF.
         */
        this.passSetFlags = createPassSetFlags();
        this.passSetHash = 0;
        /** Last owned resolve color (same texels that were blitted to the swapchain). */
        this.lastResolveW = 0;
        this.lastResolveH = 0;
        this.orbitRings = null;
        this.sceneGrid = null;
        this.sceneJumpRays = null;
        this.overlayRelScratch = null;
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
        /**
         * Model LOD sticky: global height band + per-fleet instanceStart eligibility.
         * Prevents pure-pan thrash and same-system model/triangle splits.
         */
        this.modelLodGlobalSticky = false;
        this.modelLodFleetSticky = new Map();
        /**
         * Inter-cluster jump edges keyed by connection key — for model topology LOD.
         * Updated on add/remove connection (not solar edges).
         */
        this.jumpEdgesByKey = new Map();
        this.statsPanels = [];
        this.proj = mat4Identity();
        this.view = mat4Identity();
        this.viewProj = mat4Identity();
        /**
         * Origin-relative view / viewProj for fleet model, ship triangles, and trails.
         * Built each frame with {@link chooseFrameOrigin} so close-up geometry keeps
         * mesh-scale f32 precision at galaxy |world| coords.
         */
        this.viewRel = mat4Identity();
        this.viewProjRel = mat4Identity();
        this.frameOrigin = { x: 0, y: 0, z: 0 };
        /** SCENE look-at relative to the Kepler sun (not galaxy eye). */
        this.sceneViewRel = mat4Identity();
        this.sceneViewProjRel = mat4Identity();
        this.sceneSunX = 0;
        this.sceneSunZ = 0;
        /** SCENE GPU origin — ships / pathEnd are sun-relative. */
        this.sceneOriginZero = { x: 0, y: 0, z: 0 };
        this.sceneSunOrigin = { x: 0, y: 0, z: 0 };
        this.cameraRight = new Float32Array(3);
        this.cameraUp = new Float32Array(3);
        this.cameraX = 0;
        this.cameraY = 2000;
        /** Start above origin; controller applies height-linked tilt look-at. */
        this.cameraZ = 0;
        this.targetX = 0;
        /** Look-at Y (0 for map ground; follow cam uses chase targetY). */
        this.targetY = 0;
        this.targetZ = 0;
        this.cssWidth = 1;
        this.cssHeight = 1;
        /** Projection clip planes — single source for resize + pick. */
        /** Near clip — below compact-planet boom at SPAN=0.1 (not MIN_ZOOM). */
        this.near = MAP_NEAR;
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
        /** Last look-at xz used for Band B re-pick (NaN = never applied). */
        this.lastSceneLookAtX = Number.NaN;
        this.lastSceneLookAtZ = Number.NaN;
        this.lastSceneBufferH = -1;
        /** Reused Band B candidate list (one cluster ≤80 + prev sceneId). */
        this.sceneCandidateScratch = [];
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
        /**
         * Offscreen 1-sample resolve (RENDER_ATTACHMENT | COPY_SRC) used only by
         * {@link readbackColorOnce}. Never the canvas — swapchain COPY_SRC/COPY_DST
         * destroys this Chromium SharedImage.
         */
        this.resolveColor = null;
        this.resolveColorView = null;
        /** When true, this frame resolves MSAA into {@link resolveColor}. */
        this.resolveReadback = false;
        /** MSAA depth for opaque ship models (exterior wins over back faces). */
        this.msaaDepth = null;
        this.msaaDepthView = null;
        this.msaaW = 0;
        this.msaaH = 0;
        this.onResize = () => {
            this.resize(window.innerWidth, window.innerHeight);
        };
        /** Cached GPU agent pose for third-person follow (updated after integrate). */
        this.followPoseCache = null;
        /** Last known good pose — never return null mid-follow if readback hiccups. */
        this.followPoseLastGood = null;
        this.followReadbackBusy = false;
        /** Ship index currently being followed (if any). */
        this.followShipIndex = null;
        /**
         * True after the one-shot GPU seed (or after the first shadow step when no
         * seed is needed). Per-frame camera never uses MAP_READ after this.
         */
        this.followShadowLive = false;
        /** Accept at most one async seed so late readbacks do not re-introduce lag. */
        this.followSeedDone = false;
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
        this.solarBodies = new SolarBodyStore();
        this.lineStore = new ConnectionLineStore();
        this.points = new SolarPointGpuLayer(bootstrap);
        this.impostorPoints = new SolarPointGpuLayer(bootstrap);
        this.solarBodyLayer = new SolarBodyGpuLayer(bootstrap);
        this.catalogResidency = new SolarCatalogResidency(bootstrap.device);
        this.lines = new ConnectionLineGpuLayer(bootstrap);
        this.fleetsLayer = new FleetInstanceGpuLayer(bootstrap);
        this.modelLayer = new FleetModelGpuLayer(bootstrap, {
            maxInstances: MODEL_LOD_MAX_INSTANCES,
            modelScale: MODEL_LOD_DEFAULT_SCALE,
            meshYawHalf: 0, // low-poly +Z forward
        });
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
        this.solarBodyLayer.init(msaa);
        this.lines.init(msaa);
        this.fleetsLayer.init(msaa);
        this.modelLayer.init(msaa);
        this.overlay.init(msaa);
        // Best-effort ship model for near LOD (no-op if asset missing).
        // Tests that MAP_READ on this device skip the fetch — concurrent glTF
        // upload + mapAsync destroys the device on this Chromium.
        if (!skipShipModel) {
            void this.loadShipModel("models/spaceship_fighter__-_version_1_meshy_6.glb").catch(() => {
                /* optional asset — triangle LOD remains the fallback */
            });
        }
    }
    /**
     * Load a glTF/GLB ship mesh for the model LOD band.
     * Safe to call multiple times; last successful load wins.
     */
    async loadShipModel(url) {
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(`loadShipModel: ${url} → HTTP ${res.status}`);
        }
        const buf = await res.arrayBuffer();
        await this.modelLayer.loadGlb(buf);
        const sim = this.fleetsLayer.getShipSimBuffer();
        if (sim)
            this.modelLayer.setShipSimBuffer(sim);
        const fleetGpu = this.fleetsLayer.getFleetGpuBuffer?.();
        if (fleetGpu)
            this.modelLayer.setFleetGpuBuffer(fleetGpu);
    }
    /** Grow/recreate the MSAA color + depth attachments to match the drawing buffer. */
    ensureMsaaColor(width, height) {
        const w = Math.max(1, width | 0);
        const h = Math.max(1, height | 0);
        if (this.msaaColor && this.msaaW === w && this.msaaH === h)
            return;
        this.msaaColor?.destroy();
        this.msaaDepth?.destroy();
        this.msaaColor = this.bootstrap.device.createTexture({
            label: "map-msaa-color",
            size: { width: w, height: h },
            sampleCount: MAP_MSAA_SAMPLES,
            format: this.bootstrap.format,
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
        this.msaaColorView = this.msaaColor.createView();
        this.msaaDepth = this.bootstrap.device.createTexture({
            label: "map-msaa-depth",
            size: { width: w, height: h },
            sampleCount: MAP_MSAA_SAMPLES,
            format: "depth24plus",
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
        this.msaaDepthView = this.msaaDepth.createView();
        this.msaaW = w;
        this.msaaH = h;
        if (this.resolveColor && (this.lastResolveW !== w || this.lastResolveH !== h)) {
            this.resolveColor.destroy();
            this.resolveColor = null;
            this.resolveColorView = null;
        }
    }
    /** Offscreen COPY_SRC resolve target for {@link readbackColorOnce}. */
    ensureResolveColor(width, height) {
        const w = Math.max(1, width | 0);
        const h = Math.max(1, height | 0);
        if (this.resolveColor && this.lastResolveW === w && this.lastResolveH === h) {
            return;
        }
        this.resolveColor?.destroy();
        this.resolveColor = this.bootstrap.device.createTexture({
            label: "map-resolve-color",
            size: { width: w, height: h },
            format: this.bootstrap.format,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
        });
        this.resolveColorView = this.resolveColor.createView();
        this.lastResolveW = w;
        this.lastResolveH = h;
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
        const view = new WebGpuMapView(canvas, bootstrap, options.fovyDeg ?? 60, options.skipShipModel === true);
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
            targetY: this.targetY,
            targetZ: this.targetZ,
            fovyDeg: this.fovyDeg,
            near: this.near,
            far: this.far,
            viewportW: this.cssWidth,
            viewportH: this.cssHeight,
            bufferW: this.canvas.width,
            bufferH: this.canvas.height,
        };
    }
    /** Last {@link chooseFrameOrigin} (eye / ship / pathEnd — never star). */
    getFrameOrigin() {
        return {
            x: this.frameOrigin.x,
            y: this.frameOrigin.y,
            z: this.frameOrigin.z,
        };
    }
    /** Galaxy-abs Kepler sun xz (SCENE placement). GPU SCENE origin stays 0. */
    getSceneSunAbs() {
        return { x: this.sceneSunX, z: this.sceneSunZ };
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
        this.orbitRings?.setResolution(bufW, bufH);
        this.sceneGrid?.setResolution(bufW, bufH);
        this.sceneJumpRays?.setResolution(bufW, bufH);
        this.ensureMsaaColor(bufW, bufH);
    }
    setCameraLookAt(eyeX, eyeY, eyeZ, targetX, targetZ, targetY = 0) {
        if (this.cameraX === eyeX &&
            this.cameraY === eyeY &&
            this.cameraZ === eyeZ &&
            this.targetX === targetX &&
            this.targetY === targetY &&
            this.targetZ === targetZ) {
            return;
        }
        this.cameraX = eyeX;
        this.cameraY = eyeY;
        this.cameraZ = eyeZ;
        this.targetX = targetX;
        this.targetY = targetY;
        this.targetZ = targetZ;
    }
    /**
     * CPU authority. Ids are topology SolarSystem.id. At most one catalog SCENE.
     * S2 writes the look-at winner (0 or 1 id). S3B ORs bit 7 from this set.
     * Re-applies FleetGpu flags only when the set actually changes (hysteresis edge).
     */
    setSystemScene(ids) {
        let changed = ids.size !== this.systemSceneIds.size;
        if (!changed) {
            for (const id of ids) {
                if (!this.systemSceneIds.has(id)) {
                    changed = true;
                    break;
                }
            }
        }
        this.systemSceneIds.clear();
        for (const id of ids) {
            this.systemSceneIds.add(id);
        }
        if (changed)
            this.reapplySystemSceneFlags();
    }
    /** Current SCENE set (0 or 1 topology id). */
    getSystemSceneIds() {
        return this.systemSceneIds;
    }
    /**
     * CPU FleetGpu row after {@link writeFleetGpuFromState} / parked scatter.
     * Tests-only read of the host mirror — no MAP_READ (avoids a second device
     * mapping while the map-view glTF load / 4096-ship first alloc is in flight).
     */
    readFleetGpuSlot(id) {
        const f = this.fleets.get(id);
        if (!f)
            return null;
        const o = f.fleetSlot * FLEET_GPU_STRIDE;
        if (o + FLEET_GPU_STRIDE > this.fleetGpuBytes.byteLength)
            return null;
        return {
            flags: this.fleetGpuView.getUint32(o + FleetGpuFields.flags, true),
            shipBudget: this.fleetGpuView.getUint32(o + FleetGpuFields.shipBudget, true),
            instanceStart: this.fleetGpuView.getUint32(o + FleetGpuFields.instanceStart, true),
            pad1: this.fleetGpuView.getUint32(o + FleetGpuFields._pad1, true),
            posX: this.fleetGpuView.getFloat32(o + FleetGpuFields.posX, true),
            posZ: this.fleetGpuView.getFloat32(o + FleetGpuFields.posZ, true),
            pathStartX: this.fleetGpuView.getFloat32(o + FleetGpuFields.pathStartX, true),
            pathStartZ: this.fleetGpuView.getFloat32(o + FleetGpuFields.pathStartZ, true),
            pathEndX: this.fleetGpuView.getFloat32(o + FleetGpuFields.pathEndX, true),
            pathEndZ: this.fleetGpuView.getFloat32(o + FleetGpuFields.pathEndZ, true),
            fleetSlot: f.fleetSlot,
        };
    }
    /**
     * Jewel loc is the loaded Kepler `solarBodies.systemId`, not a stale
     * SystemSceneSet. When no Kepler is loaded (S3B setSystemScene-only tests),
     * fall back to the CPU set. Inbound jumping still uses endNode via
     * {@link fleetTopologyLocFromState}.
     */
    fleetLocMatchesKepler(state) {
        const keplerId = this.solarBodies.systemId;
        if (keplerId != null) {
            return fleetTopologyLocFromState(state).solarSystemId === keplerId;
        }
        return fleetLocInSystemScene(state, this.systemSceneIds);
    }
    /**
     * Whole-hop inbound uses endNode via {@link fleetTopologyLocFromState}.
     * Followed fleet is force-included for agents only (no second Kepler set).
     */
    fleetInSystemScene(state, visual) {
        if (this.fleetLocMatchesKepler(state))
            return true;
        return shouldForceIncludeFollowedFleet(this.isFollowedVisual(visual), true);
    }
    isFollowedVisual(visual) {
        const idx = this.followShipIndex;
        if (idx == null)
            return false;
        const n = visual.instanceCapacity | 0;
        return n > 0 && idx >= visual.instanceStart && idx < visual.instanceStart + n;
    }
    /**
     * True when the chased fleet is in the jewel (loaded Kepler loc, or
     * GPU bit 7 while a SCENE is loaded). Follow force-include bit 7 on the
     * galaxy map is **not** jewel — empty scene set keeps the 1.55 boom.
     */
    isFollowedFleetInSystemScene() {
        if (this.followShipIndex == null)
            return false;
        for (const f of this.fleets.values()) {
            if (!this.isFollowedVisual(f))
                continue;
            if (this.fleetLocMatchesKepler(f.state))
                return true;
            const jewelOpen = this.solarBodies.systemId != null || this.systemSceneIds.size > 0;
            if (!jewelOpen)
                return false;
            const o = f.fleetSlot * FLEET_GPU_STRIDE;
            if (o + 4 > this.fleetGpuBytes.byteLength)
                return false;
            const flags = this.fleetGpuView.getUint32(o + FleetGpuFields.flags, true);
            return (flags & FLEET_FLAG_SYSTEM_SCENE) !== 0;
        }
        return false;
    }
    /**
     * Re-OR bit 7 after a flags rebuild. 0→1 on a live visual starts WARM_FRAMES.
     * Formation capacity is not touched.
     */
    orSystemSceneFlag(visual, state, flags, prevFlags) {
        if (!this.fleetInSystemScene(state, visual))
            return flags;
        let next = flags;
        if ((prevFlags & FLEET_FLAG_SYSTEM_SCENE) === 0 &&
            visual.instanceCapacity > 0) {
            visual.warmFramesLeft = WARM_FRAMES;
            this.warmingFleetIds.add(visual.id);
            next |= FLEET_FLAG_WARM;
            // Galaxy trail samples are O(1–7); Kepler hull is ~0.0004. Wipe on enter.
            this.fleetsLayer.killTrailRange(visual.instanceStart, visual.instanceCapacity);
        }
        return next | FLEET_FLAG_SYSTEM_SCENE;
    }
    /**
     * Sparse flag write on SCENE/follow edge. Formation (instanceStart / shipBudget)
     * stays put — never a host re-pack.
     */
    reapplySystemSceneFlags() {
        if (this.fleets.size === 0)
            return;
        for (const f of this.fleets.values()) {
            const slot = f.fleetSlot;
            const o = slot * FLEET_GPU_STRIDE;
            if (o + 4 > this.fleetGpuBytes.byteLength)
                continue;
            const flags = this.fleetGpuView.getUint32(o + FleetGpuFields.flags, true);
            const next = this.fleetInSystemScene(f.state, f)
                ? this.orSystemSceneFlag(f, f.state, flags, flags)
                : (flags & ~FLEET_FLAG_SYSTEM_SCENE) >>> 0;
            if (next !== flags) {
                this.fleetGpuView.setUint32(o + FleetGpuFields.flags, next >>> 0, true);
                if ((flags & FLEET_FLAG_SYSTEM_SCENE) !== 0 &&
                    (next & FLEET_FLAG_SYSTEM_SCENE) === 0) {
                    this.restoreTopologyPathEnd(f);
                }
                this.markFleetDirty(slot);
            }
        }
    }
    /** Topology dest xz (system node). Jumping uses endNode. */
    topologyPathEndXZ(state) {
        const lookup = this.positionLookup;
        if (!lookup)
            return null;
        if (state.state === "jumping") {
            const end = lookup(state.endNode);
            return end ? { x: end.x, z: end.z } : null;
        }
        if (state.state === "cooldown" || state.state === "awaiting") {
            const node = lookup(state.node);
            return node ? { x: node.x, z: node.z } : null;
        }
        return null;
    }
    restoreTopologyPathEnd(visual) {
        const pos = this.topologyPathEndXZ(visual.state);
        if (!pos)
            return;
        const o = visual.fleetSlot * FLEET_GPU_STRIDE;
        if (o + FLEET_GPU_STRIDE > this.fleetGpuBytes.byteLength)
            return;
        const lookup = this.positionLookup;
        const state = visual.state;
        let startX = pos.x;
        let startZ = pos.z;
        if (state.state === "jumping" && lookup) {
            const start = lookup(state.startNode);
            if (start) {
                startX = start.x;
                startZ = start.z;
            }
        }
        this.fleetGpuView.setFloat32(o + FleetGpuFields.pathStartX, startX, true);
        this.fleetGpuView.setFloat32(o + FleetGpuFields.pathStartZ, startZ, true);
        this.fleetGpuView.setFloat32(o + FleetGpuFields.pathEndX, pos.x, true);
        this.fleetGpuView.setFloat32(o + FleetGpuFields.pathEndZ, pos.z, true);
        const flags = this.fleetGpuView.getUint32(o + FleetGpuFields.flags, true);
        const next = state.state === "jumping"
            ? (flags | FLEET_FLAG_JUMPING) >>> 0
            : (flags & ~FLEET_FLAG_JUMPING) >>> 0;
        this.fleetGpuView.setUint32(o + FleetGpuFields.flags, next, true);
    }
    /**
     * Visual-only: SCENE fleets CIRCULATE a hashed compact planet, not the
     * system node. Stored pathStart/pathEnd are **sun-relative** (no unit).
     * Topology dest stays SolarSystem.position. Formation
     * (instanceStart / shipBudget) is not touched. Park pathStart=pathEnd
     * and clear JUMPING so cs_fleets does not ease across the galaxy.
     */
    writeParkedPathEnd(visual, timeSec) {
        const store = this.solarBodies;
        if (store.systemId == null || store.currentCount <= 0)
            return;
        const slot = visual.fleetSlot;
        const o = slot * FLEET_GPU_STRIDE;
        if (o + FLEET_GPU_STRIDE > this.fleetGpuBytes.byteLength)
            return;
        const hash = this.fleetGpuView.getUint32(o + FleetGpuFields.fleetIdHash, true);
        const idx = pickSceneParkBodyIndex(hash, store);
        const local = compactBodySunLocal(store, idx, timeSec, this.parkWorldScratch);
        if (!local)
            return;
        // Sun-relative compact pose — do not store galaxy abs (system + kepler).
        const lx = local.x;
        const ly = local.y;
        const lz = local.z;
        const prevEndX = this.fleetGpuView.getFloat32(o + FleetGpuFields.pathEndX, true);
        const prevEndZ = this.fleetGpuView.getFloat32(o + FleetGpuFields.pathEndZ, true);
        const prevStartX = this.fleetGpuView.getFloat32(o + FleetGpuFields.pathStartX, true);
        const prevStartZ = this.fleetGpuView.getFloat32(o + FleetGpuFields.pathStartZ, true);
        const prevEndY = this.fleetGpuView.getFloat32(o + FleetGpuFields._pad0, true);
        const prevFlags = this.fleetGpuView.getUint32(o + FleetGpuFields.flags, true);
        const nextFlags = this.orSystemSceneFlag(visual, visual.state, (prevFlags & ~FLEET_FLAG_JUMPING) >>> 0, prevFlags);
        if (prevEndX === lx &&
            prevEndZ === lz &&
            prevStartX === lx &&
            prevStartZ === lz &&
            prevEndY === ly &&
            prevFlags === nextFlags) {
            return;
        }
        this.fleetGpuView.setFloat32(o + FleetGpuFields.pathStartX, lx, true);
        this.fleetGpuView.setFloat32(o + FleetGpuFields.pathStartZ, lz, true);
        this.fleetGpuView.setFloat32(o + FleetGpuFields.pathEndX, lx, true);
        this.fleetGpuView.setFloat32(o + FleetGpuFields.pathEndZ, lz, true);
        this.fleetGpuView.setFloat32(o + FleetGpuFields._pad0, ly, true);
        this.fleetGpuView.setUint32(o + FleetGpuFields.flags, nextFlags, true);
        this.markFleetDirty(slot);
        // First park snaps galaxy pathEnd (system node / hop) onto a compact
        // planet. Per-frame Kepler motion is ≪ SPAN*0.05 — do not wipe then.
        const dx = prevEndX - lx;
        const dz = prevEndZ - lz;
        const killR = SYSTEM_LOCAL_SPAN * 0.05;
        if (visual.instanceCapacity > 0 &&
            dx * dx + dz * dz > killR * killR) {
            this.fleetsLayer.killTrailRange(visual.instanceStart, visual.instanceCapacity);
            this.snapShipsToSceneOrbit(visual);
            this.markShipDirty(visual.instanceStart, visual.instanceCapacity);
        }
    }
    /**
     * Every frame while Kepler is live: park SCENE-loc fleets on a hashed planet.
     * Followed fleets outside the SCENE keep galaxy pathEnd (bit 7 is agents only).
     */
    applyScenePlanetParking() {
        if (this.fleets.size === 0)
            return;
        const store = this.solarBodies;
        if (store.systemId == null || store.currentCount <= 0)
            return;
        const timeSec = this.getSceneTimeSec();
        for (const f of this.fleets.values()) {
            // Loc-only: do not park a followed galaxy fleet onto compact planets.
            if (!this.fleetLocMatchesKepler(f.state))
                continue;
            this.writeParkedPathEnd(f, timeSec);
        }
    }
    /** Last Band B encode draw count (sun + discs issued). */
    getBandBLastDrawCount() {
        return this.solarBodyLayer.getLastDrawCount();
    }
    /** Last host-composed sun centerRel (SCENE prepare origin is the sun → ~0). */
    getLastBandBSunCenterRel() {
        return this.solarBodyLayer.getLastSunCenterRel();
    }
    /** Last projected SYSTEM_LOCAL_SPAN in drawing-buffer px. */
    getSceneSpanPx() {
        return this.lastSceneSpanPx;
    }
    getSceneHysteresis() {
        return {
            sceneId: this.sceneHysteresis.sceneId,
            holdStartMs: this.sceneHysteresis.holdStartMs,
        };
    }
    /** Wall-relative seconds used for Kepler phase (same clock as disc encode). */
    getSceneTimeSec() {
        return this.toGpuTime(Date.now()) / 1000;
    }
    getViewProj() {
        mat4LookAt(this.view, this.cameraX, this.cameraY, this.cameraZ, this.targetX, this.targetY, this.targetZ);
        mat4ViewProj(this.viewProj, this.proj, this.view);
        return this.viewProj;
    }
    setFocusedBodyIndex(index) {
        this.focusedBodyIndex = index == null ? null : index | 0;
    }
    getFocusedBodyIndex() {
        return this.focusedBodyIndex;
    }
    /** Topology node of the loaded Kepler SCENE (for jewel fleet spawn). */
    getSceneFleetNode() {
        const id = this.solarBodies.systemId;
        if (id == null)
            return null;
        const rec = this.sceneSystems.get(id);
        if (!rec)
            return null;
        return { clusterId: rec.clusterId, solarSystemId: id };
    }
    getLastBandCDrawCount() {
        return this.solarBodyLayer.getLastBandCDrawCount();
    }
    /** Last consulted Year-1 pass-set hash (`{discs,sun,atm,models,integrate-split}`). */
    getLastPassSetHash() {
        return this.passSetHash;
    }
    /**
     * Last Band-C FOCUS atmosphere. Live map is RecurseDraw `"oneil"`
     * (color `fs_main`; depth `fs_band_c`). `"hillaire"` is lab LUT apply only.
     */
    getLastFocusAtmMode() {
        return this.solarBodyLayer.getLastFocusAtmMode();
    }
    /**
     * Bake the FOCUS LUT after submit / on promote. One in-flight.
     * Never from encode / renderFrame / startLoop — lab and tests call this.
     * Live map FOCUS stays RecurseDraw O’Neil (`lutReady = false`).
     */
    pumpLutBake() {
        this.solarBodyLayer.pumpLutBake();
    }
    wasPassResolveDepthAttached() {
        return this.lastPassResolveHadDepth;
    }
    getLastOrbitRingSegments() {
        return this.lastOrbitRingSegments;
    }
    getLastJumpRaySegments() {
        return this.lastJumpRaySegments;
    }
    /** True when the last color pass encoded topology Line2 (galaxyFade ≥ 1). */
    getLastGalaxyTopologyEncoded() {
        return this.lastGalaxyTopologyEncoded;
    }
    /**
     * Galaxy topology/point opacity. App copies {@link WebGpuCameraController.getGalaxyFade}
     * each beforeFrame. 1 = map; 0 = Kepler orbit.
     */
    setGalaxyFade(f) {
        const v = Number(f);
        const next = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
        const prevHide = this.hideGalaxySelectionRings();
        this.galaxyFade = next;
        if (this.hideGalaxySelectionRings() !== prevHide)
            this.overlayDirty = true;
    }
    getGalaxyFade() {
        return this.galaxyFade;
    }
    /** True when the last overlay pack included hover/select rings. */
    getLastPackedGalaxyRings() {
        return this.lastPackedGalaxyRings;
    }
    /**
     * Orbit-exit complete: drop hysteresis, empty the compact Kepler SCENE, and
     * restore the look-at system's 5px immediately (do not wait SCENE_HOLD_MS).
     */
    dismissCompactScene() {
        const prevIdx = this.sceneHiddenBufferIndex;
        const prevSceneId = this.sceneHysteresis.sceneId;
        if (prevIdx != null) {
            const prevRec = prevSceneId != null ? this.sceneSystems.get(prevSceneId) : undefined;
            const impostor = prevRec != null &&
                this.clusterLodMeta.get(prevRec.clusterId)?.wasImpostor === true;
            if (!impostor) {
                this.store.setLodHidden(prevIdx, false);
                this.storeDirty = true;
            }
        }
        this.resetSystemSceneLod();
        this.lastOrbitRingSegments = 0;
        this.lastJumpRaySegments = 0;
        this.orbitRings?.clearGeometry();
        this.sceneGrid?.clearGeometry();
        this.sceneJumpRays?.clearGeometry();
        this.solarBodyLayer.clearLastDrawCount();
        this.overlayDirty = true;
    }
    hideGalaxySelectionRings() {
        return this.solarBodies.systemId != null || this.galaxyFade < 1;
    }
    /** Kepler discs + schematics: skip while orbit exit fade is almost done. */
    shouldEncodeKeplerScene() {
        if (this.solarBodies.systemId == null)
            return false;
        if (this.galaxyFade > KEPLER_ENCODE_FADE_MAX && this.galaxyFade < 1) {
            return false;
        }
        return true;
    }
    /**
     * Resolve the next {@link renderOnce} into an owned COPY_SRC color instead of
     * the swapchain. Call before the boom encode; {@link readbackColorOnce} then
     * MAP_READs that target (no second encode, no canvas copy).
     */
    enableColorReadback() {
        this.resolveReadback = true;
        this.ensureResolveColor(Math.max(1, this.canvas.width | 0), Math.max(1, this.canvas.height | 0));
    }
    /**
     * Copy the last owned resolve (full buffer). Same Band C encode as
     * {@link renderOnce} after {@link enableColorReadback}. Uses buffer-readback.
     */
    async readbackColorOnce() {
        if (this.disposed || this.bootstrap.isLost) {
            throw new Error("readbackColorOnce: device lost or view disposed");
        }
        const src = this.resolveColor;
        if (!src || this.lastResolveW <= 0 || this.lastResolveH <= 0) {
            throw new Error("readbackColorOnce: no resolve target (enableColorReadback + renderOnce first)");
        }
        const device = this.bootstrap.device;
        const texW = this.lastResolveW;
        const texH = this.lastResolveH;
        return readGpuTextureRgba8(device, src, {
            width: texW,
            height: texH,
            format: this.bootstrap.format,
        });
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
        const touched = new Set();
        for (const s of systems) {
            const idx = s._bufferIndex;
            if (typeof idx !== "number")
                continue;
            this.store.updatePosition(idx, s.position.x, s.position.z);
            const rec = this.sceneSystems.get(s.id);
            if (rec) {
                rec.x = s.position.x;
                rec.z = s.position.z;
            }
            if (this.solarBodies.systemId === s.id) {
                this.solarBodies.setSystemPosition(s.position.x, s.position.z);
            }
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
        // Inter-cluster jump edges feed model topology LOD.
        const jump = parseInterClusterConnectionKey(key);
        if (jump) {
            this.jumpEdgesByKey.set(key, jump);
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
        this.jumpEdgesByKey.delete(key);
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
    finalizeBuffers(galaxy) {
        this.finalizeFromGalaxy(galaxy);
        rebuildWebGpuConnectionsFromGalaxy(this, galaxy);
        this.linesDirty = true;
    }
    clearPoints() {
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
            this.lastOverlayWorld = null;
            this.overlayLines.clearGeometry();
            return;
        }
        this.lastOverlayWorld = {
            positions: pack.positions.slice(0, pack.segmentCount * LINE2_OVERLAY_POS_FLOATS),
            colors: pack.colors.slice(0, pack.segmentCount * LINE2_OVERLAY_COLOR_FLOATS),
            segmentCount: pack.segmentCount,
        };
        this.overlayLines.setPositions(this.lastOverlayWorld.positions);
        this.overlayLines.setColors(this.lastOverlayWorld.colors);
    }
    /** Upload triangle-list overlay verts (pos.xyz + rgba). count = vertices. */
    setOverlayFills(data, vertexCount) {
        this.overlay.setFillVertices(data, vertexCount);
    }
    /** Clear overlay fat lines + fill streams. */
    clearOverlay() {
        this.lastOverlayWorld = null;
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
        mat4LookAt(this.view, this.cameraX, this.cameraY, this.cameraZ, this.targetX, this.targetY, this.targetZ);
        mat4ViewProj(this.viewProj, this.proj, this.view);
        if (mat4Invert(this.invViewProj, this.viewProj) == null)
            return null;
        const ray = rayFromNdc(ndcX, ndcY, this.invViewProj);
        const ground = intersectRayPlaneY0(ray.origin, ray.direction);
        if (!ground)
            return null;
        return hitEditHandleAtGround(ground.x, ground.z, this.activeHandles, this.editLayout);
    }
    makeSchematicLine2(alpha) {
        const line = new Line2Renderer(this.bootstrap.device, {
            format: this.bootstrap.format,
            sampleCount: MAP_MSAA_SAMPLES,
            alphaToCoverage: false,
            material: {
                color: [1, 1, 1, alpha],
                linewidth: 1,
                worldUnits: false,
                endcaps: false,
                softAA: false,
                vertexColors: true,
                depthTest: false,
                depthWrite: false,
                dashed: true,
                dashSize: SCENE_SCHEMATIC_DASH_SIZE,
                gapSize: SCENE_SCHEMATIC_GAP_SIZE,
            },
        });
        line.setResolution(this.canvas.width, this.canvas.height);
        return line;
    }
    ensureOrbitRings() {
        if (this.orbitRings)
            return this.orbitRings;
        this.orbitRings = this.makeSchematicLine2(SCENE_SCHEMATIC_RING_COLOR[3]);
        return this.orbitRings;
    }
    ensureSceneGrid() {
        if (this.sceneGrid)
            return this.sceneGrid;
        this.sceneGrid = this.makeSchematicLine2(SCENE_SCHEMATIC_GRID_COLOR[3]);
        return this.sceneGrid;
    }
    ensureSceneJumpRays() {
        if (this.sceneJumpRays)
            return this.sceneJumpRays;
        this.sceneJumpRays = this.makeSchematicLine2(SCENE_JUMP_RAY_COLOR[3]);
        return this.sceneJumpRays;
    }
    encodeViewRelLine2(line, pack, pass) {
        line.setResolution(this.canvas.width, this.canvas.height);
        if (pack.segmentCount <= 0) {
            line.clearGeometry();
            return;
        }
        line.setPositions(pack.positions);
        line.setColors(pack.colors);
        line.writeViewProjection(this.sceneViewRel, this.proj, { x: 0, y: 0, z: 0 });
        line.encode(pass);
    }
    /**
     * SCENE schematics in origin-relative space: y=0 grid, inclined Kepler
     * rings, local jump rays. Drawn before solar discs so planets sit on top.
     */
    encodeSceneSchematicsViewRel(pass, origin) {
        this.lastOrbitRingSegments = 0;
        this.lastJumpRaySegments = 0;
        const store = this.solarBodies;
        if (store.currentCount <= 0 ||
            store.systemId == null ||
            !this.shouldEncodeKeplerScene()) {
            this.orbitRings?.clearGeometry();
            this.sceneGrid?.clearGeometry();
            this.sceneJumpRays?.clearGeometry();
            return;
        }
        const sunRel = discWorldRelativeF32(store.systemX, store.systemZ, 0, 0, origin.x, origin.y, origin.z);
        const specs = [];
        let rMax = 0;
        for (let i = 0; i < store.currentCount; i++) {
            if (store.isSun[i])
                continue;
            const r = KEPLER_SCALE * store.orbitRadius[i];
            if (!(r > 0))
                continue;
            rMax = Math.max(rMax, r);
            const cat = store.catalogIds[i] ?? "";
            const inc = keplerInclinationFromCatalogId(cat);
            specs.push({ radius: r, inclination: inc.i, node: inc.node });
        }
        const half = Math.max(SCENE_GRID_SPAN_MUL * SYSTEM_LOCAL_SPAN, 1.4 * rMax);
        const gridPack = packSceneGridViewRel(sunRel.x, sunRel.y, sunRel.z, half, SCENE_GRID_DIVISIONS);
        this.encodeViewRelLine2(this.ensureSceneGrid(), gridPack, pass);
        if (specs.length === 0) {
            this.orbitRings?.clearGeometry();
        }
        else {
            const ringPack = packKeplerOrbitRingsViewRel(sunRel.x, sunRel.y, sunRel.z, specs, KEPLER_ORBIT_RING_SEGMENTS);
            this.encodeViewRelLine2(this.ensureOrbitRings(), ringPack, pass);
            this.lastOrbitRingSegments = ringPack.segmentCount;
        }
        if (this.galaxyFade < 1) {
            const rays = this.collectSceneJumpRays(store.systemId, store.systemX, store.systemZ);
            const r0 = SCENE_JUMP_RAY_R0_MUL * rMax;
            const rayPack = packSceneJumpRaysViewRel(sunRel.x, sunRel.y, sunRel.z, rays, r0);
            this.encodeViewRelLine2(this.ensureSceneJumpRays(), rayPack, pass);
            this.lastJumpRaySegments = rayPack.segmentCount;
        }
        else {
            this.sceneJumpRays?.clearGeometry();
        }
    }
    /** Topology edges incident on the SCENE system → unit dir + original length. */
    collectSceneJumpRays(systemId, systemX, systemZ) {
        const rays = [];
        const seen = new Set();
        const push = (dx, dz, length, key) => {
            if (seen.has(key) || !(length > 1e-12))
                return;
            const mag = Math.hypot(dx, dz);
            if (!(mag > 1e-12))
                return;
            seen.add(key);
            rays.push({
                dirX: dx / mag,
                dirZ: dz / mag,
                length: capSceneJumpRayLength(length, SYSTEM_LOCAL_SPAN),
            });
        };
        const otherFromKey = (key) => {
            const ends = this.lineStore.getLogicalEndpoints(key);
            if (!ends)
                return null;
            const da = Math.hypot(ends.ax - systemX, ends.az - systemZ);
            const db = Math.hypot(ends.bx - systemX, ends.bz - systemZ);
            if (da <= db)
                return { x: ends.bx, z: ends.bz };
            return { x: ends.ax, z: ends.az };
        };
        const rec = this.sceneSystems.get(systemId);
        const meta = rec != null ? this.clusterLodMeta.get(rec.clusterId) : undefined;
        if (meta) {
            for (let i = 0; i < meta.lineKeys.length; i++) {
                const key = meta.lineKeys[i];
                const parsed = parseSolarConnectionKey(key);
                if (!parsed)
                    continue;
                const otherId = parsed.a === systemId
                    ? parsed.b
                    : parsed.b === systemId
                        ? parsed.a
                        : -1;
                if (otherId < 0)
                    continue;
                const other = this.sceneSystems.get(otherId);
                const pos = other
                    ? { x: other.x, z: other.z }
                    : otherFromKey(key);
                if (!pos)
                    continue;
                push(pos.x - systemX, pos.z - systemZ, Math.hypot(pos.x - systemX, pos.z - systemZ), key);
            }
        }
        for (const [key, jump] of this.jumpEdgesByKey) {
            let otherId = -1;
            if (jump.jumpGate1 === systemId)
                otherId = jump.jumpGate2;
            else if (jump.jumpGate2 === systemId)
                otherId = jump.jumpGate1;
            else
                continue;
            const other = this.sceneSystems.get(otherId);
            const pos = other
                ? { x: other.x, z: other.z }
                : otherFromKey(key);
            if (!pos)
                continue;
            push(pos.x - systemX, pos.z - systemZ, Math.hypot(pos.x - systemX, pos.z - systemZ), key);
        }
        return rays;
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
        const hideRings = this.hideGalaxySelectionRings();
        this.lastPackedGalaxyRings = false;
        if (!hideRings && this.hoverRing) {
            lineChunks.push(packRingLine2(this.hoverRing.x, this.hoverRing.z, this.hoverRing.radius, 48, OVERLAY_COLOR_HOVER));
            this.lastPackedGalaxyRings = true;
        }
        if (!hideRings && this.selectRing) {
            lineChunks.push(packRingLine2(this.selectRing.x, this.selectRing.z, this.selectRing.radius, 48, OVERLAY_COLOR_SELECT));
            this.lastPackedGalaxyRings = true;
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
    /**
     * Pick a random **formation ship** (NEAR agent) for third-person follow.
     * Prefers fleets with shipBudget > 1 so we chase a real agent, not an impostor icon.
     * When a jewel SCENE is loaded, prefers Kepler-loc parked fleets.
     * Returns a stable shipIndex; use {@link getLiveShipPose} each frame.
     */
    pickRandomShipPose() {
        const all = [...this.fleets.values()].filter((f) => f.instanceActive > 0);
        if (all.length === 0)
            return null;
        // Jewel: prefer parked Kepler loc; fallback to any multi-ship fleet.
        const jewelOpen = this.solarBodies.systemId != null || this.systemSceneIds.size > 0;
        const scene = jewelOpen
            ? all.filter((f) => this.fleetLocMatchesKepler(f.state))
            : [];
        const fromSceneOrAll = scene.length > 0 ? scene : all;
        const multi = fromSceneOrAll.filter((f) => f.instanceCapacity > 1);
        const pool = multi.length > 0 ? multi : fromSceneOrAll;
        const f = pool[(Math.random() * pool.length) | 0];
        const n = Math.max(1, f.instanceActive | 0);
        const local = (Math.random() * n) | 0;
        const shipIndex = f.instanceStart + local;
        // Force an immediate GPU readback so chase starts on agent pose, not stale pack.
        this.followPoseCache = null;
        this.refreshFollowPoseFromGpu(shipIndex);
        return this.getLiveShipPose(shipIndex);
    }
    /**
     * Follow opts for {@link chooseFrameOrigin}: ship pose + planar CIRCULATE
     * pathEnd when the chased agent is orbiting (not SPACE3D). Pure data for
     * floating origin — camera look-at still uses {@link getLiveShipPose}.
     */
    followFrameOriginOpts(shipIndex) {
        const pose = this.getLiveShipPose(shipIndex);
        if (!pose)
            return null;
        const i = shipIndex | 0;
        const o = i * SHIP_SIM_STRIDE;
        let planarCirculate = false;
        let pathEndX;
        let pathEndY;
        let pathEndZ;
        if (o + SHIP_SIM_STRIDE <= this.shipSimView.byteLength) {
            const mode = this.shipSimView.getUint32(o + ShipSimFields.mode, true);
            const fleetSlot = this.shipSimView.getUint32(o + ShipSimFields.fleetIndex, true);
            const fo = fleetSlot * FLEET_GPU_STRIDE;
            if (fo + FLEET_GPU_STRIDE <= this.fleetGpuView.byteLength) {
                const flags = this.fleetGpuView.getUint32(fo + FleetGpuFields.flags, true);
                const space3d = (flags & FLEET_FLAG_SPACE3D) !== 0;
                // Planar CIRCULATE only — matches model/scatter phase-local gate.
                if (mode === SHIP_MODE_ORBIT && !space3d) {
                    planarCirculate = true;
                    pathEndX = this.fleetGpuView.getFloat32(fo + FleetGpuFields.pathEndX, true);
                    pathEndZ = this.fleetGpuView.getFloat32(fo + FleetGpuFields.pathEndZ, true);
                    // Planar pathEndY is 0 in _pad0; keep explicit for origin Y.
                    pathEndY = this.fleetGpuView.getFloat32(fo + FleetGpuFields._pad0, true);
                    if (!Number.isFinite(pathEndY))
                        pathEndY = 0;
                }
            }
        }
        return {
            posX: pose.posX,
            posY: pose.posY,
            posZ: pose.posZ,
            planarCirculate,
            pathEndX,
            pathEndY,
            pathEndZ,
        };
    }
    /**
     * Live chase pose for the followed ship.
     * While follow is active, this is the **same-frame CPU shadow** stepped before
     * camera / floating origin (not a multi-frame async MAP_READ).
     * Falls back to CPU ShipSim mirror / last-good before the first shadow step.
     */
    getLiveShipPose(shipIndex) {
        const i = shipIndex | 0;
        if (i < 0)
            return null;
        let pose = null;
        if (this.followPoseCache && this.followPoseCache.shipIndex === i) {
            pose = { ...this.followPoseCache };
        }
        else {
            // Bootstrap before first same-frame shadow step / seed.
            const o = i * SHIP_SIM_STRIDE;
            if (o + SHIP_SIM_STRIDE <= this.shipSimView.byteLength) {
                pose = {
                    posX: this.shipSimView.getFloat32(o + ShipSimFields.posX, true),
                    posY: this.shipSimView.getFloat32(o + ShipSimFields.posY, true),
                    posZ: this.shipSimView.getFloat32(o + ShipSimFields.posZ, true),
                    heading: this.shipSimView.getFloat32(o + ShipSimFields.heading, true),
                    shipIndex: i,
                    speed: this.shipSimView.getFloat32(o + ShipSimFields.speed, true),
                };
                if (this.followPoseLastGood &&
                    this.followPoseLastGood.shipIndex === i &&
                    !Number.isFinite(pose.posX)) {
                    pose = { ...this.followPoseLastGood };
                }
                else if (Number.isFinite(pose.posX) && Number.isFinite(pose.posZ)) {
                    this.followPoseLastGood = { ...pose, speed: pose.speed ?? 0 };
                }
            }
            else if (this.followPoseLastGood &&
                this.followPoseLastGood.shipIndex === i) {
                pose = { ...this.followPoseLastGood };
            }
        }
        if (!pose)
            return null;
        // GPU ShipSim is sun-relative while Kepler is loaded; camera / UI stay galaxy.
        const store = this.solarBodies;
        if (store.systemId == null)
            return pose;
        return {
            ...pose,
            posX: pose.posX + store.systemX,
            posZ: pose.posZ + store.systemZ,
        };
    }
    /**
     * One-shot seed: pull ShipSim from GPU so the CPU shadow starts on the live
     * agent (not a stale pack). Not used as the per-frame camera source.
     */
    refreshFollowPoseFromGpu(shipIndex) {
        const i = shipIndex | 0;
        if (i < 0 || this.followReadbackBusy)
            return;
        if (this.disposed || this.bootstrap.isLost)
            return;
        // One-shot seed only — never a per-frame camera source.
        if (this.followSeedDone)
            return;
        this.followReadbackBusy = true;
        void this.fleetsLayer
            .readbackShipSimOne(i)
            .then((ab) => {
            if (this.followShipIndex !== i)
                return;
            if (this.followSeedDone)
                return;
            const o = i * SHIP_SIM_STRIDE;
            if (o + SHIP_SIM_STRIDE <= this.shipSimBytes.byteLength) {
                new Uint8Array(this.shipSimBytes, o, SHIP_SIM_STRIDE).set(new Uint8Array(ab));
            }
            const rec = readShipSim(this.shipSimView, o);
            const pose = followPoseFromAgent(rec, i);
            if (Number.isFinite(pose.posX) &&
                Number.isFinite(pose.posZ) &&
                Number.isFinite(pose.heading)) {
                this.followPoseCache = pose;
                this.followPoseLastGood = pose;
                this.followShadowLive = true;
                this.followSeedDone = true;
            }
        })
            .catch(() => {
            /* device lost / mid-dispose */
        })
            .finally(() => {
            this.followReadbackBusy = false;
        });
    }
    setFollowShipIndex(shipIndex) {
        this.followShipIndex = shipIndex;
        if (shipIndex == null) {
            this.followPoseCache = null;
            this.followPoseLastGood = null;
            this.followShadowLive = false;
            this.followSeedDone = false;
        }
        else {
            this.followShadowLive = false;
            this.followSeedDone = false;
            // One-shot seed so shadow starts near live GPU agent (not pack-time).
            this.refreshFollowPoseFromGpu(shipIndex);
        }
        // Follow force-includes bit 7 (agents only). Re-OR on the edge, not every rAF.
        this.reapplySystemSceneFlags();
    }
    /**
     * Same-frame follow shadow: step the tracked ship on CPU with the same path
     * inputs / dt the GPU integrate will use, then cache pose for camera + origin.
     * Returns true when a pose was written to {@link followPoseCache}.
     */
    stepFollowShipShadow(dtMs, nowRel) {
        const i = this.followShipIndex;
        if (i == null || i < 0)
            return false;
        const o = i * SHIP_SIM_STRIDE;
        if (o + SHIP_SIM_STRIDE > this.shipSimBytes.byteLength)
            return false;
        const rec = readShipSim(this.shipSimView, o);
        if (!Number.isFinite(rec.posX) || !Number.isFinite(rec.posZ))
            return false;
        const fleetSlot = rec.fleetIndex | 0;
        const fo = fleetSlot * FLEET_GPU_STRIDE;
        let path;
        if (fo + FLEET_GPU_STRIDE <= this.fleetGpuBytes.byteLength) {
            const flags = this.fleetGpuView.getUint32(fo + FleetGpuFields.flags, true);
            path = {
                pathStartX: this.fleetGpuView.getFloat32(fo + FleetGpuFields.pathStartX, true),
                pathStartZ: this.fleetGpuView.getFloat32(fo + FleetGpuFields.pathStartZ, true),
                pathEndX: this.fleetGpuView.getFloat32(fo + FleetGpuFields.pathEndX, true),
                pathEndZ: this.fleetGpuView.getFloat32(fo + FleetGpuFields.pathEndZ, true),
                pathEndY: this.fleetGpuView.getFloat32(fo + FleetGpuFields._pad0, true),
                t0: this.fleetGpuView.getFloat32(fo + FleetGpuFields.t0, true),
                durationMs: this.fleetGpuView.getFloat32(fo + FleetGpuFields.durationMs, true),
                domainWarpActive: (flags & FLEET_FLAG_JUMPING) !== 0,
                space3d: (flags & FLEET_FLAG_SPACE3D) !== 0,
                formationHeading: this.fleetGpuView.getFloat32(fo + FleetGpuFields.heading, true),
            };
        }
        else {
            // No fleet row — park orbit at current pos (still advances orientation).
            path = {
                pathStartX: rec.posX,
                pathStartZ: rec.posZ,
                pathEndX: rec.posX,
                pathEndZ: rec.posZ,
                pathEndY: rec.posY ?? 0,
                t0: nowRel,
                durationMs: 1,
                domainWarpActive: false,
            };
        }
        const agent = {
            posX: rec.posX,
            posY: rec.posY,
            posZ: rec.posZ,
            heading: rec.heading,
            speed: rec.speed,
            slotX: rec.slotX,
            slotY: rec.slotY,
            slotZ: rec.slotZ,
            qx: rec.qx,
            qy: rec.qy,
            qz: rec.qz,
            qw: rec.qw,
            mode: rec.mode,
            orbitR: rec.orbitR,
            orbitOmega: rec.orbitOmega,
            orbitPhase: rec.orbitPhase,
            accel: rec.accel,
            cruiseV: rec.cruiseV,
            omegaMax: rec.omegaMax,
        };
        stepFollowShipAgent(agent, path, dtMs, nowRel);
        writeShipSim(this.shipSimView, o, {
            ...rec,
            posX: agent.posX,
            posY: agent.posY,
            posZ: agent.posZ,
            heading: agent.heading,
            speed: agent.speed,
            qx: agent.qx,
            qy: agent.qy,
            qz: agent.qz,
            qw: agent.qw,
            mode: agent.mode,
            orbitPhase: agent.orbitPhase,
            orbitR: agent.orbitR,
            orbitOmega: agent.orbitOmega,
            accel: agent.accel,
            cruiseV: agent.cruiseV,
            omegaMax: agent.omegaMax,
        });
        const pose = followPoseFromAgent(agent, i);
        this.followPoseCache = pose;
        this.followPoseLastGood = pose;
        this.followShadowLive = true;
        return true;
    }
    /**
     * Upload followed-ship pose so model draw matches the camera shadow.
     * Must **not** full-row upload — that clobbers GPU trailWrite/sinceSample and
     * kills pot trails on the chased ship only (see uploadShipSimFollowShadowPose).
     */
    uploadFollowShipShadowToGpu() {
        const i = this.followShipIndex;
        if (i == null || i < 0 || !this.followShadowLive)
            return;
        this.fleetsLayer.uploadShipSimFollowShadowPose(this.shipSimU8, i);
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
        // Spawn structure only — never re-pack every frame (GPU owns continuous pose).
        const base = this.fleetSpawnBase(state);
        if (N > 0) {
            const visualCounts = scaleCountsToBudget(counts, N);
            packFormation(this.instanceData, range.start, visualCounts, visual.seed, { x: base.x, y: base.y, z: base.z });
        }
        // FleetGpu first so initShipSim can read path/heading from the row.
        if (!this.writeFleetGpuFromState(visual, state, fleetSlot)) {
            this.writeFleetGpuParkedScatter(visual, fleetSlot, base.x, base.z);
        }
        if (N > 0) {
            this.initShipSimForFleet(visual);
            // Galaxy formation is O(1–7) around pathEnd; Kepler span is 0.1.
            // Snap onto the scaled ring so jewel-spawned ships are on-camera now,
            // not 40s of SCENE_SPEED_SCALE SEEK from off-screen.
            if (this.fleetLocMatchesKepler(state)) {
                this.snapShipsToSceneOrbit(visual);
            }
            // Free-list reuse + fresh spawn: wipe trail rings so old segments never stitch.
            this.fleetsLayer.killTrailRange(range.start, N);
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
        const prev = f.state;
        f.state = state;
        this.ensureFleetGpuCapacity(this.slotAlloc.fleetHighWater);
        // Skip mark on lookup miss — keep prior FleetGpu row (no origin teleport).
        if (this.writeFleetGpuFromState(f, state, f.fleetSlot)) {
            this.markFleetDirty(f.fleetSlot);
        }
        // Significant path / node change → reset trails (no ghost stitch across hops).
        if (f.instanceCapacity > 0 &&
            shouldResetFleetTrails(prev, state)) {
            this.fleetsLayer.killTrailRange(f.instanceStart, f.instanceCapacity);
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
        let jumping = false;
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
            jumping = true;
            // Keep prior formation heading — do NOT snap to path dir on hop start
            // (that reorients every ship slot in one frame). First hop uses 0.
            heading = this.fleetGpuView.getFloat32(o + FleetGpuFields.heading, true);
            const cmdJump = {
                from: { x: pathStartX, z: pathStartZ },
                target: { x: pathEndX, z: pathEndZ },
                durationMs,
                t0,
                formationHeading: heading,
                jumping: true,
            };
            const integrated = fleetCenter(cmdJump, this.toGpuTime(Date.now()));
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
        // Flags rebuilt from scratch — SCENE must be re-OR'd every write (not _pad1).
        const prevFlags = o + FLEET_GPU_STRIDE <= this.fleetGpuBytes.byteLength
            ? this.fleetGpuView.getUint32(o + FleetGpuFields.flags, true)
            : 0;
        flags = this.orSystemSceneFlag(visual, state, flags, prevFlags);
        const cmd = {
            from: { x: pathStartX, z: pathStartZ },
            target: { x: pathEndX, z: pathEndZ },
            durationMs,
            t0,
            formationHeading: heading,
            jumping,
        };
        writePathCommand(this.fleetGpuView, o, cmd, {
            posX,
            posZ,
            heading,
            flags,
            // Fixed capacity N — not host LOD count
            shipBudget: visual.instanceCapacity,
            red: visual.counts.red,
            blue: visual.counts.blue,
            green: visual.counts.green,
            instanceStart: visual.instanceStart,
            fleetIdHash: hashFleetId(visual.id),
        });
        if (this.fleetLocMatchesKepler(state)) {
            this.writeParkedPathEnd(visual, this.getSceneTimeSec());
        }
        return true;
    }
    /**
     * Safe FleetGpu row when path lookup misses on spawn: ALIVE only (no JUMPING),
     * park at the given xz, duration 1. Always writes shipBudget/instanceStart.
     * Never reuse a recycled slot's leftover compact-planet pos — that parks a
     * galaxy fleet inside the jewel.
     */
    writeFleetGpuParkedScatter(visual, fleetSlot, parkX = 0, parkZ = 0) {
        const o = fleetSlot * FLEET_GPU_STRIDE;
        let heading = 0;
        if (o + FLEET_GPU_STRIDE <= this.fleetGpuBytes.byteLength) {
            heading = this.fleetGpuView.getFloat32(o + FleetGpuFields.heading, true);
        }
        let flags = FLEET_FLAG_ALIVE;
        if (visual.warmFramesLeft > 0)
            flags |= FLEET_FLAG_WARM;
        const prevFlags = o + FLEET_GPU_STRIDE <= this.fleetGpuBytes.byteLength
            ? this.fleetGpuView.getUint32(o + FleetGpuFields.flags, true)
            : 0;
        flags = this.orSystemSceneFlag(visual, visual.state, flags, prevFlags);
        const cmd = {
            from: { x: parkX, z: parkZ },
            target: { x: parkX, z: parkZ },
            durationMs: 1,
            t0: 0,
            formationHeading: heading,
            jumping: false,
        };
        writePathCommand(this.fleetGpuView, o, cmd, {
            posX: parkX,
            posZ: parkZ,
            heading,
            flags,
            shipBudget: visual.instanceCapacity,
            red: visual.counts.red,
            blue: visual.counts.blue,
            green: visual.counts.green,
            instanceStart: visual.instanceStart,
            fleetIdHash: hashFleetId(visual.id),
        });
        if (this.fleetLocMatchesKepler(visual.state)) {
            this.writeParkedPathEnd(visual, this.getSceneTimeSec());
        }
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
        const cmd = {
            from: { x: path.pathStartX, z: path.pathStartZ },
            target: { x: path.pathEndX, z: path.pathEndZ },
            durationMs: 1,
            t0: 0,
            formationHeading,
            jumping: false,
        };
        initShipsFromFormation({
            instanceData: this.instanceData,
            shipSimView: this.shipSimView,
            instanceStart: visual.instanceStart,
            count,
            cmd,
            fleetIndex: visual.fleetSlot,
            seed: visual.seed,
            paused: false, // formation agent — shader LOD pauses draw on MID/FAR
        });
    }
    /**
     * Place jewel ships on SCENE-scaled CIRCULATE around parked pathEnd.
     * Host formation pack uses galaxy ORBIT_R (2–7); Kepler field is 0.1.
     */
    snapShipsToSceneOrbit(visual) {
        const path = this.fleetGpuPath(visual);
        if (!path)
            return;
        const n = visual.instanceCapacity;
        const k = SCENE_AGENT_SCALE;
        for (let i = 0; i < n; i++) {
            const idx = visual.instanceStart + i;
            const rec = readShipSim(this.shipSimView, idx * SHIP_SIM_STRIDE);
            const R = Math.max(1e-6, (rec.orbitR ?? 2) * k);
            const phase = rec.orbitPhase ?? 0;
            const x = path.pathEndX + R * Math.sin(phase);
            const z = path.pathEndZ + R * Math.cos(phase);
            const y = (rec.slotY ?? 0) * k;
            writeShipSim(this.shipSimView, idx * SHIP_SIM_STRIDE, {
                ...rec,
                posX: x,
                posY: y,
                posZ: z,
                speed: Math.abs((rec.orbitOmega ?? 0) * R),
                mode: SHIP_MODE_ORBIT,
            });
            const io = idx * FLEET_SHIP_DRAW_FLOATS;
            this.instanceData[io] = x;
            this.instanceData[io + 1] = y;
            this.instanceData[io + 2] = z;
        }
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
            systemIds: [],
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
     * Band B (one SCENE) uses drawing-buffer height and the same d/H/fovy cadence
     * plus look-at xz and a hold-pending tick (`holdStartMs > 0` only) so 2500 ms
     * exit can fire without a camera nudge.
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
        const forceLod = this.lastPointLodD < 0;
        const holdPending = this.sceneHysteresis.holdStartMs > 0;
        const lookAtChanged = Math.abs(this.targetX - this.lastSceneLookAtX) > 1e-3 ||
            Math.abs(this.targetZ - this.lastSceneLookAtZ) > 1e-3;
        const bufferH = this.canvas.height;
        const bufferHChanged = bufferH !== this.lastSceneBufferH;
        if (dChanged || forceLod) {
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
        if (dChanged || forceLod || holdPending || lookAtChanged || bufferHChanged) {
            this.applySystemSceneLod(d, fovy);
            this.lastSceneLookAtX = this.targetX;
            this.lastSceneLookAtZ = this.targetZ;
            this.lastSceneBufferH = bufferH;
        }
    }
    resetSystemSceneLod() {
        this.sceneHysteresis = { sceneId: null, holdStartMs: 0 };
        this.sceneHiddenBufferIndex = null;
        this.lastSceneSpanPx = 0;
        this.solarBodies.clear();
        this.catalogResidency.retainPreviews(EMPTY_PREVIEW_KEEP);
        this.setSystemScene(new Set());
    }
    /**
     * One sticky compact Kepler SCENE. Parks the winner's 5px slot.
     * Neighbors stay 5px (no extra catalog bind).
     *
     * Pick is O(clusters) + O(systems in the look-at cluster) — never a
     * full-galaxy `sceneSystems` walk (default 15000×80).
     */
    applySystemSceneLod(d, fovy) {
        const bufferH = this.canvas.height;
        const lookAtX = this.targetX;
        const lookAtZ = this.targetZ;
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
            nowMs: Date.now(),
            prev: this.sceneHysteresis,
        });
        this.sceneHysteresis = {
            sceneId: next.sceneId,
            holdStartMs: next.holdStartMs,
        };
        this.lastSceneSpanPx = next.spanPx;
        const sceneId = next.sceneId;
        const rec = sceneId != null ? this.sceneSystems.get(sceneId) : undefined;
        const nextHidden = rec ? rec.bufferIndex : null;
        if (prevSceneId !== sceneId)
            this.overlayDirty = true;
        if (this.sceneHiddenBufferIndex !== nextHidden) {
            const prevIdx = this.sceneHiddenBufferIndex;
            if (prevIdx != null) {
                const prevRec = prevSceneId != null ? this.sceneSystems.get(prevSceneId) : undefined;
                const impostor = prevRec != null &&
                    this.clusterLodMeta.get(prevRec.clusterId)?.wasImpostor === true;
                if (!impostor) {
                    this.store.setLodHidden(prevIdx, false);
                    this.storeDirty = true;
                }
            }
            if (nextHidden != null) {
                this.store.setLodHidden(nextHidden, true);
                this.storeDirty = true;
            }
            this.sceneHiddenBufferIndex = nextHidden;
        }
        else if (nextHidden != null && !this.store.lodHidden[nextHidden]) {
            // Cluster impostor just un-hid everyone — re-park the SCENE 5px slot.
            this.store.setLodHidden(nextHidden, true);
            this.storeDirty = true;
        }
        if (sceneId == null || !rec) {
            if (this.solarBodies.systemId != null) {
                this.solarBodies.clear();
            }
            this.catalogResidency.retainPreviews(EMPTY_PREVIEW_KEEP);
            this.setSystemScene(new Set());
            return;
        }
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
            this.catalogResidency.retainPreviews(keep);
            for (const id of keep) {
                this.catalogResidency.requestPreview(id);
            }
        }
        else {
            this.solarBodies.setSystemPosition(rec.x, rec.z);
        }
        this.setSystemScene(new Set([sceneId]));
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
    /**
     * One renderFrame without waiting onSubmittedWorkDone (tests / scripted camera).
     * Does not start rAF.
     */
    renderOnce() {
        if (this.disposed || this.bootstrap.isLost)
            return;
        this.renderFrame();
    }
    /** CPU Band B / 5px LOD only (no encode). Safe if the device was lost. */
    tickSceneLod() {
        this.applyGalaxyPointLod();
    }
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
            this.catalogResidency.pumpPreviewLoads();
            this.catalogResidency.pumpHiLoad();
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
        // Follow lockstep (before camera): same sim dt the GPU integrate will use.
        // Camera + floating origin then share this pose; async MAP_READ is seed only.
        // Frame order when following:
        //   stepFollow → beforeFrame(cam) → matrices → submit(integrate) →
        //   writeBuffer(shadow) → encode draws (exact pose, not integrate+1).
        const nowRelEarly = this.toGpuTime(Date.now());
        let simDtMsEarly = nowRelEarly - this.prevNowRel;
        if (this.prevNowRel === 0)
            simDtMsEarly = 16;
        if (simDtMsEarly < 0)
            simDtMsEarly = 0;
        else if (simDtMsEarly > 50)
            simDtMsEarly = 50;
        if (this.followShipIndex != null) {
            frameDebugTime("stepFollowShipShadow", () => this.stepFollowShipShadow(simDtMsEarly, nowRelEarly));
        }
        if (this.beforeFrame) {
            frameDebugTime("beforeFrame", () => this.beforeFrame(dtMs));
        }
        frameDebugTime("mat4LookAt+viewProj", () => {
            mat4LookAt(this.view, this.cameraX, this.cameraY, this.cameraZ, this.targetX, this.targetY, this.targetZ);
            mat4ViewProj(this.viewProj, this.proj, this.view);
            mat4CameraRight(this.view, this.cameraRight);
            mat4CameraUp(this.view, this.cameraUp);
            // Floating origin: planar CIRCULATE follow → pathEnd (orbit center);
            // else followed ship pose; else camera eye. Chase look-at still uses ship.
            // Same-frame shadow (stepFollow above) — not a lagging readback.
            // Kepler open: do not feed sun-rel pathEnd into galaxy chooseFrameOrigin.
            const keplerOpenNow = this.solarBodies.systemId != null;
            const followOriginOpts = keplerOpenNow
                ? null
                : this.followShipIndex != null
                    ? this.followFrameOriginOpts(this.followShipIndex)
                    : null;
            this.frameOrigin = chooseFrameOrigin(this.cameraX, this.cameraY, this.cameraZ, followOriginOpts);
            mat4LookAtRelative(this.viewRel, this.cameraX, this.cameraY, this.cameraZ, this.targetX, this.targetY, this.targetZ, this.frameOrigin.x, this.frameOrigin.y, this.frameOrigin.z);
            mat4ViewProj(this.viewProjRel, this.proj, this.viewRel);
        });
        // Galaxy point LOD: O(clusters) on camera/viewport change (hysteresis sticky).
        frameDebugTime("applyGalaxyPointLod", () => this.applyGalaxyPointLod());
        // Kepler pathEnd for SCENE loc fleets — after store rebuild, before integrate.
        frameDebugTime("applyScenePlanetParking", () => this.applyScenePlanetParking());
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
        // Model LOD + trail ownership **before** integrate so expandTrails mode 2
        // (model-only dense pack) uses this frame's modelHide mask.
        // Follow: beforeFrame already set chase look-at from live pose this frame —
        // recompute focus from that look-at + followed fleet domain (never freeze).
        const fovyRad = (this.fovyDeg * Math.PI) / 180;
        const tanHalfFov = Math.tan(fovyRad * 0.5);
        // View distance, not raw eyeY — orbit eyeY≈0.05 would mark the cluster NEAR.
        const lodCameraY = cameraDistanceToTarget({ x: this.cameraX, y: this.cameraY, z: this.cameraZ }, { x: this.targetX, y: this.targetY, z: this.targetZ });
        const keplerOpen = this.solarBodies.systemId != null;
        if (keplerOpen) {
            this.sceneSunX = this.solarBodies.systemX;
            this.sceneSunZ = this.solarBodies.systemZ;
            this.sceneSunOrigin.x = this.sceneSunX;
            this.sceneSunOrigin.z = this.sceneSunZ;
            buildSystemSceneView(this.sceneViewRel, this.sceneViewProjRel, this.proj, this.cameraX, this.cameraY, this.cameraZ, this.targetX, this.targetY, this.targetZ, this.sceneSunX, this.sceneSunZ);
        }
        let modelIndices = [];
        frameDebugTime("selectModelLod", () => {
            const followIdx = this.followShipIndex;
            // Galaxy map: icons only — no model hulls. Jewel uses Kepler worldSize.
            const sceneModelWorldSize = keplerOpen
                ? BASE_SHIP_SIZE * SCENE_AGENT_SCALE * SCENE_SHIP_VISUAL_MUL
                : undefined;
            this.modelLodGlobalSticky = isModelLodActiveSticky(lodCameraY, this.cssHeight, tanHalfFov, this.modelLodGlobalSticky, sceneModelWorldSize != null
                ? {
                    worldSize: sceneModelWorldSize,
                    enterScreenPx: 8,
                    exitScreenPx: 5,
                }
                : undefined);
            // Jewel: Kepler hull is ~6px at sun orbit — galaxy 100px gate never
            // fires. Force sticky so textured models can draw; 8/5 stay the
            // per-fleet floor in selectModelShipIndices. Galaxy follow stays icons.
            if (keplerOpen)
                this.modelLodGlobalSticky = true;
            // Models require sticky height AND a loaded Kepler — no galaxy-wide hulls.
            if (this.modelLayer.isReady() &&
                this.modelLodGlobalSticky &&
                keplerOpen) {
                const clusterCenters = [];
                for (const meta of this.clusterLodMeta.values()) {
                    clusterCenters.push({
                        id: meta.clusterId,
                        x: meta.x,
                        z: meta.z,
                        radius: meta.radius,
                    });
                }
                // Live chase look-at (updated in beforeFrame) + optional follow loc.
                const followPose = followIdx != null ? this.getLiveShipPose(followIdx) : null;
                let followFleetId = null;
                let followLoc = null;
                if (followIdx != null) {
                    for (const f of this.fleets.values()) {
                        const n = f.instanceCapacity | 0;
                        if (n > 0 &&
                            followIdx >= f.instanceStart &&
                            followIdx < f.instanceStart + n) {
                            followFleetId = f.id;
                            followLoc = fleetTopologyLocFromState(f.state);
                            break;
                        }
                    }
                }
                // Look-at for focus: chase target each frame (moves with ship).
                const lookGalaxyX = this.targetX;
                const lookGalaxyZ = this.targetZ;
                // SCENE cull is sun-rel (pathEnd / ShipSim); topology focus stays galaxy.
                const lookX = keplerOpen
                    ? this.targetX - this.sceneSunX
                    : this.targetX;
                const lookZ = keplerOpen
                    ? this.targetZ - this.sceneSunZ
                    : this.targetZ;
                const focusId = resolveModelFocusClusterId(lookGalaxyX, lookGalaxyZ, clusterCenters, followLoc);
                const topoCtx = focusId != null
                    ? buildModelTopologyContext(focusId, [
                        ...this.jumpEdgesByKey.values(),
                    ])
                    : null;
                const forceFollow = shouldForceIncludeFollowedFleet(followFleetId != null, true);
                const fleetList = [];
                for (const f of this.fleets.values()) {
                    const n = f.instanceCapacity | 0;
                    if (n <= 0)
                        continue;
                    const isFollowed = followFleetId != null && f.id === followFleetId;
                    // Topology filter; followed fleet always kept when forceFollow.
                    if (topoCtx && !(isFollowed && forceFollow)) {
                        const loc = fleetTopologyLocFromState(f.state);
                        if (!isFleetModelTopologyEligible(loc, topoCtx))
                            continue;
                    }
                    // AND SCENE or follow (bit 7 consult) — icons stay triangles/impostors.
                    if (!this.fleetInSystemScene(f.state, f))
                        continue;
                    const o = f.fleetSlot * FLEET_GPU_STRIDE;
                    // Marker ease pos vs pathEnd (ships orbit pathEnd).
                    const markerX = this.fleetGpuView.getFloat32(o + FleetGpuFields.posX, true);
                    const markerZ = this.fleetGpuView.getFloat32(o + FleetGpuFields.posZ, true);
                    const pathEndX = this.fleetGpuView.getFloat32(o + FleetGpuFields.pathEndX, true);
                    const pathEndZ = this.fleetGpuView.getFloat32(o + FleetGpuFields.pathEndZ, true);
                    // Followed fleet: live ship pose so view cull tracks the chase.
                    let posX;
                    let posZ;
                    if (isFollowed && followPose) {
                        posX = keplerOpen
                            ? followPose.posX - this.sceneSunX
                            : followPose.posX;
                        posZ = keplerOpen
                            ? followPose.posZ - this.sceneSunZ
                            : followPose.posZ;
                    }
                    else {
                        // Prefer pathEnd when closer to look-at so inbound gate hops model.
                        const cull = modelLodFleetCullPos(pathEndX, pathEndZ, markerX, markerZ, lookX, lookZ);
                        posX = cull.x;
                        posZ = cull.z;
                    }
                    fleetList.push({
                        instanceStart: f.instanceStart,
                        shipBudget: n,
                        posX,
                        posZ,
                    });
                }
                modelIndices = selectModelShipIndices(fleetList, {
                    // Live chase look-at — same values as setCameraLookAt this frame.
                    targetX: lookX,
                    targetZ: lookZ,
                    cameraY: cameraDistanceToTarget({ x: this.cameraX, y: this.cameraY, z: this.cameraZ }, { x: lookX, y: this.targetY, z: lookZ }),
                    tanHalfFov,
                    eyeX: this.cameraX,
                    eyeY: this.cameraY,
                    eyeZ: this.cameraZ,
                    viewportH: this.cssHeight,
                    assumeHeightGate: true,
                    ...(sceneModelWorldSize != null
                        ? {
                            worldSize: sceneModelWorldSize,
                            minScreenPx: 8,
                            exitScreenPx: 5,
                            neighborRadius: 2,
                        }
                        : {}),
                }, MODEL_LOD_MAX_INSTANCES, this.modelLodFleetSticky);
            }
            else {
                this.modelLodFleetSticky.clear();
                this.fleetsLayer.setTrailDrawShipIndices(null);
            }
            const modelOn = modelIndices.length > 0;
            this.modelLayer.setActive(modelOn);
            this.fleetsLayer.setModelLodActive(modelOn);
            // Trail width is one production size (no follow-only scale).
            if (modelOn) {
                // Follow force-include: budget/cull must never drop the chased ship from
                // model hide + pot trail expand (fleetmates alone looked "traced").
                if (followIdx != null) {
                    modelIndices = ensureShipIndexInList(modelIndices, followIdx);
                }
                this.fleetsLayer.setModelHideIndices(modelIndices);
                // Model pot trails (mode 2): model-owned set including followed ship.
                this.fleetsLayer.setTrailDrawShipIndices(modelIndices);
                const sim = this.fleetsLayer.getShipSimBuffer();
                if (sim)
                    this.modelLayer.setShipSimBuffer(sim);
                const fleetGpu = this.fleetsLayer.getFleetGpuBuffer?.();
                if (fleetGpu)
                    this.modelLayer.setFleetGpuBuffer(fleetGpu);
                this.modelLayer.setShipIndices(modelIndices);
            }
            else {
                this.fleetsLayer.setModelHideIndices([]);
                this.fleetsLayer.setTrailDrawShipIndices(null);
            }
        });
        try {
            // Readback frames skip the swapchain — COPY_* on the canvas texture
            // destroys SharedImage on this Chromium. MSAA still matches the buffer.
            const texture = this.resolveReadback
                ? null
                : frameDebugTime("getCurrentTexture", () => this.bootstrap.context.getCurrentTexture());
            const colorW = texture?.width ?? this.canvas.width;
            const colorH = texture?.height ?? this.canvas.height;
            // L5 continuous pose: reuse the same nowRel/dt as the follow shadow step.
            const nowRel = nowRelEarly;
            const simDtMs = simDtMsEarly;
            this.prevNowRel = nowRel;
            const fleetHw = this.slotAlloc.fleetHighWater;
            const shipHw = this.instanceLiveCount;
            const fovyRadIntegrate = (this.fovyDeg * Math.PI) / 180;
            const integrateCamera = {
                cameraY: lodCameraY,
                targetX: keplerOpen ? this.targetX - this.sceneSunX : this.targetX,
                targetZ: keplerOpen ? this.targetZ - this.sceneSunZ : this.targetZ,
                viewportH: this.cssHeight,
                tanHalfFov: Math.tan(fovyRadIntegrate * 0.5),
                // Galaxy: eye/ship/pathEnd. SCENE: ships are sun-rel → origin 0.
                originX: keplerOpen ? 0 : this.frameOrigin.x,
                originY: keplerOpen ? 0 : this.frameOrigin.y,
                originZ: keplerOpen ? 0 : this.frameOrigin.z,
            };
            const following = this.followShipIndex != null;
            const integrateOpts = {
                anyScene: this.systemSceneIds.size > 0 || following,
                follow: following,
                systemSceneActive: keplerOpen,
                hideNonSceneDraw: keplerOpen || this.getGalaxyFade() < 1,
            };
            // Follow lockstep: integrate must *finish* on the GPU before we overwrite
            // the tracked ship with the camera shadow. queue.writeBuffer before a single
            // submit(encoder) runs *before* that encoder's compute — so the GPU would
            // step the shadow again and draw 1 frame ahead of the camera. Split submit.
            if (following) {
                const encI = this.bootstrap.device.createCommandEncoder({
                    label: "webgpu-map-integrate",
                });
                frameDebugTime("dispatchIntegrate (encode)", () => this.fleetsLayer.dispatchIntegrate(encI, nowRel, simDtMs, fleetHw, shipHw, integrateCamera, integrateOpts), `fleets=${fleetHw} ships=${shipHw}`);
                frameDebugTime("queue.submit.integrate", () => this.bootstrap.device.queue.submit([encI.finish()]));
                frameDebugTime("tickWarmFleets", () => this.tickWarmFleets());
                // Exact camera pose → ShipSim for draw (matches stepFollow above).
                frameDebugTime("uploadFollowShipShadow", () => this.uploadFollowShipShadowToGpu());
            }
            const encoder = this.bootstrap.device.createCommandEncoder({
                label: "webgpu-map-frame",
            });
            if (!following) {
                frameDebugTime("dispatchIntegrate (encode)", () => this.fleetsLayer.dispatchIntegrate(encoder, nowRel, simDtMs, fleetHw, shipHw, integrateCamera, integrateOpts), `fleets=${fleetHw} ships=${shipHw}`);
                frameDebugTime("tickWarmFleets", () => this.tickWarmFleets());
            }
            const modelN = modelIndices.length;
            const modelOn = modelN > 0;
            // Two-pass map encode (WebGPU validation):
            // 1) Color-only MSAA — Line2 / points / strategic trails / fleets / overlay
            //    (depthFormat:null — cannot share a depth-bearing pass).
            // 2) Depth-bearing pass — opaque models, then model pot trails
            //    (depth test on, write off), then resolve.
            // See vendor/line2 I01 "Galaxy color-only pipeline".
            this.ensureMsaaColor(colorW, colorH);
            if (this.resolveReadback) {
                this.ensureResolveColor(this.msaaW, this.msaaH);
            }
            const resolveView = this.resolveReadback && this.resolveColorView
                ? this.resolveColorView
                : texture.createView();
            const origin = this.frameOrigin;
            const sceneView = this.sceneViewRel;
            const sceneViewProj = this.sceneViewProjRel;
            const sceneOrigin = this.sceneOriginZero;
            const bandC = this.focusedBodyIndex != null &&
                this.focusedBodyIndex >= 0 &&
                this.solarBodies.currentCount > 0 &&
                this.solarBodies.isSun[this.focusedBodyIndex] !== 1;
            // Band B UBOs must land before the pass (no mid-pass writeBuffer).
            this.solarBodyLayer.prepare({
                store: this.solarBodies,
                residency: this.catalogResidency,
                viewProjRel: keplerOpen ? sceneViewProj : this.viewProjRel,
                frameOrigin: keplerOpen ? this.sceneSunOrigin : origin,
                eyeX: this.cameraX,
                eyeY: this.cameraY,
                eyeZ: this.cameraZ,
                cameraRight: this.cameraRight,
                cameraUp: this.cameraUp,
                viewportH: this.canvas.height,
                fovyDeg: this.fovyDeg,
                timeSec: this.toGpuTime(Date.now()) / 1000,
                focusedBodyIndex: this.focusedBodyIndex,
                bandC,
            });
            // Hashed sticky pass-set: fill reused flags, skip unused encode.
            // Rebuild the number when flags change — no PassData / plan object.
            const sceneOpen = this.systemSceneIds.size > 0 || this.solarBodies.systemId != null;
            const keplerEncode = sceneOpen && this.shouldEncodeKeplerScene();
            const nBodies = this.solarBodies.currentCount;
            const hasSun = solarStoreHasSun(this.solarBodies.isSun, nBodies);
            const hasDisc = solarStoreHasDisc(this.solarBodies.isSun, nBodies);
            fillPassSetFlags(this.passSetFlags, keplerEncode && hasDisc, keplerEncode && hasSun, (keplerEncode && hasDisc) || (keplerEncode && bandC), modelOn && modelN > 0, following);
            this.passSetHash = hashPassSet(this.passSetFlags);
            const passColor = encoder.beginRenderPass({
                colorAttachments: [
                    {
                        view: this.msaaColorView,
                        // Keep MSAA samples for pass 2; resolve after models (or alone).
                        clearValue: this.bootstrap.clearColor,
                        loadOp: "clear",
                        storeOp: "store",
                    },
                ],
            });
            // Faded galaxy (if any) → schematics → solar discs. Skip topology while
            // orbiting so galaxy jump-gate f32 jitter does not crawl the SCENE.
            this.lastGalaxyTopologyEncoded = false;
            if (this.galaxyFade >= 1) {
                frameDebugTime("encode.lines", () => this.lines.encode(passColor, this.viewRel, this.proj, origin));
                this.lastGalaxyTopologyEncoded = true;
            }
            if (this.galaxyFade >= GALAXY_FADE_SKIP) {
                frameDebugTime("encode.points", () => this.points.encode(passColor, this.viewProjRel, this.pointWorldScale, this.store.currentCount, this.cameraRight, this.cameraUp, origin, this.galaxyFade));
                frameDebugTime("encode.impostors", () => this.impostorPoints.encode(passColor, this.viewProjRel, this.pointWorldScale, this.impostorStore.currentCount, this.cameraRight, this.cameraUp, origin, this.galaxyFade));
            }
            frameDebugTime("encode.schematics", () => this.encodeSceneSchematicsViewRel(passColor, keplerOpen ? this.sceneSunOrigin : origin));
            // Band B: compact Kepler after 5px hide is visible. Color-only (no frag_depth).
            // Skip unused: do not record encode.solarBodies when discs+sun are off.
            if (this.passSetFlags.discs || this.passSetFlags.sun) {
                frameDebugTime("encode.solarBodies", () => this.solarBodyLayer.encode(passColor));
            }
            else {
                this.solarBodyLayer.clearLastDrawCount();
            }
            // Strategic trails only in the color-only pass (no depth). Galaxy map
            // is icons — skip when Kepler is not loaded. When model LOD owns ships,
            // pot trails draw after models in the depth pass instead.
            if (keplerOpen && !(modelOn && modelN > 0)) {
                frameDebugTime("encode.trails", () => this.fleetsLayer.encodeTrails(passColor, sceneView, this.proj, this.canvas.width, this.canvas.height, lodCameraY, sceneOrigin, { sceneTrailScale: true }));
            }
            // W4: cameraY / viewportH / tanHalfFov + floating origin for ship VS.
            frameDebugTime("encode.fleets", () => this.fleetsLayer.encode(passColor, keplerOpen ? sceneViewProj : this.viewProjRel, 0.95, {
                cameraY: cameraDistanceToTarget({ x: this.cameraX, y: this.cameraY, z: this.cameraZ }, { x: this.targetX, y: this.targetY, z: this.targetZ }),
                viewportH: this.cssHeight,
                tanHalfFov,
                originX: keplerOpen ? sceneOrigin.x : origin.x,
                originY: keplerOpen ? sceneOrigin.y : origin.y,
                originZ: keplerOpen ? sceneOrigin.z : origin.z,
            }));
            // M4: translucent plane fills under fat Line2 rings/axes.
            // Resolution every frame so select/hover rings keep correct screen width
            // after resize / DPR changes (Line2 needs CSS/drawing buffer size).
            frameDebugTime("encode.overlay", () => {
                this.overlay.encode(passColor, this.viewProj);
                this.overlayLines.setResolution(this.canvas.width, this.canvas.height);
                if (this.lastOverlayWorld && this.lastOverlayWorld.segmentCount > 0) {
                    const shifted = shiftLine2PackByOrigin(this.lastOverlayWorld, origin.x, origin.y, origin.z, this.overlayRelScratch ?? undefined);
                    this.overlayRelScratch = shifted;
                    this.overlayLines.setPositions(shifted.positions);
                    this.overlayLines.setColors(shifted.colors);
                }
                this.overlayLines.writeViewProjection(this.viewRel, this.proj);
                this.overlayLines.encode(passColor);
            });
            passColor.end();
            // Pass 2: depth when models OR Band C; resolve MSAA → swapchain
            // (or owned COPY_SRC target when {@link enableColorReadback}).
            const wantDepth = (modelOn && modelN > 0) || bandC;
            this.lastPassResolveHadDepth = !!(wantDepth && this.msaaDepthView);
            const passResolve = encoder.beginRenderPass({
                colorAttachments: [
                    {
                        view: this.msaaColorView,
                        resolveTarget: resolveView,
                        loadOp: "load",
                        storeOp: "discard",
                    },
                ],
                depthStencilAttachment: wantDepth && this.msaaDepthView
                    ? {
                        view: this.msaaDepthView,
                        depthClearValue: 1,
                        depthLoadOp: "clear",
                        depthStoreOp: "discard",
                    }
                    : undefined,
            });
            if (bandC && this.msaaDepthView && this.passSetFlags.atm) {
                frameDebugTime("encode.bandC", () => this.solarBodyLayer.encodeDepth(passResolve));
            }
            if (keplerOpen && modelOn && modelN > 0) {
                // eyeWorld = true camera (rim only). Key light is fleet pathEnd in VS.
                // Follow floating origin may be the ship — do not use origin as light.
                if (this.passSetFlags.models) {
                    frameDebugTime("encode.models", () => this.modelLayer.encode(passResolve, sceneViewProj, modelIndices, sceneOrigin, {
                        x: this.cameraX - this.sceneSunX,
                        y: this.cameraY,
                        z: this.cameraZ - this.sceneSunZ,
                    }, 
                    // Aft thruster pulse — same wall clock as trail glow feel.
                    this.toGpuTime(Date.now()) / 1000));
                }
                // Model pot trails after opaque hull. Depth write off; compare less-equal
                // so nearer hulls occlude far thruster ribbons (not always-on-top).
                frameDebugTime("encode.modelTrails", () => this.fleetsLayer.encodeTrails(passResolve, sceneView, this.proj, this.canvas.width, this.canvas.height, lodCameraY, sceneOrigin, { depthAware: true, sceneTrailScale: true }));
            }
            passResolve.end();
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
        this.solarBodyLayer.dispose();
        this.orbitRings?.dispose();
        this.orbitRings = null;
        this.sceneGrid?.dispose();
        this.sceneGrid = null;
        this.sceneJumpRays?.dispose();
        this.sceneJumpRays = null;
        this.catalogResidency.dispose();
        this.lines.dispose();
        this.modelLayer.dispose();
        this.fleetsLayer.dispose();
        this.overlayLines.dispose();
        this.overlay.dispose();
        this.msaaColor?.destroy();
        this.msaaColor = null;
        this.msaaColorView = null;
        this.resolveColor?.destroy();
        this.resolveColor = null;
        this.resolveColorView = null;
        this.msaaDepth?.destroy();
        this.msaaDepth = null;
        this.msaaDepthView = null;
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