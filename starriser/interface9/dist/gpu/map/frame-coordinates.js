/**
 * Numerical boundary between galaxy placement and local rendering. Camera and
 * topology inputs are JS doubles; subtraction happens before f32 matrices.
 * Reused frame objects carry their space explicitly so features can test their
 * projection without a canvas/device, and cannot mistake a sun anchor for the
 * origin used by the galaxy or the origin of sun-local ship buffers.
 */
import { mat4Identity, mat4LookAt, mat4ViewProj, mat4CameraRight, mat4CameraUp } from "../math/mat4.js";
import { chooseFrameOrigin, mat4LookAtRelative } from "../math/world-origin.js";
import { buildSystemSceneView } from "../system-scene/view.js";
export class MapFrameCoordinates {
    constructor() {
        this.projection = mat4Identity();
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
        this.eye = { x: 0, y: 0, z: 0 };
        this.target = { x: 0, y: 0, z: 0 };
    }
    updateCamera(eyeX, eyeY, eyeZ, targetX, targetY, targetZ, follow, systemOpen) {
        this.eye.x = eyeX;
        this.eye.y = eyeY;
        this.eye.z = eyeZ;
        this.target.x = targetX;
        this.target.y = targetY;
        this.target.z = targetZ;
        mat4LookAt(this.absoluteView, eyeX, eyeY, eyeZ, targetX, targetY, targetZ);
        mat4ViewProj(this.absoluteViewProj, this.projection, this.absoluteView);
        mat4CameraRight(this.absoluteView, this.cameraRight);
        mat4CameraUp(this.absoluteView, this.cameraUp);
        // Follow data is sun-local while a system is open. It must never become a
        // galaxy origin, even when the local pathEnd happens to be near (0,0,0).
        const origin = chooseFrameOrigin(eyeX, eyeY, eyeZ, systemOpen ? null : follow);
        Object.assign(this.galaxy.origin, origin);
        mat4LookAtRelative(this.galaxy.view, eyeX, eyeY, eyeZ, targetX, targetY, targetZ, origin.x, origin.y, origin.z);
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
        buildSystemSceneView(system.view, system.viewProj, this.projection, eye.x, eye.y, eye.z, target.x, target.y, target.z, sunX, sunZ);
    }
}
//# sourceMappingURL=frame-coordinates.js.map