/** CPU ray vs fleet halo spheres. No ShipSim readback. */

export const HALO_MIN_CSS_PX = 24;

export function cssPxToWorld(cssPx, distance, tanHalfFov, cssHeight) {
  return Math.abs(cssPx) * (2 * Math.abs(distance) * Math.max(1e-8, tanHalfFov)) / Math.max(1, cssHeight);
}

export function raySphereT(ray, cx, cy, cz, radius) {
  const ox = ray.origin.x - cx, oy = ray.origin.y - cy, oz = ray.origin.z - cz;
  const dx = ray.direction.x, dy = ray.direction.y, dz = ray.direction.z;
  const b = ox * dx + oy * dy + oz * dz;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const s = Math.sqrt(disc);
  const t0 = -b - s, t1 = -b + s;
  if (t0 >= 0) return t0;
  if (t1 >= 0) return t1;
  return Infinity;
}

export function pickFleetHalo(ray, markers, minWorldRadius) {
  let best = null, bestT = Infinity;
  for (const marker of markers) {
    const r = Math.max(marker.radius, minWorldRadius);
    const t = raySphereT(ray, marker.x, marker.y, marker.z, r);
    if (t < bestT) {
      bestT = t;
      best = marker;
    }
  }
  return best;
}
