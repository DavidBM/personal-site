import { tiltAngleRad } from './camera-zoom.js';
/** One y=0 point and its CSS-pixel location, retained through every zoom frame. */
export class MapZoomAnchor {
    constructor() {
        this.active = false;
        this.x = 0;
        this.z = 0;
        this.screenX = 0;
        this.screenY = 0;
        this.offsetX = 0;
        this.offsetZ = 0;
    }
    capture(pose, x, y, lens) {
        this.screenX = x;
        this.screenY = y;
        this.active = this.offset(pose, lens);
        this.x = pose.eyeX + this.offsetX;
        this.z = pose.eyeZ + this.offsetZ;
    }
    apply(pose, lens) {
        if (!this.active || !this.offset(pose, lens))
            return;
        pose.eyeX = this.x - this.offsetX;
        pose.eyeZ = this.z - this.offsetZ;
    }
    /** Analytic perspective ray for the map's fixed -Z tilt. No matrix inversion. */
    offset(pose, lens) {
        const h = Math.max(1, lens.viewportH), w = Math.max(1, lens.viewportW);
        const tangent = Math.tan(lens.fovyDeg * Math.PI / 360);
        const nx = (2 * this.screenX / w - 1) * tangent * w / h;
        const ny = (1 - 2 * this.screenY / h) * tangent;
        const angle = tiltAngleRad(pose.tilt), c = Math.cos(angle), s = Math.sin(angle);
        const down = c - ny * s;
        if (!(down > 1e-6))
            return false;
        const distance = pose.eyeY / down;
        this.offsetX = nx * distance;
        this.offsetZ = (-s - ny * c) * distance;
        return Number.isFinite(this.offsetX + this.offsetZ);
    }
}
//# sourceMappingURL=map-zoom-anchor.js.map