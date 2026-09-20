// @ts-nocheck
/** Map host for the directed 192-byte kernel. Injected device; no canvas. */
import { createRuntime, STRIDE } from "../../../lib/ship-runtime/engine.mjs";
import { MAP_MSAA_SAMPLES } from "../../map-msaa.js";
import { DENSITY_OVERLAY_WGSL, DENSITY_OVERLAY_SIDE, DENSITY_OVERLAY_CELL_LAB, DENSITY_OVERLAY_VERTICES, } from "./density-overlay.wgsl.js";
import { DIRECTED_PRESENT_WGSL, DIRECTED_PRESENT_WORKGROUP, MAX_SCENE_FLEETS, SCENE_KERNEL_COUNT, MAX_GROUP_VISUAL, directedTickDecision, sceneFleetFingerprint, buildInstanceMap, seedDirectedShips, drainDirectedEncodeTick, labToCompact, compactToLab, occupancyForScene, occupancyVisuals, SCENE_VISUAL_CAP, warpEnterCommand, stageCommand, orbitCommand, pressurePlanetCommand, sceneMotionPlan, pickDensityFields, allocateKernelRanges, droppedInstanceIndices, pickCompactMove, rangesOverlap, SCENE_SHIP_CHUNK, SCENE_CHUNK_BUDGET_MS, SCENE_LAB_SCALE, WARP_ENTER_SEC, TRAIL_COPY_SAMPLES, PRODUCTION_TRAIL_RING, } from "./directed-present.wgsl.js";
// @ts-expect-error JS helper copied into dist
import { labPressureHalfExtent } from "../../../lib/ship-runtime/kepler-solar.mjs";
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
export function createDirectedSceneHost(injected = null) {
    let runtime = injected;
    let lastWorkgroups = 0;
    let pending = null;
    let ensureFailed = false;
    let fleets = [];
    let fingerprint = "";
    let instanceBuffer = null;
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
    let presentUniform = null;
    let presentPipeline = null;
    let presentBind = null;
    let lastPresent = 0;
    let lastNowMs = 0;
    let bindKey = "";
    let keplerBodies = [];
    let keplerTime = 0;
    let selectedId = null;
    let capState = { shown: 0, requested: 0, cap: 0 };
    let densityOn = false;
    let densityPipeline = null;
    let densityUniform = null;
    let densityBind = null;
    let densityDummy = null;
    let colorFormat = "bgra8unorm";
    const seededSlots = new Set();
    const phaseKeys = new Map();
    const pendingOrbit = new Map();
    let slotRanges = new Map();
    let journeyRev = 1;
    let occupancyKey = "";
    let poseCpu = null;
    let seedStaging = null;
    let compactScratch = null;
    const sceneWork = [];
    let compactPending = null;
    let destroyed = false;
    function mappedCount() {
        return fleets.reduce((n, f) => n + Math.max(0, f.shipCount | 0), 0);
    }
    function applyOccupancy() {
        if (!runtime?.extras?.compactVisuals)
            return;
        const key = fleets.map((f) => `${(f.slot ?? 0) | 0}:${f.shipCount | 0}`).join("|");
        if (key === occupancyKey)
            return;
        occupancyKey = key;
        runtime.extras.compactVisuals(occupancyVisuals({ fleets }));
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
        const key = phaseKey(plan, fleet);
        if (phaseKeys.get(slot) === key)
            return;
        phaseKeys.set(slot, key);
        pendingOrbit.delete(slot);
        const now = runtime.now;
        journeyRev += 2;
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
    function historyTombstone(count) {
        const n = Math.max(0, count | 0) * 192;
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
        runtime.device.queue.writeBuffer(runtime.history, start * 768, historyTombstone(count));
    }
    function tombstoneTrailRange(instanceStart, count) {
        if (!trailSampleBuffer || count <= 0)
            return;
        runtime.device.queue.writeBuffer(trailSampleBuffer, instanceStart * PRODUCTION_TRAIL_RING * 16, trailTombstone(count));
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
    function enqueueMembership() {
        if (!runtime)
            return;
        const allocated = allocateKernelRanges(fleets, runtime.count, slotRanges);
        slotRanges = allocated.ranges;
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
    function seedJoinChunk(job, count) {
        if (!runtime || count <= 0)
            return;
        const fleet = fleets.find((f) => ((f.slot ?? 0) | 0) === job.slot);
        if (!fleet)
            return;
        const bytes = count * STRIDE;
        if (!seedStaging || seedStaging.byteLength < bytes)
            seedStaging = new ArrayBuffer(Math.max(bytes, SCENE_SHIP_CHUNK * STRIDE));
        seedDirectedShips(job.start + job.cap, [fleet], dummyPose, 1, {
            into: seedStaging,
            ranges: new Map([[job.slot, { start: job.start, cap: job.cap }]]),
            onlySlots: new Set([job.slot]),
            arrival: "orbit",
            seedFrom: job.seeded,
            seedCount: count,
            rowBase: 0,
        });
        const gpuOff = (job.start + job.seeded) * STRIDE;
        runtime.device.queue.writeBuffer(runtime.state, gpuOff, seedStaging, 0, bytes);
        runtime.device.queue.writeBuffer(runtime.pendingPoseBuffer(), gpuOff, seedStaging, 0, bytes);
        zeroHistorySlice(job.start + job.seeded, count);
        if (job.seeded === 0)
            tombstoneTrailRange(fleet.instanceStart | 0, Math.min(fleet.shipCount | 0, job.cap));
        job.seeded += count;
    }
    function drainLeaveJoin() {
        if (!runtime)
            return;
        const budget = SCENE_CHUNK_BUDGET_MS;
        for (;;) {
            const job = sceneWork.find((j) => j.type === "leave");
            if (!job || job.type !== "leave")
                break;
            const t0 = performance.now();
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
        for (;;) {
            const job = sceneWork.find((j) => j.type === "join" && !leaveBlocks(j.start + j.seeded, Math.min(SCENE_SHIP_CHUNK, j.cap - j.seeded)));
            if (!job || job.type !== "join")
                break;
            const t0 = performance.now();
            const n = Math.min(SCENE_SHIP_CHUNK, job.cap - job.seeded);
            seedJoinChunk(job, n);
            if (job.seeded >= job.cap) {
                const i = sceneWork.indexOf(job);
                if (i >= 0)
                    sceneWork.splice(i, 1);
            }
            writeMapAndFleetTables();
            if (performance.now() - t0 >= budget)
                return;
        }
    }
    function ensureScratch(bytes) {
        if (!runtime)
            return null;
        const size = Math.max(bytes, MAX_GROUP_VISUAL * 768);
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
        copy(runtime.history, 768);
        if (shipSimBuffer && shipSimBuffer.size > 224)
            copy(shipSimBuffer, 224);
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
    function writeMapAndFleetTables() {
        if (!runtime)
            return;
        const prevMap = mapCpu;
        mapCpu = buildInstanceMap(mappedFleets(), runtime.count, slotRanges);
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
        writeKernelFleetTable();
        mappedLive.length = 0;
        for (let i = 0; i < mapCpu.length; i++) {
            const inst = mapCpu[i];
            if (inst !== 0xffffffff)
                mappedLive.push(inst >>> 0);
        }
        mapGen++;
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
    function writeKernelFleetTable() {
        if (!runtime)
            return;
        const n = runtime.count;
        if (kernelFleetCpu.length !== n)
            kernelFleetCpu = new Uint32Array(n);
        kernelFleetCpu.fill(0xffffffff);
        for (const f of mappedFleets()) {
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
                size: 16,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
        }
        if (!shipSimBuffer)
            shipSimDummy = storageDummy(shipSimDummy, 224);
        if (!trailSampleBuffer)
            trailDummy = storageDummy(trailDummy, 128);
        return {
            sims: shipSimBuffer ?? shipSimDummy,
            trails: trailSampleBuffer ?? trailDummy,
            source,
        };
    }
    function bindPresent(source, sims) {
        if (!kernelFleetBuffer)
            kernelFleetBuffer = storageDummy(kernelFleetBuffer, 4);
        const key = `${source.label}|${instanceBuffer.label}|${mapBuffer.label}|${sims.label}|${kernelFleetBuffer.label}|${runtime.count}`;
        if (presentBind && key === bindKey)
            return;
        presentBind = runtime.device.createBindGroup({
            layout: presentPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: presentUniform } },
                { binding: 1, resource: { buffer: source } },
                { binding: 2, resource: { buffer: instanceBuffer } },
                { binding: 3, resource: { buffer: mapBuffer } },
                { binding: 4, resource: { buffer: sims } },
                { binding: 7, resource: { buffer: kernelFleetBuffer } },
            ],
        });
        bindKey = key;
    }
    function presentCopy(encoder, source) {
        if (!runtime || !instanceBuffer || !mapBuffer || !presentPipeline || mappedCount() === 0)
            return;
        const groups = Math.ceil(runtime.count / DIRECTED_PRESENT_WORKGROUP);
        if (groups === 0)
            return;
        const { sims } = presentResources(source);
        bindPresent(source, sims);
        const counts = new Uint32Array(4);
        counts[0] = runtime.count;
        counts[1] = TRAIL_COPY_SAMPLES;
        const u = new Float32Array(counts.buffer);
        u[2] = lastNowMs;
        u[3] = labToCompact(1);
        runtime.device.queue.writeBuffer(presentUniform, 0, counts);
        const pass = encoder.beginComputePass({ label: "directed-present" });
        pass.setPipeline(presentPipeline);
        pass.setBindGroup(0, presentBind);
        pass.dispatchWorkgroups(groups);
        pass.end();
    }
    function bindFleets(next, buffer, poses, sims, trails) {
        const prepared = next.slice(0, MAX_SCENE_FLEETS).map((f) => {
            const row = { ...f };
            attachPlan(row);
            if (row.plan?.phase === "hide") {
                row.paused = true;
                row.shipCount = 0;
            }
            return row;
        });
        const shown = prepared.reduce((n, f) => n + Math.max(0, f.shipCount | 0), 0);
        capState = { shown, requested: shown, cap: SCENE_VISUAL_CAP };
        const capped = prepared.slice().sort((a, b) => ((a.slot ?? 0) | 0) - ((b.slot ?? 0) | 0));
        const fp = sceneFleetFingerprint(capped, poses);
        instanceBuffer = buffer;
        shipSimBuffer = sims;
        trailSampleBuffer = trails;
        poseSeed = poses;
        fleets = capped;
        applyOccupancy();
        if (fp !== fingerprint) {
            fingerprint = fp;
            if (runtime) {
                rebuildMap();
                applyKepler();
            }
        }
        if (runtime)
            issueNewFleets();
        return fleets;
    }
    async function buildDensityPipeline(device) {
        const module = device.createShaderModule({ code: DENSITY_OVERLAY_WGSL });
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
                format: "depth24plus",
                depthWriteEnabled: false,
                depthCompare: "always",
            },
            multisample: { count: MAP_MSAA_SAMPLES },
        });
        densityUniform = device.createBuffer({
            size: 96,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
    }
    return {
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
            selectedId = selected ?? selectedId;
            return bindFleets(next, buffer, poses, sims, trails) ?? [];
        },
        ensure(device, format) {
            if (format)
                colorFormat = format;
            if (runtime || ensureFailed)
                return Promise.resolve();
            pending ?? (pending = createRuntime({
                device, canvas: null, count: SCENE_KERNEL_COUNT, fleetCount: MAX_SCENE_FLEETS,
                fieldCapacity: 8, navigation: true, simHz: 30,
                occupancy: occupancyForScene(MAX_SCENE_FLEETS, 0),
            }).then(async (created) => {
                if (destroyed) {
                    created.destroy?.();
                    return;
                }
                runtime = created;
                const module = device.createShaderModule({ code: DIRECTED_PRESENT_WGSL });
                presentPipeline = await device.createComputePipelineAsync({
                    layout: "auto",
                    compute: { module, entryPoint: "presentDirected" },
                });
                await buildDensityPipeline(device);
                if (destroyed)
                    return;
                occupancyKey = "";
                applyOccupancy();
                rebuildMap();
                applyKepler();
                issueNewFleets();
            }).catch((err) => {
                pending = null;
                runtime = null;
                const msg = String(err?.message ?? err);
                if (destroyed || /Instance dropped|no longer exists/i.test(msg))
                    return;
                ensureFailed = true;
                throw err;
            }));
            return pending ?? Promise.resolve();
        },
        syncKeplerBodies(bodies, timeSec) {
            keplerBodies = bodies ?? [];
            keplerTime = timeSec;
            applyKepler();
            issueNewFleets();
        },
        encodeTick(encoder, timeSec, _dtSec, sceneOpen, nowMs = timeSec * 1000) {
            lastWorkgroups = 0;
            lastNowMs = nowMs;
            if (!runtime)
                return;
            drainLeaveJoin();
            applyKepler();
            issueNewFleets();
            drainDirectedEncodeTick(runtime, runtime.now);
            flushOrbits();
            flushPendingCommands();
            if (!sceneOpen || mappedCount() === 0) {
                recordCompact(encoder);
                return;
            }
            const dt = runtime.simDt;
            if (lastPresent === 0)
                lastPresent = timeSec - dt;
            const wallGap = timeSec - lastPresent;
            lastPresent = timeSec;
            if (allPaused()) {
                presentCopy(encoder, runtime.state);
                recordCompact(encoder);
                return;
            }
            const decision = directedTickDecision(wallGap, timeSec - runtime.now, dt);
            if (decision === "freeze") {
                presentCopy(encoder, runtime.state);
                recordCompact(encoder);
                return;
            }
            if (decision === "tick") {
                runtime.encodeTick(encoder, runtime.now + dt, dt, { emitting: true });
                lastWorkgroups = Math.ceil(Math.max(1, runtime.count) / 128);
                presentCopy(encoder, runtime.pendingPoseBuffer());
            }
            else {
                presentCopy(encoder, runtime.state);
            }
            recordCompact(encoder);
        },
        commitTick() {
            commitCompact();
            if (lastWorkgroups > 0)
                runtime?.commitTick();
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
        encodeDensity(pass, viewProj, focusedBodyIndex = null) {
            if (!densityOn || !runtime || !densityPipeline || !densityUniform)
                return;
            const density = runtime.density ?? densityDummy ?? (densityDummy = storageDummy(null, 4));
            const limit = densityCellLimit();
            const focused = focusedBodyIndex == null ? null : keplerBodies[focusedBodyIndex | 0];
            pass.setPipeline(densityPipeline);
            for (const field of pickDensityFields(pressureFields(runtime), focused)) {
                drawDensityField(pass, runtime, density, viewProj, field, limit);
            }
        },
        visualCap: () => capState,
        combatSlots: () => combatSlotsOf(runtime),
        destroy() {
            destroyed = true;
            lastWorkgroups = 0;
            runtime?.destroy();
            runtime = null;
            pending = null;
            sceneWork.length = 0;
            compactPending = null;
            compactScratch?.destroy();
            compactScratch = null;
            mapBuffer?.destroy();
            kernelFleetBuffer?.destroy();
            presentUniform?.destroy();
            shipSimDummy?.destroy();
            densityUniform?.destroy();
            densityDummy?.destroy();
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
            fleets = [];
            fingerprint = "";
            occupancyKey = "";
            seededSlots.clear();
            pendingOrbit.clear();
            slotRanges = new Map();
            poseCpu = null;
        },
    };
}
//# sourceMappingURL=directed-scene-host.js.map