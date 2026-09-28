// @ts-nocheck
import { QualityDiagnostics } from './quality-diagnostics.js';
import { simulationRate, DEFAULT_SIMULATION_RATE } from '../../../contracts/simulation-rate.js';
import { SHIP_SIM_STRIDE } from '../../ship-sim-layout.js';
import { preparePipelines } from '../../../lib/ship-runtime/pipeline-preparation.mjs';
import { sceneCameraShader, sceneSelectionShader, bindSceneCamera } from "../../scene-camera.js";
import { SceneCameraGpu } from './scene-camera-gpu.js';
import { WARP_RIM_ORBIT_MULTIPLIER } from "../../../lib/ship-runtime/scene-scale.mjs";
import { sceneFleetTypes } from './fleet-marker.js';
import { DEFAULT_SHIP_CAPACITY, MAX_SHIP_CAPACITY } from '../../../lib/ship-runtime/ship-capacity.mjs';
import { FLEET_MARKER_WGSL, SHIP_SELECTION_WGSL } from './fleet-marker.wgsl.js';
import { SceneFrameClock } from './scene-frame-clock.js';
import { rebaseWarpMotion } from '../../warp-motion.js';
/** Map host for the directed split-position kernel. Injected device; no canvas. */
import { SHIP_WGSL, SHIP_HISTORY_WORDS, SHIP_HISTORY_BYTES } from "../../../lib/ship-runtime/ship-layout.mjs";
import { createRuntime, STRIDE } from "../../../lib/ship-runtime/engine.mjs";
import { MAP_MSAA_SAMPLES } from "../../map-msaa.js";
import { depthPolicy } from "../../map-depth.js";
import { DENSITY_OVERLAY_WGSL, DENSITY_OVERLAY_SIDE, DENSITY_OVERLAY_CELL_LAB, DENSITY_OVERLAY_VERTICES, } from "./density-overlay.wgsl.js";
import { DIRECTED_PRESENT_WGSL, DIRECTED_PRESENT_WORKGROUP, SCENE_HULL_SIZE, SCENE_MODEL_SIZE_MUL, MAX_SCENE_FLEETS, SCENE_KERNEL_COUNT, MAX_GROUP_VISUAL, directedTickDecision, sceneFleetFingerprint, buildInstanceMap, seedDirectedShips, drainDirectedEncodeTick, labToCompact, compactToLab, occupancyForScene, occupancyVisuals, warpEnterCommand, stageCommand, orbitCommand, pressurePlanetCommand, sceneMotionPlan, pickDensityFields, allocateKernelRanges, droppedInstanceIndices, pickCompactMove, rangesOverlap, SCENE_SHIP_CHUNK, SCENE_CHUNK_BUDGET_MS, SCENE_LAB_SCALE, WARP_ENTER_SEC, PRODUCTION_TRAIL_RING, } from "./directed-present.wgsl.js";
// @ts-expect-error JS helper copied into dist
import { labPressureHalfExtent } from "../../../lib/ship-runtime/kepler-solar.mjs";
import { CLASS_BY_TYPE } from "../../../lib/ship-runtime/classes.mjs";
import { consumeShipTuning, packClassTuning } from "../../../lib/ship-runtime/class-tuning.mjs";
import { packFleetFormation } from "../../../lib/ship-runtime/formation.mjs";
import { FLEET_CENTER_WGSL } from "./fleet-center.mjs";
import { createSceneNearbyPositions } from "./scene-nearby-positions.mjs";
import { SceneShipAccess } from "./scene-ship-access.js";
import { SceneObservations } from "./scene-observations.js";
import { SceneObservationContinuity } from './scene-observation-continuity.js';
import { COMPACT_SYSTEM_SPAN, sceneFleetLifetimeKey } from "./directed-map.mjs";
import { WarpLayout } from "./warp-layout.mjs";
import { reserveOrbitBirth } from './orbit-admission.mjs';
import { planetOrbitAdapt } from "../../../lib/ship-runtime/flight-layout.mjs";
import { createSceneFleetRoutes } from './scene-fleet-routes.mjs';
import { SceneFleetTelemetry } from './scene-fleet-telemetry.js';
import { fleetDebugGeometry } from './fleet-debug-geometry.js';
import { routeActivity, automaticActivity } from './fleet-activity.js';
// @ts-expect-error Shared numeric command-guide helpers.
import { automaticFleetGuide } from './fleet-intent-guides.mjs';
import { SceneRouteLines } from './scene-route-lines.js';
import { createRuntimePreparation } from './runtime-preparation.js';
const REPEL_WGSL = /* wgsl */ `
${SHIP_WGSL}
struct U {
  viewProj: mat4x4<f32>,
  view: mat4x4<f32>,
  poseScale: f32,
  count: u32,
  pad: vec2<f32>,
}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> ships: array<Ship>;
struct ClassTuning { rows: array<vec4<f32>, 12> }
@group(0) @binding(3) var<uniform> classTuning: ClassTuning;
struct V {
  @builtin(position) clip: vec4<f32>,
  @location(0) uv: vec2<f32>,
}
fn repelWorld(typeId: u32) -> f32 {
  let kinds = array<u32, 32>(${CLASS_BY_TYPE.map((x) => `${x}u`).join(",")});
  let kind = kinds[min(typeId, 31u)];
  // Tuning value is the sim-unit radius. poseScale only converts it into the jewel.
  return classTuning.rows[kind * 2u + 1u].x * u.poseScale;
}
@vertex fn vs(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> V {
  var out: V;
  out.clip = vec4<f32>(2.0, 2.0, 2.0, 1.0);
  out.uv = vec2<f32>(0.0);
  if (i >= u.count) { return out; }
  let s = ships[i];
  if (s.identity.z == 0u) { return out; }
  let slot = s.identity.y;
  if (slot >= ${MAX_SCENE_FLEETS}u) { return out; }
  let radius = repelWorld((s.identity.x >> 8u) & 31u);
  if (radius <= 1e-8) { return out; }
  let corner = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, 1.0),
  );
  let q = corner[v];
  let right = normalize(vec3<f32>(u.view[0].x, u.view[1].x, u.view[2].x));
  let up = normalize(vec3<f32>(u.view[0].y, u.view[1].y, u.view[2].y));
  let p = s.p.xyz * u.poseScale + (right * q.x + up * q.y) * radius;
  out.clip = u.viewProj * vec4<f32>(p, 1.0);
  out.uv = q;
  return out;
}
@fragment fn fs(input: V) -> @location(0) vec4<f32> {
  let d = length(input.uv);
  let ring = smoothstep(0.78, 0.9, d) * (1.0 - smoothstep(0.9, 1.0, d));
  let fill = (1.0 - smoothstep(0.0, 1.0, d)) * 0.07;
  let a = ring * 0.28 + fill;
  if (a <= 0.001) { return vec4<f32>(0.0); }
  let rgb = vec3<f32>(0.55, 0.95, 1.0);
  return vec4<f32>(rgb * a, a);
}
`;
export { MAX_SCENE_FLEETS, SCENE_KERNEL_COUNT, MAX_GROUP_VISUAL, directedTickDecision, sceneFleetFingerprint, buildInstanceMap, seedDirectedShips, SCENE_LAB_SCALE, };
function planetOf(fleet) {
    const idx = (fleet.bodyIndex ?? 1) | 0;
    return Math.max(1, Math.min(15, idx));
}
function combatSlotsOf(runtime) {
    const occupied = runtime?.director?.occupied;
    if (!occupied)
        return [];
    return occupied.filter((g) => g.joined).map((g) => g.slot);
}
export function createDirectedSceneHost(injected = null, options = {}) {
    const preparation = createRuntimePreparation();
    let visualCapacity = options.capacity ?? DEFAULT_SHIP_CAPACITY;
    let requestedCapacity = visualCapacity;
    const depth = depthPolicy(options.reverseDepth);
    let runtime = injected;
    let lastWorkgroups = 0;
    let pending = null;
    let initializing = null;
    let ensureError = null;
    let fleets = [];
    let fingerprint = "";
    let instanceBuffer = null;
    let quality = null;
    let shipSimBuffer = null;
    let shipSimDummy = null;
    let trailSampleBuffer = null;
    let trailDummy = null;
    let poseSeed = null;
    let mapCpu = new Uint32Array(0);
    const mappedLive = [];
    let mapGen = 0;
    let kernelFleetCpu = new Uint32Array(0);
    let kernelFleetBuffer = null;
    let mapBuffer = null;
    let fleetTintBuffer = null;
    const fleetTints = new Float32Array(MAX_SCENE_FLEETS * 4);
    let presentationControls = null;
    const detailWords = new Uint32Array(4);
    let followCamera = null;
    let followCameraObserved = null;
    let presentUniform = null;
    let preparationStarted = 0, firstPresentation = false;
    let presentPipeline = null;
    let presentBind = null;
    const frameClock = new SceneFrameClock();
    let simulationHz = DEFAULT_SIMULATION_RATE;
    const rangeOwners = new Map();
    let lastNowMs = 0;
    let presentAlpha = 1;
    let warpPresentationTime = 0;
    const ships = new SceneShipAccess();
    let observations = null;
    let followedShip = null;
    let centerSpanCount = 0;
    let centerGeneration = -1;
    let centerTimeMs = 0;
    const presentWords = new Uint32Array(32);
    const presentFloats = new Float32Array(presentWords.buffer);
    presentFloats[28] = 55;
    presentFloats[29] = 50;
    const centerWords = new Uint32Array(MAX_SCENE_FLEETS * 4);
    const centerParams = new Float32Array(4);
    const pinUniformData = new ArrayBuffer(96);
    const presentBinds = new Map();
    let presentInputs = [];
    let bindKey = "";
    let keplerBodies = [];
    let keplerTime = 0;
    let nearbySystemId = null;
    let selectedId = null;
    let hoveredId = null;
    const typeRows = new Map();
    const typeWords = new Uint32Array(MAX_SCENE_FLEETS * 8);
    let typeBuffer = null;
    let selectionPipeline = null;
    let selectionBind = null;
    let selectionSource = null;
    let capState = { shown: 0, requested: 0, cap: 0 };
    let densityOn = false;
    let repelOn = false;
    let optionalDensity = null, optionalRepel = null;
    let repelPipeline = null;
    let repelUniform = null;
    let repelBind = null;
    let repelBindBuf = null;
    let shipDrawBuffer = null;
    let densityPipeline = null;
    let densityUniform = null;
    let densityBind = null;
    let densityDummy = null;
    let markBuffer = null;
    let markZero = null;
    let spanBuffer = null;
    let centerUniform = null;
    let centerPipeline = null;
    let centerBind = null;
    let centerSource = null;
    let altitudePipeline = null;
    let altitudeUniform = null;
    let altitudeBind = null;
    let colorFormat = "bgra8unorm";
    const warpLayouts = new Map();
    const observationContinuity = new SceneObservationContinuity();
    const warpReservations = new Map();
    const orbitBirthReservations = new Map();
    const seededSlots = new Set();
    const phaseKeys = new Map();
    const pendingOrbit = new Map();
    let slotRanges = new Map();
    let journeyRev = 1;
    let occupancyKey = "";
    let poseCpu = null;
    let seedStaging = null;
    let compactScratch = null;
    let sceneWork = [];
    let compactPending = null;
    let destroyed = false;
    let routeLines = null;
    let routesDirty = true;
    let allPaths = false, debugFleet = false;
    let telemetry = null;
    let debugLines = null;
    let nextGuidesAt = 0;
    const localRoutes = createSceneFleetRoutes({
        formationFrame: (fleet) => routeFormationFrame(fleet),
        center: (id) => { const slot = ships.fleetSlot(id); return slot == null ? null : observations?.routeAnchor(slot); },
        install: (slot, data) => runtime?.uploadSceneRoute?.(slot, data),
        changed: () => { routesDirty = true; },
    });
    const nearbyPositions = createSceneNearbyPositions(MAX_SCENE_FLEETS);
    function debugRepresentatives() {
        if (!debugFleet || !selectedId)
            return [];
        const rows = typeRows.get(selectedId) ?? [], out = [];
        for (const row of rows)
            for (const ordinal of [row.ordinal, row.ordinal + row.count - 1]) {
                const handle = ships.capture(selectedId, ordinal);
                const resolved = handle && ships.resolve(handle.id);
                if (resolved && !out.includes(resolved.kernelIndex))
                    out.push(resolved.kernelIndex);
            }
        return out;
    }
    function showsGuide(id) { return allPaths || id === selectedId || id === hoveredId; }
    function stageGuide(fleet) {
        if (fleet.plan?.phase !== 'stage' || !fleet.plan.exit)
            return [];
        const center = observations?.center(fleet.slot ?? 0), exit = fleet.plan.exit;
        return center ? [{ slot: fleet.slot, color: fleet.marker ?? [.45, .78, 1], status: 'guide', guide: true,
                points: [[center.x, center.y, center.z], [exit.x, exit.y, exit.z]], destination: [exit.x, exit.y, exit.z] }] : [];
    }
    function routeGuides() {
        const out = [...localRoutes.rows.values()].filter(row => showsGuide(row.id)).map(row => ({ ...row, waypoints: row.acceptedIntent?.waypoints ?? row.waypoints }));
        for (const fleet of fleets) {
            if (localRoutes.rows.has(fleet.id) || !showsGuide(fleet.id))
                continue;
            const rows = typeRows.get(fleet.id ?? '');
            out.push(...automaticFleetGuide(fleet, bodyFor(fleet), rows?.[rows.length - 1], warpLayouts.get(fleet.slot ?? 0)), ...stageGuide(fleet));
        }
        return out;
    }
    function fleetActivity(id) {
        const fleet = fleets.find(row => row.id === id);
        if (!fleet)
            return null;
        if (!runtime)
            return { action: 'Scene admission', micro: ensureError ? 'GPU ship runtime unavailable' : 'Preparing GPU ship runtime' };
        if (!joinReady(fleet.slot ?? 0))
            return { action: 'Scene admission', micro: 'Preparing visual ships' };
        const route = localRoutes.rows.get(id);
        if (route)
            return routeActivity(route, telemetry?.freshTravel(fleet.slot ?? 0));
        return fleetAutomaticActivity(fleet);
    }
    function fleetAutomaticActivity(fleet) {
        const handoff = pendingOrbit.get(fleet.slot ?? 0);
        if (handoff)
            return { action: 'System transfer', micro: keplerTime >= handoff.at ? 'Warp exit · awaiting GPU handoff' : 'Inbound warp command' };
        return automaticActivity(fleet.plan?.phase ?? 'pending');
    }
    function mappedCount() {
        return fleets.reduce((n, f) => n + Math.max(0, f.shipCount | 0), 0);
    }
    function fleetSeedCount(fleet) {
        const layout = warpLayouts.get(fleet.slot ?? 0);
        if (layout)
            return layout.offsets.length / 4;
        return fleets.find(row => row.slot === fleet.slot)?.shipCount ?? fleet.shipCount;
    }
    function routeFormationFrame(fleet) {
        if (!observations)
            return null;
        const slot = fleet.slot ?? 0;
        const layout = warpLayouts.get(slot);
        const ready = mappedFleets().find(row => row.slot === slot);
        if (!layout || !ready || ready.shipCount !== fleet.shipCount)
            return null;
        const center = observations.center(slot);
        const anchor = observations.routeAnchor(slot);
        if (!center || !anchor || center.n !== ready.shipCount)
            return null;
        return { radius: layout.radius, bias: [anchor.x - center.x, anchor.y - center.y, anchor.z - center.z] };
    }
    function fleetFormation(ready = mappedFleets()) {
        const rows = ready.map(fleet => {
            const layout = warpLayouts.get(fleet.slot ?? 0);
            return { ...fleet, seedShipCount: fleetSeedCount(fleet), formationOrigin: layout?.center, formationRadius: layout?.radius };
        });
        return packFleetFormation(rows, MAX_SCENE_FLEETS, slotRanges);
    }
    function applyOccupancy() {
        if (!runtime?.extras?.compactVisuals)
            return;
        const key = fleets.map((f) => `${(f.slot ?? 0) | 0}:${f.shipCount | 0}:${f.id ?? ""}`).join("|");
        if (key === occupancyKey)
            return;
        occupancyKey = key;
        runtime.extras.compactVisuals(occupancyVisuals({ fleets }));
        runtime.uploadFormation(fleetFormation(), true);
    }
    function allPaused() {
        return fleets.length > 0 && fleets.every((f) => f.paused);
    }
    function applyKepler() {
        if (!runtime || keplerBodies.length === 0)
            return;
        runtime.extras?.keplerBodies?.(keplerBodies, keplerTime);
    }
    function bodyFor(fleet) {
        return keplerBodies[planetOf(fleet)] ?? keplerBodies[1] ?? keplerBodies[0];
    }
    function pressureHalf(fleet) {
        const radius = bodyFor(fleet)?.radius;
        const lab = compactToLab(Number.isFinite(radius) ? radius : 0);
        return labPressureHalfExtent(lab);
    }
    function attachPlan(fleet) {
        const plan = sceneMotionPlan({
            state: fleet.state,
            nowMs: fleet.nowMs,
            systemId: fleet.systemId,
            fromX: fleet.fromX,
            fromZ: fleet.fromZ,
            toX: fleet.toX,
            toZ: fleet.toZ,
            fromPos: fleet.toward,
            outerR: WARP_RIM_ORBIT_MULTIPLIER * keplerBodies.reduce((radius, body) => Math.max(radius, body.orbitRadius ?? 0), 0),
            slot: fleet.slot,
        });
        fleet.plan = plan;
        if (plan.paused)
            fleet.paused = true;
        return plan;
    }
    function labExit(plan) {
        const e = plan?.exit;
        if (!e)
            return [0, 0, 0];
        return [compactToLab(e.x), compactToLab(e.y), compactToLab(e.z)];
    }
    function phaseKey(plan, fleet) {
        const ex = plan?.exit;
        const planet = plan?.planet ? planetOf(fleet) : 0;
        return `${plan?.phase}:${planet}:${ex ? ex.x.toFixed(2) : 0}:${ex ? ex.z.toFixed(2) : 0}`;
    }
    const pendingCommands = [];
    function queueCommands(cmds) {
        for (const cmd of cmds)
            pendingCommands.push(cmd);
    }
    function flushPendingCommands() {
        if (!runtime?.applyCommands || pendingCommands.length === 0)
            return;
        runtime.applyCommands(pendingCommands.splice(0));
    }
    function driveOrbit(fleet, slot, now) {
        const planet = planetOf(fleet);
        queueCommands([
            orbitCommand(now, slot, planet, journeyRev - 1),
            pressurePlanetCommand(slot, planet, pressureHalf(fleet), journeyRev),
        ]);
    }
    function driveStage(fleet, plan, slot, now) {
        const planet = planetOf(fleet);
        queueCommands([
            stageCommand(now, slot, labExit(plan), journeyRev - 1, planet),
            pressurePlanetCommand(slot, planet, pressureHalf(fleet), journeyRev),
        ]);
    }
    function driveWarp(fleet, plan, slot, now) {
        const planet = plan.planet ? planetOf(fleet) : undefined;
        const cmds = [warpEnterCommand(now, slot, planet, labExit(plan), journeyRev - 1, plan.warpSec)];
        if (planet)
            cmds.push(pressurePlanetCommand(slot, planet, pressureHalf(fleet), journeyRev));
        queueCommands(cmds);
        if (planet && plan.phase === "inbound") {
            pendingOrbit.set(slot, {
                at: now + (plan.warpSec || WARP_ENTER_SEC),
                cmd: orbitCommand(now + (plan.warpSec || 0), slot, planet, journeyRev + 1),
            });
        }
    }
    function canDrive(fleet, plan) {
        return runtime?.applyCommands && fleet.shipCount > 0 && !plan.paused && plan.phase !== "hide";
    }
    function driveFleet(fleet) {
        const plan = fleet.plan ?? attachPlan(fleet);
        const slot = (fleet.slot ?? 0) >>> 0;
        if (!canDrive(fleet, plan))
            return;
        // Let the GPU evaluate the final timed warp pose before replacing its journey.
        // A domain arrival can precede that tick after a slow/suspended render frame.
        if ((plan.phase === "orbit" || plan.phase === "stage") && pendingOrbit.has(slot))
            return;
        const move = fleet.state?.state === 'awaiting' && fleet.state.localMove;
        const key = move ? `move:${fleet.generation ?? 0}:${move.orderId ?? move.revision}` : phaseKey(plan, fleet);
        if (phaseKeys.get(slot) === key)
            return;
        phaseKeys.set(slot, key);
        pendingOrbit.delete(slot);
        // The kinematic journey uses domain/Kepler time; local integration stays fixed-step.
        const now = keplerTime;
        // A phase reserves journey, pressure and delayed orbit revisions. Reusing a
        // fleet slot must outrank that previous orbit, not repeat its revision.
        journeyRev += 3;
        if (move) {
            queueCommands([{ fleet: slot, journey: { mode: 'route', at: now, end: now + 1e6,
                        planet: planetOf(fleet), revision: journeyRev - 1,
                        exit: [move.destination.x, move.destination.y, move.destination.z].map(compactToLab) } }]);
            return;
        }
        if (plan.phase === "orbit")
            return driveOrbit(fleet, slot, now);
        if (plan.phase === "stage")
            return driveStage(fleet, plan, slot, now);
        driveWarp(fleet, plan, slot, now);
    }
    function dropStaleSlots() {
        const live = new Set(fleets.map((f) => (f.slot ?? 0) >>> 0));
        for (const slot of [...seededSlots]) {
            if (live.has(slot))
                continue;
            seededSlots.delete(slot);
            pendingOrbit.delete(slot);
            phaseKeys.delete(slot);
        }
    }
    function issueNewFleets() {
        if (!runtime)
            return;
        dropStaleSlots();
        for (const fleet of fleets) {
            // bindFleets already attached this frame's time/intent plan.
            if (!fleet.plan)
                attachPlan(fleet);
            const slot = (fleet.slot ?? 0) >>> 0;
            if (fleet.shipCount <= 0)
                continue;
            if (!joinReady(slot))
                continue;
            if (!seededSlots.has(slot)) {
                if (!fleet.paused && keplerBodies.length < 2 && fleet.plan?.phase === "orbit")
                    continue;
                seededSlots.add(slot);
            }
            if (!fleet.paused)
                driveFleet(fleet);
        }
    }
    function pressureFloats(pressure) {
        if (!pressure?.data)
            return null;
        if (pressure.data instanceof Float32Array)
            return pressure.data;
        return new Float32Array(pressure.data.buffer ?? pressure.data);
    }
    function pressureFieldAt(f, frames, slot) {
        const at = frames + slot * 4;
        const cellLab = f[at + 3] > 0 ? f[at + 3] : DENSITY_OVERLAY_CELL_LAB;
        return {
            x: labToCompact(f[at] || 0),
            y: labToCompact(f[at + 1] || 0),
            z: labToCompact(f[at + 2] || 0),
            cell: labToCompact(cellLab),
            slot,
        };
    }
    function pressureFields(runtime) {
        const pressure = runtime.pressure;
        if (!pressure?.data)
            return [];
        const f = pressureFloats(pressure);
        const w = new Uint32Array(pressure.data.buffer ?? pressure.data);
        const frames = pressure.layout?.frames ?? 0;
        const out = [];
        for (let i = 0; i < (w[0] | 0); i++)
            out.push(pressureFieldAt(f, frames, w[4 + i] | 0));
        return out;
    }
    function densityCellLimit() {
        let maxR = 0.001;
        for (const b of keplerBodies) {
            if (b.isSun)
                continue;
            maxR = Math.max(maxR, b.radius || 0);
        }
        return maxR * 0.5;
    }
    function writeDensityUniform(runtime, viewProj, field) {
        const u = new Float32Array(24);
        const vp = viewProj instanceof Float32Array ? viewProj : new Float32Array(viewProj);
        u.set(vp.subarray(0, 16), 0);
        u[16] = field.x;
        u[17] = field.y;
        u[18] = field.z;
        u[20] = DENSITY_OVERLAY_SIDE;
        u[21] = field.cell;
        u[22] = 1;
        u[23] = field.cell;
        runtime.device.queue.writeBuffer(densityUniform, 0, u);
    }
    function drawDensityField(pass, runtime, density, viewProj, field, limit) {
        if (!(field.cell > 1e-7) || field.cell > limit)
            return;
        const fieldBytes = DENSITY_OVERLAY_SIDE ** 3 * 4;
        const offset = field.slot * fieldBytes;
        const size = Math.min(fieldBytes, Math.max(4, density.size - offset));
        if (offset + size > density.size)
            return;
        writeDensityUniform(runtime, viewProj, field);
        densityBind = runtime.device.createBindGroup({
            layout: densityPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: densityUniform } },
                { binding: 1, resource: { buffer: density, offset, size } },
            ],
        });
        pass.setBindGroup(0, densityBind);
        pass.draw(DENSITY_OVERLAY_VERTICES, DENSITY_OVERLAY_SIDE ** 3);
    }
    function flushOrbits() {
        if (!runtime?.applyCommands || pendingOrbit.size === 0)
            return;
        const due = [];
        for (const [slot, row] of pendingOrbit) {
            if (runtime.now + 1e-6 >= row.at) {
                due.push(row.cmd);
                pendingOrbit.delete(slot);
            }
        }
        if (due.length)
            queueCommands(due);
    }
    function writeKernelSlice(start, count) {
        if (!runtime || !poseCpu || count <= 0)
            return;
        const bytes = count * STRIDE;
        const offset = start * STRIDE;
        if (offset + bytes > poseCpu.byteLength)
            return;
        runtime.device.queue.writeBuffer(runtime.state, offset, poseCpu, offset, bytes);
        runtime.device.queue.writeBuffer(runtime.pendingPoseBuffer(), offset, poseCpu, offset, bytes);
    }
    let historyDead = new Float32Array(0);
    let trailDead = new Float32Array(0);
    let presentedDead = new Uint8Array(0);
    function historyTombstone(count) {
        const n = Math.max(0, count | 0) * SHIP_HISTORY_WORDS;
        if (historyDead.length < n) {
            historyDead = new Float32Array(n);
            for (let i = 3; i < n; i += 4)
                historyDead[i] = -1;
        }
        return historyDead.subarray(0, n);
    }
    function trailTombstone(count) {
        const n = Math.max(0, count | 0) * PRODUCTION_TRAIL_RING * 4;
        if (trailDead.length < n) {
            trailDead = new Float32Array(n);
            for (let i = 2; i < n; i += 4)
                trailDead[i] = -1;
        }
        return trailDead.subarray(0, n);
    }
    function zeroHistorySlice(start, count) {
        if (!runtime?.history || count <= 0)
            return;
        runtime.device.queue.writeBuffer(runtime.history, start * SHIP_HISTORY_BYTES, historyTombstone(count));
    }
    function tombstoneTrailRange(instanceStart, count) {
        if (!trailSampleBuffer || count <= 0)
            return;
        runtime.device.queue.writeBuffer(trailSampleBuffer, instanceStart * PRODUCTION_TRAIL_RING * 16, trailTombstone(count));
    }
    function zeroPresentedSlice(start, count) {
        const offset = start * SHIP_SIM_STRIDE, bytes = count * SHIP_SIM_STRIDE;
        if (!shipSimBuffer || offset + bytes > shipSimBuffer.size)
            return;
        if (presentedDead.byteLength < bytes)
            presentedDead = new Uint8Array(bytes);
        // A new coordinate frame can reuse the same logical serial and kernel slot.
        // Its embedded compact trail must not inherit the retired frame's knots.
        runtime.device.queue.writeBuffer(shipSimBuffer, offset, presentedDead, 0, bytes);
    }
    function zeroKernelSlice(start, count) {
        if (!poseCpu || count <= 0)
            return;
        const w = new Uint32Array(poseCpu);
        const end = Math.min(start + count, poseCpu.byteLength / STRIDE);
        const stride = STRIDE / 4;
        for (let k = start; k < end; k++) {
            const o = k * stride;
            w[o + 20] = 0;
            w[o + 21] = 0;
            w[o + 22] = 0;
            w[o + 23] = 0;
        }
        writeKernelSlice(start, count);
        zeroHistorySlice(start, count);
        zeroPresentedSlice(start, count);
    }
    function dummyPose() {
        return { x: 0, y: 0, z: 0 };
    }
    function joinReady(slot) {
        const job = sceneWork.find((j) => j.type === "join" && j.slot === slot);
        if (job)
            return job.seeded > 0;
        return true;
    }
    function mappedFleets() {
        return fleets.map((f) => {
            const slot = (f.slot ?? 0) >>> 0;
            const job = sceneWork.find((j) => j.type === "join" && j.slot === slot);
            if (job)
                return { ...f, shipCount: job.seeded };
            return f;
        });
    }
    function leaveBlocks(start, cap) {
        return sceneWork.some((j) => j.type === "leave" && rangesOverlap({ start: j.start + j.done, cap: j.cap - j.done }, { start, cap }));
    }
    function releaseWarpLayouts(owners) {
        for (const [slot, layout] of warpLayouts) {
            if (owners.get(slot) === layout.key)
                continue;
            warpReservations.delete(layout.key);
            orbitBirthReservations.delete(layout.key);
            warpLayouts.delete(slot);
        }
    }
    function retireSlotIntent(slot) {
        seededSlots.delete(slot);
        phaseKeys.delete(slot);
        pendingOrbit.delete(slot);
        for (let i = pendingCommands.length - 1; i >= 0; i--) {
            if (pendingCommands[i].fleet === slot)
                pendingCommands.splice(i, 1);
        }
    }
    function clipPendingJoins() {
        for (const job of sceneWork) {
            if (job.type !== "join")
                continue;
            job.cap = Math.min(job.cap, slotRanges.get(job.slot)?.cap ?? 0);
            job.seeded = Math.min(job.seeded, job.cap);
        }
        sceneWork = sceneWork.filter(job => job.type !== "join" || job.seeded < job.cap);
    }
    function enqueueMembership() {
        if (!runtime)
            return;
        const owners = new Map(fleets.map(f => [(f.slot ?? 0) >>> 0, sceneFleetLifetimeKey(f)]));
        for (const [slot, range] of slotRanges) {
            if (owners.get(slot) === rangeOwners.get(slot))
                continue;
            slotRanges.delete(slot);
            retireSlotIntent(slot);
            sceneWork = sceneWork.filter(job => job.type !== 'join' || job.slot !== slot);
            sceneWork.push({ type: 'leave', start: range.start, cap: range.cap, done: 0 });
        }
        rangeOwners.clear();
        releaseWarpLayouts(owners);
        for (const [slot, owner] of owners)
            rangeOwners.set(slot, owner);
        const allocated = allocateKernelRanges(fleets, runtime.count, slotRanges);
        slotRanges = allocated.ranges;
        clipPendingJoins();
        for (const r of allocated.abandoned) {
            if (r.cap <= 0)
                continue;
            sceneWork.push({ type: "leave", start: r.start, cap: r.cap, done: 0 });
        }
        for (const slot of allocated.grown) {
            const r = slotRanges.get(slot);
            if (!r || r.cap <= 0)
                continue;
            if (sceneWork.some((j) => j.type === "join" && j.slot === slot))
                continue;
            sceneWork.push({ type: "join", slot, start: r.start, cap: r.cap, seeded: 0 });
        }
    }
    function warpLayoutFor(fleet, slot) {
        let layout = warpLayouts.get(slot);
        if (!layout) {
            // Match contactPush's largest body-dependent clearance in this scene.
            const maxAdapt = keplerBodies.reduce((max, body) => Math.max(max, planetOrbitAdapt(compactToLab(body.radius))), 0.02);
            layout = new WarpLayout(fleet, packClassTuning(), warpReservations, maxAdapt * 0.075);
            warpLayouts.set(slot, layout);
        }
        return layout;
    }
    function orbitBirthFor(fleet, layout) {
        if (fleet.plan?.phase !== 'orbit')
            return undefined;
        // Freeze the physical birth cloud and body snapshot across admission chunks.
        // It is a placement reservation, never a live collision/position authority.
        if (!layout.orbitBirth)
            layout.orbitBirth = reserveOrbitBirth(layout, fleet, bodyFor(fleet), keplerBodies, orbitBirthReservations, keplerTime);
        return layout.orbitBirth.origin;
    }
    function seedJoinChunk(job, count, deadline) {
        if (!runtime || count <= 0)
            return;
        const fleet = fleets.find((f) => ((f.slot ?? 0) | 0) === job.slot);
        if (!fleet)
            return;
        if (!fleet.plan)
            attachPlan(fleet);
        const layout = warpLayoutFor(fleet, job.slot);
        const ready = layout.advance(job.seeded + count, deadline);
        count = Math.min(count, ready - job.seeded);
        if (count <= 0)
            return;
        const warpOffsets = layout.offsets;
        const bytes = count * STRIDE;
        if (!seedStaging || seedStaging.byteLength < bytes)
            seedStaging = new ArrayBuffer(Math.max(bytes, SCENE_SHIP_CHUNK * STRIDE));
        seedDirectedShips(job.start + job.cap, [{ ...fleet, paused: false, warpOffsets, orbitSeedOrigin: orbitBirthFor(fleet, layout), seedShipCount: warpOffsets.length / 4, seedTime: runtime.localTime(keplerTime) }], dummyPose, 1, {
            into: seedStaging,
            ranges: new Map([[job.slot, { start: job.start, cap: job.cap }]]),
            onlySlots: new Set([job.slot]),
            arrival: "orbit",
            seedFrom: job.seeded,
            seedCount: count,
            rowBase: 0,
        });
        runtime.uploadWarpOffsets(job.start + job.seeded, warpOffsets.subarray(job.seeded * 4, (job.seeded + count) * 4));
        const gpuOff = (job.start + job.seeded) * STRIDE;
        runtime.device.queue.writeBuffer(runtime.state, gpuOff, seedStaging, 0, bytes);
        runtime.device.queue.writeBuffer(runtime.pendingPoseBuffer(), gpuOff, seedStaging, 0, bytes);
        zeroHistorySlice(job.start + job.seeded, count);
        if (job.seeded === 0)
            tombstoneTrailRange(job.start, Math.min(fleet.shipCount | 0, job.cap));
        job.seeded += count;
    }
    function drainLeaveJoin() {
        if (!runtime)
            return;
        const budget = SCENE_CHUNK_BUDGET_MS;
        const t0 = performance.now();
        for (;;) {
            const job = sceneWork.find((j) => j.type === "leave");
            if (!job || job.type !== "leave")
                break;
            const n = Math.min(SCENE_SHIP_CHUNK, job.cap - job.done);
            if (!poseCpu || poseCpu.byteLength < runtime.count * STRIDE) {
                poseCpu = new ArrayBuffer(runtime.count * STRIDE);
            }
            zeroKernelSlice(job.start + job.done, n);
            job.done += n;
            if (job.done >= job.cap) {
                const i = sceneWork.indexOf(job);
                if (i >= 0)
                    sceneWork.splice(i, 1);
            }
            if (performance.now() - t0 >= budget)
                return;
        }
        let changed = false;
        for (;;) {
            const job = sceneWork.find((j) => j.type === "join" && !leaveBlocks(j.start + j.seeded, Math.min(SCENE_SHIP_CHUNK, j.cap - j.seeded)));
            if (!job || job.type !== "join")
                break;
            const n = Math.min(SCENE_SHIP_CHUNK, job.cap - job.seeded);
            seedJoinChunk(job, n, t0 + budget);
            if (job.seeded >= job.cap) {
                const i = sceneWork.indexOf(job);
                if (i >= 0)
                    sceneWork.splice(i, 1);
            }
            changed = true;
            if (performance.now() - t0 >= budget)
                break;
        }
        if (changed)
            writeMapAndFleetTables();
    }
    function ensureScratch(bytes) {
        if (!runtime)
            return null;
        const size = Math.max(bytes, MAX_GROUP_VISUAL * SHIP_HISTORY_BYTES);
        if (compactScratch && compactScratch.size >= size)
            return compactScratch;
        compactScratch?.destroy();
        compactScratch = runtime.device.createBuffer({
            size,
            usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        });
        return compactScratch;
    }
    function copyKernelRange(encoder, oldStart, newStart, n, _overlap) {
        if (!runtime || n <= 0 || oldStart === newStart)
            return;
        const copy = (buf, stride) => {
            if (!buf)
                return;
            const bytes = n * stride;
            const src = oldStart * stride;
            const dst = newStart * stride;
            if (src + bytes > buf.size || dst + bytes > buf.size)
                return;
            // Chrome invalidates copyBufferToBuffer when src === dst, even if ranges
            // are disjoint. Always hop through scratch.
            const scratch = ensureScratch(bytes);
            if (!scratch)
                return;
            encoder.copyBufferToBuffer(buf, src, scratch, 0, bytes);
            encoder.copyBufferToBuffer(scratch, 0, buf, dst, bytes);
        };
        copy(runtime.state, STRIDE);
        copy(runtime.pendingPoseBuffer(), STRIDE);
        copy(runtime.history, SHIP_HISTORY_BYTES);
        copy(presentationControls, 16);
        if (shipSimBuffer && shipSimBuffer.size > SHIP_SIM_STRIDE)
            copy(shipSimBuffer, SHIP_SIM_STRIDE);
        const travelScratch = ensureScratch(n * 16);
        if (travelScratch)
            runtime.copyTravelOffsets(encoder, oldStart, newStart, n, travelScratch);
    }
    function recordCompact(encoder) {
        if (!runtime || compactPending)
            return;
        if (sceneWork.some((j) => j.type === "join" || j.type === "leave"))
            return;
        const move = pickCompactMove(slotRanges, runtime.count);
        if (!move)
            return;
        if (sceneWork.some((j) => j.type === "join" && j.slot === move.slot))
            return;
        copyKernelRange(encoder, move.oldStart, move.newStart, move.cap, move.overlap);
        slotRanges.set(move.slot, { start: move.newStart, cap: move.cap });
        compactPending = move;
    }
    function commitCompact() {
        if (!compactPending || !runtime)
            return;
        const move = compactPending;
        compactPending = null;
        writeMapAndFleetTables();
        const offsets = warpLayouts.get(move.slot)?.offsets;
        if (offsets)
            runtime.uploadWarpOffsets(move.newStart, offsets.subarray(0, move.cap * 4), false);
        if (!poseCpu || poseCpu.byteLength < runtime.count * STRIDE)
            poseCpu = new ArrayBuffer(runtime.count * STRIDE);
        zeroKernelSlice(move.oldStart, move.cap);
    }
    let instanceHide = new Float32Array(12 * 64);
    function hideDroppedInstances(prev, next) {
        if (!runtime || !instanceBuffer)
            return;
        const dropped = droppedInstanceIndices(prev, next);
        if (dropped.length === 0)
            return;
        dropped.sort((a, b) => a - b);
        const stride = 48;
        const cap = Math.floor(instanceBuffer.size / stride);
        let i = 0;
        while (i < dropped.length) {
            const start = dropped[i] >>> 0;
            if (start >= cap) {
                i++;
                continue;
            }
            let count = 1;
            i++;
            while (i < dropped.length && dropped[i] === start + count && start + count < cap) {
                count++;
                i++;
            }
            const floats = count * 12;
            if (instanceHide.length < floats)
                instanceHide = new Float32Array(floats);
            const bytes = floats * 4;
            const offset = start * stride;
            if (offset + bytes > instanceBuffer.size)
                continue;
            if (instanceHide.byteOffset + bytes > instanceHide.buffer.byteLength)
                continue;
            runtime.device.queue.writeBuffer(instanceBuffer, offset, instanceHide.buffer, instanceHide.byteOffset, bytes);
        }
    }
    function invalidateObservations(ready) {
        const centerSlots = observationContinuity.reconcile(ready);
        const followed = followedShip == null ? null : ships.resolve(followedShip);
        const followedSlot = followed ? ships.fleetSlot(followed.handle.fleetId) : null;
        observations?.invalidate({ centerSlots,
            shipHandle: followedSlot != null && centerSlots.has(followedSlot) ? followedShip : null });
    }
    function writeMapAndFleetTables() {
        if (!runtime)
            return;
        const ready = mappedFleets();
        runtime.uploadFormation(fleetFormation(ready), false);
        ships.sync(ready, slotRanges);
        for (const fleet of fleets)
            fleet.serialBase = ships.serialBase(fleet.id ?? "");
        const prevMap = mapCpu;
        mapCpu = buildInstanceMap(ready, runtime.count, slotRanges);
        if (options.instanceBase != null) {
            for (let i = 0; i < mapCpu.length; i++)
                if (mapCpu[i] !== 0xffffffff)
                    mapCpu[i] = options.instanceBase + i;
        }
        hideDroppedInstances(prevMap, mapCpu);
        const bytes = mapCpu.byteLength;
        if (!mapBuffer || mapBuffer.size < bytes) {
            mapBuffer?.destroy();
            mapBuffer = runtime.device.createBuffer({
                size: Math.max(4, bytes),
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
            });
            presentBind = null;
            bindKey = "";
        }
        runtime.device.queue.writeBuffer(mapBuffer, 0, mapCpu);
        writeKernelFleetTable(ready);
        fleetTintBuffer ?? (fleetTintBuffer = runtime.device.createBuffer({ label: 'scene-fleet-tints', size: fleetTints.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
        fleetTints.fill(0);
        for (const f of fleets)
            fleetTints.set(f.marker ?? [0.45, 0.78, 1], (f.slot ?? 0) * 4);
        runtime.device.queue.writeBuffer(fleetTintBuffer, 0, fleetTints);
        typeBuffer ?? (typeBuffer = runtime.device.createBuffer({ label: 'scene-fleet-types', size: typeWords.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
        typeRows.clear();
        typeWords.fill(0);
        for (const f of ready) {
            const fullCount = fleetSeedCount(f);
            const rows = sceneFleetTypes(f.id ?? '', fullCount, f.type).map(row => ({ ...row,
                count: Math.min(row.count, Math.max(0, f.shipCount - row.ordinal)) })).filter(row => row.count > 0);
            typeRows.set(f.id ?? '', rows);
            const at = (f.slot ?? 0) * 8;
            for (const row of rows)
                typeWords[at + row.kind] = row.count;
            typeWords[at + 6] = rows.length;
        }
        runtime.device.queue.writeBuffer(typeBuffer, 0, typeWords);
        mappedLive.length = 0;
        for (let i = 0; i < mapCpu.length; i++) {
            const inst = mapCpu[i];
            if (inst !== 0xffffffff)
                mappedLive.push(inst >>> 0);
        }
        mapGen++;
        telemetry?.invalidate();
        routesDirty = true;
        invalidateObservations(ready);
    }
    function rebuildMap() {
        if (!runtime)
            return;
        if (allPaused() && poseSeed) {
            slotRanges = new Map();
            sceneWork.length = 0;
            compactPending = null;
            mapCpu = buildInstanceMap(fleets, runtime.count);
            runtime.device.queue.writeBuffer(runtime.state, 0, poseSeed);
            runtime.device.queue.writeBuffer(runtime.pendingPoseBuffer(), 0, poseSeed);
            writeMapAndFleetTables();
            presentBind = null;
            bindKey = "";
            return;
        }
        enqueueMembership();
        writeMapAndFleetTables();
        presentBind = null;
        bindKey = "";
    }
    function writeKernelFleetTable(ready) {
        if (!runtime)
            return;
        const n = runtime.count;
        if (kernelFleetCpu.length !== n)
            kernelFleetCpu = new Uint32Array(n);
        kernelFleetCpu.fill(0xffffffff);
        for (const f of ready) {
            const r = slotRanges.get((f.slot ?? 0) >>> 0);
            const gpu = (f.gpuSlot ?? 0xffffffff) >>> 0;
            if (!r || gpu === 0xffffffff)
                continue;
            const ships = Math.min(Math.max(0, f.shipCount | 0), r.cap);
            for (let k = 0; k < ships; k++)
                kernelFleetCpu[r.start + k] = gpu;
        }
        const bytes = Math.max(4, n * 4);
        if (!kernelFleetBuffer || kernelFleetBuffer.size < bytes) {
            kernelFleetBuffer?.destroy();
            kernelFleetBuffer = runtime.device.createBuffer({
                size: bytes,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });
            presentBind = null;
            bindKey = "";
        }
        runtime.device.queue.writeBuffer(kernelFleetBuffer, 0, kernelFleetCpu);
    }
    function storageDummy(existing, size) {
        return existing ?? runtime.device.createBuffer({
            size,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
    }
    function presentResources(source) {
        if (!presentUniform) {
            presentUniform = runtime.device.createBuffer({
                size: 128,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
        }
        presentationControls ?? (presentationControls = runtime.device.createBuffer({ label: 'scene-ship-controls', size: runtime.count * 16,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC }));
        if (!shipSimBuffer)
            shipSimDummy = storageDummy(shipSimDummy, SHIP_SIM_STRIDE);
        if (!trailSampleBuffer)
            trailDummy = storageDummy(trailDummy, 128);
        return {
            sims: shipSimBuffer ?? shipSimDummy,
            trails: trailSampleBuffer ?? trailDummy,
            source,
        };
    }
    function growPresentationControls() {
        if (!runtime || !presentationControls || presentationControls.size >= runtime.count * 16)
            return;
        const previous = presentationControls;
        presentationControls = runtime.device.createBuffer({ label: 'scene-ship-controls', size: runtime.count * 16,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
        const encoder = runtime.device.createCommandEncoder();
        encoder.copyBufferToBuffer(previous, 0, presentationControls, 0, previous.size);
        runtime.device.queue.submit([encoder.finish()]);
        void runtime.device.queue.onSubmittedWorkDone().catch(() => { }).then(() => previous.destroy());
    }
    function ensureCapacity() {
        if (!runtime || requestedCapacity <= runtime.count || !runtime.growSceneCapacity?.(requestedCapacity))
            return;
        growPresentationControls();
        rebuildMap();
    }
    function ensureMarks() {
        if (markBuffer || !runtime)
            return;
        const markBytes = MAX_SCENE_FLEETS * 32;
        markBuffer = runtime.device.createBuffer({
            label: "fleet-pin",
            size: markBytes,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        });
        observations = new SceneObservations(runtime.device, MAX_SCENE_FLEETS);
        if (runtime.inspection)
            telemetry = new SceneFleetTelemetry(runtime.device, runtime.inspection);
        markZero = new Uint8Array(markBytes);
        spanBuffer = runtime.device.createBuffer({
            label: "fleet-center-spans",
            size: MAX_SCENE_FLEETS * 16,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        centerUniform = runtime.device.createBuffer({
            label: "fleet-center-uniform",
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
    }
    function packMarker(fleet) {
        const rgb = fleet.marker;
        const channel = (v) => Math.round(Math.min(1, Math.max(0, Number(v) || 0)) * 255) & 255;
        if (!rgb)
            return (115 << 16) | (199 << 8) | 255;
        return (channel(rgb[0]) << 16) | (channel(rgb[1]) << 8) | channel(rgb[2]);
    }
    function fleetSlot(id) {
        if (!id)
            return 0xffffffff;
        for (const fleet of fleets) {
            if (fleet.id === id)
                return (fleet.slot ?? 0) >>> 0;
        }
        return 0xffffffff;
    }
    function liveSpans() {
        const rows = [];
        for (const fleet of fleets) {
            const slot = (fleet.slot ?? 0) | 0;
            if (slot < 0 || slot >= MAX_SCENE_FLEETS)
                continue;
            const range = slotRanges.get(slot);
            const count = Math.min(Math.max(0, fleet.shipCount | 0), range?.cap ?? 0);
            if (!range || count <= 0)
                continue;
            rows.push({ start: range.start | 0, count, slot, color: packMarker(fleet) });
        }
        return rows;
    }
    function bindPresent(source, sims) {
        if (!kernelFleetBuffer)
            kernelFleetBuffer = storageDummy(kernelFleetBuffer, 4);
        const previous = source === runtime.state ? runtime.pendingPoseBuffer() : runtime.state;
        const inputs = [instanceBuffer, mapBuffer, sims, kernelFleetBuffer, runtime.classTuningBuffer()];
        if (inputs.some((value, i) => value !== presentInputs[i])) {
            presentBinds.clear();
            presentInputs = inputs;
        }
        presentBind = presentBinds.get(source) ?? null;
        if (presentBind)
            return;
        presentBind = runtime.device.createBindGroup({
            layout: presentPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: presentUniform } },
                { binding: 1, resource: { buffer: source } },
                { binding: 2, resource: { buffer: instanceBuffer } },
                { binding: 3, resource: { buffer: mapBuffer } },
                { binding: 4, resource: { buffer: sims } },
                { binding: 5, resource: { buffer: runtime.classTuningBuffer() } },
                { binding: 6, resource: { buffer: previous } },
                { binding: 9, resource: { buffer: fleetTintBuffer } },
                { binding: 8, resource: { buffer: presentationControls } },
                { binding: 7, resource: { buffer: kernelFleetBuffer } },
            ],
        });
        presentBinds.set(source, presentBind);
    }
    function encodeFleetCenter(encoder, source) {
        if (!runtime || !centerPipeline)
            return;
        ensureMarks();
        if (!markBuffer || !spanBuffer || !centerUniform || !markZero)
            return;
        if (centerGeneration !== mapGen) {
            runtime.device.queue.writeBuffer(markBuffer, 0, markZero);
            const spans = liveSpans();
            centerSpanCount = spans.length;
            centerGeneration = mapGen;
            if (spans.length === 0)
                return;
            const words = centerWords;
            for (let i = 0; i < spans.length; i++) {
                const row = spans[i];
                words[i * 4] = row.start;
                words[i * 4 + 1] = row.count;
                words[i * 4 + 2] = row.slot;
                words[i * 4 + 3] = row.color;
            }
            runtime.device.queue.writeBuffer(spanBuffer, 0, words, 0, spans.length * 4);
            new Uint32Array(centerParams.buffer)[0] = spans.length;
            centerParams[1] = 1; // Presentation ShipSim is already in compact coordinates.
            runtime.device.queue.writeBuffer(centerUniform, 0, centerParams);
        }
        if (centerSpanCount === 0)
            return;
        if (!centerBind || centerSource !== source) {
            centerSource = source;
            centerBind = runtime.device.createBindGroup({
                layout: centerPipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: centerUniform } },
                    { binding: 1, resource: { buffer: spanBuffer } },
                    { binding: 2, resource: { buffer: source } },
                    { binding: 3, resource: { buffer: markBuffer } },
                ],
            });
        }
        const pass = encoder.beginComputePass({ label: "fleet-center" });
        pass.setPipeline(centerPipeline);
        pass.setBindGroup(0, centerBind);
        pass.dispatchWorkgroups(centerSpanCount);
        pass.end();
    }
    function canCorrectFollowCamera() {
        return !!(runtime && shipSimBuffer && followCamera && followedShip != null
            && followCameraObserved?.id === followedShip && ships.resolve(followedShip));
    }
    function previewWarpTime(nowMs, active = !allPaused()) {
        return runtime ? frameClock.presentationTime(nowMs / 1000, runtime.simDt, active, runtime.now, simulationHz === 0) : nowMs / 1000;
    }
    function presentCopy(encoder, source) {
        shipDrawBuffer = source;
        if (!runtime)
            return;
        const groups = Math.ceil(runtime.count / DIRECTED_PRESENT_WORKGROUP);
        if (groups === 0)
            return;
        if (!instanceBuffer || !mapBuffer || !presentPipeline)
            return;
        const { sims } = presentResources(source);
        bindPresent(source, sims);
        const counts = presentWords;
        counts[0] = runtime.count;
        counts[1] = canCorrectFollowCamera() ? 1 : 0;
        const u = presentFloats;
        u[2] = lastNowMs;
        u[3] = labToCompact(1);
        counts[4] = fleetSlot(selectedId);
        counts[6] = fleetSlot(hoveredId);
        u[5] = presentAlpha;
        u[30] = runtime.localTime(warpPresentationTime);
        u[31] = runtime.localTime(runtime.now);
        runtime.device.queue.writeBuffer(presentUniform, 0, counts);
        const pass = encoder.beginComputePass({ label: "directed-present" });
        pass.setPipeline(presentPipeline);
        pass.setBindGroup(0, presentBind);
        pass.dispatchWorkgroups(groups);
        pass.end();
        if (!firstPresentation && mappedCount() > 0) {
            firstPresentation = true;
            console.info('[ship-preparation] first ship presentation encoded', (performance.now() - preparationStarted).toFixed(1) + 'ms since preparation began');
        }
        // The marker and camera must describe the same presented frame. Holding a
        // center on alternate frames creates two alternating screen positions.
        encodeFleetCenter(encoder, sims);
        centerTimeMs = lastNowMs;
        const followed = followedShip == null ? null : ships.resolve(followedShip);
        if (observations && markBuffer)
            observations.encode(encoder, markBuffer, sims, mapGen, lastNowMs, followed ? { id: followed.handle.id, kernelIndex: followed.kernelIndex } : null, centerTimeMs, { buffer: source, epoch: runtime.clock?.origin ?? 0, lag: simulationHz === 0 ? 0 : runtime.simDt, scale: labToCompact(1), displayMs: warpPresentationTime * 1000 });
        encodeFleetTelemetry(encoder, source);
    }
    function encodeFleetTelemetry(encoder, source) {
        telemetry?.select(debugFleet && selectedId ? `${mapGen}:${selectedId}` : null);
        if (runtime?.classTuningBuffer)
            telemetry?.encode(encoder, source, runtime.classTuningBuffer(), lastNowMs, String(mapGen), debugRepresentatives());
    }
    function selectedDebugGeometry() {
        if (!debugFleet || !selectedId)
            return [];
        const samples = telemetry?.freshShips() ?? [];
        if (!samples.length)
            return [];
        const slot = fleetSlot(selectedId), center = observations?.center(slot);
        return fleetDebugGeometry(slot, samples, center ? [center.x, center.y, center.z] : null, telemetry?.freshTravel(slot));
    }
    function encodeRouteOverlays(pass, viewProj, width, height) {
        const wallNow = performance.now();
        if (routesDirty || wallNow >= nextGuidesAt) {
            routeLines?.update(routeGuides());
            debugLines?.update(selectedDebugGeometry());
            routesDirty = false;
            nextGuidesAt = wallNow + 200;
        }
        routeLines?.encode(pass, viewProj, fleetSlot(selectedId), fleetSlot(hoveredId), keplerTime, width, height, allPaths, presentFloats[27] / Math.max(1, height));
        if (debugFleet && selectedId)
            debugLines?.encode(pass, viewProj, 0xffffffff, fleetSlot(selectedId), 0, width, height, false);
    }
    function syncNearbySystem() {
        const systemId = fleets.find(fleet => fleet.shipCount > 0)?.systemId ?? null;
        if (systemId === nearbySystemId)
            return;
        nearbySystemId = systemId;
        // Equal-size catalogs can reuse every body index in a different system.
        runtime?.invalidateNearby?.();
    }
    function bindFleets(next, buffer, poses, sims, trails) {
        const prepared = next.slice(0, MAX_SCENE_FLEETS).map((f) => {
            const row = { ...f };
            attachPlan(row);
            row.serialBase = ships.serialBase(row.id ?? "");
            if (row.plan?.phase === "hide") {
                row.paused = true;
                row.shipCount = 0;
            }
            return row;
        });
        const shown = prepared.reduce((n, f) => n + Math.max(0, f.shipCount | 0), 0);
        capState = { shown, requested: shown, cap: visualCapacity };
        const capped = prepared;
        if (capped.some((fleet, i) => i > 0 && (fleet.slot ?? 0) < (capped[i - 1].slot ?? 0))) {
            capped.sort((a, b) => ((a.slot ?? 0) | 0) - ((b.slot ?? 0) | 0));
        }
        const fp = sceneFleetFingerprint(capped, poses);
        // Closing the scene detaches the draw buffer before rebuilding the empty
        // map. Retire its old rows while their buffer and addresses still exist.
        // Replacement buffers may have already retired their predecessor; normal
        // map rebuilding clears dropped rows in the replacement instead.
        if (instanceBuffer && !buffer)
            hideDroppedInstances(mapCpu, new Uint32Array(0));
        instanceBuffer = buffer;
        shipSimBuffer = sims;
        trailSampleBuffer = trails;
        poseSeed = poses;
        fleets = capped;
        localRoutes.sync(fleets, fleets[0]?.systemId ?? null);
        syncNearbySystem();
        applyOccupancy();
        if (fp !== fingerprint) {
            fingerprint = fp;
            centerGeneration = -1;
            if (runtime) {
                rebuildMap();
            }
        }
        // encodeTick drives intent once after the current membership work is ready.
        return fleets;
    }
    async function buildDensityPipeline(device) {
        preparation.update({ phase: 'compiling', label: 'Scene pipelines · density overlay', completed: 1, total: 6 });
        const module = device.createShaderModule({ code: sceneCameraShader(DENSITY_OVERLAY_WGSL, ["u.viewProj"]) });
        densityPipeline = await device.createRenderPipelineAsync({
            layout: "auto",
            vertex: { module, entryPoint: "densityCell" },
            fragment: {
                module,
                entryPoint: "densityFrag",
                targets: [{
                        format: colorFormat,
                        blend: {
                            color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
                            alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
                        },
                    }],
            },
            primitive: { topology: "line-list" },
            depthStencil: {
                format: depth.format,
                depthWriteEnabled: false,
                depthCompare: "always",
            },
            multisample: { count: MAP_MSAA_SAMPLES },
        });
        if (destroyed) {
            densityPipeline = null;
            return;
        }
        densityUniform = device.createBuffer({
            size: 96,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
    }
    async function buildCenterPipeline(device) {
        preparation.update({ phase: 'compiling', label: 'Scene pipelines · fleet centers', completed: 2, total: 6 });
        const module = device.createShaderModule({ code: FLEET_CENTER_WGSL });
        centerPipeline = await device.createComputePipelineAsync({
            layout: "auto",
            compute: { module, entryPoint: "fleetCenter" },
        });
    }
    async function buildAltitudePipeline(device) {
        preparation.update({ phase: 'compiling', label: 'Scene pipelines · fleet markers', completed: 3, total: 6 });
        const module = device.createShaderModule({ code: sceneCameraShader(FLEET_MARKER_WGSL, ["u.vp"]) });
        altitudePipeline = await device.createRenderPipelineAsync({
            layout: "auto",
            vertex: { module, entryPoint: "vs" },
            fragment: {
                module,
                entryPoint: "fs",
                targets: [{
                        format: colorFormat,
                        blend: {
                            color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
                            alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
                        },
                    }],
            },
            primitive: { topology: "triangle-list" },
            depthStencil: {
                format: depth.format,
                depthWriteEnabled: false,
                depthCompare: "always",
            },
            multisample: { count: MAP_MSAA_SAMPLES },
        });
        const selectionModule = device.createShaderModule({ code: sceneSelectionShader(SHIP_SELECTION_WGSL) });
        preparation.update({ phase: 'compiling', label: 'Scene pipelines · ship selection', completed: 4, total: 6 });
        selectionPipeline = await device.createRenderPipelineAsync({ layout: 'auto',
            vertex: { module: selectionModule, entryPoint: 'vs' },
            fragment: { module: selectionModule, entryPoint: 'fs', targets: [{ format: colorFormat,
                        blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
                            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } } }] },
            primitive: { topology: 'triangle-list' },
            depthStencil: { format: depth.format, depthWriteEnabled: false, depthCompare: depth.transparentCompare },
            multisample: { count: MAP_MSAA_SAMPLES },
        });
        altitudeUniform = device.createBuffer({
            label: "fleet-pin-uniform",
            size: 96,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
    }
    async function buildRepelPipeline(device) {
        preparation.update({ phase: 'compiling', label: 'Scene pipelines · repulsion overlay', completed: 5, total: 6 });
        const module = device.createShaderModule({ code: sceneCameraShader(REPEL_WGSL, ["u.viewProj"]) });
        repelPipeline = await device.createRenderPipelineAsync({
            layout: "auto",
            vertex: { module, entryPoint: "vs" },
            fragment: {
                module,
                entryPoint: "fs",
                targets: [{
                        format: colorFormat,
                        blend: {
                            color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
                            alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
                        },
                    }],
            },
            primitive: { topology: "triangle-list" },
            depthStencil: {
                format: depth.format,
                depthWriteEnabled: false,
                depthCompare: "always",
            },
            multisample: { count: MAP_MSAA_SAMPLES },
        });
        if (destroyed) {
            repelPipeline = null;
            return;
        }
        repelUniform = device.createBuffer({
            label: "ship-repel-uniform",
            size: 160,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
    }
    function destroyHost() {
        preparation.cancel();
        destroyed = true;
        localRoutes.destroy();
        routeLines?.destroy();
        routeLines = null;
        telemetry?.destroy();
        telemetry = null;
        debugLines?.destroy();
        debugLines = null;
        observations?.destroy();
        observations = null;
        ships.clear();
        presentBinds.clear();
        observationContinuity.clear();
        lastWorkgroups = 0;
        runtime?.destroy();
        initializing?.destroy();
        initializing = null;
        runtime = null;
        pending = null;
        sceneWork.length = 0;
        compactPending = null;
        compactScratch?.destroy();
        compactScratch = null;
        mapBuffer?.destroy();
        kernelFleetBuffer?.destroy();
        followCamera?.destroy();
        followCamera = null;
        followCameraObserved = null;
        presentUniform?.destroy();
        fleetTintBuffer?.destroy();
        fleetTintBuffer = null;
        presentationControls?.destroy();
        presentationControls = null;
        shipSimDummy?.destroy();
        trailDummy?.destroy();
        densityUniform?.destroy();
        densityDummy?.destroy();
        markBuffer?.destroy();
        typeBuffer?.destroy();
        typeBuffer = null;
        typeRows.clear();
        selectionBind = null;
        selectionSource = null;
        spanBuffer?.destroy();
        centerUniform?.destroy();
        altitudeUniform?.destroy();
        quality?.dispose();
        quality = null;
        mapBuffer = null;
        kernelFleetBuffer = null;
        presentUniform = null;
        shipSimDummy = null;
        trailDummy = null;
        densityUniform = null;
        densityDummy = null;
        shipSimBuffer = null;
        trailSampleBuffer = null;
        presentPipeline = null;
        presentBind = null;
        densityPipeline = null;
        densityBind = null;
        markBuffer = null;
        markZero = null;
        spanBuffer = null;
        centerUniform = null;
        centerPipeline = null;
        centerBind = null;
        centerSource = null;
        altitudePipeline = null;
        altitudeUniform = null;
        altitudeBind = null;
        repelPipeline = null;
        repelUniform?.destroy();
        repelUniform = null;
        repelBind = null;
        repelBindBuf = null;
        shipDrawBuffer = null;
        fleets = [];
        fingerprint = "";
        occupancyKey = "";
        warpLayouts.clear();
        warpReservations.clear();
        orbitBirthReservations.clear();
        seededSlots.clear();
        pendingOrbit.clear();
        slotRanges = new Map();
        poseCpu = null;
    }
    return {
        clearQuality() { quality?.dispose(); quality = null; },
        async sampleQuality() {
            const source = runtime?.inspection;
            if (!runtime || !source || !shipSimBuffer || !source.adviceBase)
                return null;
            const token = mapGen, owner = runtime;
            quality ?? (quality = new QualityDiagnostics(runtime.device));
            const sampler = quality;
            const result = await sampler.sample({ state: runtime.state, control: source.control, sims: shipSimBuffer, orders: source.orders,
                count: runtime.count, adviceBase: source.adviceBase, guideBase: source.travelOffset - source.fleetCount * 256,
                fleetCount: source.fleetCount, projection: presentFloats });
            return token === mapGen && owner === runtime && sampler === quality ? result : null;
        },
        setVisualCapacity(capacity) {
            if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_SHIP_CAPACITY)
                throw new Error('Invalid scene ship capacity');
            visualCapacity = capacity;
            requestedCapacity = Math.max(requestedCapacity, capacity);
            ensureCapacity();
        },
        kernelCapacity: () => runtime?.count ?? requestedCapacity,
        preparationStatus: () => preparation.snapshot(),
        mappedInstanceIndices() {
            return mappedLive;
        },
        mappedGeneration() {
            return mapGen;
        },
        mapStorage() {
            return mapBuffer;
        },
        kernelRanges() {
            return slotRanges;
        },
        syncSceneFleets(next, buffer, poses = null, sims = null, trails = null, selected = null) {
            if (selectedId !== selected) {
                routesDirty = true;
                telemetry?.select(debugFleet && selected ? `${mapGen}:${selected}` : null);
            }
            selectedId = selected;
            return bindFleets(next, buffer, poses, sims, trails) ?? [];
        },
        ensure(device, format) {
            if (format)
                colorFormat = format;
            if (ensureError)
                return Promise.reject(ensureError);
            if (destroyed)
                return Promise.resolve();
            if (runtime) {
                ensureCapacity();
                return Promise.resolve();
            }
            if (pending)
                return pending;
            preparation.update({ phase: 'preparing', label: 'Ship simulation runtime' });
            const sceneStart = performance.now();
            preparationStarted = sceneStart;
            const sceneJobs = [
                { label: 'Ship presentation', run: async () => {
                        const module = device.createShaderModule({ label: 'ship-presentation', code: DIRECTED_PRESENT_WGSL });
                        presentPipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'presentDirected' } });
                    } },
                { label: 'GPU follow camera', run: async () => { followCamera = await SceneCameraGpu.create(device); } },
                { label: 'Fleet centers', run: () => buildCenterPipeline(device) },
                { label: 'Fleet markers and selection', run: () => buildAltitudePipeline(device) },
            ];
            // Two lightweight scene jobs overlap the bounded runtime preparation.
            const sceneReady = preparePipelines(sceneJobs, 2, timing => {
                console.info('[ship-preparation]', timing.label, timing.durationMs.toFixed(1) + 'ms');
                preparation.update({ phase: 'compiling', ...timing });
            });
            // Attach a handler immediately; runtime preparation can finish later.
            const sceneSettled = sceneReady.then(() => null, error => error);
            pending ?? (pending = createRuntime({
                onCompileStatus: preparation.engine,
                device, canvas: null, count: requestedCapacity, fleetCount: MAX_SCENE_FLEETS, warpOffsetCapacity: MAX_SHIP_CAPACITY,
                // The map's frame profiler owns timestamps for all encoded passes.
                fieldCapacity: 8, navigation: true, simHz: simulationHz || 60, timestamps: false,
                occupancy: occupancyForScene(MAX_SCENE_FLEETS, 0),
            }).then(async (created) => {
                initializing = created;
                const sceneError = await sceneSettled;
                if (destroyed) {
                    created.destroy();
                    initializing = null;
                    destroyHost();
                    return;
                }
                if (sceneError)
                    throw sceneError;
                preparation.update({ phase: 'preparing', label: 'Route overlays and scene resources' });
                routeLines = new SceneRouteLines(device, colorFormat, depth.format);
                debugLines = new SceneRouteLines(device, colorFormat, depth.format);
                if (destroyed) {
                    created.destroy();
                    initializing = null;
                    destroyHost();
                    return;
                }
                preparation.update({ phase: 'preparing', label: 'Scene bindings and initial ship state' });
                runtime = created;
                initializing = null;
                // Quality can change while the lazy runtime/pipelines are being built.
                // Catch up before publishing any map against the requested admission cap.
                ensureCapacity();
                occupancyKey = "";
                applyOccupancy();
                rebuildMap();
                applyKepler();
                issueNewFleets();
                const elapsed = performance.now() - sceneStart;
                console.info('[ship-preparation] essential scene ready', elapsed.toFixed(1) + 'ms', elapsed > 5000 ? 'OVER 5s BUDGET' : 'within 5s budget');
                preparation.update({ phase: 'ready', label: 'Ship simulation and scene pipelines ready' });
            }).catch(async (err) => {
                await sceneSettled;
                pending = null;
                const wasDestroyed = destroyed;
                if (!wasDestroyed)
                    preparation.update({ phase: 'failed', label: preparation.snapshot()?.label ?? 'Ship runtime', error: String(err?.message ?? err).slice(0, 2000) });
                destroyHost();
                if (wasDestroyed)
                    return;
                ensureError = err;
                throw err;
            }));
            return pending ?? Promise.resolve();
        },
        syncKeplerBodies(bodies, timeSec) {
            keplerBodies = bodies ?? [];
            keplerTime = timeSec;
            applyKepler();
            // Fleet metadata is refreshed after bodies. Drive in bindFleets/encodeTick
            // so a new clock cannot be combined with last frame's remaining warp time.
        },
        encodeTick(encoder, timeSec, _dtSec, sceneOpen, nowMs = timeSec * 1000) {
            lastWorkgroups = 0;
            lastNowMs = nowMs;
            if (!runtime)
                return;
            runtime.simDt = simulationHz === 0 ? Math.min(.3, Math.max(1 / 1000, _dtSec)) : 1 / simulationHz;
            const tuned = consumeShipTuning();
            if (tuned) {
                runtime.uploadClassTuning?.(tuned);
                localRoutes.invalidate();
                localRoutes.sync(fleets, fleets[0]?.systemId ?? null);
            }
            drainLeaveJoin();
            issueNewFleets();
            drainDirectedEncodeTick(runtime, runtime.now);
            flushOrbits();
            flushPendingCommands();
            warpPresentationTime = previewWarpTime(nowMs, sceneOpen && mappedCount() > 0 && !allPaused());
            if (!sceneOpen || mappedCount() === 0) {
                frameClock.advance(timeSec, runtime.simDt, false);
                if (sceneOpen) {
                    presentAlpha = 1;
                    presentCopy(encoder, runtime.state);
                }
                return;
            }
            const dt = runtime.simDt;
            const step = frameClock.advance(timeSec, dt, !allPaused(), simulationHz === 0);
            presentAlpha = step.alpha;
            if (step.tick) {
                runtime.encodeTick(encoder, timeSec, frameClock.integrationDt, { emitting: true });
                lastWorkgroups = Math.ceil(Math.max(1, runtime.count) / 128);
                presentCopy(encoder, runtime.pendingPoseBuffer());
            }
            else {
                presentCopy(encoder, runtime.state);
            }
        },
        setPresentationCamera(viewProj, origin, height, projectionY, highEnterPx = 55, highExitPx = 50) {
            // Projection-only scale: view rotation must not shrink a bounding sphere.
            presentFloats[7] = Math.abs(projectionY);
            for (let i = 0; i < 16; i++)
                presentFloats[8 + i] = viewProj[i];
            presentFloats[24] = origin.x;
            presentFloats[25] = origin.y;
            presentFloats[26] = origin.z;
            presentFloats[27] = height;
            presentFloats[28] = highEnterPx;
            presentFloats[29] = highExitPx;
            runtime?.setPilotView?.(viewProj, origin, Math.abs(projectionY) * height * SCENE_HULL_SIZE * SCENE_MODEL_SIZE_MUL, labToCompact(1), followedShip == null ? -1 : ships.resolve(followedShip)?.kernelIndex ?? -1, selectedId == null ? -1 : fleetSlot(selectedId));
        },
        setShipDetail(handle, detail) {
            const ship = ships.resolve(handle);
            if (!ship || !runtime || !presentationControls)
                return false;
            detailWords[0] = handle;
            detailWords[1] = detail === 'high' ? 2 : detail === 'low' ? 1 : 0;
            runtime.device.queue.writeBuffer(presentationControls, ship.kernelIndex * 16, detailWords);
            return true;
        },
        encodeMaintenance(encoder) { recordCompact(encoder); },
        commitTick() {
            commitCompact();
            if (lastWorkgroups > 0)
                runtime?.commitTick();
            observations?.submitted(() => mapGen, () => followedShip);
            telemetry?.submitted(() => String(mapGen));
            // Render-only frames also prepare: no GPU writes or pose ownership changes.
            runtime?.prepareNearby?.(nearbyPositions(fleets, slot => observations?.routeAnchor(slot)));
            // Work for a future frame after submitting this frame's GPU commands.
            localRoutes.advance(keplerBodies, keplerTime);
        },
        lastShipWorkgroups: () => lastWorkgroups,
        receive(packet) {
            if (!runtime || typeof runtime.receiveEvent !== "function")
                return { status: "closed" };
            return runtime.receiveEvent(packet, runtime.lifetime);
        },
        setDensityVisible(on) {
            densityOn = !!on;
            runtime?.setDensityVisible?.(on);
        },
        getSimulationRate() { return simulationHz; },
        setSimulationRate(hz) {
            const next = simulationRate(hz);
            if (next === simulationHz)
                return;
            simulationHz = next;
            frameClock.resetCadence();
            if (runtime)
                runtime.simDt = 1 / (next || 60);
        },
        setFleetPathsVisible(on) { allPaths = on; routesDirty = true; },
        setFleetDebugVisible(on) { debugFleet = on; routesDirty = true; telemetry?.select(on && selectedId ? `${mapGen}:${selectedId}` : null); },
        fleetActivity,
        setRepulsionVisible(on) {
            repelOn = !!on;
        },
        encodeRepulsion(pass, viewProj, view) {
            if (repelOn && runtime && !optionalRepel) {
                optionalRepel = buildRepelPipeline(runtime.device).catch(error => console.error('[ship-preparation] repulsion overlay', error));
            }
            if (!repelOn || !runtime || !repelPipeline || !repelUniform || !shipDrawBuffer || !runtime.classTuningBuffer || mappedCount() === 0)
                return;
            const vp = viewProj instanceof Float32Array ? viewProj : new Float32Array(viewProj);
            const vm = view instanceof Float32Array ? view : new Float32Array(view);
            const packed = new ArrayBuffer(160);
            const f = new Float32Array(packed);
            const w = new Uint32Array(packed);
            f.set(vp.subarray(0, 16), 0);
            f.set(vm.subarray(0, 16), 16);
            f[32] = labToCompact(1);
            w[33] = runtime.count;
            runtime.device.queue.writeBuffer(repelUniform, 0, packed);
            if (!repelBind || repelBindBuf !== shipDrawBuffer) {
                repelBindBuf = shipDrawBuffer;
                repelBind = runtime.device.createBindGroup({
                    layout: repelPipeline.getBindGroupLayout(0),
                    entries: [
                        { binding: 0, resource: { buffer: repelUniform } },
                        { binding: 1, resource: { buffer: shipDrawBuffer } },
                        { binding: 3, resource: { buffer: runtime.classTuningBuffer() } },
                    ],
                });
            }
            pass.setPipeline(repelPipeline);
            bindSceneCamera(runtime.device, pass, repelPipeline);
            pass.setBindGroup(0, repelBind);
            pass.draw(6, runtime.count);
        },
        encodeFleetAltitude(pass, viewProj, width = 1, height = 1) {
            encodeRouteOverlays(pass, viewProj, width, height);
            if (!runtime || !altitudePipeline || !altitudeUniform || !markBuffer || !typeBuffer || mappedCount() === 0)
                return;
            const vp = viewProj instanceof Float32Array ? viewProj : new Float32Array(viewProj);
            const packed = pinUniformData;
            const f = new Float32Array(packed);
            const w = new Uint32Array(packed);
            f.set(vp.subarray(0, 16), 0);
            f[16] = width > 0 ? width : 1;
            f[17] = height > 0 ? height : 1;
            f[18] = presentFloats[7]; // Shared projection scale; this pass uses CSS height.
            f[19] = COMPACT_SYSTEM_SPAN * 0.15;
            w[20] = fleetSlot(selectedId);
            w[21] = fleetSlot(hoveredId);
            runtime.device.queue.writeBuffer(altitudeUniform, 0, packed);
            if (!altitudeBind) {
                altitudeBind = runtime.device.createBindGroup({
                    layout: altitudePipeline.getBindGroupLayout(0),
                    entries: [
                        { binding: 0, resource: { buffer: altitudeUniform } },
                        { binding: 1, resource: { buffer: markBuffer } },
                        { binding: 2, resource: { buffer: typeBuffer } },
                    ],
                });
            }
            pass.setPipeline(altitudePipeline);
            bindSceneCamera(runtime.device, pass, altitudePipeline);
            pass.setBindGroup(0, altitudeBind);
            pass.draw(12, MAX_SCENE_FLEETS);
            if ((!selectedId && !hoveredId) || !selectionPipeline || !shipSimBuffer)
                return;
            if (!selectionBind || selectionSource !== shipSimBuffer) {
                selectionSource = shipSimBuffer;
                selectionBind = runtime.device.createBindGroup({ layout: selectionPipeline.getBindGroupLayout(0), entries: [
                        { binding: 0, resource: { buffer: altitudeUniform } }, { binding: 1, resource: { buffer: shipSimBuffer } },
                    ] });
            }
            pass.setPipeline(selectionPipeline);
            bindSceneCamera(runtime.device, pass, selectionPipeline);
            pass.setBindGroup(0, selectionBind);
            pass.draw(6, runtime.count);
        },
        encodeDensity(pass, viewProj, focusedBodyIndex = null) {
            if (densityOn && runtime && !optionalDensity) {
                optionalDensity = buildDensityPipeline(runtime.device).catch(error => console.error('[ship-preparation] density overlay', error));
            }
            if (!densityOn || !runtime || !densityPipeline || !densityUniform)
                return;
            const density = runtime.density ?? densityDummy ?? (densityDummy = storageDummy(null, 4));
            const limit = densityCellLimit();
            const focused = focusedBodyIndex == null ? null : keplerBodies[focusedBodyIndex | 0];
            pass.setPipeline(densityPipeline);
            bindSceneCamera(runtime.device, pass, densityPipeline);
            for (const field of pickDensityFields(pressureFields(runtime), focused)) {
                drawDensityField(pass, runtime, density, viewProj, field, limit);
            }
        },
        shipHandle: (id, ordinal) => ships.capture(id, ordinal),
        resolveShip: (handle) => ships.resolve(handle),
        setFollowShip(handle) { followCameraObserved = null; followCamera?.observe(null); followedShip = handle; if (observations)
            observations.pose = null; },
        observeFollowCamera(pose) { if (pose.id === followedShip)
            followCameraObserved = pose; },
        encodeFollowCamera(encoder, view, projection, eye) {
            if (!canCorrectFollowCamera())
                return;
            const follow = ships.resolve(followedShip);
            if (!follow)
                return;
            if (!followCamera)
                return;
            followCamera.observe(followCameraObserved);
            followCamera.encode(encoder, shipSimBuffer, follow, view, projection, eye, {
                controls: presentationControls, count: runtime.count,
                pixelGain: presentFloats[7] * SCENE_HULL_SIZE * SCENE_MODEL_SIZE_MUL * presentFloats[27],
                enter: presentFloats[28], exit: presentFloats[29],
            });
        },
        shipPose(handle, nowMs = lastNowMs) {
            if (!ships.resolve(handle))
                return null;
            const pose = observations?.pose;
            if (pose?.shipIndex !== handle)
                return null;
            if (pose.warp) {
                rebaseWarpMotion(pose.warp, runtime?.clock?.origin ?? pose.warp.epoch);
                pose.warp.displayMs = previewWarpTime(nowMs) * 1000;
            }
            return pose;
        },
        fleetTypes: (id) => typeRows.get(id) ?? [],
        fleetDebugSnapshot: () => ({ enabled: debugFleet, selected: selectedId, ships: telemetry?.freshShips() ?? [], stats: telemetry?.stats ?? null }),
        fleetRoute(id) { const row = localRoutes.rows.get(id); return row ? { status: row.status, points: row.points, validUntil: row.validUntil } : null; },
        setHoveredFleet(id) { if (hoveredId !== id)
            routesDirty = true; hoveredId = id; },
        fleetCenter(id) {
            const slot = ships.fleetSlot(id);
            return slot == null ? null : observations?.center(slot) ?? null;
        },
        visualCap: () => capState,
        combatSlots: () => combatSlotsOf(runtime),
        destroy: destroyHost,
    };
}
//# sourceMappingURL=directed-scene-host.js.map