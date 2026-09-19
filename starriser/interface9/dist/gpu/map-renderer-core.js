import { measureIsolatedFrame } from "./map/frame-measurement.js";
import { createMapFrameState } from "./map/frame-state.js";
import { createMapFrameEncoder } from "./map/frame-encoder.js";
import { createFleetFrameEncoding } from "./map/fleets/frame-encoding.js";
import { createDirectedSceneHost, MAX_SCENE_FLEETS, SCENE_KERNEL_COUNT, MAX_GROUP_VISUAL, seedDirectedShips, SCENE_LAB_SCALE } from "./map/fleets/directed-scene-host.js";
import { countShips } from "./fleet-lod.js";
import { compactOrbitPad, allocateSceneVisuals, sceneModelScale, fleetModelLodBits } from "./map/fleets/directed-present.wgsl.js";
import { pickSceneParkBodyIndex, KEPLER_SCALE } from "./solar-system-lod.js";
import { compactBodySunLocal } from "./system-scene/frame.js";
import { keplerOrbitLocalF32 } from "./math/world-origin.js";
import { orbitPhaseAt, SOLAR_ORBIT_SPEED_SCALE } from "./planet-lib/solar-bodies.js";
import { FLEET_GPU_STRIDE, FleetGpuFields, FLEET_FLAG_ALIVE, FLEET_FLAG_SYSTEM_SCENE, FLEET_FLAG_SIM_PAUSED, FLEET_FLAG_MODEL_LOW, FLEET_FLAG_MODEL_HIGH, FLEET_FLAG_MODEL_LOD } from "./fleet-layout.js";
import { SHIP_SIM_STRIDE, ShipSimFields } from "./ship-sim-layout.js";
import { createGalaxyEncoding } from "./map/galaxy-encoding.js";
import { createSolarScenePresentation } from "./map/solar-scene-presentation.js";
import { createFrameGpuProfiler } from "./gpu-frame-profiler.js";
import { FrameAttachments } from "./map/frame-attachments.js";
import { MapOverlayPresentation } from "./map/overlay-presentation.js";
import { SceneSchematics } from "./map/scene-schematics.js";
import { FleetModelPresentation } from "./map/fleets/model-presentation.js";
import { FleetPresentation } from "./map/fleets/fleet-presentation.js";
import { createRemoteFleetSlots } from './map/fleets/remote-presentation.js';
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
import { MAP_MSAA_SAMPLES } from "./map-msaa.js";
import { Line2Renderer } from "../vendor/line2/index.js";
import { MODEL_LOD_DEFAULT_SCALE, MODEL_LOD_MAX_INSTANCES } from "./fleet-lod.js";
import { MAP_NEAR, SCENE_FAR, SCENE_NEAR } from "./camera-zoom.js";
import { mat4LookAt, mat4ViewProj } from "./math/mat4.js";
import { frameDebugBegin, frameDebugFrameTotal, frameDebugTime } from "./frame-debug.js";
import { rebuildWebGpuConnectionsFromGalaxy } from "../render/topology-view-bridge.js";
/** Screen-space overlay stroke width (buffer pixels; Line2 `worldUnits=false`). */
/** Fat selection/hover/edit rings (screen px). Slightly wider so select is obvious. */
const OVERLAY_LINEWIDTH_PX = 3.5;
/** Skip Kepler discs/schematics while orbit exit is almost done (fade < 1). */
const KEPLER_ENCODE_FADE_MAX = 0.88;
function keplerAxes(catalogId) {
    const u = keplerOrbitLocalF32(1, 1, 0, catalogId);
    const v = keplerOrbitLocalF32(1, 1, Math.PI * 0.5, catalogId);
    return { u: [u.x, u.y, u.z], v: [v.x, v.y, v.z] };
}
function keplerLocalPose(store, index, timeSec) {
    const local = compactBodySunLocal(store, index, timeSec);
    return { x: local?.x ?? 0, y: local?.y ?? 0, z: local?.z ?? 0 };
}
function keplerBodyRecord(store, index, timeSec) {
    const isSun = !!store.isSun[index];
    const period = store.orbitPeriod[index] || 1;
    const axes = keplerAxes(store.catalogIds[index]);
    const pose = keplerLocalPose(store, index, timeSec);
    if (isSun) {
        return { ...pose, radius: store.radius[index] ?? 0, isSun, orbitRadius: 0, rate: 0, phase: 0, uAxis: axes.u, vAxis: axes.v };
    }
    return {
        ...pose,
        radius: store.radius[index] ?? 0,
        isSun,
        orbitRadius: (store.orbitRadius[index] || 0) * KEPLER_SCALE,
        rate: (SOLAR_ORBIT_SPEED_SCALE / Math.max(1e-6, period)) * Math.PI * 2,
        phase: orbitPhaseAt(store.phase0[index], period, timeSec),
        uAxis: axes.u,
        vAxis: axes.v,
    };
}
function keplerBodiesForStore(store, timeSec) {
    const n = Math.min(store.currentCount, 16);
    const bodies = [];
    for (let i = 0; i < n; i++)
        bodies.push(keplerBodyRecord(store, i, timeSec));
    return bodies;
}
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
        this.sceneSlots = new Map();
        this.sceneSlotLive = new Uint8Array(MAX_SCENE_FLEETS);
        this.sceneCollectCached = null;
        this.hullLodKey = "";
        this.lastHullHighOn = false;
        this.liveGpuProfiler = null;
        this.gpuSamplePending = false;
        this.framesSinceGpuSample = 0;
        this.selectedFleetId = null;
        this.occupancyKey = "";
        this.lastOccupancy = null;
        this.sceneHideQueue = [];
        this.statsPanels = [];
        this.coordinates = new MapFrameCoordinates();
        this.proj = this.coordinates.projection;
        this.view = this.coordinates.absoluteView;
        this.viewProj = this.coordinates.absoluteViewProj;
        this.viewRel = this.coordinates.galaxy.view;
        this.viewProjRel = this.coordinates.galaxy.viewProj;
        this.frameOrigin = this.coordinates.galaxy.origin;
        this.sceneViewRel = this.coordinates.system.view;
        this.sceneViewProjRel = this.coordinates.system.viewProj;
        this.sceneOriginZero = this.coordinates.system.origin;
        this.sceneSunOrigin = this.coordinates.system.anchor;
        this.cameraRight = this.coordinates.cameraRight;
        this.cameraUp = this.coordinates.cameraUp;
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
        this.canvas = canvas;
        this.bootstrap = bootstrap;
        this.fovyDeg = fovyDeg;
        this.timeline = new FrameTimeline(clock);
        this.attachments = new FrameAttachments(bootstrap, canvas, () => this.disposed || bootstrap.isLost);
        this.points = new SolarPointGpuLayer(bootstrap);
        this.impostorPoints = new SolarPointGpuLayer(bootstrap);
        this.solarBodyLayer = new SolarBodyGpuLayer(bootstrap);
        this.catalogResidency = new SolarCatalogResidency(bootstrap.device);
        this.topology = new MapTopologyPresentation(this.catalogResidency, (ids) => this.setSystemScene(ids));
        this.store = this.topology.store;
        this.impostorStore = this.topology.impostorStore;
        this.solarBodies = this.topology.solarBodies;
        this.lineStore = this.topology.lineStore;
        this.lines = new ConnectionLineGpuLayer(bootstrap);
        this.fleetsLayer = new FleetInstanceGpuLayer(bootstrap);
        this.fleetPresentation = new FleetPresentation(this.fleetsLayer, () => this.disposed || bootstrap.isLost, this.solarBodies, this.timeline);
        this.modelLayer = new FleetModelGpuLayer(bootstrap, {
            maxInstances: MODEL_LOD_MAX_INSTANCES,
            modelScale: MODEL_LOD_DEFAULT_SCALE,
            meshYawHalf: 0, // low-poly +Z forward
        });
        this.modelLowLayer = new FleetModelGpuLayer(bootstrap, {
            maxInstances: MODEL_LOD_MAX_INSTANCES,
            modelScale: MODEL_LOD_DEFAULT_SCALE,
            meshYawHalf: 0,
        });
        this.modelPresentation = new FleetModelPresentation({
            ships: this.fleetsLayer, models: this.modelLayer, modelsLow: this.modelLowLayer,
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
        this.overlayPresentation = new MapOverlayPresentation(this.overlay, this.overlayLines, () => this.getViewProj(), () => this.hideGalaxySelectionRings());
        this.schematics = new SceneSchematics(bootstrap, canvas, this.topology, this.coordinates, () => this.shouldEncodeKeplerScene());
        this.galaxyEncoding = createGalaxyEncoding(this.topology, this.lines, this.points, this.impostorPoints, this.coordinates);
        this.solarPresentation = createSolarScenePresentation(this.solarBodyLayer, this.solarBodies, this.catalogResidency, this.coordinates);
        this.frameEncoder = createMapFrameEncoder({
            bootstrap, surface: canvas, coordinates: this.coordinates, attachments: this.attachments,
            galaxy: this.galaxyEncoding, solar: this.solarPresentation,
            fleets: createFleetFrameEncoding(this.fleetsLayer, this.modelLayer, this.coordinates, canvas, {
                encodeTick: (encoder, timeSec, dtSec, sceneOpen, nowMs) => {
                    this.directed?.encodeTick(encoder, timeSec, dtSec, sceneOpen, nowMs);
                },
                encodeDensity: (pass, viewProj, focusedBodyIndex) => {
                    this.directed?.encodeDensity?.(pass, viewProj, focusedBodyIndex);
                },
            }, this.modelLowLayer),
            schematics: this.schematics, overlay: this.overlayPresentation,
            tickWarmFleets: () => this.fleetPresentation.tickWarmFleets(),
            commitDirectedTick: () => { this.directed?.commitTick(); },
        });
        this.points.init(msaa);
        this.impostorPoints.init(msaa);
        this.solarBodyLayer.init(msaa);
        this.lines.init(msaa);
        this.fleetsLayer.init(msaa);
        this.modelLayer.init(msaa);
        this.modelLowLayer.init(msaa);
        this.overlay.init(msaa);
        this.liveGpuProfiler = createFrameGpuProfiler(bootstrap.device);
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
     * Safe to call multiple times; last successful load wins.
     */
    async loadShipModel(url) {
        await this.loadGlbInto(this.modelLayer, url);
    }
    async loadShipModels() {
        await Promise.all([
            this.loadGlbInto(this.modelLayer, "models/spaceship_fighter_simplify50.glb"),
            this.loadGlbInto(this.modelLowLayer, "models/spaceship_fighter_simplify3.glb"),
        ]);
    }
    async loadGlbInto(layer, url) {
        this.assertModelLoadAvailable();
        const res = await fetch(url);
        this.assertModelLoadAvailable();
        if (!res.ok) {
            throw new Error(`loadShipModel: ${url} → HTTP ${res.status}`);
        }
        const buf = await res.arrayBuffer();
        this.assertModelLoadAvailable();
        await layer.loadGlb(buf);
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
            onDeviceLost: (info) => {
                view?.stopLoop();
                options.onDeviceLost?.(info);
            },
        });
        try {
            view = new WebGpuMapView(canvas, bootstrap, options.fovyDeg ?? 60, options.skipShipModel === true, options.clock);
            view.surfaceCleanup = options.onDispose ?? null;
            view.onRenderError = options.onRenderError;
            view.directed = createDirectedSceneHost();
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
    /** GPU-relative ms for f32 uniforms / FleetGpu.t0 (wall - origin). */
    toGpuTime(wallMs) {
        return this.timeline.toGpuMs(wallMs);
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
    /** Domain wall clock (epoch + elapsed); same sample as FleetGpu `toGpuMs`. */
    getSceneWallMs() {
        return this.timeline.wallMs;
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
     * Bake the FOCUS LUT after submit / on promote. One in-flight.
     * Never from encode / renderFrame / startLoop — lab and tests call this.
     * Live map FOCUS stays RecurseDraw O’Neil (`lutReady = false`).
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
    pickRandomShipPose() { return this.fleetPresentation.follow.pickRandomShipPose(); }
    getLiveShipPose(shipIndex) { return this.fleetPresentation.follow.getLiveShipPose(shipIndex); }
    sceneShipCentroid(id) {
        return this.fleetPresentation.sceneShipCentroid(id);
    }
    refreshFollowPoseFromGpu(shipIndex) { return this.fleetPresentation.follow.refreshFollowPoseFromGpu(shipIndex); }
    setFollowShipIndex(shipIndex) { return this.fleetPresentation.follow.setFollowShipIndex(shipIndex); }
    setSelectedFleetId(id) { this.selectedFleetId = id; }
    getFleetCount() { return this.fleetPresentation.getFleetCount(); }
    getFleetVisual(id) {
        return this.fleetPresentation.getVisual(id);
    }
    getShipHighWater() { return this.fleetPresentation.getShipHighWater(); }
    reserveFleetCapacity(fleetCount, shipsPerFleet) { return this.fleetPresentation.reserveFleetCapacity(fleetCount, shipsPerFleet); }
    addFleet(id, counts, state) { return this.fleetPresentation.addFleet(id, counts, state); }
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
        this.topology.updateLod(d, this.cssHeight, this.canvas.height, this.fovyDeg, this.targetX, this.targetZ, this.timeline.wallMs);
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
            if (gpu)
                this.finishLiveGpuSample();
            this.catalogResidency.pumpPreviewLoads();
            this.catalogResidency.pumpHiLoad();
            // CPU counters describe this frame before observers publish its snapshot.
            this.afterFrame?.();
            for (const panel of this.statsPanels)
                panel.end();
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
            this.applyPendingResize();
            this.prepareCameraFrame();
            frameDebugTime("applyGalaxyPointLod", () => this.applyGalaxyPointLod());
            frameDebugTime("applyScenePlanetParking", () => this.fleetPresentation.scene.applyScenePlanetParking());
            this.flushPresentationChanges();
            this.updateFrameState();
            this.frameEncoder.encode(this.frameState, profiler);
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
    prepareCameraFrame() {
        this.timeline.sample();
        const follow = this.fleetPresentation.follow;
        if (follow.followShipIndex != null) {
            frameDebugTime("stepFollowShipShadow", () => follow.stepFollowShipShadow(this.timeline.simDtMs, this.timeline.elapsedMs));
        }
        if (this.beforeFrame)
            frameDebugTime("beforeFrame", () => this.beforeFrame(this.timeline.cameraDtMs));
        const sceneOpen = this.solarBodies.systemId != null;
        const origin = !sceneOpen && follow.followShipIndex != null ? follow.followFrameOriginOpts(follow.followShipIndex) : null;
        this.coordinates.updateCamera(this.cameraX, this.cameraY, this.cameraZ, this.targetX, this.targetY, this.targetZ, origin, sceneOpen);
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
        frame.sceneOpen = this.solarBodies.systemId != null;
        frame.anyScene = this.fleetPresentation.scene.systemSceneIds.size > 0;
        frame.following = this.fleetPresentation.follow.followShipIndex != null;
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
        if (frame.sceneOpen) {
            this.sceneSunX = this.solarBodies.systemX;
            this.sceneSunZ = this.solarBodies.systemZ;
            this.coordinates.updateSystem(this.sceneSunX, this.sceneSunZ);
            void this.directed?.ensure(this.bootstrap.device, this.bootstrap.format);
            this.syncKeplerBodies(frame.timeSec);
            this.syncDirectedScene();
            this.modelLayer.setModelScale(sceneModelScale(this.modelLayer.getMeshOriginRadius()));
            this.modelLowLayer.setModelScale(sceneModelScale(this.modelLowLayer.getMeshOriginRadius()));
        }
        else {
            this.modelLayer.setModelScale(MODEL_LOD_DEFAULT_SCALE);
            this.modelLowLayer.setModelScale(MODEL_LOD_DEFAULT_SCALE);
            this.releaseSceneSlots(new Set());
            this.lastOccupancy = null;
            this.occupancyKey = "";
            this.directed?.syncSceneFleets([], null);
        }
        const mapBuf = this.directed?.mapStorage?.() ?? null;
        const meshesReady = this.modelLayer.isReady() && this.modelLowLayer.isReady() && !!mapBuf;
        const hullsOn = this.modelPresentation.update(frame.sceneOpen, frame.distance, meshesReady);
        const gen = this.directed?.mappedGeneration?.() ?? 0;
        const key = `${this.focusedBodyIndex}|${this.selectedFleetId ?? ""}|${gen}`;
        if (this.hullLodKey !== key) {
            this.hullLodKey = key;
            this.lastHullHighOn = this.applyFleetHullLod();
        }
        this.modelLayer.setLodMask(FLEET_FLAG_MODEL_HIGH);
        this.modelLowLayer.setLodMask(FLEET_FLAG_MODEL_LOW);
        if (mapBuf) {
            this.modelLayer.setKernelIdentitySource(SCENE_KERNEL_COUNT);
            this.modelLowLayer.setKernelIdentitySource(SCENE_KERNEL_COUNT);
        }
        frame.hullsOn = hullsOn;
        frame.hullHighOn = hullsOn && this.lastHullHighOn;
        this.fleetPresentation.upload.flushFleetGpuDirt();
    }
    applyFleetHullLod() {
        const focus = this.focusedBodyIndex;
        const selected = this.selectedFleetId;
        const view = this.fleetPresentation.storage.fleetGpuView;
        const bytes = this.fleetPresentation.storage.fleetGpuBytes.byteLength;
        let anyHigh = false;
        for (const fleet of this.collectSceneFleets()) {
            const slot = (fleet.gpuSlot ?? -1) | 0;
            const o = slot * FLEET_GPU_STRIDE;
            if (slot < 0 || o + FLEET_GPU_STRIDE > bytes)
                continue;
            const prev = view.getUint32(o + FleetGpuFields.flags, true);
            const bits = fleetModelLodBits({
                selected: selected != null && fleet.id === selected,
                bodyIndex: fleet.bodyIndex,
                focusedBodyIndex: focus,
            });
            if ((bits & FLEET_FLAG_MODEL_HIGH) !== 0)
                anyHigh = true;
            const next = (prev & ~FLEET_FLAG_MODEL_LOD) | bits;
            if (next === prev)
                continue;
            view.setUint32(o + FleetGpuFields.flags, next >>> 0, true);
            this.fleetPresentation.storage.markFleetDirty(slot);
        }
        return anyHigh;
    }
    allocSceneSlot(id) {
        const have = this.sceneSlots.get(id);
        if (have != null && this.sceneSlotLive[have])
            return have;
        if (this.sceneSlots.size >= MAX_SCENE_FLEETS)
            return -1;
        for (let slot = 0; slot < MAX_SCENE_FLEETS; slot++) {
            if (this.sceneSlotLive[slot])
                continue;
            this.sceneSlotLive[slot] = 1;
            this.sceneSlots.set(id, slot);
            return slot;
        }
        return -1;
    }
    releaseSceneSlots(live) {
        for (const [id, slot] of [...this.sceneSlots]) {
            if (live.has(id))
                continue;
            this.sceneSlots.delete(id);
            this.sceneSlotLive[slot] = 0;
            this.fleetPresentation.hideSceneTail(id, 0);
            this.fleetPresentation.ensureSceneVisualCount(id, null);
        }
    }
    sceneFleetPark(hash) {
        const bodyIndex = pickSceneParkBodyIndex(hash, this.solarBodies);
        const toward = compactBodySunLocal(this.solarBodies, bodyIndex, this.timeline.seconds)
            ?? { x: 0, y: 0, z: 0 };
        return { bodyIndex, toward, bodyRadius: this.solarBodies.radius[bodyIndex] ?? 0 };
    }
    collectSceneFleets() {
        if (this.sceneCollectCached)
            return this.sceneCollectCached;
        const storage = this.fleetPresentation.storage;
        const fleets = [];
        for (const visual of this.fleetPresentation.scene.fleetsInJewel().values()) {
            const mapped = this.mapSceneVisual(visual, storage);
            if (mapped)
                fleets.push(mapped);
        }
        this.releaseSceneSlots(new Set(fleets.map((f) => f.id ?? "")));
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
        if ((flags & FLEET_FLAG_SYSTEM_SCENE) === 0)
            return null;
        const hadSlot = this.sceneSlots.has(visual.id);
        const slot = this.allocSceneSlot(visual.id);
        if (slot < 0)
            return null;
        const domain = countShips(visual.counts);
        const want = Math.min(MAX_GROUP_VISUAL, Math.max(0, domain));
        if (!hadSlot)
            this.fleetPresentation.ensureSceneVisualCount(visual.id, want);
        const grown = this.fleetPresentation.records.get(visual.id);
        if (!grown)
            return null;
        const hash = storage.fleetGpuView.getUint32(o + FleetGpuFields.fleetIdHash, true);
        const park = this.sceneFleetPark(hash);
        const systemId = this.solarBodies.systemId;
        const sunX = this.solarBodies.systemX;
        const sunZ = this.solarBodies.systemZ;
        const lookup = this.fleetPresentation.scene.lookup();
        const localOf = (node) => {
            if (!node || !lookup)
                return { x: 0, z: 0 };
            const p = lookup(node);
            if (!p)
                return { x: 0, z: 0 };
            return { x: p.x - sunX, z: p.z - sunZ };
        };
        const st = grown.state;
        const from = st.state === "jumping" ? localOf(st.startNode) : { x: 0, z: 0 };
        const to = st.state === "jumping" ? localOf(st.endNode) : { x: 0, z: 0 };
        return {
            id: grown.id,
            slot,
            gpuSlot: grown.fleetSlot,
            groupId: slot,
            instanceStart: grown.instanceStart,
            shipCount: want,
            paused: (flags & FLEET_FLAG_SIM_PAUSED) !== 0,
            bodyIndex: park.bodyIndex,
            toward: park.toward,
            bodyRadius: park.bodyRadius,
            systemId,
            nowMs: this.timeline.wallMs,
            fromX: from.x,
            fromZ: from.z,
            toX: to.x,
            toZ: to.z,
            state: st,
        };
    }
    syncDirectedScene() {
        if (!this.directed)
            return;
        const wanted = this.collectSceneFleets();
        const previous = this.lastOccupancy;
        const allocated = allocateSceneVisuals(wanted, { previous });
        this.lastOccupancy = allocated;
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
        const paused = allocated.fleets.length > 0 && allocated.fleets.every((f) => f.paused || f.shipCount <= 0);
        const storage = this.fleetPresentation.storage;
        const poses = paused ? seedDirectedShips(SCENE_KERNEL_COUNT, allocated.fleets, (index) => {
            const at = index * SHIP_SIM_STRIDE;
            if (at + 12 > storage.shipSimBytes.byteLength)
                return { x: 0, y: 0, z: 0 };
            return {
                x: storage.shipSimView.getFloat32(at + ShipSimFields.posX, true),
                y: storage.shipSimView.getFloat32(at + ShipSimFields.posY, true),
                z: storage.shipSimView.getFloat32(at + ShipSimFields.posZ, true),
            };
        }, SCENE_LAB_SCALE) : null;
        this.directed.syncSceneFleets(allocated.fleets, this.fleetsLayer.getInstanceBuffer(), poses, this.fleetsLayer.getShipSimBuffer(), this.fleetsLayer.getTrailSampleBuffer());
        this.fleetPresentation.upload.flushFleetGpuDirt();
    }
    drainSceneHideQueue() {
        const budgetMs = 1;
        while (this.sceneHideQueue.length) {
            const t0 = performance.now();
            const next = this.sceneHideQueue.shift();
            if (next)
                this.fleetPresentation.hideSceneTail(next.id, next.live);
            if (performance.now() - t0 >= budgetMs)
                break;
        }
    }
    syncKeplerBodies(timeSec) {
        if (this.solarBodies.systemId == null || typeof this.directed?.syncKeplerBodies !== "function")
            return;
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
    kernelFleetMap() {
        return this.collectSceneFleets().map((f) => ({ id: f.id ?? "", slot: f.slot ?? 0 }));
    }
    receiveDirectorPacket(packet) {
        return this.directed?.receive?.(packet) ?? { status: "closed" };
    }
    setDebugDensityVoxels(on) {
        this.directed?.setDensityVisible?.(on);
    }
    visualCap() {
        return this.directed?.visualCap?.() ?? null;
    }
    sceneDrawStats() {
        const allocated = this.lastOccupancy?.fleets;
        if (!allocated?.length)
            return { fleets: 0, ships: 0, highFleets: 0, lowFleets: 0 };
        const view = this.fleetPresentation.storage.fleetGpuView;
        const bytes = this.fleetPresentation.storage.fleetGpuBytes.byteLength;
        let fleets = 0, ships = 0, highFleets = 0, lowFleets = 0;
        for (const fleet of allocated) {
            const n = fleet.shipCount | 0;
            if (n <= 0)
                continue;
            fleets++;
            ships += n;
            const slot = (fleet.gpuSlot ?? -1) | 0;
            const o = slot * FLEET_GPU_STRIDE;
            if (slot < 0 || o + FLEET_GPU_STRIDE > bytes)
                continue;
            const flags = view.getUint32(o + FleetGpuFields.flags, true);
            if ((flags & FLEET_FLAG_MODEL_HIGH) !== 0)
                highFleets++;
            else
                lowFleets++;
        }
        return { fleets, ships, highFleets, lowFleets };
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
        this.directed?.destroy();
        this.directed = null;
        this.fleetsLayer.dispose();
        this.overlayLines.dispose();
        this.overlay.dispose();
        this.attachments.dispose();
        this.bootstrap.destroy();
        this.surfaceCleanup?.();
        this.surfaceCleanup = null;
    }
}
//# sourceMappingURL=map-renderer-core.js.map