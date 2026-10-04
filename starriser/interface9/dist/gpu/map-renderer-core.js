import { FollowJourney } from './map/fleets/follow-journey.js';
import { FollowEvents } from './map/fleets/follow-events.js';
import { renderBudget, compactRenderBudget } from './render-budget.js';
import { withGpuResourceDiagnostics } from './runtime-errors.js';
import { FLEET_RELATIONSHIPS, RELATIONSHIP_COLORS } from "../contracts/fleet-relationship.js";
import { GalaxySurveyLayer } from './map/survey/survey-layer.js';
import { createPyramidShipMesh } from '../lib/fleet-sim/visual/lowpoly-ship-mesh.js';
import { refreshSceneVisualAllocation } from "./map/fleets/scene-visual-allocation.js";
import { SHIP_MODEL_CATALOG_URL, parseShipModelCatalog } from '../lib/fleet-sim/visual/ship-model-catalog.js';
import { assetUrl } from "./asset-url.js";
import { measureIsolatedFrame } from "./map/frame-measurement.js";
import { createMapFrameState } from "./map/frame-state.js";
import { createMapFrameEncoder } from "./map/frame-encoder.js";
import { createFleetFrameEncoding } from "./map/fleets/frame-encoding.js";
import { createDirectedSceneHost, MAX_SCENE_FLEETS, SCENE_KERNEL_COUNT, MAX_GROUP_VISUAL } from "./map/fleets/directed-scene-host.js";
import { sceneShipCapacity } from '../lib/ship-runtime/ship-capacity.mjs';
import { shipStorageSizes } from '../lib/ship-runtime/ship-storage.mjs';
import { warpViewSample } from './warp-motion.js';
const HIGH_FX_BIND_BYTES = Math.max(...Object.values(shipStorageSizes(sceneShipCapacity(true))));
import { projectFleetMarker } from './map/fleets/fleet-marker.js';
import { SCENE_SHIP_HANDLE_BASE } from "./map/fleets/scene-ship-access.js";
import { countShips } from "./fleet-lod.js";
import { compactOrbitPad, sceneModelScale, SCENE_HULL_SIZE, SCENE_MODEL_SIZE_MUL } from "./map/fleets/directed-present.wgsl.js";
import { ObservedMotion, OBSERVATION_PREDICT_SECONDS } from './observed-motion.js';
import { mixShipAttitude } from './ship-chase-camera.js';
import { pickSceneParkBodyIndex } from "./solar-system-lod.js";
import { compactBodySunLocal } from "./system-scene/frame.js";
import { keplerBodiesForStore } from "./compact-ephemeris.js";
import { FLEET_GPU_STRIDE, FleetGpuFields, FLEET_FLAG_ALIVE, FLEET_FLAG_SYSTEM_SCENE, FLEET_FLAG_SIM_PAUSED, FLEET_FLAG_MODEL_LOW, FLEET_FLAG_MODEL_HIGH } from "./fleet-layout.js";
import { createGalaxyEncoding } from "./map/galaxy-encoding.js";
import { createSolarScenePresentation } from "./map/solar-scene-presentation.js";
import { createFrameGpuProfiler } from "./gpu-frame-profiler.js";
import { FrameAttachments } from "./map/frame-attachments.js";
import { MapOverlayPresentation } from "./map/overlay-presentation.js";
import { SceneSchematics } from "./map/scene-schematics.js";
import { FleetModelPresentation } from "./map/fleets/model-presentation.js";
import { FleetPresentation, MAX_FLEET_SLOTS } from "./map/fleets/fleet-presentation.js";
import { createRemoteFleetSlots } from './map/fleets/remote-presentation.js';
/** Composition root for the shared galaxy/solar renderer. Motion, presentation,
 * frame coordinates and resource lifetime have dedicated owners under map/.
 * Keep GPU poses authoritative across population changes and follow reframes;
 * see map/README.md for the frame and module contracts. */
import { MapFrameCoordinates } from "./map/frame-coordinates.js";
import { FrameTimeline } from "./map/frame-clock.js";
import { MapTopologyPresentation } from "./map/topology-presentation.js";
import { createWebGpuBootstrap } from "./device.js";
import { SolarPointGpuLayer } from "./layers/solar-point-gpu-layer.js";
import { SolarBodyGpuLayer } from "./layers/solar-body-gpu-layer.js";
import { SolarCatalogResidency } from "./solar-catalog-residency.js";
import { ConnectionLineGpuLayer } from "./layers/connection-line-gpu-layer.js";
import { FleetInstanceGpuLayer } from "./layers/fleet-instance-gpu-layer.js";
import { FleetModelGpuLayer } from "./layers/fleet-model-gpu-layer.js";
import { MapOverlayGpuLayer } from "./layers/map-overlay-gpu-layer.js";
import { MAP_MSAA_SAMPLES, MAP_BODY_SAMPLES, MAP_HALF_GLOW, MAP_HULL_MSAA, MAP_HIGH_HULL_SAMPLES } from "./map-msaa.js";
import { MAP_REVERSE_DEPTH } from "./map-depth.js";
import { Line2Renderer } from "../vendor/line2/index.js";
import { MODEL_LOD_DEFAULT_SCALE, MODEL_LOD_MAX_INSTANCES } from "./fleet-lod.js";
import { MAP_NEAR, SCENE_FAR, SCENE_NEAR } from "./camera-zoom.js";
import { mat4LookAt, mat4ViewProj } from "./math/mat4.js";
import { frameDebugBegin, frameDebugFrameTotal, frameDebugTime, frameDebugCount } from "./frame-debug.js";
import { rebuildWebGpuConnectionsFromGalaxy } from "../render/topology-view-bridge.js";
/** Screen-space overlay stroke width (buffer pixels; Line2 `worldUnits=false`). */
const OVERLAY_LINEWIDTH_PX = 2;
/** Skip Kepler discs/schematics while orbit exit is almost done (fade < 1). */
const KEPLER_ENCODE_FADE_MAX = 0.88;
export class WebGpuMapView {
    constructor(canvas, bootstrap, fovyDeg, skipShipModel = false, clock) {
        this.surfaceCleanup = null;
        this.pixelRatio = 1;
        /** Band C focused compact-body slot (null = none). */
        this.focusedBodyIndex = null;
        /** Last color-pass: topology Line2 was encoded (galaxyFade ≥ 1). */
        /** 1 = full galaxy; 0 = orbiting SCENE (topology replaced by local rays). */
        this.galaxyFade = 1;
        /**
         * Year-1 hashed sticky pass-set. One reused flags object + a number.
         * Skip unused encode; do not allocate PassData / a plan per rAF.
         */
        this.frameState = createMapFrameState();
        this.directed = null;
        this.followJourney = null;
        this.sceneFollowHandle = null;
        this.followEvents = new FollowEvents();
        this.cameraUpHint = { x: 0, y: 1, z: 0 };
        this.shipCameraMotion = new ObservedMotion();
        // Fleet readback can span several frames under load. Match its 200 ms
        // velocity-observation window instead of repeatedly stopping at 67 ms.
        this.fleetCameraMotion = new ObservedMotion(.2);
        this.trackedFleet = null;
        this.sceneSlots = new Map();
        this.sceneSlotLive = new Uint8Array(MAX_SCENE_FLEETS);
        this.sceneSlotSeen = new Uint8Array(MAX_SCENE_FLEETS);
        this.sceneCollectCached = null;
        this.liveGpuProfiler = null;
        this.gpuSamplePending = false;
        this.framesSinceGpuSample = 0;
        this.selectedFleetId = null;
        this.occupancyKey = "";
        this.lastOccupancy = null;
        this.sceneFleetMetadata = new Array(MAX_SCENE_FLEETS);
        this.sceneBodyParks = [];
        this.sceneHideQueue = [];
        this.statsPanels = [];
        this.coordinates = new MapFrameCoordinates(MAP_REVERSE_DEPTH);
        this.proj = this.coordinates.projection;
        this.view = this.coordinates.absoluteView;
        this.viewProj = this.coordinates.absoluteViewProj;
        this.frameOrigin = this.coordinates.galaxy.origin;
        this.sceneSunX = 0;
        this.sceneSunZ = 0;
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
        this.pendingResize = null;
        /** Projection clip planes — single source for resize + pick. */
        /** Near clip — below compact-planet boom at SPAN=0.1 (not MIN_ZOOM). */
        this.near = MAP_NEAR;
        this.far = 1e10;
        this.raf = 0;
        this.disposed = false;
        this.directedErrorReported = false;
        this.modelRequests = new Map();
        /**
         * Optional pre-lookAt tick (camera damp). App wires controller.update.
         * Receives clamped dt in ms.
         */
        this.beforeFrame = null;
        this.afterFrame = null;
        this.loopRunning = false;
        /** Last renderFrame wall time (ms) — independent of display vsync. */
        this.lastFrameCpuMs = 0;
        /** Last timestamp sum across real compute/render passes; zero until sampled. */
        this.lastFrameGpuMs = 0;
        this.frameCpuSampleSum = 0;
        this.frameCpuSampleCount = 0;
        this.frameGpuSampleSum = 0;
        this.frameGpuSampleCount = 0;
        this.lastFrameEndToEndMs = 0;
        this.measurementPorts = {
            isRunning: () => this.loopRunning, isUnavailable: () => this.isDeviceLost(),
            stop: () => this.stopLoop(), start: () => this.startRenderLoop(),
            drain: async () => { await this.bootstrap.device.queue.onSubmittedWorkDone?.(); },
            now: () => performance.now(), createProfiler: () => createFrameGpuProfiler(this.bootstrap.device),
            render: (profiler, options) => this.renderMeasuredCpu(profiler, true, options),
        };
        this.qualityEpoch = 0;
        this.canvas = canvas;
        this.bootstrap = bootstrap;
        this.fovyDeg = fovyDeg;
        this.timeline = new FrameTimeline(clock);
        this.attachments = new FrameAttachments(bootstrap, canvas, () => this.disposed || bootstrap.isLost, MAP_REVERSE_DEPTH);
        this.points = new SolarPointGpuLayer(bootstrap);
        this.impostorPoints = new SolarPointGpuLayer(bootstrap);
        this.solarBodyLayer = new SolarBodyGpuLayer(bootstrap, { reverseDepth: MAP_REVERSE_DEPTH });
        this.catalogResidency = new SolarCatalogResidency(bootstrap.device);
        this.topology = new MapTopologyPresentation(this.catalogResidency, (ids) => this.setSystemScene(ids));
        this.store = this.topology.store;
        this.impostorStore = this.topology.impostorStore;
        this.solarBodies = this.topology.solarBodies;
        this.lineStore = this.topology.lineStore;
        this.lines = new ConnectionLineGpuLayer(bootstrap);
        this.fleetsLayer = new FleetInstanceGpuLayer(bootstrap, { reverseDepth: MAP_REVERSE_DEPTH });
        this.fleetPresentation = new FleetPresentation(this.fleetsLayer, () => this.disposed || bootstrap.isLost, this.solarBodies, this.timeline, true);
        this.modelLayer = new FleetModelGpuLayer(bootstrap, {
            reverseDepth: MAP_REVERSE_DEPTH,
            maxInstances: Math.min(MODEL_LOD_MAX_INSTANCES, renderBudget().ships),
            modelScale: MODEL_LOD_DEFAULT_SCALE,
            meshYawHalf: 0, // low-poly +Z forward
        });
        this.modelLowLayer = new FleetModelGpuLayer(bootstrap, {
            reverseDepth: MAP_REVERSE_DEPTH,
            maxInstances: Math.min(MODEL_LOD_MAX_INSTANCES, renderBudget().ships),
            modelScale: MODEL_LOD_DEFAULT_SCALE,
            meshYawHalf: 0,
        });
        this.modelTinyLayer = new FleetModelGpuLayer(bootstrap, {
            reverseDepth: MAP_REVERSE_DEPTH, maxInstances: Math.min(MODEL_LOD_MAX_INSTANCES, renderBudget().ships),
            modelScale: MODEL_LOD_DEFAULT_SCALE, meshYawHalf: 0,
        });
        this.modelPresentation = new FleetModelPresentation({
            ships: this.fleetsLayer, models: this.modelLayer, modelsLow: this.modelLowLayer, modelsTiny: this.modelTinyLayer,
        });
        this.overlay = new MapOverlayGpuLayer(bootstrap);
        // MSAA supplies geometric coverage; blend faint opacity once.
        const msaa = { sampleCount: MAP_MSAA_SAMPLES };
        this.overlayLines = new Line2Renderer(bootstrap.device, {
            format: bootstrap.format,
            sampleCount: MAP_MSAA_SAMPLES,
            alphaToCoverage: false,
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
        this.overlayPresentation = new MapOverlayPresentation(this.overlay, this.overlayLines, () => this.getViewProj(), () => this.hideGalaxySelectionRings(), MAP_REVERSE_DEPTH);
        this.schematics = new SceneSchematics(bootstrap, canvas, this.topology, this.coordinates, () => this.shouldEncodeKeplerScene());
        this.survey = new GalaxySurveyLayer(bootstrap, this.topology, this.coordinates, this.fleetPresentation.scene.surveyTotals, canvas);
        this.galaxyEncoding = createGalaxyEncoding(this.topology, this.lines, this.points, this.coordinates, this.survey);
        this.solarPresentation = createSolarScenePresentation(this.solarBodyLayer, this.solarBodies, this.catalogResidency, this.coordinates);
        this.frameEncoder = createMapFrameEncoder({
            bootstrap, surface: canvas, coordinates: this.coordinates, attachments: this.attachments,
            galaxy: this.galaxyEncoding, solar: this.solarPresentation,
            fleets: createFleetFrameEncoding(this.fleetsLayer, this.modelLayer, this.coordinates, canvas, {
                encodeFollowCamera: (...args) => this.directed?.encodeFollowCamera(...args),
                setPresentationCamera: (...args) => this.directed?.setPresentationCamera?.(...args),
                encodeTick: (encoder, timeSec, dtSec, sceneOpen, nowMs) => {
                    this.directed?.encodeTick(encoder, timeSec, dtSec, sceneOpen, nowMs);
                },
                encodeDensity: (pass, viewProj, focusedBodyIndex) => {
                    this.directed?.encodeDensity?.(pass, viewProj, focusedBodyIndex);
                },
                encodeRepulsion: (pass, viewProj, view) => {
                    this.directed?.encodeRepulsion?.(pass, viewProj, view);
                },
                encodeFleetAltitude: (pass, viewProj, width, height) => {
                    this.directed?.encodeFleetAltitude?.(pass, viewProj, width, height);
                },
            }, this.modelLowLayer, this.modelTinyLayer),
            schematics: this.schematics, overlay: this.overlayPresentation,
            tickWarmFleets: () => this.fleetPresentation.tickWarmFleets(),
            encodeDirectedMaintenance: (encoder) => this.directed?.encodeMaintenance?.(encoder),
            commitDirectedTick: () => { this.directed?.commitTick(); },
        });
        this.points.init({ sampleCount: MAP_BODY_SAMPLES });
        this.impostorPoints.init({ sampleCount: MAP_BODY_SAMPLES });
        this.solarBodyLayer.init(msaa);
        this.lines.init(msaa);
        this.fleetsLayer.init(msaa);
        this.fleetsLayer.configureScenePool(MAX_FLEET_SLOTS, renderBudget().ships);
        this.modelLayer.init({ sampleCount: MAP_HIGH_HULL_SAMPLES });
        this.modelLowLayer.init(msaa);
        this.modelTinyLayer.init(msaa);
        this.modelTinyLayer.loadMeshSync(createPyramidShipMesh(), { meshYawHalf: 0, originRadius: 1 });
        this.overlay.init(msaa);
        try {
            this.liveGpuProfiler = createFrameGpuProfiler(bootstrap.device);
        }
        catch {
            this.liveGpuProfiler = null; /* Rendering does not depend on diagnostics. */
        }
        // Best-effort ship model for near LOD (no-op if asset missing).
        // Tests that MAP_READ on this device skip the fetch — concurrent glTF
        // upload + mapAsync destroys the device on this Chromium.
        if (!skipShipModel) {
            void this.loadShipModels().catch(() => {
                /* optional asset — triangle LOD remains the fallback */
            });
        }
    }
    /**
     * Load a glTF/GLB ship mesh for the model LOD band.
     * Safe to call multiple times; the latest request owns publication.
     */
    async loadShipModel(url) {
        await this.loadGlbInto(this.modelLayer, url);
    }
    async loadShipModels() {
        this.assertModelLoadAvailable();
        const catalog = fetch(assetUrl(SHIP_MODEL_CATALOG_URL)).then(async (response) => {
            if (!response.ok)
                throw new Error(`Ship catalog HTTP ${response.status}`);
            return parseShipModelCatalog(await response.json());
        });
        await Promise.all([
            this.loadCatalogLod(this.modelLayer, catalog, 'high'),
            this.loadCatalogLod(this.modelLowLayer, catalog, 'low'),
        ]);
    }
    async loadCatalogLod(layer, pending, lod) {
        const request = (this.modelRequests.get(layer) ?? 0) + 1;
        this.modelRequests.set(layer, request);
        const catalog = await pending;
        this.assertModelLoadAvailable();
        const directory = SHIP_MODEL_CATALOG_URL.slice(0, SHIP_MODEL_CATALOG_URL.lastIndexOf('/') + 1);
        const buffers = await Promise.all(catalog.ships.map(async (ship) => {
            const response = await fetch(assetUrl(directory + ship[lod]));
            if (!response.ok)
                throw new Error(`Ship mesh ${ship[lod]} HTTP ${response.status}`);
            return response.arrayBuffer();
        }));
        if (this.modelRequests.get(layer) !== request)
            return;
        this.assertModelLoadAvailable();
        await layer.loadCatalog(buffers, catalog.originRadius);
        if (this.modelRequests.get(layer) !== request)
            return;
        this.assertModelLoadAvailable();
        this.bindLoadedModel(layer);
    }
    bindLoadedModel(layer) {
        layer.setModelScale(sceneModelScale(layer.getMeshOriginRadius()));
        const sim = this.fleetsLayer.getShipSimBuffer();
        if (sim)
            layer.setShipSimBuffer(sim);
        const fleets = this.fleetsLayer.getFleetGpuBuffer();
        if (fleets)
            layer.setFleetGpuBuffer(fleets);
    }
    async loadGlbInto(layer, url) {
        this.assertModelLoadAvailable();
        const request = (this.modelRequests.get(layer) ?? 0) + 1;
        this.modelRequests.set(layer, request);
        const res = await fetch(assetUrl(url));
        if (this.modelRequests.get(layer) !== request)
            return;
        this.assertModelLoadAvailable();
        if (!res.ok) {
            throw new Error(`loadShipModel: ${url} → HTTP ${res.status}`);
        }
        const buf = await res.arrayBuffer();
        if (this.modelRequests.get(layer) !== request)
            return;
        this.assertModelLoadAvailable();
        await layer.loadGlb(buf);
        if (this.modelRequests.get(layer) !== request)
            return;
        this.assertModelLoadAvailable();
        layer.setModelScale(sceneModelScale(layer.getMeshOriginRadius()));
        const sim = this.fleetsLayer.getShipSimBuffer();
        if (sim)
            layer.setShipSimBuffer(sim);
        const fleetGpu = this.fleetsLayer.getFleetGpuBuffer?.();
        if (fleetGpu)
            layer.setFleetGpuBuffer(fleetGpu);
    }
    assertModelLoadAvailable() {
        if (this.isDeviceLost())
            throw new Error("Model loading is unavailable: renderer disposed or lost");
    }
    /** DOM-free surface owner, shared by the render worker and component fixtures. */
    static async createForSurface(canvas, options) {
        let view = null;
        const bootstrap = await createWebGpuBootstrap({
            canvas, pixelRatio: options.dpr, label: "galaxy-webgpu-map",
            onGpuError: options.onGpuError,
            onDeviceLost: (info) => {
                view?.stopLoop();
                options.onDeviceLost?.(info);
            },
        });
        try {
            view = withGpuResourceDiagnostics(bootstrap.device, "Map startup resources", () => new WebGpuMapView(canvas, bootstrap, options.fovyDeg ?? 60, options.skipShipModel === true, options.clock));
            view.surfaceCleanup = options.onDispose ?? null;
            view.onRenderError = options.onRenderError;
            view.directed = createDirectedSceneHost(null, { instanceBase: MAX_FLEET_SLOTS, reverseDepth: MAP_REVERSE_DEPTH, capacity: renderBudget().ships, maxCapacity: renderBudget().maxShips, fleetCount: renderBudget().fleets, onPreparation: options.onPreparation, visualFormation: options.visualFormation });
            const directed = view.directed;
            // Compile once per renderer/device while domain data and assets arrive.
            // Do not hold the galaxy map's first frame behind ship preparation.
            void directed.ensure(bootstrap.device, bootstrap.format).catch(error => {
                if (view && !view.disposed) {
                    view.directedErrorReported = true;
                    view.onRenderError?.(error);
                }
            });
            view.fleetPresentation.sceneCenterProvider = (id) => directed.fleetCenter(id);
            view.fleetsLayer.setShipWorkgroupsSource(() => view.directed?.lastShipWorkgroups() ?? 0);
            view.resize(options.width, options.height, options.dpr);
            return view;
        }
        catch (error) {
            bootstrap.destroy();
            throw error;
        }
    }
    /** Start the map rAF loop (idempotent). Prefer after workers are online. */
    startRenderLoop() {
        if (this.disposed || this.bootstrap.isLost)
            return;
        if (this.raf)
            return;
        this.loopRunning = true;
        this.startLoop();
    }
    isDeviceLost() {
        return this.disposed || this.bootstrap.isLost;
    }
    getCameraState() {
        return {
            upX: this.cameraUpHint.x, upY: this.cameraUpHint.y, upZ: this.cameraUpHint.z,
            eyeX: this.cameraX,
            eyeY: this.cameraY,
            eyeZ: this.cameraZ,
            targetX: this.targetX,
            targetY: this.targetY,
            targetZ: this.targetZ,
            fovyDeg: this.fovyDeg,
            near: this.solarBodies.systemId != null ? SCENE_NEAR : this.near,
            far: this.solarBodies.systemId != null ? SCENE_FAR : this.far,
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
    resize(width, height, pixelRatio = this.pixelRatio) {
        if (this.bootstrap.isLost)
            return;
        this.pendingResize = {
            width: Math.max(1, width),
            height: Math.max(1, height),
            pixelRatio,
        };
        if (!this.loopRunning)
            this.applyPendingResize();
    }
    /** Apply the last queued viewport at the start of a frame, never mid-encode. */
    applyPendingResize() {
        const next = this.pendingResize;
        if (!next || this.bootstrap.isLost)
            return;
        this.pendingResize = null;
        const width = next.width;
        const height = next.height;
        const pixelRatio = next.pixelRatio;
        const bufW = Math.max(1, Math.floor(width * pixelRatio));
        const bufH = Math.max(1, Math.floor(height * pixelRatio));
        if (this.cssWidth === width &&
            this.cssHeight === height &&
            this.pixelRatio === pixelRatio &&
            this.canvas.width === bufW &&
            this.canvas.height === bufH) {
            return;
        }
        this.cssWidth = width;
        this.cssHeight = height;
        this.pixelRatio = pixelRatio;
        this.bootstrap.configureContext(this.cssWidth, this.cssHeight, pixelRatio);
        const aspect = this.cssWidth / this.cssHeight;
        this.coordinates.setPerspectives((this.fovyDeg * Math.PI) / 180, aspect, this.near, this.far, SCENE_NEAR, SCENE_FAR);
        const w = this.canvas.width;
        const h = this.canvas.height;
        this.overlayLines.setResolution(w, h);
        this.lines.setResolution(w, h);
        this.schematics.orbitRings?.setResolution(w, h);
        this.schematics.sceneGrid?.setResolution(w, h);
        this.schematics.sceneJumpRays?.setResolution(w, h);
        this.attachments.ensureMsaaColor(w, h);
    }
    setCameraLookAt(eyeX, eyeY, eyeZ, targetX, targetZ, targetY = 0, upX = 0, upY = 1, upZ = 0) {
        this.cameraUpHint.x = upX;
        this.cameraUpHint.y = upY;
        this.cameraUpHint.z = upZ;
        this.cameraX = eyeX;
        this.cameraY = eyeY;
        this.cameraZ = eyeZ;
        this.targetX = targetX;
        this.targetY = targetY;
        this.targetZ = targetZ;
    }
    setSystemScene(ids) { return this.fleetPresentation.scene.setSystemScene(ids); }
    getSystemSceneIds() { return this.fleetPresentation.scene.getSystemSceneIds(); }
    readFleetGpuSlot(id) { return this.fleetPresentation.readFleetGpuSlot(id); }
    isFollowedFleetInSystemScene() { return this.fleetPresentation.scene.isFollowedFleetInSystemScene(); }
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
        return this.topology.lastSceneSpanPx;
    }
    getSceneHysteresis() {
        return {
            sceneId: this.topology.sceneHysteresis.sceneId,
            holdStartMs: this.topology.sceneHysteresis.holdStartMs,
        };
    }
    /** Wall-relative seconds used for Kepler phase (same clock as disc encode). */
    getSceneTimeSec() {
        return this.timeline.seconds;
    }
    /** Simulation clock (epoch + elapsed). Pause holds it; the same sample feeds FleetGpu `toGpuMs`. */
    getSceneWallMs() {
        return this.timeline.wallMs;
    }
    getViewProj() {
        mat4LookAt(this.view, this.cameraX, this.cameraY, this.cameraZ, this.targetX, this.targetY, this.targetZ, this.cameraUpHint.x, this.cameraUpHint.y, this.cameraUpHint.z);
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
        const rec = this.topology.sceneSystems.get(id);
        if (!rec)
            return null;
        return { clusterId: rec.clusterId, solarSystemId: id };
    }
    getLastBandCDrawCount() {
        return this.solarBodyLayer.getLastBandCDrawCount();
    }
    /** Last consulted Year-1 pass-set hash (`{discs,sun,atm,models,integrate-split}`). */
    getLastPassSetHash() {
        return this.solarPresentation.getHash();
    }
    /**
     * Last Band-C FOCUS atmosphere. Live map is RecurseDraw `"oneil"`
     * (color `fs_main`; depth `fs_band_c`). `"hillaire"` is lab LUT apply only.
     */
    getLastFocusAtmMode() {
        return this.solarBodyLayer.getLastFocusAtmMode();
    }
    /**
     * Compatibility hook for older fixtures. Production uses shared O’Neil
     * scattering and does not allocate or compile experimental LUT resources.
     */
    pumpLutBake() {
        this.solarBodyLayer.pumpLutBake();
    }
    wasPassResolveDepthAttached() {
        return this.frameEncoder.lastResolveHadDepth();
    }
    getLastOrbitRingSegments() {
        return this.schematics.lastOrbitRingSegments;
    }
    getLastJumpRaySegments() {
        return this.schematics.lastJumpRaySegments;
    }
    /** True when the last color pass encoded topology Line2 (galaxyFade ≥ 1). */
    getLastGalaxyTopologyEncoded() {
        return this.galaxyEncoding.wasTopologyEncoded();
    }
    /**
     * Galaxy topology/point opacity. App copies {@link WebGpuCameraController.getGalaxyFade}
     * each beforeFrame. 1 = map; 0 = Kepler orbit.
     */
    setGalaxyFade(f) {
        const v = Number(f);
        const next = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
        const prevHide = this.hideGalaxySelectionRings();
        this.schematics.galaxyFade = this.galaxyFade = next;
        if (this.hideGalaxySelectionRings() !== prevHide)
            this.overlayPresentation.overlayDirty = true;
    }
    getGalaxyFade() {
        return this.galaxyFade;
    }
    /** True when the last overlay pack included hover/select rings. */
    getLastPackedGalaxyRings() {
        return this.overlayPresentation.lastPackedGalaxyRings;
    }
    /**
     * Orbit-exit complete: drop hysteresis, empty the compact Kepler SCENE, and
     * restore the look-at system's 5px immediately (do not wait SCENE_HOLD_MS).
     */
    dismissCompactScene() {
        this.topology.dismissCompactScene();
        this.schematics.clear();
        this.solarBodyLayer.clearLastDrawCount();
        this.overlayPresentation.overlayDirty = true;
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
     * Run once per rAF before look-at / LOD / draw (e.g. damped camera update).
     * Pass null to clear.
     */
    enableColorReadback() { return this.attachments.enableColorReadback(); }
    disableColorReadback() { return this.attachments.disableColorReadback(); }
    async readbackColorOnce() { return this.attachments.readbackColorOnce(); }
    setOverlayLine2(pack) { return this.overlayPresentation.setOverlayLine2(pack); }
    setOverlayFills(data, vertexCount) { return this.overlayPresentation.setOverlayFills(data, vertexCount); }
    clearOverlay() { return this.overlayPresentation.clearOverlay(); }
    showEditHandles(clusterId, handles, radius) { return this.overlayPresentation.showEditHandles(clusterId, handles, radius); }
    hideEditHandles() { return this.overlayPresentation.hideEditHandles(); }
    updateEditOverlayPosition(clusterId, pos) { return this.overlayPresentation.updateEditOverlayPosition(clusterId, pos); }
    setHoverRing(ring) { return this.overlayPresentation.setHoverRing(ring); }
    setSelectRing(ring) { return this.overlayPresentation.setSelectRing(ring); }
    hasEditHandles() { return this.overlayPresentation.hasEditHandles(); }
    getEditHandleHit(ndcX, ndcY) { return this.overlayPresentation.getEditHandleHit(ndcX, ndcY); }
    setAfterFrame(fn) {
        this.afterFrame = fn;
    }
    setBeforeFrame(fn) {
        this.beforeFrame = fn;
    }
    setFleetPositionProvider(lookup) { return this.fleetPresentation.setFleetPositionProvider(lookup); }
    addSolarSystem(cluster, solarSystem) {
        this.topology.addSolarSystem(cluster, solarSystem);
    }
    removeSolarSystem(cluster, solarSystem) {
        this.topology.removeSolarSystem(cluster, solarSystem);
    }
    updateSolarSystemPositions(systems) {
        this.topology.updateSolarSystemPositions(systems);
    }
    addConnection(key, a, b, color = 0x00ffff) {
        this.topology.addConnection(key, a, b, color);
    }
    updateConnectionEndpoints(key, a, b) {
        return this.topology.updateConnectionEndpoints(key, a, b);
    }
    removeConnection(key) {
        this.topology.removeConnection(key);
    }
    markClusterConnectionsDirty(clusterId) {
        this.topology.markClusterConnectionsDirty(clusterId);
    }
    setConnectionColor(key, color) {
        this.topology.setConnectionColor(key, color);
    }
    setConnectionColors(map) {
        this.topology.setConnectionColors(map);
    }
    finalizeFromGalaxy(galaxy) {
        this.topology.finalizeFromGalaxy(galaxy);
    }
    finalizeBuffers(galaxy) {
        this.finalizeFromGalaxy(galaxy);
        rebuildWebGpuConnectionsFromGalaxy(this, galaxy);
        this.topology.linesDirty = true;
    }
    clearPoints() {
        this.topology.clearPoints();
    }
    clearLines() {
        this.topology.clearLines();
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
        this.overlayPresentation.overlayDirty = false;
    }
    setStatsPanels(panels) {
        this.statsPanels = panels ?? [];
    }
    setBulkShipBudgetHint(n) { return this.fleetPresentation.setBulkShipBudgetHint(n); }
    getBulkShipBudgetHint() { return this.fleetPresentation.getBulkShipBudgetHint(); }
    pickRandomShipPose() {
        if (this.solarBodies.systemId == null)
            return this.fleetPresentation.follow.pickRandomShipPose();
        const fleets = this.collectSceneFleets();
        if (!fleets.length)
            return null;
        const fleet = fleets[Math.floor(Math.random() * fleets.length)];
        const handle = this.getSceneShipHandle(fleet.id ?? "", Math.floor(Math.random() * fleet.shipCount));
        return handle == null ? null : this.getLiveShipPose(handle);
    }
    /** One small GPU update; logical identity survives physical moves. */
    setSceneShipDetail(handle, detail) {
        return this.directed?.setShipDetail(handle, detail) ?? false;
    }
    /** Stable per-ship identity for cameras and individual visual controls. */
    getSceneShipHandle(fleetId, ordinal) {
        return this.directed?.shipHandle(fleetId, ordinal)?.id ?? null;
    }
    getLiveShipPose(shipIndex) {
        if (shipIndex < SCENE_SHIP_HANDLE_BASE)
            return this.fleetPresentation.follow.getLiveShipPose(shipIndex);
        const visual = this.liveSceneShipVisual(shipIndex);
        if (!visual)
            return null;
        const pose = this.directed?.shipPose(shipIndex, this.timeline.elapsedMs);
        return pose ? this.observedShipCameraPose(pose) : this.pendingShipCameraPose(shipIndex, visual.id);
    }
    observedShipCameraPose(pose) {
        const age = Math.min(OBSERVATION_PREDICT_SECONDS, Math.max(0, (this.timeline.elapsedMs - pose.observedMs) * 0.001));
        const position = this.shipCameraMotion.at(pose, this.timeline.elapsedMs);
        const attitude = pose.warp ? pose.attitude : mixShipAttitude(pose.previousAttitude, pose.attitude, pose.attitudeDt > 0 ? 1 + age / pose.attitudeDt : 1);
        this.directed?.observeFollowCamera({ id: pose.shipIndex, position, attitude });
        return { posX: position.x + (this.followJourney?.origin.x ?? this.solarBodies.systemX), posY: position.y, posZ: position.z + (this.followJourney?.origin.z ?? this.solarBodies.systemZ),
            heading: pose.heading, speed: pose.speed, shipIndex: pose.shipIndex, attitude,
            hullRadius: SCENE_HULL_SIZE * SCENE_MODEL_SIZE_MUL * pose.classScale };
    }
    pendingShipCameraPose(shipIndex, id) {
        const visual = this.fleetPresentation.records.get(id);
        const center = this.directed?.fleetCenter(id) ?? this.fleetPresentation.storage.fleetGpuPath(visual);
        if (!center)
            return null;
        const p = 'x' in center ? center : { x: center.pathEndX, y: center.pathEndY, z: center.pathEndZ };
        return { posX: p.x + (this.followJourney?.origin.x ?? this.solarBodies.systemX), posY: p.y, posZ: p.z + (this.followJourney?.origin.z ?? this.solarBodies.systemZ), heading: 0, shipIndex, pending: true };
    }
    getFollowWarpState() {
        if (this.sceneFollowHandle == null || !this.liveSceneShipVisual(this.sceneFollowHandle))
            return null;
        const pose = this.directed?.shipPose(this.sceneFollowHandle, this.timeline.elapsedMs) ?? null;
        return warpViewSample(pose, this.timeline.elapsedMs, SCENE_HULL_SIZE * SCENE_MODEL_SIZE_MUL * (pose?.classScale ?? 1));
    }
    liveSceneShipVisual(handle) {
        const resolved = this.directed?.resolveShip(handle);
        if (!resolved || (this.solarBodies.systemId == null && !this.followJourney))
            return null;
        const visual = this.fleetPresentation.records.get(resolved.handle.fleetId);
        // Resolution is against the admitted GPU population, including late departures.
        // Domain membership can already name the next system while these ships still draw.
        if (!visual || visual.generation !== resolved.handle.generation)
            return null;
        if (this.followJourney && this.followJourney.fleetId === visual.id)
            return visual;
        return this.admittedSceneFleet(visual.id, visual.generation) ? visual : null;
    }
    admittedSceneFleet(id, generation) {
        return this.lastOccupancy?.fleets.find((fleet) => fleet.id === id
            && fleet.generation === generation && fleet.systemId === this.solarBodies.systemId);
    }
    sceneShipTypes(id) { return this.directed?.fleetTypes(id) ?? []; }
    /** Borrowed matrix/center: consume synchronously; never transfer renderer-owned storage. */
    sceneMarkerProjection() { return this.coordinates.system.viewProj; }
    sceneMarkerCenter(id) { return this.directed?.fleetCenter(id) ?? null; }
    sceneFleetMarkers() {
        if (this.solarBodies.systemId == null)
            return [];
        const out = [];
        for (const fleet of this.collectSceneFleets()) {
            const id = fleet.id ?? '', center = this.directed?.fleetCenter(id);
            const types = this.sceneShipTypes(id);
            if (!center || types.length === 0)
                continue;
            const marker = projectFleetMarker(this.coordinates.system.viewProj, center, types.length, this.cssWidth, this.cssHeight);
            if (marker)
                out.push({ id, ...marker });
        }
        return out;
    }
    sceneFleetActivity(id) { return this.directed?.fleetActivity(id) ?? null; }
    scenePreparationStatus() { return this.directed?.preparationStatus() ?? null; }
    setFleetPathsVisible(on) { this.directed?.setFleetPathsVisible(on); }
    setFleetDebugVisible(on) { this.directed?.setFleetDebugVisible(on); }
    setHoveredFleetId(id) { this.directed?.setHoveredFleet(id); }
    sceneShipCentroid(id) {
        return this.fleetPresentation.sceneShipCentroid(id);
    }
    /** Smooth only the active camera target; badges still use the raw GPU mean. */
    sceneFleetTrackingPoint(id) {
        const visual = this.fleetPresentation.records.get(id), center = this.directed?.fleetCenter(id);
        if (!visual || !center)
            return null;
        if (this.trackedFleet !== visual) {
            this.trackedFleet = visual;
            this.fleetCameraMotion.reset();
        }
        return this.fleetCameraMotion.at(center, this.timeline.elapsedMs);
    }
    refreshFollowPoseFromGpu(shipIndex) {
        if (shipIndex < SCENE_SHIP_HANDLE_BASE)
            this.fleetPresentation.follow.refreshFollowPoseFromGpu(shipIndex);
    }
    retainedFollowLease(handle) {
        if (handle == null || !this.directed)
            return null;
        const resolved = this.directed.resolveShip(handle);
        if (!resolved)
            return null;
        const { fleetId, generation } = resolved.handle;
        const old = this.followJourney;
        if (old && old.fleetId === fleetId && old.generation === generation)
            return old;
        const fleet = this.lastOccupancy?.fleets.find((f) => f.id === fleetId);
        const systemId = this.solarBodies.systemId;
        if (!fleet || systemId == null)
            return null;
        return new FollowJourney(fleetId, generation, systemId, this.directed.fleetResidentCount(fleetId), { x: this.solarBodies.systemX, z: this.solarBodies.systemZ }, fleet.ownerSystemId);
    }
    noteFollowEvent(reason) {
        this.followEvents.record(this.timeline.elapsedMs, reason, this.sceneFollowHandle ?? this.fleetPresentation.follow.followShipIndex, this.followJourney?.fleetId ?? null, this.followJourney ? this.followJourney.systemId : this.solarBodies.systemId);
    }
    followDiagnostics() {
        return { ship: this.sceneFollowHandle ?? this.fleetPresentation.follow.followShipIndex,
            fleet: this.followJourney?.fleetId ?? null, events: this.followEvents.snapshot() };
    }
    isSceneFleetResident(id) { return (this.directed?.fleetResidentCount(id) ?? 0) > 0; }
    setFollowShipIndex(shipIndex, reason = 'follow-command') {
        const sceneHandle = shipIndex != null && shipIndex >= SCENE_SHIP_HANDLE_BASE ? shipIndex : null;
        const lease = this.retainedFollowLease(sceneHandle);
        if (sceneHandle != null && !lease) {
            this.noteFollowEvent('rejected:ship-not-resident');
            return false;
        }
        const oldHandle = this.sceneFollowHandle ?? this.fleetPresentation.follow.followShipIndex;
        if (oldHandle === shipIndex)
            return true;
        if (oldHandle != null)
            this.noteFollowEvent(`stop:${reason}`);
        this.applyFollowLease(shipIndex, lease);
        if (shipIndex != null)
            this.noteFollowEvent(`start:${reason}`);
        return true;
    }
    applyFollowLease(shipIndex, lease) {
        this.shipCameraMotion.reset();
        this.sceneFollowHandle = lease ? shipIndex : null;
        this.followJourney = lease;
        this.topology.retainedScene = this.followJourney?.systemId;
        this.topology.retainedDestination = this.followJourney?.jump?.endNode.solarSystemId ?? null;
        this.directed?.setFollowShip(this.sceneFollowHandle);
        this.fleetPresentation.follow.setFollowShipIndex(this.sceneFollowHandle == null ? shipIndex : null);
    }
    setSelectedFleetId(id) { this.selectedFleetId = id; }
    setFollowRotation(on) { this.directed?.setFollowRotation(on); }
    getFleetCount() { return this.fleetPresentation.getFleetCount(); }
    getFleetVisual(id) {
        return this.fleetPresentation.getVisual(id);
    }
    getShipHighWater() { return this.fleetPresentation.getShipHighWater(); }
    reserveFleetCapacity(fleetCount, shipsPerFleet) { return this.fleetPresentation.reserveFleetCapacity(fleetCount, shipsPerFleet); }
    addFleet(id, counts, state, relationship) { return this.fleetPresentation.addFleet(id, counts, state, undefined, relationship); }
    createRemoteFleetSlots(onFollowRetired) { return createRemoteFleetSlots(this.fleetPresentation, onFollowRetired); }
    remoteClockReference() {
        return { ...this.timeline.observeClock(performance.timeOrigin), frameEpochMs: this.timeline.epochMs };
    }
    updateFleetState(id, state) { return this.fleetPresentation.updateFleetState(id, state); }
    removeFleet(id) { return this.fleetPresentation.removeFleet(id); }
    clearFleets() { return this.fleetPresentation.clearFleets(); }
    /** Headless topology owns visibility and compact-scene transitions. */
    applyGalaxyPointLod() {
        const d = Math.hypot(this.cameraX - this.targetX, this.cameraY, this.cameraZ - this.targetZ);
        const previousScene = this.solarBodies.systemId;
        this.survey.prepareLayout(this.cssWidth, this.cssHeight, Math.tan(this.fovyDeg * Math.PI / 360), !this.followJourney && this.galaxyFade >= 0.02);
        this.topology.setSurveyPanelClusters(this.survey.layout.panelClusters);
        this.topology.updateLod(d, this.cssHeight, this.canvas.height, this.fovyDeg, this.targetX, this.targetZ, this.timeline.realWallMs);
        if (previousScene !== this.solarBodies.systemId)
            this.overlayPresentation.overlayDirty = true;
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
     * One renderFrame without waiting onSubmittedWorkDone (tests / scripted camera).
     * Does not start rAF.
     */
    renderOnce(options) {
        if (this.disposed || this.bootstrap.isLost)
            return;
        this.renderMeasuredCpu(undefined, false, options);
    }
    /** CPU camera/update/encode time, excluding GPU waits and observation callbacks. */
    renderMeasuredCpu(profiler, diagnostic = false, options) {
        const started = performance.now();
        this.renderFrame(profiler, diagnostic, options);
        this.lastFrameCpuMs = performance.now() - started;
        this.frameCpuSampleSum += this.lastFrameCpuMs;
        this.frameCpuSampleCount++;
        return this.lastFrameCpuMs;
    }
    readModelVisibilityOnce() {
        if (this.isDeviceLost())
            return Promise.reject(new Error("Model visibility is unavailable"));
        return this.modelLayer.readbackVisibility();
    }
    getGpuTimingAvailable() { return this.bootstrap.device.features.has("timestamp-query"); }
    getAdapterInfo() {
        const info = this.bootstrap.adapter.info;
        return { vendor: info?.vendor ?? "", architecture: info?.architecture ?? "", device: info?.device ?? "", description: info?.description ?? "" };
    }
    getLastFrameEndToEndMs() { return this.lastFrameEndToEndMs; }
    /** CPU Band B / 5px LOD only (no encode). Safe if the device was lost. */
    tickSceneLod() {
        this.timeline.sample();
        this.advanceFollowJourney();
        this.applyGalaxyPointLod();
    }
    /** Compatibility alias. This has always measured end-to-end, not GPU timestamps. */
    async measureOneGpuFrameMs() { return this.measureOneFrameEndToEndMs(); }
    async measureOneFrameEndToEndMs() {
        const timing = await this.measureFrame(false);
        return timing.endToEndMs;
    }
    /** Opt-in full-frame timestamps across compute, color and depth passes. */
    async measureFrameTimings(options) {
        return this.measureFrame(true, options);
    }
    async measureFrame(withGpu, options) {
        const result = await measureIsolatedFrame(this.measurementPorts, withGpu, options);
        this.lastFrameEndToEndMs = result.endToEndMs;
        this.recordGpuSample(result.gpu);
        return result;
    }
    recordGpuSample(gpu) {
        if (!gpu)
            return;
        this.lastFrameGpuMs = gpu.gpuMs;
        this.frameGpuSampleSum += gpu.gpuMs;
        this.frameGpuSampleCount++;
    }
    startLoop() {
        const frame = () => {
            if (!this.canRenderLoop()) {
                this.raf = 0;
                return;
            }
            for (const panel of this.statsPanels)
                panel.begin();
            const gpu = this.takeLiveGpuProfiler();
            this.renderMeasuredCpu(gpu);
            frameDebugBegin();
            if (gpu)
                this.finishLiveGpuSample();
            frameDebugTime('planet fetch/decode admission', () => {
                this.catalogResidency.pumpPreviewLoads();
                this.catalogResidency.pumpHiLoad();
            });
            frameDebugTime('planet texture upload', () => this.catalogResidency.pumpUploads());
            // CPU counters describe this frame before observers publish its snapshot.
            frameDebugTime('UI snapshot publication', () => this.afterFrame?.());
            for (const panel of this.statsPanels)
                panel.end();
            frameDebugFrameTotal('post-render work TOTAL (outside Render CPU)');
            if (!this.canRenderLoop()) {
                this.raf = 0;
                return;
            }
            this.raf = requestAnimationFrame(frame);
        };
        this.raf = requestAnimationFrame(frame);
    }
    canRenderLoop() { return this.loopRunning && !this.disposed && !this.bootstrap.isLost; }
    stopLoop() {
        this.loopRunning = false;
        if (this.raf) {
            cancelAnimationFrame(this.raf);
            this.raf = 0;
        }
    }
    renderFrame(profiler, diagnostic = false, options) {
        if (this.bootstrap.isLost)
            return;
        frameDebugBegin();
        this.frameState.referenceModelVisibility = options?.referenceModelVisibility === true;
        this.frameState.referenceTrailVisibility = options?.referenceTrailVisibility === true;
        try {
            frameDebugTime('resize', () => this.applyPendingResize());
            frameDebugTime('camera', () => this.prepareCameraFrame());
            frameDebugTime("applyGalaxyPointLod", () => this.applyGalaxyPointLod());
            frameDebugTime("applyScenePlanetParking", () => this.fleetPresentation.scene.applyScenePlanetParking());
            frameDebugTime('presentation uploads', () => this.flushPresentationChanges());
            frameDebugTime('frame state', () => this.updateFrameState());
            frameDebugTime('encode and submit', () => this.frameEncoder.encode(this.frameState, profiler));
        }
        catch (err) {
            console.error("[WebGPU] renderFrame failed:", err);
            this.stopLoop();
            this.onRenderError?.(err);
            if (diagnostic)
                throw err;
        }
        frameDebugFrameTotal("renderFrame TOTAL");
    }
    advanceFollowJourney() {
        const pin = this.followJourney;
        if (!pin)
            return;
        const visual = this.fleetPresentation.records.get(pin.fleetId);
        if (!visual || visual.generation !== pin.generation) {
            this.setFollowShipIndex(null, 'fleet-retired-or-replaced');
            return;
        }
        const now = this.timeline.wallMs, state = visual.state;
        pin.observe(state);
        const queued = pin.queuedJump;
        if (queued && !pin.jump && !this.beginFollowJump(pin, queued, now))
            return;
        if (pin.jump && !this.updateFollowFrame(pin, now))
            return;
        this.topology.retainedScene = pin.systemId;
        this.topology.retainedDestination = pin.jump?.endNode.solarSystemId ?? null;
    }
    beginFollowJump(pin, jump, now) {
        // A delayed physical approach may outlive an entire logical hop. A newer
        // hop from another system supersedes that old gate; waiting for it would
        // deadlock retention against a plan that now says this fleet is elsewhere.
        const catchingUp = jump.startNode.solarSystemId !== pin.systemId;
        if (!catchingUp && this.directed?.departurePending(pin.fleetId))
            return false;
        const lookup = this.fleetPresentation.scene.lookup();
        const source = lookup?.(jump.startNode), destination = lookup?.(jump.endNode);
        const center = this.directed?.fleetCenter(pin.fleetId);
        if (!source || !destination || !center)
            return false;
        if (catchingUp)
            this.noteFollowEvent('journey:catch-up');
        const radius = 50 * Math.max(.01, ...Array.from(this.solarBodies.orbitRadius));
        pin.begin(jump, source, destination, { x: center.x + pin.origin.x, y: center.y, z: center.z + pin.origin.z }, radius, now);
        pin.queuedJump = null;
        this.noteFollowEvent('journey:warp-start');
        return true;
    }
    updateFollowFrame(pin, now) {
        const jump = pin.jump;
        const lookup = this.fleetPresentation.scene.lookup();
        const source = lookup?.(jump.startNode), destination = lookup?.(jump.endNode);
        if (!source || !destination) {
            this.setFollowShipIndex(null, 'topology-missing');
            return false;
        }
        const next = pin.frame(now, source, destination);
        if (next.origin.x !== pin.origin.x || next.origin.z !== pin.origin.z) {
            this.directed?.reframeFleet(pin.fleetId, [(pin.origin.x - next.origin.x) * 560, 0, (pin.origin.z - next.origin.z) * 560]);
            this.shipCameraMotion.reset();
            pin.origin = { ...next.origin };
        }
        const changed = pin.systemId !== next.systemId;
        pin.systemId = next.systemId;
        if (changed)
            this.noteFollowEvent(next.systemId == null ? 'journey:transit' : 'journey:system-enter');
        if (now >= pin.endMs) {
            pin.completedJump = jump.startTime;
            pin.jump = null;
            this.noteFollowEvent('journey:arrived');
        }
        return true;
    }
    prepareCameraFrame() {
        this.timeline.sample();
        this.advanceFollowJourney();
        const follow = this.fleetPresentation.follow;
        if (follow.followShipIndex != null) {
            frameDebugTime("stepFollowShipShadow", () => follow.stepFollowShipShadow(this.timeline.simDtMs, this.timeline.elapsedMs));
        }
        if (this.beforeFrame)
            frameDebugTime("beforeFrame", () => this.beforeFrame(this.timeline.cameraDtMs));
        const sceneOpen = this.solarBodies.systemId != null || this.followJourney != null;
        const origin = !sceneOpen && follow.followShipIndex != null ? follow.followFrameOriginOpts(follow.followShipIndex) : null;
        this.coordinates.updateCamera(this.cameraX, this.cameraY, this.cameraZ, this.targetX, this.targetY, this.targetZ, origin, sceneOpen, this.cameraUpHint);
    }
    flushPresentationChanges() {
        if (this.topology.storeDirty) {
            this.points.syncFromStore(this.store);
            this.topology.storeDirty = false;
        }
        if (this.topology.impostorStoreDirty) {
            this.impostorPoints.syncFromStore(this.impostorStore);
            this.topology.impostorStoreDirty = false;
        }
        if (this.topology.linesDirty) {
            this.schematics.invalidate();
            this.lines.syncFromStore(this.lineStore);
            this.topology.linesDirty = false;
        }
        this.overlayPresentation.packOverlaysIfDirty();
        this.fleetPresentation.upload.flushFleetGpuDirt();
    }
    updateFrameState() {
        const frame = this.frameState;
        frame.warp = this.getFollowWarpState();
        frame.sceneOpen = this.solarBodies.systemId != null || this.followJourney != null;
        frame.anyScene = this.fleetPresentation.scene.systemSceneIds.size > 0;
        frame.following = this.sceneFollowHandle != null || this.fleetPresentation.follow.followShipIndex != null;
        frame.strategicVisible = this.followJourney == null;
        frame.keplerEncode = (frame.sceneOpen || frame.anyScene) && this.shouldEncodeKeplerScene();
        frame.eyeX = this.cameraX;
        frame.eyeY = this.cameraY;
        frame.eyeZ = this.cameraZ;
        frame.targetX = this.targetX;
        frame.targetZ = this.targetZ;
        frame.distance = Math.hypot(this.cameraX - this.targetX, this.cameraY - this.targetY, this.cameraZ - this.targetZ);
        frame.tanHalfFov = Math.tan(this.fovyDeg * Math.PI / 360);
        frame.cssWidth = this.cssWidth;
        frame.cssHeight = this.cssHeight;
        frame.fovyDeg = this.fovyDeg;
        frame.galaxyFade = this.galaxyFade;
        frame.focusedBodyIndex = this.focusedBodyIndex;
        frame.nowMs = this.timeline.elapsedMs;
        frame.dtMs = this.timeline.simDtMs;
        frame.timeSec = this.timeline.seconds;
        frame.fleetHighWater = this.fleetPresentation.slotAlloc.fleetHighWater;
        frame.shipHighWater = this.fleetPresentation.storage.instanceLiveCount;
        this.sceneCollectCached = null;
        this.sceneBodyParks.fill(undefined);
        this.sceneSlotSeen.fill(0);
        if (frame.sceneOpen) {
            this.sceneSunX = this.followJourney?.origin.x ?? this.solarBodies.systemX;
            this.sceneSunZ = this.followJourney?.origin.z ?? this.solarBodies.systemZ;
            this.coordinates.updateSystem(this.sceneSunX, this.sceneSunZ);
            void this.directed?.ensure(this.bootstrap.device, this.bootstrap.format).catch(error => {
                if (!this.disposed && !this.directedErrorReported) {
                    this.directedErrorReported = true;
                    this.onRenderError?.(error);
                }
            });
            frameDebugTime('Kepler staging', () => this.syncKeplerBodies(frame.timeSec));
            frameDebugTime('scene synchronization', () => this.syncDirectedScene());
            this.modelLayer.setModelScale(sceneModelScale(this.modelLayer.getMeshOriginRadius()));
            this.modelLowLayer.setModelScale(sceneModelScale(this.modelLowLayer.getMeshOriginRadius()));
            this.modelTinyLayer.setModelScale(sceneModelScale(1));
        }
        else {
            this.modelLayer.setModelScale(MODEL_LOD_DEFAULT_SCALE);
            this.modelLowLayer.setModelScale(MODEL_LOD_DEFAULT_SCALE);
            this.releaseSceneSlots();
            this.lastOccupancy = null;
            this.occupancyKey = "";
            this.directed?.syncSceneFleets([], null);
        }
        const mapBuf = this.directed?.mapStorage?.() ?? null;
        const meshesReady = this.modelLayer.isReady() && this.modelLowLayer.isReady() && !!mapBuf
            && (this.directed?.visualCap?.().shown ?? 0) > 0;
        const hullsOn = this.modelPresentation.update(frame.sceneOpen, frame.distance, meshesReady);
        this.modelLayer.setLodMask(FLEET_FLAG_MODEL_HIGH);
        this.modelLowLayer.setLodMask(FLEET_FLAG_MODEL_LOW);
        this.modelTinyLayer.setLodMask(8192);
        frame.sceneShipCapacity = this.directed?.kernelCapacity?.() ?? SCENE_KERNEL_COUNT;
        if (mapBuf) {
            this.modelLayer.setKernelIdentitySource(frame.sceneShipCapacity);
            this.modelLowLayer.setKernelIdentitySource(frame.sceneShipCapacity);
            this.modelTinyLayer.setKernelIdentitySource(frame.sceneShipCapacity);
        }
        frame.hullsOn = hullsOn;
        frame.hullHighOn = hullsOn;
        this.fleetPresentation.upload.flushFleetGpuDirt();
    }
    allocSceneSlot(id) {
        const have = this.sceneSlots.get(id);
        if (have != null && this.sceneSlotLive[have])
            return have;
        if (this.sceneSlots.size >= renderBudget().fleets)
            return -1;
        for (let slot = 0; slot < renderBudget().fleets; slot++) {
            if (this.sceneSlotLive[slot])
                continue;
            this.sceneSlotLive[slot] = 1;
            this.sceneSlots.set(id, slot);
            return slot;
        }
        return -1;
    }
    releaseSceneSlots() {
        for (const [id, slot] of this.sceneSlots) {
            if (this.sceneSlotSeen[slot])
                continue;
            this.sceneSlots.delete(id);
            this.sceneFleetMetadata[slot] = undefined;
            this.sceneSlotLive[slot] = 0;
            this.fleetPresentation.hideSceneTail(id, 0);
            this.fleetPresentation.ensureSceneVisualCount(id, null);
        }
    }
    sceneFleetPark(hash) {
        const bodyIndex = pickSceneParkBodyIndex(hash, this.solarBodies);
        const cached = this.sceneBodyParks[bodyIndex];
        if (cached)
            return cached;
        const toward = compactBodySunLocal(this.solarBodies, bodyIndex, this.timeline.seconds)
            ?? { x: 0, y: 0, z: 0 };
        const park = { bodyIndex, toward, bodyRadius: this.solarBodies.radius[bodyIndex] ?? 0 };
        this.sceneBodyParks[bodyIndex] = park;
        return park;
    }
    collectSceneFleets() {
        if (this.sceneCollectCached)
            return this.sceneCollectCached;
        const storage = this.fleetPresentation.storage;
        const fleets = [];
        const pin = this.followJourney;
        const retained = pin && this.fleetPresentation.records.get(pin.fleetId);
        if (retained) {
            const mapped = this.mapSceneVisual(retained, storage);
            if (mapped) {
                fleets.push(mapped);
                this.sceneSlotSeen[mapped.slot ?? 0] = 1;
            }
        }
        for (const visual of this.fleetPresentation.scene.fleetsInJewel().values()) {
            if (visual.id === pin?.fleetId || (pin && pin.systemId == null))
                continue;
            const mapped = this.mapSceneVisual(visual, storage);
            if (mapped) {
                fleets.push(mapped);
                this.sceneSlotSeen[mapped.slot ?? 0] = 1;
            }
        }
        for (const [id, slot] of this.sceneSlots) {
            if ((pin && pin.systemId == null) || this.sceneSlotSeen[slot] || !this.directed?.retainsDeparture(id))
                continue;
            const visual = this.fleetPresentation.records.get(id);
            if (visual) {
                const mapped = this.mapSceneVisual(visual, storage);
                if (mapped) {
                    fleets.push(mapped);
                    this.sceneSlotSeen[slot] = 1;
                }
            }
        }
        this.releaseSceneSlots();
        fleets.sort((a, b) => ((a.slot ?? 0) | 0) - ((b.slot ?? 0) | 0));
        this.sceneCollectCached = fleets;
        return fleets;
    }
    mapSceneVisual(visual, storage) {
        const o = visual.fleetSlot * FLEET_GPU_STRIDE;
        if (o + FLEET_GPU_STRIDE > storage.fleetGpuBytes.byteLength)
            return null;
        const flags = storage.fleetGpuView.getUint32(o + FleetGpuFields.flags, true);
        if ((flags & FLEET_FLAG_ALIVE) === 0)
            return null;
        const pin = this.followJourney?.fleetId === visual.id ? this.followJourney : null;
        if ((flags & FLEET_FLAG_SYSTEM_SCENE) === 0 && !pin && !this.directed?.retainsDeparture(visual.id))
            return null;
        const hadSlot = this.sceneSlots.has(visual.id);
        const slot = this.allocSceneSlot(visual.id);
        if (slot < 0)
            return null;
        const domain = countShips(visual.counts);
        const tint = RELATIONSHIP_COLORS[FLEET_RELATIONSHIPS.indexOf(visual.relationship)] ?? RELATIONSHIP_COLORS[1];
        const want = pin?.count ?? Math.min(MAX_GROUP_VISUAL, Math.max(0, domain));
        if (!hadSlot)
            this.fleetPresentation.ensureSceneVisualCount(visual.id, want);
        const grown = this.fleetPresentation.records.get(visual.id);
        if (!grown)
            return null;
        const hash = storage.fleetGpuView.getUint32(o + FleetGpuFields.fleetIdHash, true);
        const park = this.sceneFleetPark(hash);
        const systemId = this.solarBodies.systemId;
        const sunX = pin?.origin.x ?? this.solarBodies.systemX;
        const sunZ = pin?.origin.z ?? this.solarBodies.systemZ;
        const lookup = this.fleetPresentation.scene.lookup();
        const st = grown.state;
        // Lookups borrow stable world positions. Avoid two temporary coordinate
        // objects and a captured closure for every fleet on every rendered frame.
        const from = st.state === "jumping" ? lookup?.(st.startNode) : null;
        const to = st.state === "jumping" ? lookup?.(st.endNode)
            : st.state === "cooldown" && st.nextNode ? lookup?.(st.nextNode) : null;
        const row = this.sceneFleetMetadata[slot] ?? {};
        // Releasing/reselecting follow inside the destination does not replace the
        // resident fleet. Keep its physical owner until this scene row retires.
        const ownerSystemId = pin?.ownerSystemId ?? (row.id === grown.id && row.generation === grown.generation
            && row.systemId === systemId ? row.ownerSystemId : undefined);
        row.id = grown.id;
        row.generation = grown.generation;
        row.slot = slot;
        row.gpuSlot = grown.fleetSlot;
        row.groupId = slot;
        row.instanceStart = grown.instanceStart;
        row.shipCount = want;
        row.classCounts = grown.counts.classes;
        row.marker = tint;
        row.paused = (flags & FLEET_FLAG_SIM_PAUSED) !== 0;
        row.bodyIndex = park.bodyIndex;
        row.toward = park.toward;
        row.bodyRadius = park.bodyRadius;
        row.systemId = systemId;
        row.ownerSystemId = ownerSystemId;
        row.retainedCount = pin?.count;
        row.retainedPlan = pin?.jump && pin.end ? { phase: 'retained-warp', journeyKey: pin.jump.startTime,
            warpSec: Math.max(.001, (pin.endMs - this.timeline.wallMs) / 1000),
            exit: { x: pin.end.x - sunX, y: pin.end.y ?? 0, z: pin.end.z - sunZ } } : undefined;
        row.nowMs = this.timeline.wallMs;
        row.fromX = from ? from.x - sunX : 0;
        row.fromZ = from ? from.z - sunZ : 0;
        row.toX = to ? to.x - sunX : 0;
        row.toZ = to ? to.z - sunZ : 0;
        row.state = st;
        this.sceneFleetMetadata[slot] = row;
        return row;
    }
    syncDirectedScene() {
        if (!this.directed)
            return;
        const wanted = this.collectSceneFleets();
        const previous = this.lastOccupancy;
        const cap = Math.min(renderBudget().maxShips, Math.max(this.followJourney?.count ?? 0, sceneShipCapacity(this.isHighFxEnabled())));
        const allocated = refreshSceneVisualAllocation(wanted, previous, cap);
        this.lastOccupancy = allocated;
        frameDebugCount('scene fleets', allocated.fleets.length);
        if (allocated.key !== this.occupancyKey) {
            this.occupancyKey = allocated.key;
            const live = new Set(allocated.fleets.map((f) => f.id ?? ""));
            if (previous) {
                for (const fleet of previous.fleets) {
                    if (fleet.id && !live.has(fleet.id))
                        this.sceneHideQueue.push({ id: fleet.id, live: 0 });
                }
            }
            for (const fleet of allocated.fleets) {
                if (fleet.id)
                    this.sceneHideQueue.push({ id: fleet.id, live: fleet.shipCount | 0 });
            }
        }
        this.drainSceneHideQueue();
        this.directed.syncSceneFleets(allocated.fleets, this.fleetsLayer.getInstanceBuffer(), null, this.fleetsLayer.getShipSimBuffer(), this.fleetsLayer.getTrailSampleBuffer(), this.selectedFleetId);
        this.fleetPresentation.upload.flushFleetGpuDirt();
    }
    drainSceneHideQueue() {
        const budgetMs = 1;
        const t0 = performance.now();
        while (this.sceneHideQueue.length) {
            const next = this.sceneHideQueue.shift();
            if (next)
                this.fleetPresentation.hideSceneTail(next.id, next.live);
            if (performance.now() - t0 >= budgetMs)
                break;
        }
    }
    syncKeplerBodies(timeSec) {
        if (typeof this.directed?.syncKeplerBodies !== "function")
            return;
        if (this.solarBodies.systemId == null) {
            this.directed.syncKeplerBodies([], timeSec);
            return;
        }
        this.directed.syncKeplerBodies(keplerBodiesForStore(this.solarBodies, timeSec), timeSec);
    }
    async ensureDirectedRuntime() {
        await this.directed?.ensure(this.bootstrap.device, this.bootstrap.format);
    }
    haloCentroid(id, storage, o) {
        const c = this.fleetPresentation.sceneShipCentroid(id);
        if (c)
            return c;
        return {
            x: storage.fleetGpuView.getFloat32(o + FleetGpuFields.posX, true),
            y: storage.fleetGpuView.getFloat32(o + FleetGpuFields._pad0, true),
            z: storage.fleetGpuView.getFloat32(o + FleetGpuFields.posZ, true),
        };
    }
    haloMarkers() {
        const out = [];
        for (const fleet of this.collectSceneFleets()) {
            const visual = this.fleetPresentation.records.get(fleet.id ?? "");
            if (!visual)
                continue;
            const o = visual.fleetSlot * FLEET_GPU_STRIDE;
            const storage = this.fleetPresentation.storage;
            if (o + FLEET_GPU_STRIDE > storage.fleetGpuBytes.byteLength)
                continue;
            const c = this.haloCentroid(visual.id, storage, o);
            out.push({
                id: visual.id,
                slot: fleet.slot ?? out.length,
                x: c.x,
                y: c.y,
                z: c.z,
                radius: Math.max(0.002, compactOrbitPad(4)),
            });
        }
        return out;
    }
    battleProbe(attacker, defender) {
        const node = this.getSceneFleetNode();
        if (!node)
            return null;
        return this.directed?.battleProbe(attacker, defender, node) ?? null;
    }
    kernelFleetMap() {
        return this.collectSceneFleets().map((f) => ({ id: f.id ?? "", slot: f.slot ?? 0 }));
    }
    receiveDirectorPacket(packet) {
        return this.directed?.receive?.(packet) ?? { status: "closed" };
    }
    setDebugDensityVoxels(on) {
        this.directed?.setDensityVisible?.(on);
    }
    setDebugRepulsion(on) {
        this.directed?.setRepulsionVisible?.(on);
    }
    setSimulationRate(hz) { this.directed?.setSimulationRate(hz); }
    isHighFxEnabled() { return this.frameState.highFx; }
    supportsHighFx() {
        return !compactRenderBudget() && HIGH_FX_BIND_BYTES <= Math.min(this.bootstrap.device.limits.maxStorageBufferBindingSize, this.bootstrap.device.limits.maxBufferSize);
    }
    clearQualityDiagnostics() { this.qualityEpoch++; this.directed?.clearQuality(); }
    async sampleQualityDiagnostics() {
        if (!this.frameState.sceneOpen)
            return null;
        const epoch = this.qualityEpoch, scene = this.solarBodies.systemId;
        const counts = await this.directed?.sampleQuality();
        if (!counts || epoch !== this.qualityEpoch || scene !== this.solarBodies.systemId)
            return null;
        const [emitters, args, tiny, low, high] = await Promise.all([this.fleetsLayer.readbackTrailDrawCount(), this.fleetsLayer.readbackTrailIndirectArgs(),
            this.modelTinyLayer.readbackVisibleCount(), this.modelLowLayer.readbackVisibleCount(), this.modelLayer.readbackVisibleCount()]);
        if (epoch !== this.qualityEpoch || scene !== this.solarBodies.systemId)
            return null;
        return { counts, visible: [tiny, low, high], emitters, segments: args[1] ?? 0, wallMs: Date.now(), width: this.canvas.width, height: this.canvas.height,
            msaa: MAP_HULL_MSAA ? 4 : MAP_MSAA_SAMPLES, selective: MAP_HULL_MSAA || MAP_BODY_SAMPLES !== MAP_MSAA_SAMPLES, halfGlow: MAP_HALF_GLOW, simulationHz: this.directed?.getSimulationRate() ?? 30 };
    }
    setStarField(on) { this.survey.stars.enabled = on; }
    setHighFx(on) {
        const capacity = Math.min(Math.max(this.followJourney?.count ?? 0, sceneShipCapacity(on === true)), renderBudget().maxShips);
        if (on && !this.supportsHighFx())
            return;
        this.frameState.highFx = on === true;
        this.modelLayer.growCapacity(capacity);
        this.modelLowLayer.growCapacity(capacity);
        this.modelTinyLayer.growCapacity(capacity);
        const residentCapacity = this.directed?.kernelCapacity?.() ?? this.frameState.sceneShipCapacity;
        this.fleetsLayer.configureScenePool(MAX_FLEET_SLOTS, Math.max(capacity, residentCapacity));
        this.directed?.setVisualCapacity(capacity);
    }
    setSimPause(state) {
        this.timeline.applySimPause(state);
    }
    visualCap() {
        return this.directed?.visualCap?.() ?? null;
    }
    sceneDrawStats() {
        return this.directed?.drawStats() ?? { fleets: 0, ships: 0 };
    }
    takeLiveGpuProfiler() {
        if (this.gpuSamplePending || !this.liveGpuProfiler)
            return;
        if (++this.framesSinceGpuSample < 20)
            return;
        this.framesSinceGpuSample = 0;
        this.gpuSamplePending = true;
        return this.liveGpuProfiler;
    }
    finishLiveGpuSample() {
        const profiler = this.liveGpuProfiler;
        if (!profiler) {
            this.gpuSamplePending = false;
            return;
        }
        void profiler.complete().then((timing) => {
            this.recordGpuSample(timing);
        }).catch(() => {
            /* timestamp readback is best-effort */
        }).finally(() => {
            this.gpuSamplePending = false;
        });
    }
    dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        this.stopLoop();
        this.survey.dispose();
        this.points.dispose();
        this.impostorPoints.dispose();
        this.solarBodyLayer.dispose();
        this.schematics.dispose();
        this.catalogResidency.dispose();
        this.lines.dispose();
        this.liveGpuProfiler?.dispose();
        this.liveGpuProfiler = null;
        this.modelLayer.dispose();
        this.modelLowLayer.dispose();
        this.modelTinyLayer.dispose();
        this.directed?.destroy();
        this.directed = null;
        this.fleetsLayer.dispose();
        this.overlayLines.dispose();
        this.overlay.dispose();
        this.frameEncoder.dispose();
        this.attachments.dispose();
        this.bootstrap.destroy();
        this.surfaceCleanup?.();
        this.surfaceCleanup = null;
    }
}
//# sourceMappingURL=map-renderer-core.js.map