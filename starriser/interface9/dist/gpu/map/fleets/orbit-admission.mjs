import { classOf } from '../../../lib/ship-runtime/classes.mjs';
import { mixHash } from '../../../lib/ship-runtime/fleet-mix.mjs';
import { planetOrbitAdapt } from '../../../lib/ship-runtime/flight-layout.mjs';
import { OBSTACLE_PADDING, OBSTACLE_SOFT_REACH } from '../../../lib/ship-runtime/force-clearance.mjs';
import { classSeedPlan, compactToLab } from './directed-map.mjs';

const ATTEMPTS = 64;
const CLEARANCE_SLACK = 0.01;
function randomStream(key) {
  let value = mixHash(key) || 1;
  return () => { value ^= value << 13; value ^= value >>> 17; value ^= value << 5; return (value >>> 0) / 4294967296; };
}
function bearing(random) {
  const y = random() * 2 - 1, angle = random() * Math.PI * 2, ring = Math.sqrt(1 - y * y);
  return [Math.cos(angle) * ring, y, Math.sin(angle) * ring];
}
function bodyExclusion(body, hullRadius) {
  const radius = compactToLab(body.radius ?? 0), adapt = planetOrbitAdapt(radius);
  const padded = radius + hullRadius * adapt + OBSTACLE_PADDING * adapt;
  const core = adapt < 0.99 ? Math.max(radius * 3, padded) : padded;
  return { center: [body.x ?? 0, body.y ?? 0, body.z ?? 0].map(compactToLab), radius: core + OBSTACLE_SOFT_REACH * adapt };
}
function intersects(center, radius, rows) {
  for (const row of rows) if (Math.hypot(...center.map((value, axis) => value - row.center[axis])) < radius + row.radius) return true;
  return false;
}
function candidate(center, direction, distance) { return center.map((value, axis) => value + direction[axis] * distance); }
function findCenter(target, radius, bodies, reservations, random) {
  const minimum = target.radius + radius;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const center = candidate(target.center, bearing(random), minimum + random() * radius * 2);
    if (!intersects(center, radius, bodies) && !intersects(center, radius, reservations.values())) return center;
  }
  // Bounded exterior fallback: the entire cloud lies beyond every birth sphere.
  let reach = minimum;
  for (const row of [...bodies, ...reservations.values()]) {
    reach = Math.max(reach, Math.hypot(...row.center.map((value, axis) => value - target.center[axis])) + row.radius + radius);
  }
  return candidate(target.center, bearing(random), reach + CLEARANCE_SLACK);
}

/** Birth-only clearance. These reservations do not track already moving ships. */
export function reserveOrbitBirth(layout, fleet, targetBody, bodies, reservations, time) {
  const plan = classSeedPlan(fleet, layout.offsets.length / 4);
  const hullRadius = Math.max(...plan.types.map(type => Math.hypot(...classOf(type).extent)));
  const target = bodyExclusion(targetBody ?? {}, hullRadius);
  const exclusions = bodies.map(body => bodyExclusion(body, hullRadius));
  const radius = layout.radius + CLEARANCE_SLACK;
  const random = randomStream(`${fleet.id}:${fleet.generation ?? 0}:orbit-birth`);
  const center = findCenter(target, radius, exclusions, reservations, random);
  reservations.set(layout.key, { center, radius });
  return { center, origin: center.map((value, axis) => value - layout.center[axis]), time };
}
