import { integrateShipAgent, SHIP_MODE_ORBIT } from './ship-flight-ref.js';
import { SCENE_AGENT_SCALE, SCENE_ORBIT_SPEED_MUL, SCENE_SPEED_SCALE } from './ship-motion-config.js';
/** The existing agent's dimensional constants are canonical fleet units. Run a
 * local move around its target in those units, then restore sun-local storage.
 * This also scales capture/height/singularity thresholds without divergent rules.
 * Orbit radius/height are already stored canonically in ShipSim. */
export function stepLocalShipAgent(ship, path, dtMs) {
    const scale = SCENE_AGENT_SCALE, centerY = path.pathEndY ?? 0;
    const accel = ship.accel, cruise = ship.cruiseV;
    ship.posX = (ship.posX - path.pathEndX) / scale;
    ship.posZ = (ship.posZ - path.pathEndZ) / scale;
    ship.posY = ((ship.posY ?? 0) - centerY) / scale;
    ship.speed /= scale;
    ship.accel /= scale;
    ship.cruiseV /= scale;
    const orbitMul = ship.mode === SHIP_MODE_ORBIT ? SCENE_ORBIT_SPEED_MUL : 1;
    integrateShipAgent(ship, {
        centerX: 0, centerZ: 0, pathEndX: 0, pathEndZ: 0,
        pathStartX: (path.pathStartX - path.pathEndX) / scale,
        pathStartZ: (path.pathStartZ - path.pathEndZ) / scale,
        durationMs: path.durationMs, domainWarpActive: path.domainWarpActive,
        localMovement: true, dtMs: Math.min(50, Math.max(0, dtMs)) *
            (path.domainWarpActive ? 1 : SCENE_SPEED_SCALE * orbitMul),
    });
    ship.posX = path.pathEndX + ship.posX * scale;
    ship.posZ = path.pathEndZ + ship.posZ * scale;
    ship.posY = centerY + (ship.posY ?? 0) * scale;
    ship.speed *= scale;
    ship.accel = accel;
    ship.cruiseV = cruise;
    return ship;
}
//# sourceMappingURL=local-move-reference.js.map