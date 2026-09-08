import { HOP_OPEN_SPEED_MUL, SCENE_AGENT_SCALE, hopOpenSpeedFromDuration } from './ship-motion-config.js';
/** Local movement uses the same seconds and turn rates, but sun-local world units.
 * The legacy galaxy hop's 40-unit floor would cross an entire scene in one step. */
export function movementHopOpenSpeed(pathLen, durationMs, localMovement = false) {
    if (!localMovement)
        return hopOpenSpeedFromDuration(pathLen, durationMs);
    return Math.max(1e-6, Math.max(0, pathLen) / Math.max(1e-3, durationMs / 1000) * HOP_OPEN_SPEED_MUL);
}
/** Only dimensional acceleration/cruise inputs scale; angular velocity is rad/s,
 * and the existing scene branch already scales orbit radius and personal height. */
export const LOCAL_MOVE_ACCEL_SCALE = SCENE_AGENT_SCALE;
export const LOCAL_MOVE_CRUISE_SCALE = SCENE_AGENT_SCALE;
//# sourceMappingURL=local-move-profile.js.map