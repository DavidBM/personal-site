/** Independent scene dimensions. Spacing must never rescale hulls or planets. */
export const ORBIT_SPACING_MULTIPLIER = 5;
export const SUN_SIZE_MULTIPLIER = 5;
export const SHIP_SPEED_MULTIPLIER = 10;
/** Original coordinate conversion: fixed even when the system grows. */
export const BASE_SYSTEM_SPAN = 0.1;
export const BODY_UNIT_SCALE = BASE_SYSTEM_SPAN / 56;
export const SYSTEM_SPAN = BASE_SYSTEM_SPAN * ORBIT_SPACING_MULTIPLIER;
export const SUN_RADIUS = 0.005 * SUN_SIZE_MULTIPLIER;

/** Warp lanes grow independently of the planetary layout. */
export const WARP_LANE_LENGTH_MULTIPLIER = 50;
export const WARP_LANE_BASE_SPAN = 3.2;
export const WARP_RIM_ORBIT_MULTIPLIER = 1.2;
/** Sun-local schematic distance, shared by lane rendering and timed travel. */
export function sceneWarpLaneLength(edgeLength, span = SYSTEM_SPAN) {
  if (!(edgeLength > 0) || !(span > 0)) return 0;
  return Math.min(edgeLength, WARP_LANE_BASE_SPAN * span) * WARP_LANE_LENGTH_MULTIPLIER;
}
