import { lookAtAxes } from '../gpu/math/mat4.js';
/** Double-precision sun-local projection, also used for waypoint closure picking. */
export function scenePointOnScreen(snapshot, point) {
    const sun = snapshot.bodies.find(b => b.isSun);
    if (!sun)
        return null;
    const c = snapshot.camera;
    const axes = lookAtAxes(c.eyeX, c.eyeY, c.eyeZ, c.targetX, c.targetY, c.targetZ, c.upX ?? 0, c.upY ?? 1, c.upZ ?? 0);
    const p = [point.x - (c.eyeX - sun.x), point.y - (c.eyeY - sun.y), point.z - (c.eyeZ - sun.z)];
    const dot = (a) => p[0] * a[0] + p[1] * a[1] + p[2] * a[2];
    const depth = -dot([axes.zx, axes.zy, axes.zz]);
    if (depth <= 1e-8)
        return null;
    const scale = c.viewportH / (2 * Math.tan(c.fovyDeg * Math.PI / 360));
    return { x: c.viewportW / 2 + dot([axes.xx, axes.xy, axes.xz]) * scale / depth, y: c.viewportH / 2 - dot([axes.yx, axes.yy, axes.yz]) * scale / depth };
}
export function sceneHeightScale(snapshot, point) {
    const sun = snapshot.bodies.find(b => b.isSun);
    if (!sun)
        return 0;
    const c = snapshot.camera;
    const distance = Math.hypot(c.eyeX - sun.x - point.x, c.eyeY - sun.y, c.eyeZ - sun.z - point.z);
    return 2 * distance * Math.tan(c.fovyDeg * Math.PI / 360) / Math.max(1, c.viewportH);
}
/** Allocated only during a placement gesture. No scene or ship enumeration. */
export function createFleetMovePreview(parent) {
    const canvas = document.createElement('canvas');
    canvas.id = 'fleet-height-preview';
    canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, { position: 'fixed', pointerEvents: 'none', zIndex: '899', left: '0', top: '0' });
    parent.appendChild(canvas);
    function draw(snapshot, rect, point, scale, closing) {
        const width = window.innerWidth, height = window.innerHeight;
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx)
            return;
        ctx.clearRect(0, 0, width, height);
        const project = (p) => { const s = scenePointOnScreen(snapshot, p); return s && { x: s.x + rect.left, y: s.y + rect.top }; };
        const line = (a, b) => {
            const p = project(a), q = project(b);
            if (!p || !q)
                return;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.stroke();
        };
        const span = scale * 64, step = span / 4, ground = { ...point, y: 0 };
        ctx.strokeStyle = 'rgba(120,210,230,.28)';
        ctx.lineWidth = 1;
        for (let i = -4; i <= 4; i++) {
            line({ x: point.x + i * step, y: 0, z: point.z - span }, { x: point.x + i * step, y: 0, z: point.z + span });
            line({ x: point.x - span, y: 0, z: point.z + i * step }, { x: point.x + span, y: 0, z: point.z + i * step });
        }
        ctx.strokeStyle = '#85ecff';
        line(ground, point);
        const target = project(point);
        if (!target)
            return;
        ctx.beginPath();
        ctx.arc(target.x, target.y, closing ? 9 : 5, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.fillStyle = '#b9f5ff';
        ctx.font = '10px monospace';
        ctx.fillText(closing ? 'Close patrol' : `Height ${point.y >= 0 ? '+' : ''}${point.y.toFixed(5)} · release to place`, target.x + 10, target.y - 9);
    }
    return { draw, destroy: () => canvas.remove() };
}
export function nearFirstWaypoint(snapshot, first, point, x, y) {
    const screen = scenePointOnScreen(snapshot, first);
    if (!screen || Math.hypot(screen.x - x, screen.y - y) > 12)
        return false;
    return point.y === 0 || Math.abs(first.y - point.y) <= sceneHeightScale(snapshot, first) * 12;
}
//# sourceMappingURL=fleet-move-preview.js.map