/**
 * L1 — Fleet GPU storage layouts (WebGPU storage / vertex buffers).
 *
 * ## Packing rules (two different contracts)
 *
 * **FleetGpu** (storage buffer, stride 64): host-shareable WGSL-friendly layout
 * with vec2-aligned fields and explicit pad slots. Struct size is 16-byte aligned
 * for storage arrays.
 *
 * **ShipInstance** (vertex-step instance buffer, stride 48): **tight 48-byte
 * packing with scalar fields only** — NOT the default WGSL host-shareable
 * `vec3` layout (which would insert 4 bytes of padding after each `vec3` and
 * push the struct past 48 bytes / misalign color).
 *
 * Future WGSL for ShipInstance must use scalar `f32`/`u32` fields (preferred)
 * or `@align(4) vec3` / equivalent explicit packing — never bare `vec3` in a
 * host-shareable struct. Example scalar shape:
 *
 * ```wgsl
 * struct ShipInstance {
 *   localCenterX : f32,
 *   localCenterY : f32,
 *   localCenterZ : f32,
 *   rotation     : f32,
 *   size         : f32,
 *   _pad0        : f32,
 *   colorR       : f32,
 *   colorG       : f32,
 *   colorB       : f32,
 *   phase        : f32,
 *   fleetIndex   : u32,
 *   typeId       : u32,
 * } // stride 48
 * ```
 *
 * CPU authority still issues path commands; GPU owns continuous pose (clock A).
 * Field order is the contract for TS packing, WGSL structs, and golden tests.
 */
/** Bytes — must match WGSL `struct FleetGpu` packing. */
export const FLEET_GPU_STRIDE = 64;
/**
 * FleetGpu (stride 64) — **do not change stride/offsets** (L1 tests):
 *  0  f32 posX / 4 f32 posZ   // visual center (updated by L3 compute)
 *  8  f32 heading
 * 12  f32 _pad0               // planar: 0; SPACE3D: pathEndY (orbit/seek center height)
 * 16  f32 pathStartX / 20 pathStartZ
 * 24  f32 pathEndX / 28 pathEndZ
 * 32  f32 t0                  // jump start, **GPU-relative** ms (wall - origin)
 * 36  f32 durationMs
 * 40  u32 flags               // bit0 alive, bit1 jumping, bit2 cooldown, bit3 no-trail (icon),
 *                             // bit4 sim-paused (R3 impostor/icon), bit5 warm (R5 promote),
 *                             // bit6 SPACE3D (sphere agent + pathEndY in _pad0)
 * 44  u32 shipBudget          // visual scatter count after L4 LOD (instanceCount)
 * 48  u32 countsPacked        // domain truth: red | blue<<10 | green<<20 (10 bits each)
 * 52  u32 instanceStart       // draw + ShipSim + trail-ring base index (ring cursor = ShipSim.trailWrite)
 * 56  u32 fleetIdHash         // stable id token for debug
 * 60  u32 _pad1               // zeroed by writeFleetGpu
 *
 * L3/L4: shipBudget = visual scatter count (LOD-capped); countsPacked = domain
 * truth (not visual). instanceStart = draw/ShipSim base index for scatter.
 */
export const FleetGpuFields = {
    posX: 0,
    posZ: 4,
    heading: 8,
    _pad0: 12,
    pathStartX: 16,
    pathStartZ: 20,
    pathEndX: 24,
    pathEndZ: 28,
    t0: 32,
    durationMs: 36,
    flags: 40,
    shipBudget: 44,
    countsPacked: 48,
    instanceStart: 52,
    fleetIdHash: 56,
    _pad1: 60,
};
export const FLEET_FLAG_ALIVE = 1 << 0;
export const FLEET_FLAG_JUMPING = 1 << 1;
export const FLEET_FLAG_COOLDOWN = 1 << 2;
/** W4 icon band: skip trail age/append/expand in fleet-integrate. */
export const FLEET_FLAG_NO_TRAIL = 1 << 3;
/**
 * R0/R3 — fleet sim paused (ships hold; agent motion skipped).
 * R3: set for impostor/icon (mid/far LOD). With shipBudget==1, cs_fleets
 * writes the single draw instance from eased FleetGpu.pos (rotation 0).
 * Formation multi-ship does not set this; cs_ships owns draw.
 */
export const FLEET_FLAG_SIM_PAUSED = 1 << 4;
/**
 * R5 — formation warm-up residency. Set for WARM_FRAMES (fleet-lod) after
 * promote to formation from impostor/icon/new. cs_ships still integrates the
 * agent but writes draw size=0 until the flag clears. Cleared on demote to
 * impostor/icon or when warmFramesLeft hits 0.
 */
export const FLEET_FLAG_WARM = 1 << 5;
/**
 * Full sphere 3D ship agent (space3d). When set, FleetGpu._pad0 holds pathEndY
 * (orbit/seek center height); GPU/CPU use sphere external-tangent + CIRCULATE.
 * Planar production leaves this clear and _pad0 = 0.
 */
export const FLEET_FLAG_SPACE3D = 1 << 6;
/**
 * Ship instance for instanced draw (vertex-step-mode instance). Stride 48.
 *
 * Tight scalar packing — see file header. Do not treat as WGSL `vec3` layout.
 */
export const SHIP_INSTANCE_STRIDE = 48;
/**
 * ShipInstance (stride 48, scalar / tight):
 *  0  f32 localCenterX     // formation offset (NOT host-shareable vec3)
 *  4  f32 localCenterY
 *  8  f32 localCenterZ
 * 12  f32 rotation
 * 16  f32 size
 * 20  f32 _pad0            // zeroed by writeShipInstance
 * 24  f32 colorR
 * 28  f32 colorG
 * 32  f32 colorB
 * 36  f32 phase            // weave seed
 * 40  u32 fleetIndex
 * 44  u32 typeId           // 0 red 1 blue 2 green
 */
export const ShipInstanceFields = {
    localCenterX: 0,
    localCenterY: 4,
    localCenterZ: 8,
    rotation: 12,
    size: 16,
    _pad0: 20,
    colorR: 24,
    colorG: 28,
    colorB: 32,
    phase: 36,
    fleetIndex: 40,
    typeId: 44,
};
/** Per-ship or per-fleet trail ring sample. Stride 16. */
export const TRAIL_SAMPLE_STRIDE = 16;
/**
 * TrailSample:
 *  0  f32 posX
 *  4  f32 posZ
 *  8  f32 age01   // 0 = fresh, 1 = dead
 * 12  f32 _pad    // zeroed by writeTrailSample
 */
export const TrailSampleFields = {
    posX: 0,
    posZ: 4,
    age01: 8,
    _pad: 12,
};
/** Write one TrailSample (zeros pad). */
export function writeTrailSample(view, byteOffset, sample) {
    const o = byteOffset;
    view.setFloat32(o + TrailSampleFields.posX, sample.posX, true);
    view.setFloat32(o + TrailSampleFields.posZ, sample.posZ, true);
    view.setFloat32(o + TrailSampleFields.age01, sample.age01, true);
    view.setFloat32(o + TrailSampleFields._pad, 0, true);
}
/** Read one TrailSample (pad not returned). */
export function readTrailSample(view, byteOffset) {
    const o = byteOffset;
    return {
        posX: view.getFloat32(o + TrailSampleFields.posX, true),
        posZ: view.getFloat32(o + TrailSampleFields.posZ, true),
        age01: view.getFloat32(o + TrailSampleFields.age01, true),
    };
}
export function packFleetCounts(red, blue, green) {
    const r = Math.max(0, Math.min(1023, red | 0));
    const b = Math.max(0, Math.min(1023, blue | 0));
    const g = Math.max(0, Math.min(1023, green | 0));
    return r | (b << 10) | (g << 20);
}
export function unpackFleetCounts(packed) {
    return {
        red: packed & 1023,
        blue: (packed >>> 10) & 1023,
        green: (packed >>> 20) & 1023,
    };
}
/** Write one FleetGpu record into a ArrayBuffer/DataView at byte offset. */
export function writeFleetGpu(view, byteOffset, fleet) {
    const o = byteOffset;
    view.setFloat32(o + FleetGpuFields.posX, fleet.posX, true);
    view.setFloat32(o + FleetGpuFields.posZ, fleet.posZ, true);
    view.setFloat32(o + FleetGpuFields.heading, fleet.heading, true);
    // _pad0: pathEndY under SPACE3D; else zero (planar bit-compat).
    const pathEndY = fleet.pathEndY !== undefined && Number.isFinite(fleet.pathEndY)
        ? fleet.pathEndY
        : 0;
    view.setFloat32(o + FleetGpuFields._pad0, pathEndY, true);
    view.setFloat32(o + FleetGpuFields.pathStartX, fleet.pathStartX, true);
    view.setFloat32(o + FleetGpuFields.pathStartZ, fleet.pathStartZ, true);
    view.setFloat32(o + FleetGpuFields.pathEndX, fleet.pathEndX, true);
    view.setFloat32(o + FleetGpuFields.pathEndZ, fleet.pathEndZ, true);
    view.setFloat32(o + FleetGpuFields.t0, fleet.t0, true);
    view.setFloat32(o + FleetGpuFields.durationMs, fleet.durationMs, true);
    view.setUint32(o + FleetGpuFields.flags, fleet.flags >>> 0, true);
    view.setUint32(o + FleetGpuFields.shipBudget, fleet.shipBudget >>> 0, true);
    view.setUint32(o + FleetGpuFields.countsPacked, packFleetCounts(fleet.red, fleet.blue, fleet.green) >>> 0, true);
    view.setUint32(o + FleetGpuFields.instanceStart, fleet.instanceStart >>> 0, true);
    view.setUint32(o + FleetGpuFields.fleetIdHash, fleet.fleetIdHash >>> 0, true);
    view.setUint32(o + FleetGpuFields._pad1, 0, true);
}
export function readFleetGpuPos(view, byteOffset) {
    return {
        x: view.getFloat32(byteOffset + FleetGpuFields.posX, true),
        z: view.getFloat32(byteOffset + FleetGpuFields.posZ, true),
    };
}
/** Write one ShipInstance record (tight 48-byte scalar packing). */
export function writeShipInstance(view, byteOffset, ship) {
    const o = byteOffset;
    view.setFloat32(o + ShipInstanceFields.localCenterX, ship.localCenterX, true);
    view.setFloat32(o + ShipInstanceFields.localCenterY, ship.localCenterY, true);
    view.setFloat32(o + ShipInstanceFields.localCenterZ, ship.localCenterZ, true);
    view.setFloat32(o + ShipInstanceFields.rotation, ship.rotation, true);
    view.setFloat32(o + ShipInstanceFields.size, ship.size, true);
    view.setFloat32(o + ShipInstanceFields._pad0, 0, true);
    view.setFloat32(o + ShipInstanceFields.colorR, ship.colorR, true);
    view.setFloat32(o + ShipInstanceFields.colorG, ship.colorG, true);
    view.setFloat32(o + ShipInstanceFields.colorB, ship.colorB, true);
    view.setFloat32(o + ShipInstanceFields.phase, ship.phase, true);
    view.setUint32(o + ShipInstanceFields.fleetIndex, ship.fleetIndex >>> 0, true);
    view.setUint32(o + ShipInstanceFields.typeId, ship.typeId >>> 0, true);
}
/** Read one ShipInstance record (tight 48-byte scalar packing). */
export function readShipInstance(view, byteOffset) {
    const o = byteOffset;
    return {
        localCenterX: view.getFloat32(o + ShipInstanceFields.localCenterX, true),
        localCenterY: view.getFloat32(o + ShipInstanceFields.localCenterY, true),
        localCenterZ: view.getFloat32(o + ShipInstanceFields.localCenterZ, true),
        rotation: view.getFloat32(o + ShipInstanceFields.rotation, true),
        size: view.getFloat32(o + ShipInstanceFields.size, true),
        colorR: view.getFloat32(o + ShipInstanceFields.colorR, true),
        colorG: view.getFloat32(o + ShipInstanceFields.colorG, true),
        colorB: view.getFloat32(o + ShipInstanceFields.colorB, true),
        phase: view.getFloat32(o + ShipInstanceFields.phase, true),
        fleetIndex: view.getUint32(o + ShipInstanceFields.fleetIndex, true),
        typeId: view.getUint32(o + ShipInstanceFields.typeId, true),
    };
}
/** Simple string hash for debug id tokens (not cryptographic). */
export function hashFleetId(id) {
    let h = 2166136261;
    for (let i = 0; i < id.length; i++) {
        h ^= id.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}
function assertOffset(actual, expected, name) {
    if (actual !== expected) {
        throw new Error(`${name} offset ${actual} !== ${expected}`);
    }
}
/** Assert layout invariants (called from unit tests). */
export function assertFleetLayoutInvariants() {
    if (FLEET_GPU_STRIDE !== 64) {
        throw new Error(`FLEET_GPU_STRIDE ${FLEET_GPU_STRIDE} !== 64`);
    }
    if (SHIP_INSTANCE_STRIDE !== 48) {
        throw new Error(`SHIP_INSTANCE_STRIDE ${SHIP_INSTANCE_STRIDE} !== 48`);
    }
    if (TRAIL_SAMPLE_STRIDE !== 16) {
        throw new Error(`TRAIL_SAMPLE_STRIDE ${TRAIL_SAMPLE_STRIDE} !== 16`);
    }
    if (FLEET_GPU_STRIDE % 16 !== 0) {
        throw new Error("FLEET_GPU_STRIDE must be 16-byte aligned");
    }
    if (SHIP_INSTANCE_STRIDE % 16 !== 0) {
        throw new Error("SHIP_INSTANCE_STRIDE must be 16-byte aligned");
    }
    if (TRAIL_SAMPLE_STRIDE % 16 !== 0) {
        throw new Error("TRAIL_SAMPLE_STRIDE must be 16-byte aligned");
    }
    // FleetGpu field offsets
    assertOffset(FleetGpuFields.posX, 0, "FleetGpu.posX");
    assertOffset(FleetGpuFields.posZ, 4, "FleetGpu.posZ");
    assertOffset(FleetGpuFields.heading, 8, "FleetGpu.heading");
    assertOffset(FleetGpuFields._pad0, 12, "FleetGpu._pad0");
    assertOffset(FleetGpuFields.pathStartX, 16, "FleetGpu.pathStartX");
    assertOffset(FleetGpuFields.pathStartZ, 20, "FleetGpu.pathStartZ");
    assertOffset(FleetGpuFields.pathEndX, 24, "FleetGpu.pathEndX");
    assertOffset(FleetGpuFields.pathEndZ, 28, "FleetGpu.pathEndZ");
    assertOffset(FleetGpuFields.t0, 32, "FleetGpu.t0");
    assertOffset(FleetGpuFields.durationMs, 36, "FleetGpu.durationMs");
    assertOffset(FleetGpuFields.flags, 40, "FleetGpu.flags");
    assertOffset(FleetGpuFields.shipBudget, 44, "FleetGpu.shipBudget");
    assertOffset(FleetGpuFields.countsPacked, 48, "FleetGpu.countsPacked");
    assertOffset(FleetGpuFields.instanceStart, 52, "FleetGpu.instanceStart");
    assertOffset(FleetGpuFields.fleetIdHash, 56, "FleetGpu.fleetIdHash");
    assertOffset(FleetGpuFields._pad1, 60, "FleetGpu._pad1");
    // Last field + 4 = stride
    if (FleetGpuFields._pad1 + 4 !== FLEET_GPU_STRIDE) {
        throw new Error("FleetGpu last field does not end at FLEET_GPU_STRIDE");
    }
    // ShipInstance field offsets (tight scalar packing)
    assertOffset(ShipInstanceFields.localCenterX, 0, "ShipInstance.localCenterX");
    assertOffset(ShipInstanceFields.localCenterY, 4, "ShipInstance.localCenterY");
    assertOffset(ShipInstanceFields.localCenterZ, 8, "ShipInstance.localCenterZ");
    assertOffset(ShipInstanceFields.rotation, 12, "ShipInstance.rotation");
    assertOffset(ShipInstanceFields.size, 16, "ShipInstance.size");
    assertOffset(ShipInstanceFields._pad0, 20, "ShipInstance._pad0");
    assertOffset(ShipInstanceFields.colorR, 24, "ShipInstance.colorR");
    assertOffset(ShipInstanceFields.colorG, 28, "ShipInstance.colorG");
    assertOffset(ShipInstanceFields.colorB, 32, "ShipInstance.colorB");
    assertOffset(ShipInstanceFields.phase, 36, "ShipInstance.phase");
    assertOffset(ShipInstanceFields.fleetIndex, 40, "ShipInstance.fleetIndex");
    assertOffset(ShipInstanceFields.typeId, 44, "ShipInstance.typeId");
    if (ShipInstanceFields.typeId + 4 !== SHIP_INSTANCE_STRIDE) {
        throw new Error("ShipInstance last field does not end at SHIP_INSTANCE_STRIDE");
    }
    // TrailSample
    assertOffset(TrailSampleFields.posX, 0, "TrailSample.posX");
    assertOffset(TrailSampleFields.posZ, 4, "TrailSample.posZ");
    assertOffset(TrailSampleFields.age01, 8, "TrailSample.age01");
    assertOffset(TrailSampleFields._pad, 12, "TrailSample._pad");
    if (TrailSampleFields._pad + 4 !== TRAIL_SAMPLE_STRIDE) {
        throw new Error("TrailSample last field does not end at TRAIL_SAMPLE_STRIDE");
    }
}
//# sourceMappingURL=fleet-layout.js.map