/**
 * Sun-relative look-at for the compact Kepler SCENE.
 *
 * Subtract the sun — do not rescale. `systemSceneUnit()` is not applied here.
 * Galaxy-abs camera/target stay on the controller; this view is only for
 * SCENE integrate / discs / fleets / trails / models.
 */
import { mat4ViewProj } from "../math/mat4.js";
import { mat4LookAtRelative, } from "../math/world-origin.js";
export function sunRelativePos(sunX, sunZ, gx, gy, gz) {
    return { x: gx - sunX, y: gy, z: gz - sunZ };
}
/**
 * Look-at relative to the Kepler sun (origin y = 0). `outView` / `outViewProj`
 * are the SCENE matrices; galaxy `viewRel` stays eye/ship/pathEnd.
 */
export function buildSystemSceneView(outView, outViewProj, proj, camX, camY, camZ, targetX, targetY, targetZ, sunX, sunZ) {
    mat4LookAtRelative(outView, camX, camY, camZ, targetX, targetY, targetZ, sunX, 0, sunZ);
    mat4ViewProj(outViewProj, proj, outView);
    return {
        sunX,
        sunZ,
        camLocal: { x: camX - sunX, y: camY, z: camZ - sunZ },
        targetLocal: { x: targetX - sunX, y: targetY, z: targetZ - sunZ },
    };
}
//# sourceMappingURL=view.js.map