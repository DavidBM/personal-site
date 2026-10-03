import { SHIP_SIM_STRIDE } from '../../ship-sim-layout.js';
import { SHIP_BYTES } from '../../../lib/ship-runtime/ship-layout.mjs';
function canReadPose(slot, currentMap, handle) {
    return slot.poseValid && slot.handle != null && slot.handle === handle && (currentMap || slot.retainedPose);
}
function retainPending(slot, preserve) {
    slot.poseValid = slot.poseValid && slot.handle === preserve?.shipHandle;
    slot.retainedPose = slot.poseValid;
    slot.retainedCenters = false;
    for (let i = 0; i < slot.centersValid.length; i++) {
        const keep = slot.centersValid[i] !== 0 && Boolean(preserve?.centerSlots.has(i));
        slot.centersValid[i] = keep ? 1 : 0;
        slot.retainedCenters || (slot.retainedCenters = keep);
    }
}
function readAttitude(f, at = 4) {
    const length = Math.hypot(f[at], f[at + 1], f[at + 2], f[at + 3]);
    return length > 1e-6 ? { qx: f[at] / length, qy: f[at + 1] / length, qz: f[at + 2] / length, qw: f[at + 3] / length }
        : { qx: 0, qy: Math.sin(f[11] / 2), qz: 0, qw: Math.cos(f[11] / 2) };
}
function readWarp(f, slot) {
    if (f[31] < 2 || f[35] === -2 || f[30] <= f[29])
        return;
    if (f[31] === 4)
        return { x: f[52] + f[48], y: f[53] + f[49], z: f[54] + f[50], anchor: f[55],
            vx: f[4], vy: f[5], vz: f[6], start: f[29], end: f[30], revision: f[28], epoch: slot.epoch, lag: slot.lag, scale: slot.scale };
    return { x: f[32], y: f[33], z: f[34], vx: f[4], vy: f[5], vz: f[6],
        start: f[29], end: f[30], revision: f[28], epoch: slot.epoch, lag: slot.lag, scale: slot.scale };
}
function observedVelocity(previous, slot, f, warping) {
    const dt = (slot.timeMs - (previous?.observedMs ?? slot.timeMs)) / 1000;
    // A difference straddling warp completion is not a local-cruise velocity.
    if (!previous || previous.shipIndex !== slot.handle || (previous.warp && !warping) || dt <= 0 || dt >= 0.2)
        return { vx: 0, vy: 0, vz: 0, dt: 0 };
    return { vx: (f[0] - previous.x) / dt, vy: (f[1] - previous.y) / dt, vz: (f[2] - previous.z) / dt, dt };
}
function configureDirectedSample(slot, directed, timeMs) {
    slot.directed = Boolean(directed);
    if (directed) {
        slot.epoch = directed.epoch;
        slot.lag = directed.lag;
        slot.scale = Math.fround(directed.scale);
        slot.displayMs = directed.displayMs;
    }
    else {
        slot.epoch = 0;
        slot.lag = 0;
        slot.scale = 1;
        slot.displayMs = timeMs;
    }
}
function readWarpObservation(bytes, offset, slot, previous) {
    if (!slot.directed)
        return null;
    const raw = new Float32Array(bytes, offset, 56);
    if (new Uint32Array(bytes, offset, 36)[23] !== slot.handle)
        return null;
    const warp = readWarp(raw, slot);
    if (warp)
        return { warp, attitude: readAttitude(raw, 12) };
    // The kernel can finish before the delayed presentation's warp deadline.
    if (!previous || previous.shipIndex !== slot.handle || !previous.warp)
        return null;
    if (raw[28] !== previous.warp.revision || slot.displayMs / 1000 >= previous.warp.end + previous.warp.epoch)
        return null;
    return { warp: { ...previous.warp, displayMs: undefined }, attitude: previous.attitude };
}
export class SceneObservations {
    constructor(device, fleetCapacity) {
        this.closed = false;
        this.nextSequence = 0;
        this.poseSequence = -1;
        this.pose = null;
        this.centerBytes = fleetCapacity * 32;
        this.bytes = this.centerBytes + 224 + SHIP_BYTES;
        this.centers = new Float32Array(fleetCapacity * 8);
        this.previousCenters = new Float32Array(this.centers.length);
        this.centerTimes = new Float64Array(fleetCapacity).fill(-Infinity);
        this.previousCenterTimes = new Float64Array(fleetCapacity).fill(-Infinity);
        this.centerSequences = new Float64Array(fleetCapacity).fill(-1);
        this.slots = [];
        try {
            for (let i = 0; i < 2; i++)
                this.slots.push({
                    buffer: device.createBuffer({ label: 'scene-observation-readback', size: this.bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }),
                    busy: false, submitted: false, generation: 0, handle: null, timeMs: 0, centerMs: 0,
                    directed: false, epoch: 0, lag: 0, scale: 1, displayMs: 0, poseValid: false, retainedPose: false,
                    centersValid: new Uint8Array(fleetCapacity), retainedCenters: false, sequence: 0,
                });
        }
        catch (error) {
            for (const slot of this.slots)
                slot.buffer.destroy();
            throw error;
        }
    }
    encode(encoder, centers, poses, generation, timeMs, followed, centerMs = timeMs, directed) {
        if (this.closed)
            return;
        const slot = this.slots.find(row => !row.busy);
        if (!slot)
            return;
        slot.busy = true;
        slot.submitted = true;
        slot.generation = generation;
        slot.timeMs = timeMs;
        slot.handle = followed?.id ?? null;
        slot.poseValid = followed != null;
        slot.retainedPose = false;
        slot.centersValid.fill(1);
        slot.retainedCenters = false;
        slot.sequence = ++this.nextSequence;
        slot.centerMs = centerMs;
        configureDirectedSample(slot, directed, timeMs);
        encoder.copyBufferToBuffer(centers, 0, slot.buffer, 0, this.centerBytes);
        if (followed)
            encoder.copyBufferToBuffer(poses, followed.kernelIndex * SHIP_SIM_STRIDE, slot.buffer, this.centerBytes, 224);
        if (followed && directed)
            encoder.copyBufferToBuffer(directed.buffer, followed.kernelIndex * SHIP_BYTES, slot.buffer, this.centerBytes + 224, SHIP_BYTES);
    }
    submitted(currentGeneration, currentHandle) {
        for (const slot of this.slots) {
            if (!slot.submitted)
                continue;
            slot.submitted = false;
            void this.read(slot, currentGeneration, currentHandle);
        }
    }
    async read(slot, generation, handle) {
        try {
            await slot.buffer.mapAsync(GPUMapMode.READ);
            if (this.closed)
                return;
            const currentMap = slot.generation === generation();
            const currentPose = canReadPose(slot, currentMap, handle());
            const currentCenters = currentMap || slot.retainedCenters;
            if (!currentCenters && !currentPose)
                return;
            const bytes = slot.buffer.getMappedRange();
            if (currentCenters)
                this.acceptCenters(bytes, slot);
            if (currentPose)
                this.acceptPose(bytes, slot);
        }
        catch { /* Disposal/device loss skips an observation, never rendering. */ }
        finally {
            if (!this.closed)
                slot.buffer.unmap();
            slot.busy = false;
        }
    }
    acceptCenters(bytes, slot) {
        const values = new Float32Array(bytes, 0, this.centers.length);
        for (let i = 0; i < this.centerTimes.length; i++) {
            if (!slot.centersValid[i] || slot.sequence < this.centerSequences[i])
                continue;
            this.centerSequences[i] = slot.sequence;
            const changed = slot.centerMs !== this.centerTimes[i];
            if (changed) {
                this.previousCenterTimes[i] = this.centerTimes[i];
                this.centerTimes[i] = slot.centerMs;
            }
            for (let c = 0; c < 8; c++) {
                const at = i * 8 + c;
                if (changed)
                    this.previousCenters[at] = this.centers[at];
                this.centers[at] = values[at];
            }
        }
    }
    acceptPose(bytes, slot) {
        if (slot.sequence < this.poseSequence)
            return;
        const f = new Float32Array(bytes, this.centerBytes, 56), w = new Uint32Array(bytes, this.centerBytes, 56);
        if (w[23] !== slot.handle || w[14] === 0 || !Number.isFinite(f[0]))
            return;
        this.poseSequence = slot.sequence;
        const previous = this.pose;
        const observed = readWarpObservation(bytes, this.centerBytes + 224, slot, previous);
        const warp = observed?.warp, attitude = observed?.attitude ?? readAttitude(f);
        const velocity = observedVelocity(previous, slot, f, observed !== null);
        this.pose = { x: f[0], y: f[1], z: f[2], posX: f[0], posY: f[1], posZ: f[2], speed: f[3], heading: f[11], shipIndex: slot.handle, observedMs: slot.timeMs,
            attitude, previousAttitude: velocity.dt ? previous.attitude : attitude, attitudeDt: velocity.dt, classScale: Math.max(1, w[16] >>> 16) * 0.1, warp,
            vx: velocity.vx, vy: velocity.vy, vz: velocity.vz };
    }
    center(slot) {
        const o = slot * 8, n = this.centers[o + 3] ?? 0;
        const dt = (this.centerTimes[slot] - this.previousCenterTimes[slot]) / 1000;
        const inv = dt > 0 && dt < 0.2 && this.previousCenters[o + 3] === n ? 1 / dt : 0;
        return n > 0 ? { x: this.centers[o], y: this.centers[o + 1], z: this.centers[o + 2], n, observedMs: this.centerTimes[slot],
            vx: (this.centers[o] - this.previousCenters[o]) * inv,
            vy: (this.centers[o + 1] - this.previousCenters[o + 1]) * inv,
            vz: (this.centers[o + 2] - this.previousCenters[o + 2]) * inv } : null;
    }
    /** Real representative pose; a centroid can lie inside an orbited planet. */
    routeAnchor(slot) {
        const o = slot * 8, n = this.centers[o + 3] ?? 0;
        const dt = (this.centerTimes[slot] - this.previousCenterTimes[slot]) / 1000;
        const inv = dt > 0 && dt < .2 && this.previousCenters[o + 3] === n ? 1 / dt : 0;
        return n > 0 ? { x: this.centers[o + 4], y: this.centers[o + 5], z: this.centers[o + 6], n, observedMs: this.centerTimes[slot],
            vx: (this.centers[o + 4] - this.previousCenters[o + 4]) * inv,
            vy: (this.centers[o + 5] - this.previousCenters[o + 5]) * inv,
            vz: (this.centers[o + 6] - this.previousCenters[o + 6]) * inv } : null;
    }
    translate(fleetSlot, delta) {
        for (const slot of this.slots)
            retainPending(slot);
        for (const values of [this.centers, this.previousCenters]) {
            const at = fleetSlot * 8;
            for (let axis = 0; axis < 3; axis++) {
                values[at + axis] += delta[axis];
                values[at + 4 + axis] += delta[axis];
            }
        }
        const pose = this.pose;
        if (pose) {
            pose.x += delta[0];
            pose.y += delta[1];
            pose.z += delta[2];
            pose.posX = pose.x;
            pose.posY = pose.y;
            pose.posZ = pose.z;
            if (pose.warp) {
                pose.warp.x += delta[0] / pose.warp.scale;
                pose.warp.y += delta[1] / pose.warp.scale;
                pose.warp.z += delta[2] / pose.warp.scale;
            }
        }
    }
    invalidate(preserve) {
        // A physical mapping edit invalidates changed owners, not observations
        // of unchanged logical owners. The host fences id, generation and scene
        // before naming survivors. Each pending record survives only if its exact
        // owner survives every edit; a later preserve can never undo a prior clear.
        for (const slot of this.slots)
            retainPending(slot, preserve);
        if (!preserve) {
            this.centers.fill(0);
            this.previousCenters.fill(0);
            this.pose = null;
            this.centerTimes.fill(-Infinity);
            this.previousCenterTimes.fill(-Infinity);
            this.centerSequences.fill(-1);
            return;
        }
        this.retainCenters(preserve.centerSlots);
        if (this.pose?.shipIndex !== preserve.shipHandle)
            this.pose = null;
    }
    retainCenters(slots) {
        for (let slot = 0; slot < this.centers.length / 8; slot++) {
            if (slots.has(slot))
                continue;
            this.centers.fill(0, slot * 8, (slot + 1) * 8);
            this.previousCenters.fill(0, slot * 8, (slot + 1) * 8);
            this.centerTimes[slot] = this.previousCenterTimes[slot] = -Infinity;
            this.centerSequences[slot] = -1;
        }
    }
    destroy() { this.closed = true; for (const slot of this.slots)
        slot.buffer.destroy(); this.invalidate(); }
}
//# sourceMappingURL=scene-observations.js.map