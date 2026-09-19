/** Transit density bricks: snapped corridor points, not a system-wide grid. */
export const TRANSIT_BRICK_HALF = 64;
export const TRANSIT_HOP_FRACTION = 0.4;

export function snapTransitBrick(point, half = TRANSIT_BRICK_HALF) {
  const cell = half * 2;
  return {
    x: Math.round(point.x / cell) * cell,
    y: Math.round(point.y / cell) * cell,
    z: Math.round(point.z / cell) * cell,
    halfExtent: half,
  };
}

export function assignTransitBrick(pose, brick) {
  return { x: pose.x, y: pose.y, z: pose.z, brick };
}

export function shouldHoldTransitBrick(centroid, brick, fraction = TRANSIT_HOP_FRACTION) {
  const dx = centroid.x - brick.x, dy = centroid.y - brick.y, dz = centroid.z - brick.z;
  return Math.hypot(dx, dy, dz) <= brick.halfExtent * fraction;
}

export function transitsContactWithoutAffinity(a, b, hullPad = 0.15) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  const r = (a.radius ?? 1) + (b.radius ?? 1) + hullPad;
  return a.brick && b.brick && a.brick !== b.brick && dx * dx + dy * dy + dz * dz <= r * r;
}
