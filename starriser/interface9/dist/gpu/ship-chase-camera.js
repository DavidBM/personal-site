import { chaseCameraFromShip, SCENE_NEAR } from './camera-zoom.js';
export const FOLLOW_ZOOM_MIN = 0.2;
export const FOLLOW_ZOOM_MAX = 12;
function multiply(a, b) {
    return { qx: a.qw * b.qx + a.qx * b.qw + a.qy * b.qz - a.qz * b.qy,
        qy: a.qw * b.qy - a.qx * b.qz + a.qy * b.qw + a.qz * b.qx,
        qz: a.qw * b.qz + a.qx * b.qy - a.qy * b.qx + a.qz * b.qw,
        qw: a.qw * b.qw - a.qx * b.qx - a.qy * b.qy - a.qz * b.qz };
}
/** A mode switch changes the basis owner, never the visible camera pose. */
export class FollowOrientation {
    constructor() {
        this.rotating = true;
        this.offset = { qx: 0, qy: 0, qz: 0, qw: 1 };
        this.fixed = { qx: 0, qy: 0, qz: 0, qw: 1 };
    }
    at(hull) { return this.rotating ? multiply(hull, this.offset) : this.fixed; }
    set(rotating, hull) {
        if (rotating === this.rotating)
            return;
        if (hull) {
            const current = this.at(hull);
            if (rotating)
                this.offset = multiply({ qx: -hull.qx, qy: -hull.qy, qz: -hull.qz, qw: hull.qw }, current);
            else
                this.fixed = current;
        }
        this.rotating = rotating;
    }
}
export function rotateShipVector(q, x, y, z) {
    const tx = 2 * (q.qy * z - q.qz * y), ty = 2 * (q.qz * x - q.qx * z), tz = 2 * (q.qx * y - q.qy * x);
    return { x: x + q.qw * tx + q.qy * tz - q.qz * ty,
        y: y + q.qw * ty + q.qz * tx - q.qx * tz, z: z + q.qw * tz + q.qx * ty - q.qy * tx };
}
/** A close body-space boom; all classes get the same apparent framing. */
export function hullChaseCamera(pose, zoom = 1, lookYaw = 0, lookPitch = 0) {
    const r = Math.max(SCENE_NEAR * 3, pose.hullRadius ?? SCENE_NEAR * 3);
    const q = pose.attitude;
    const local = chaseCameraFromShip(0, 0, 0, 0, {
        back: r * 6 * zoom, height: r * 2 * zoom, lookAhead: r * 1.5, lookY: r * 0.25, lookYaw, lookPitch,
    });
    // At roof-camera distance, drag pitch can swing the boom inside the hull.
    // Keep a full near-plane margin outside its rendered origin-radius sphere.
    const clearance = Math.max(1, (r + 2 * SCENE_NEAR) / Math.hypot(local.eyeX, local.eyeY, local.eyeZ));
    const eye = rotateShipVector(q, local.eyeX * clearance, local.eyeY * clearance, local.eyeZ * clearance);
    const target = rotateShipVector(q, local.targetX, local.targetY, local.targetZ);
    const up = rotateShipVector(q, 0, 1, 0);
    return { eyeX: pose.posX + eye.x, eyeY: pose.posY + eye.y, eyeZ: pose.posZ + eye.z,
        targetX: pose.posX + target.x, targetY: pose.posY + target.y, targetZ: pose.posZ + target.z,
        upX: up.x, upY: up.y, upZ: up.z };
}
/** Shortest quaternion arc, also used for a bounded angular extrapolation. */
export function mixShipAttitude(a, b, t) {
    let dot = a.qx * b.qx + a.qy * b.qy + a.qz * b.qz + a.qw * b.qw;
    const sign = dot < 0 ? -1 : 1;
    dot = Math.min(1, Math.abs(dot));
    const angle = Math.acos(dot), sin = Math.sin(angle);
    const u = sin > 1e-5 ? Math.sin((1 - t) * angle) / sin : 1 - t;
    const v = sign * (sin > 1e-5 ? Math.sin(t * angle) / sin : t);
    const x = a.qx * u + b.qx * v, y = a.qy * u + b.qy * v, z = a.qz * u + b.qz * v, w = a.qw * u + b.qw * v;
    const length = Math.hypot(x, y, z, w) || 1;
    return { qx: x / length, qy: y / length, qz: z / length, qw: w / length };
}
//# sourceMappingURL=ship-chase-camera.js.map