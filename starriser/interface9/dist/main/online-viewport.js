import { lookAtAxes } from '../gpu/math/mat4.js';
// Prefetch systems before cluster labels appear (64 px diameter). In a tilted
// view, clusters near the top are much smaller than equally visible bottom ones.
export const ONLINE_VIEWPORT = { margin: 0.2, minRadiusPx: 12, retainRadiusPx: 9, maxClusters: 24, intervalMs: 250 };
export const atlasClusterId = (id) => `000000020000000000000000${id.toString(16).padStart(8, '0')}`;
/** Only pick authorized systems whose cluster has expanded to individual markers. */
export function pickViewportSystem(c, view, screenX, screenY) {
    const a = lookAtAxes(c.eyeX, c.eyeY, c.eyeZ, c.targetX, c.targetY, c.targetZ, c.upX, c.upY, c.upZ);
    const focal = c.viewportH / (2 * Math.tan(c.fovyDeg * Math.PI / 360));
    const expanded = new Set(view.clusters.filter(row => {
        const depth = -((row.x - c.eyeX) * a.zx - c.eyeY * a.zy + (row.z - c.eyeZ) * a.zz);
        return row.radius * focal / Math.max(depth, c.near) >= 200;
    }).map(row => row.id));
    let distance = 18 ** 2, selected;
    for (const row of view.systems) {
        if (!expanded.has(row.clusterId))
            continue;
        const dx = row.x - c.eyeX, dy = -c.eyeY, dz = row.z - c.eyeZ, depth = -(dx * a.zx + dy * a.zy + dz * a.zz);
        if (depth <= c.near)
            continue;
        const x = c.viewportW / 2 + focal * (dx * a.xx + dy * a.xy + dz * a.xz) / depth;
        const y = c.viewportH / 2 - focal * (dx * a.yx + dy * a.yy + dz * a.yz) / depth;
        const d = (x - screenX) ** 2 + (y - screenY) ** 2;
        if (d < distance) {
            distance = d;
            selected = row.id;
        }
    }
    return selected;
}
/** Camera coordinates are world coordinates, independent of the renderer's floating origin.
 * The expanded frustum prefetches nearby clusters; small distant outlines need no systems. */
export function viewportClusters(camera, clusters, retained, limit = ONLINE_VIEWPORT.maxClusters) {
    const c = camera;
    if (Math.min(c.viewportW, c.viewportH) <= 0)
        return [];
    const axes = lookAtAxes(c.eyeX, c.eyeY, c.eyeZ, c.targetX, c.targetY, c.targetZ, c.upX, c.upY, c.upZ);
    const tanY = Math.tan(c.fovyDeg * Math.PI / 360), tanX = tanY * c.viewportW / c.viewportH;
    const extent = 1 + ONLINE_VIEWPORT.margin * 2;
    const candidates = [];
    for (const row of clusters) {
        const dx = row.position[0] - c.eyeX, dy = row.position[1] - c.eyeY, dz = row.position[2] - c.eyeZ;
        const depth = -(dx * axes.zx + dy * axes.zy + dz * axes.zz), r = row.radius;
        if (depth + r < c.near || depth - r > c.far)
            continue;
        const x = dx * axes.xx + dy * axes.xy + dz * axes.xz;
        const y = dx * axes.yx + dy * axes.yy + dz * axes.yz;
        if (!intersectsViewport(x, y, depth, r, tanX * extent, tanY * extent))
            continue;
        const id = atlasClusterId(row.id), threshold = retained.has(id) ? ONLINE_VIEWPORT.retainRadiusPx : ONLINE_VIEWPORT.minRadiusPx;
        if (r * c.viewportH / (2 * Math.max(depth, c.near) * tanY) < threshold)
            continue;
        candidates.push({ id, visible: intersectsViewport(x, y, depth, r, tanX, tanY),
            score: ((x / tanX) ** 2 + (y / tanY) ** 2) / Math.max(depth, c.near) ** 2 });
    }
    candidates.sort((a, b) => Number(b.visible) - Number(a.visible) || a.score - b.score || a.id.localeCompare(b.id));
    return candidates.slice(0, limit).map(row => row.id).sort();
}
function intersectsViewport(x, y, depth, radius, tanX, tanY) {
    return Math.abs(x) <= depth * tanX + radius * Math.hypot(1, tanX)
        && Math.abs(y) <= depth * tanY + radius * Math.hypot(1, tanY);
}
/** One settled view request at a time, with the newest camera intent retained.
 * load must resolve after the view is ready, not just after the request is sent. */
export function createViewportRequests(options) {
    let wanted = [], loaded = '', failed, running = false;
    let timer, lifetime = new AbortController();
    const key = (ids) => ids.join(',');
    function schedule() {
        if (timer || running || key(wanted) === loaded || key(wanted) === failed)
            return;
        timer = setTimeout(() => { timer = undefined; void drain(); }, options.delayMs ?? ONLINE_VIEWPORT.intervalMs);
    }
    async function drain() {
        const ids = wanted, owner = lifetime;
        running = true;
        try {
            await options.load(ids, owner.signal);
            if (!owner.signal.aborted)
                loaded = key(ids);
        }
        catch (error) {
            if (!owner.signal.aborted) {
                failed = key(ids);
                options.error(error);
            }
        }
        finally {
            running = false;
            schedule();
        }
    }
    return {
        update(ids) {
            const next = [...new Set(ids)].sort();
            if (key(next) !== key(wanted))
                failed = undefined;
            wanted = next;
            schedule();
        },
        reset() { lifetime.abort(); lifetime = new AbortController(); clearTimeout(timer); timer = undefined; wanted = []; loaded = ''; failed = undefined; },
    };
}
//# sourceMappingURL=online-viewport.js.map