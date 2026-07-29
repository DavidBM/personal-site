/**
 * Unit triangle mesh for fleet ship instancing (XZ plane, y=0).
 *
 * Tip at +X (nose); base edge at x = −0.5 (aft). Draw rotates by
 * {@link shipDrawRotation} = π/2 − heading so tip aligns with motion forward
 * (sin h, cos h). Scale = instance world size.
 */
export const FLEET_TRIANGLE_VERTICES = new Float32Array([
    1, 0, 0,
    -0.5, 0, 0.8660254,
    -0.5, 0, -0.8660254,
]);
/**
 * Local-X of the aft edge midpoint on the unit triangle (before size scale).
 * Average of the two base verts: both have x = −0.5.
 */
export const FLEET_TRIANGLE_AFT_LOCAL_X = -0.5;
/**
 * World XZ offset from ship center to the triangle **aft midpoint**.
 * Matches fleet-ships VS: rotate mesh by (π/2 − heading), then × worldSize.
 *
 *   aft = aftLocalX * worldSize * forward
 *   forward = (sin h, cos h)  // heading 0 = +Z
 *   aftLocalX = −0.5 ⇒ half a size-unit behind the center along −forward
 */
export function triangleAftWorldOffset(heading, worldSize) {
    const s = worldSize > 0 && Number.isFinite(worldSize) ? worldSize : 0;
    // Mesh aft at local x=-0.5; after draw rotation → −0.5·size · forward.
    const along = FLEET_TRIANGLE_AFT_LOCAL_X * s;
    return {
        x: Math.sin(heading) * along,
        z: Math.cos(heading) * along,
    };
}
//# sourceMappingURL=fleet-mesh.js.map