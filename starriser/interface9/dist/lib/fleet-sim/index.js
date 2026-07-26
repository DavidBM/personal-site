/**
 * Fleet simulation library — pure TypeScript, no Bus / GPU device.
 *
 * Dual clock:
 * - domain: discrete path / events (worker world) — deep import only
 * - visual: continuous ship/fleet pose (CPU ref + WGSL string builders)
 *
 * Preferred continuous entry: `./motion.js` (createMotion / GoToOrbitCommand).
 * Runtime GPU layers still live under js/gpu/; this package is the pure core.
 *
 * Domain modules are **not** re-exported from this barrel — use deep paths
 * (`js/lib/fleet-sim/domain/*`) or worker shims (`js/worker/fleets/*`).
 */
// 1 · Curated continuous motion API (preferred product surface)
export { createMotion, fleetCenter, stepShip, stepShips, packFormation, initShipsFromFormation, writePathCommand, packJumpingFleet, applyOrbitRadiusIfSet, resolveTravelMode, } from "./motion.js";
// ShipAgentState comes from ship-flight-ref (below); also re-exported by motion.ts
// 2 · Visual (CPU ref + layouts + pack) — advanced / parity / GPU hosts
export * from "./visual/quat.js";
export * from "./visual/ship-motion-config.js";
export * from "./visual/ship-type-config.js";
export * from "./visual/ship-flight-ref.js";
export * from "./visual/ship-orbit-ref.js";
export * from "./visual/ship-sim-layout.js";
export * from "./visual/fleet-layout.js";
export * from "./visual/fleet-integrate-ref.js";
export * from "./visual/fleet-motion-ref.js";
export * from "./visual/fleet-ship-pack.js";
export * from "./visual/fleet-trail-ref.js";
export * from "./visual/fleet-lod.js";
export * from "./visual/fleet-slot-allocator.js";
export * from "./visual/fleet-mesh.js";
export * from "./visual/gltf-static-mesh.js";
export * from "./visual/lowpoly-ship-mesh.js";
export * from "./visual/model-trail-config.js";
// 3 · WGSL string builders (no device)
export * from "./gpu/fleet-integrate.wgsl.js";
export * from "./gpu/fleet-ships.wgsl.js";
export * from "./gpu/fleet-trails.wgsl.js";
export * from "./gpu/fleet-model-ships.wgsl.js";
//# sourceMappingURL=index.js.map