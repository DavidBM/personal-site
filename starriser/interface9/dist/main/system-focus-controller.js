/**
 * Band C planet lock on the live map (not an OP).
 *
 * Click lock only: zoom / 180px limb hysteresis must not steal look-at.
 * `tick()` holds a body the user already locked (Kepler identity + 4K).
 * It does **not** write the camera — `WebGpuCameraController` orbit pose owns
 * look-at. It does not call `planetFocusWithHysteresis` to pick a new body.
 * Lock identity is `{systemId, catalogId}` — not a raw SCENE slot.
 * SCENE rebuild / remapped `catalogIds[i]` that no longer match → `clearFocus()`.
 * F1 follow always wins the camera — still admit lock + `promoteHi`,
 * but do not `setSystemOrbitFocus` while following.
 *
 * Pick in drawing-buffer pixels. Boom via controller orbit radius — no
 * solar-camera.ts. Calls residency.promoteHi for the focused catalog id only.
 */
import { MAP_NEAR } from "../gpu/camera-zoom.js";
import { systemOrbitBoomDistance, systemOrbitMinRadius, } from "../gpu/system-orbit-pose.js";
import { screenToNdc } from "../gpu/math/ground-pick.js";
import { pickRayFromNdc } from "../gpu/planet-lib/solar-pick.js";
import { pickBodyIndex } from "../gpu/planet-lib/solar-bodies.js";
import { bodyScreenRadiusPx, cameraToPlaneDistance, composeCompactBodyWorld, } from "../gpu/solar-system-lod.js";
export { composeCompactBodyWorld };
/** CSS client → drawing-buffer pixels (Line2 / Band C pick). */
export function clientToBufferPx(canvas, clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const w = rect.width || 1;
    const h = rect.height || 1;
    return {
        x: ((clientX - rect.left) * canvas.width) / w,
        y: ((clientY - rect.top) * canvas.height) / h,
    };
}
/** Limb diameter in drawing-buffer px (2 × bodyScreenRadiusPx). */
export function bodyLimbDiameterPx(radiusWorld, dist, bufferH, fovyDeg) {
    return 2 * bodyScreenRadiusPx(radiusWorld, dist, bufferH, fovyDeg);
}
/** Camera distance so limb diameter ≈ fillFrac × short edge. Floor on near×3. */
export function boomDistanceForLimbFill(radiusWorld, bufferW, bufferH, fovyDeg, fillFrac = 0.9, near = MAP_NEAR) {
    return systemOrbitBoomDistance(radiusWorld, bufferW, bufferH, fovyDeg, fillFrac, near);
}
export function sceneBodyLimbPx(store, index, eyeX, eyeY, eyeZ, timeSec, bufferH, fovyDeg) {
    const world = composeCompactBodyWorld(store, index, timeSec);
    if (!world)
        return 0;
    const dist = cameraToPlaneDistance(eyeX, eyeY, eyeZ, world.x, world.z);
    return bodyScreenRadiusPx(store.radius[index], dist, bufferH, fovyDeg);
}
export function pickSceneBodyFromMap(opts) {
    const ndc = screenToNdc(opts.bufferX, opts.bufferY, opts.bufferW || 1, opts.bufferH || 1);
    const ray = pickRayFromNdc(ndc.x, ndc.y, opts.viewProj);
    if (!ray)
        return null;
    return pickBodyIndex(ray.originX, ray.originY, ray.originZ, ray.dx, ray.dy, ray.dz, opts.poses);
}
export function buildSceneBodyPoses(store, timeSec) {
    const n = store.currentCount;
    const out = [];
    for (let i = 0; i < n; i++) {
        const def = store.defs[i];
        if (!def)
            continue;
        const world = composeCompactBodyWorld(store, i, timeSec);
        if (!world)
            continue;
        out.push({
            def,
            x: world.x,
            y: world.y,
            z: world.z,
            spin: 0,
        });
    }
    return out;
}
export function createSystemFocusController(opts) {
    const view = opts.view;
    let hyst = { focusIndex: null, holdStartMs: 0 };
    let locked = null;
    let lastHiId = null;
    const followActive = () => {
        const cam = opts.camera;
        return !!cam && typeof cam.isFollowing === "function" && cam.isFollowing();
    };
    /** Slot whose `{systemId, catalogId}` still matches, or null → clear. */
    const resolveLockedSlot = () => {
        if (locked == null)
            return null;
        const store = view.solarBodies;
        if (store.systemId !== locked.systemId)
            return null;
        const want = locked.catalogId;
        const n = store.currentCount;
        for (let i = 0; i < n; i++) {
            if (store.isSun[i])
                continue;
            if (store.catalogIds[i] === want)
                return i;
        }
        return null;
    };
    const applyHi = (index) => {
        if (index == null || index < 0) {
            if (lastHiId != null) {
                view.catalogResidency.releaseHi();
                lastHiId = null;
            }
            return;
        }
        if (view.solarBodies.isSun[index])
            return;
        const id = view.solarBodies.catalogIds[index];
        if (!id)
            return;
        if (lastHiId === id) {
            view.catalogResidency.promoteHi(id);
            return;
        }
        if (lastHiId != null && lastHiId !== id) {
            view.catalogResidency.releaseHi();
        }
        view.catalogResidency.promoteHi(id);
        lastHiId = id;
    };
    const lockBody = (index) => {
        const store = view.solarBodies;
        if (index < 0 || index >= store.currentCount)
            return;
        if (store.isSun[index])
            return;
        const systemId = store.systemId;
        const catalogId = store.catalogIds[index];
        if (systemId == null || !catalogId)
            return;
        locked = { systemId, catalogId };
        hyst = { focusIndex: index, holdStartMs: 0 };
        view.setFocusedBodyIndex(index);
        applyHi(index);
        // F1 wins the camera: still hold lock + 4K, do not steal look-at.
        if (followActive())
            return;
        const st = view.getCameraState();
        const world = composeCompactBodyWorld(store, index, view.getSceneTimeSec());
        if (!world)
            return;
        const boom = boomDistanceForLimbFill(store.radius[index], st.bufferW, st.bufferH, st.fovyDeg, 0.9, st.near);
        const cam = opts.camera;
        if (cam && typeof cam.setSystemOrbitFocus === "function") {
            cam.setSystemOrbitFocus({
                bodyIndex: index,
                x: world.x,
                y: world.y,
                z: world.z,
                radius: boom,
                minRadius: systemOrbitMinRadius(store.radius[index], boom, st.near),
            });
        }
    };
    const clearFocus = () => {
        locked = null;
        hyst = { focusIndex: null, holdStartMs: 0 };
        view.setFocusedBodyIndex(null);
        applyHi(null);
        // Planet lock released → sun, but only while orbit pose still owns the
        // camera. Dblclick disarms orbit first, then clearFocus must not snap back.
        const cam = opts.camera;
        if (!followActive() &&
            cam &&
            typeof cam.isOrbiting === "function" &&
            cam.isOrbiting() &&
            typeof cam.setSystemOrbitSun === "function") {
            cam.setSystemOrbitSun();
        }
    };
    return {
        tick() {
            const store = view.solarBodies;
            if (store.systemId == null || store.currentCount <= 0) {
                if (locked != null || view.getFocusedBodyIndex() != null || lastHiId != null) {
                    clearFocus();
                }
                return;
            }
            if (locked == null) {
                if (view.getFocusedBodyIndex() != null || lastHiId != null) {
                    clearFocus();
                }
                return;
            }
            const slot = resolveLockedSlot();
            if (slot == null || store.isSun[slot]) {
                clearFocus();
                return;
            }
            hyst = { focusIndex: slot, holdStartMs: 0 };
            view.setFocusedBodyIndex(slot);
            applyHi(slot);
            // Camera is the orbit controller — tick never writes look-at.
        },
        tryPickBody(clientX, clientY) {
            if (view.getSystemSceneIds().size === 0)
                return false;
            const store = view.solarBodies;
            if (store.currentCount <= 0)
                return false;
            const buf = clientToBufferPx(view.canvas, clientX, clientY);
            const st = view.getCameraState();
            const poses = buildSceneBodyPoses(store, view.getSceneTimeSec());
            const hit = pickSceneBodyFromMap({
                bufferX: buf.x,
                bufferY: buf.y,
                bufferW: st.bufferW,
                bufferH: st.bufferH,
                viewProj: view.getViewProj(),
                poses,
            });
            if (hit == null)
                return false;
            if (store.isSun[hit]) {
                locked = null;
                hyst = { focusIndex: null, holdStartMs: 0 };
                view.setFocusedBodyIndex(null);
                applyHi(null);
                if (!followActive())
                    opts.camera?.setSystemOrbitSun?.();
                return true;
            }
            lockBody(hit);
            return true;
        },
        lockBody,
        clearFocus,
        getFocusIndex() {
            return view.getFocusedBodyIndex();
        },
    };
}
//# sourceMappingURL=system-focus-controller.js.map