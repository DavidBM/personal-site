import { FLEET_GPU_STRIDE, FLEET_FLAG_ALIVE, FLEET_FLAG_JUMPING, FLEET_FLAG_COOLDOWN, FLEET_FLAG_WARM, FLEET_FLAG_SYSTEM_SCENE, FleetGpuFields, hashFleetId } from "../../fleet-layout.js";
import { fleetCenter, initShipsFromFormation, writePathCommand } from "../../fleet-motion-api.js";
import { RENDER_PLANE_Y } from "../../../contracts/render-constants.js";
import { resolveFleetVisualPosition } from "../../fleet-motion-ref.js";
import { writeRemoteFleetPath } from "./remote-path.js";
/** Domain paths to FleetGpu commands; initial ShipSim formation only on spawn. */
export function createFleetPathPacking(storage, getLookup, timeline, scene) {
    /**
     * Spawn-time pack base from discrete state. Unresolved → origin (GPU path
     * command still lands ships once lookup is ready).
     */
    function fleetSpawnBase(state) {
        const lookup = getLookup();
        const pos = lookup
            ? resolveFleetVisualPosition(state, timeline.wallMs, lookup)
            : null;
        if (!pos)
            return { x: 0, y: RENDER_PLANE_Y, z: 0 };
        return { x: pos.x, y: RENDER_PLANE_Y, z: pos.z };
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
    function writeFleetGpuFromState(visual, state, fleetSlot) {
        if (visual.remote) {
            writeRemoteFleetPath(storage, visual, scene.fleetLocMatchesKepler(state), getLookup(), timeline.elapsedMs);
            return true;
        }
        const o = fleetSlot * FLEET_GPU_STRIDE;
        const path = resolvePath(state, o);
        if (!path)
            return false;
        const { pathStartX, pathStartZ, pathEndX, pathEndZ, t0, durationMs, heading, posX, posZ, jumping } = path;
        let flags = path.flags;
        // R5: spawn warm-up (cs_ships sims + size 0). Shader LOD owns MID/FAR proxy.
        if (visual.warmFramesLeft > 0)
            flags |= FLEET_FLAG_WARM;
        // Flags rebuilt from scratch — SCENE must be re-OR'd every write (not _pad1).
        const prevFlags = o + FLEET_GPU_STRIDE <= storage.fleetGpuBytes.byteLength
            ? storage.fleetGpuView.getUint32(o + FleetGpuFields.flags, true)
            : 0;
        const preserveScenePath = (prevFlags & FLEET_FLAG_SYSTEM_SCENE) !== 0 &&
            scene.fleetLocMatchesKepler(state);
        const previousSceneRow = preserveScenePath
            ? {
                posX: storage.fleetGpuView.getFloat32(o + FleetGpuFields.posX, true),
                posZ: storage.fleetGpuView.getFloat32(o + FleetGpuFields.posZ, true),
                startX: storage.fleetGpuView.getFloat32(o + FleetGpuFields.pathStartX, true),
                startZ: storage.fleetGpuView.getFloat32(o + FleetGpuFields.pathStartZ, true),
                endX: storage.fleetGpuView.getFloat32(o + FleetGpuFields.pathEndX, true),
                endZ: storage.fleetGpuView.getFloat32(o + FleetGpuFields.pathEndZ, true),
            }
            : null;
        flags = scene.orSystemSceneFlag(visual, state, flags, prevFlags);
        const cmd = {
            from: { x: pathStartX, z: pathStartZ },
            target: { x: pathEndX, z: pathEndZ },
            durationMs,
            t0,
            formationHeading: heading,
            jumping,
        };
        writePathCommand(storage.fleetGpuView, o, cmd, {
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
        if (previousSceneRow) {
            storage.fleetGpuView.setFloat32(o + FleetGpuFields.posX, previousSceneRow.posX, true);
            storage.fleetGpuView.setFloat32(o + FleetGpuFields.posZ, previousSceneRow.posZ, true);
            storage.fleetGpuView.setFloat32(o + FleetGpuFields.pathStartX, previousSceneRow.startX, true);
            storage.fleetGpuView.setFloat32(o + FleetGpuFields.pathStartZ, previousSceneRow.startZ, true);
            storage.fleetGpuView.setFloat32(o + FleetGpuFields.pathEndX, previousSceneRow.endX, true);
            storage.fleetGpuView.setFloat32(o + FleetGpuFields.pathEndZ, previousSceneRow.endZ, true);
        }
        if (scene.fleetLocMatchesKepler(state)) {
            scene.writeParkedPathEnd(visual, timeline.seconds);
        }
        return true;
    }
    function resolvePath(state, o) {
        const lookup = getLookup();
        if (!lookup)
            return null;
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
                return null;
            pathStartX = start.x;
            pathStartZ = start.z;
            pathEndX = end.x;
            pathEndZ = end.z;
            t0 = timeline.toGpuMs(state.startTime);
            durationMs = state.durationMs;
            flags = FLEET_FLAG_ALIVE | FLEET_FLAG_JUMPING;
            jumping = true;
            // Keep prior formation heading — do NOT snap to path dir on hop start
            // (that reorients every ship slot in one frame). First hop uses 0.
            heading = storage.fleetGpuView.getFloat32(o + FleetGpuFields.heading, true);
            const cmdJump = {
                from: { x: pathStartX, z: pathStartZ },
                target: { x: pathEndX, z: pathEndZ },
                durationMs,
                t0,
                formationHeading: heading,
                jumping: true,
            };
            const integrated = fleetCenter(cmdJump, timeline.elapsedMs);
            posX = integrated.x;
            posZ = integrated.z;
        }
        else if (state.state === "cooldown" || state.state === "awaiting") {
            const node = lookup(state.node);
            if (!node)
                return null;
            pathStartX = pathEndX = node.x;
            pathStartZ = pathEndZ = node.z;
            posX = node.x;
            posZ = node.z;
            // Keep formation heading (stable slot frame across hops).
            heading = storage.fleetGpuView.getFloat32(o + FleetGpuFields.heading, true);
            if (state.state === "cooldown") {
                flags = FLEET_FLAG_ALIVE | FLEET_FLAG_COOLDOWN;
                t0 = timeline.toGpuMs(state.startTime);
                durationMs = state.durationMs > 0 ? state.durationMs : 1;
            }
            else {
                flags = FLEET_FLAG_ALIVE;
                durationMs = 1;
            }
        }
        else {
            return null;
        }
        return { pathStartX, pathStartZ, pathEndX, pathEndZ, t0, durationMs, flags, heading, posX, posZ, jumping };
    }
    /**
     * Safe FleetGpu row when path lookup misses on spawn: ALIVE only (no JUMPING),
     * park at the given xz, duration 1. Always writes shipBudget/instanceStart.
     * Never reuse a recycled slot's leftover compact-planet pos — that parks a
     * galaxy fleet inside the jewel.
     */
    function writeFleetGpuParkedScatter(visual, fleetSlot, parkX = 0, parkZ = 0) {
        const o = fleetSlot * FLEET_GPU_STRIDE;
        let heading = 0;
        if (o + FLEET_GPU_STRIDE <= storage.fleetGpuBytes.byteLength) {
            heading = storage.fleetGpuView.getFloat32(o + FleetGpuFields.heading, true);
        }
        let flags = FLEET_FLAG_ALIVE;
        if (visual.warmFramesLeft > 0)
            flags |= FLEET_FLAG_WARM;
        const prevFlags = o + FLEET_GPU_STRIDE <= storage.fleetGpuBytes.byteLength
            ? storage.fleetGpuView.getUint32(o + FleetGpuFields.flags, true)
            : 0;
        flags = scene.orSystemSceneFlag(visual, visual.state, flags, prevFlags);
        const cmd = {
            from: { x: parkX, z: parkZ },
            target: { x: parkX, z: parkZ },
            durationMs: 1,
            t0: 0,
            formationHeading: heading,
            jumping: false,
        };
        writePathCommand(storage.fleetGpuView, o, cmd, {
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
        if (scene.fleetLocMatchesKepler(visual.state)) {
            scene.writeParkedPathEnd(visual, timeline.seconds);
        }
    }
    /**
     * L5 — init ShipSim from just-packed draw centers. fleetIndex = stable fleetSlot.
     * Always formation agents (paused=false); GPU shader LOD owns MID/FAR hide.
     */
    function initShipSimForFleet(visual) {
        const count = visual.instanceCapacity;
        if (count <= 0)
            return;
        const path = storage.fleetGpuPath(visual);
        if (!path)
            return;
        const formationHeading = storage.fleetGpuView.getFloat32(visual.fleetSlot * FLEET_GPU_STRIDE + FleetGpuFields.heading, true);
        const cmd = {
            from: { x: path.pathStartX, z: path.pathStartZ },
            target: { x: path.pathEndX, z: path.pathEndZ },
            durationMs: 1,
            t0: 0,
            formationHeading,
            jumping: false,
        };
        initShipsFromFormation({
            instanceData: storage.instanceData,
            shipSimView: storage.shipSimView,
            instanceStart: visual.instanceStart,
            count,
            cmd,
            fleetIndex: visual.fleetSlot,
            seed: visual.seed,
            paused: false, // formation agent — shader LOD pauses draw on MID/FAR
        });
    }
    return { fleetSpawnBase, writeFleetGpuFromState, writeFleetGpuParkedScatter, initShipSimForFleet };
}
//# sourceMappingURL=path-packing.js.map