/** Shared production/scale-bench sampler. Matches timed-trail-ref.ts. */
export const TIMED_TRAIL_WGSL = /* wgsl */ `
fn writeTimedTrailPoint(base: u32, point: vec3<f32>, birth: f32) {
  trails[base] = point.x;
  trails[base + 1u] = point.z;
  trails[base + 2u] = birth;
  trails[base + 3u] = point.y;
}

/**
 * The newest slot is a live head, overwritten every frame. All other slots
 * freeze at cadence timestamps, interpolated between consecutive emitter poses.
 * A late frame writes only the newest ringful, never unbounded catch-up work.
 * No additional storage or draw segments; sinceSample stores elapsed ms.
 */
fn appendTimedTrail(shipIn: ShipSim, ringBase: u32, point: vec3<f32>) -> ShipSim {
  var ship = shipIn;
  let mask = TRAIL_RING_SIZE - 1u;
  var head = (ship.trailWrite - 1u) & mask;
  let base = ringBase + head * TRAIL_SAMPLE_FLOATS;
  let previousBirth = trails[base + 2u];
  let elapsed = u.nowRel - previousBirth;
  if (previousBirth < 0.0 || elapsed < 0.0 || elapsed >= TRAIL_LIFETIME_MS) {
    for (var i = 0u; i < TRAIL_RING_SIZE; i++) {
      trails[ringBase + i * TRAIL_SAMPLE_FLOATS + 2u] = -1.0;
    }
    // One initial historical point and one live head (zero length on spawn).
    writeTimedTrailPoint(ringBase, point, u.nowRel);
    writeTimedTrailPoint(ringBase + TRAIL_SAMPLE_FLOATS, point, u.nowRel);
    ship.trailWrite = 2u;
    ship.sinceSample = 0.0;
    return ship;
  }
  let previous = vec3<f32>(trails[base], trails[base + 3u], trails[base + 1u]);
  let total = max(ship.sinceSample, 0.0) + elapsed;
  let count = u32(floor((total + 0.001) / TRAIL_MAX_INTERVAL_MS));
  let skip = count - min(count, TRAIL_RING_SIZE - 1u);
  head = (head + skip) & mask;
  for (var i = skip; i < count; i++) {
    let offset = min((f32(i) + 1.0) * TRAIL_MAX_INTERVAL_MS - ship.sinceSample, elapsed);
    let fraction = clamp(offset / max(elapsed, 0.000001), 0.0, 1.0);
    writeTimedTrailPoint(ringBase + head * TRAIL_SAMPLE_FLOATS,
      mix(previous, point, fraction), previousBirth + offset);
    head = (head + 1u) & mask;
  }
  writeTimedTrailPoint(ringBase + head * TRAIL_SAMPLE_FLOATS, point, u.nowRel);
  ship.trailWrite = (head + 1u) & mask;
  ship.sinceSample = max(total - f32(count) * TRAIL_MAX_INTERVAL_MS, 0.0);
  return ship;
}
`;
//# sourceMappingURL=timed-trail.wgsl.js.map