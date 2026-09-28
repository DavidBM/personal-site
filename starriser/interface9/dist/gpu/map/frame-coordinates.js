/**
 * Numerical boundary between galaxy placement and local rendering. Camera and
 * topology inputs are JS doubles; subtraction happens before f32 matrices.
 * Reused frame objects carry their space explicitly so features can test their
 * projection without a canvas/device, and cannot mistake a sun anchor for the
 * origin used by the galaxy or the origin of sun-local ship buffers.
 */
import { mat4Identity, mat4LookAt, mat4Perspective, mat4PerspectiveReverseZ, mat4ViewProj, mat4CameraRight, mat4CameraUp } from "../math/mat4.js";
import { chooseFrameOrigin, mat4LookAtRelative } from "../math/world-origin.js";
import { buildSystemSceneView } from "../system-scene/view.js";
export class MapFrameCoordinates {
    constructor(reverseDepth = false) {
        this.projection = mat4Identity();
        /** Jewel clip (SCENE_NEAR / SCENE_FAR). Identity until {@link setPerspectives}. */
        this.sceneProjection = mat4Identity();
        /** Absolute matrices are retained for the legacy ground-pick API only. */
        this.absoluteView = mat4Identity();
        this.absoluteViewProj = mat4Identity();
        this.cameraRight = new Float32Array(3);
        this.cameraUp = new Float32Array(3);
        this.galaxy = {
            space: "galaxy-relative", view: mat4Identity(), viewProj: mat4Identity(),
            origin: { x: 0, y: 0, z: 0 },
        };
        this.system = {
            space: "system-local", view: mat4Identity(), viewProj: mat4Identity(),
            origin: Object.freeze({ x: 0, y: 0, z: 0 }),
            anchor: { x: 0, y: 0, z: 0 }, eye: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 },
        };
        this.hulls = { view: mat4Identity(), viewProj: mat4Identity(), rotation: mat4Identity(), rotationViewProj: mat4Identity(), origin: { x: 0, y: 0, z: 0 } };
        this.eye = { x: 0, y: 0, z: 0 };
        this.target = { x: 0, y: 0, z: 0 };
        this.up = { x: 0, y: 1, z: 0 };
        this.reverseDepth = reverseDepth;
    }
    setPerspectives(fovyRad, aspect, galaxyNear, galaxyFar, sceneNear, sceneFar) {
        const perspective = this.reverseDepth ? mat4PerspectiveReverseZ : mat4Perspective;
        perspective(this.projection, fovyRad, aspect, galaxyNear, galaxyFar);
        perspective(this.sceneProjection, fovyRad, aspect, sceneNear, sceneFar);
    }
    /** Jewel clip when written; otherwise the shared galaxy projection (tests). */
    sceneClip() {
        return this.sceneProjection[15] === 0 ? this.sceneProjection : this.projection;
    }
    updateCamera(eyeX, eyeY, eyeZ, targetX, targetY, targetZ, follow, systemOpen, up = { x: 0, y: 1, z: 0 }) {
        this.eye.x = eyeX;
        this.eye.y = eyeY;
        this.eye.z = eyeZ;
        this.target.x = targetX;
        this.target.y = targetY;
        this.target.z = targetZ;
        Object.assign(this.up, up);
        mat4LookAt(this.absoluteView, eyeX, eyeY, eyeZ, targetX, targetY, targetZ, up.x, up.y, up.z);
        mat4ViewProj(this.absoluteViewProj, this.projection, this.absoluteView);
        mat4CameraRight(this.absoluteView, this.cameraRight);
        mat4CameraUp(this.absoluteView, this.cameraUp);
        // Follow data is sun-local while a system is open. It must never become a
        // galaxy origin, even when the local pathEnd happens to be near (0,0,0).
        const origin = chooseFrameOrigin(eyeX, eyeY, eyeZ, systemOpen ? null : follow);
        Object.assign(this.galaxy.origin, origin);
        mat4LookAtRelative(this.galaxy.view, eyeX, eyeY, eyeZ, targetX, targetY, targetZ, origin.x, origin.y, origin.z, up.x, up.y, up.z);
        mat4ViewProj(this.galaxy.viewProj, this.projection, this.galaxy.view);
    }
    /** Called after scene selection; the same camera can enter a scene this frame. */
    updateSystem(sunX, sunZ) {
        const { eye, target, system } = this;
        system.anchor.x = sunX;
        system.anchor.z = sunZ;
        system.eye.x = eye.x - sunX;
        system.eye.y = eye.y;
        system.eye.z = eye.z - sunZ;
        system.target.x = target.x - sunX;
        system.target.y = target.y;
        system.target.z = target.z - sunZ;
        const h = this.hulls;
        h.origin.x = Math.fround(system.eye.x);
        h.origin.y = Math.fround(system.eye.y);
        h.origin.z = Math.fround(system.eye.z);
        mat4LookAtRelative(h.view, system.eye.x, system.eye.y, system.eye.z, system.target.x, system.target.y, system.target.z, h.origin.x, h.origin.y, h.origin.z, this.up.x, this.up.y, this.up.z);
        mat4ViewProj(h.viewProj, this.sceneClip(), h.view);
        h.rotation.set(h.view);
        h.rotation[12] = 0;
        h.rotation[13] = 0;
        h.rotation[14] = 0;
        mat4ViewProj(h.rotationViewProj, this.sceneClip(), h.rotation);
        buildSystemSceneView(system.view, system.viewProj, this.sceneClip(), eye.x, eye.y, eye.z, target.x, target.y, target.z, sunX, sunZ, this.up);
    }
}
//# sourceMappingURL=frame-coordinates.js.map