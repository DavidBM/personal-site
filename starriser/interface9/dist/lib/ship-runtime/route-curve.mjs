/** Shared bounded quadratic fillets, baked once when the fleet route changes. */
export const ROUTE_CORNER_STEPS = 8;
export const ROUTE_MAX_DEVIATION = 0.001;

/** Use only a quarter of the planner's compact clearance, capped at 0.001 sun-local units. */
export function routeCornerDeviation(clearance) {
  return Number.isFinite(clearance) ? Math.min(ROUTE_MAX_DEVIATION, Math.max(0, clearance) * 0.25) : 0;
}

/** Reject invalid routes and remove zero-length legs before constructing tangents. */
function cleanRoutePoints(points) {
  const source = [];
  for (const point of points) {
    if (point.length !== 3 || !point.every(Number.isFinite)) return [];
    const last = source[source.length - 1];
    if (!last || Math.hypot(...point.map((value, axis) => value - last[axis])) > 1e-12) source.push([...point]);
  }
  return source;
}

/**
 * A quadratic fillet stays in the corner triangle. Trimming each arm by at most
 * 4*deviation bounds its distance to the original two segments by deviation:
 * on either half of the curve the opposite arm contributes at most trim/4.
 * Arm trims use <=40% of their segment, so adjacent fillets cannot overlap.
 */
export function roundedRoutePoints(points, deviation) {
  const source = cleanRoutePoints(points);
  if (source.length < 3 || !(deviation > 0) || !Number.isFinite(deviation)) return source;
  const out = [source[0]];
  for (let i = 1; i < source.length - 1; i++) {
    const a = source[i - 1], p = source[i], b = source[i + 1];
    const incoming = p.map((v, axis) => v - a[axis]);
    const outgoing = b.map((v, axis) => v - p[axis]);
    const before = Math.hypot(...incoming), after = Math.hypot(...outgoing);
    const u = incoming.map(v => v / before), v = outgoing.map(value => value / after);
    const cosine = u.reduce((sum, value, axis) => sum + value * v[axis], 0);
    // Preserve straight runs and near-reversals; the latter have no useful fillet tangent.
    if (cosine > .9995 || cosine < -.95) { out.push(p); continue; }
    const trim = Math.min(before * .4, after * .4, deviation * 4);
    const entry = p.map((value, axis) => value - u[axis] * trim);
    const exit = p.map((value, axis) => value + v[axis] * trim);
    out.push(entry);
    for (let step = 1; step <= ROUTE_CORNER_STEPS; step++) {
      const t = step / ROUTE_CORNER_STEPS, s = 1 - t;
      out.push(p.map((value, axis) => s * s * entry[axis] + 2 * s * t * value + t * t * exit[axis]));
    }
  }
  out.push(source[source.length - 1]);
  return out;
}
