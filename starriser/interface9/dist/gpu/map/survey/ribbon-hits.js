/** Reused, bounded by admitted labels and active battle centers. Matches the shader's cut edge. */
export class RibbonHits {
    constructor() {
        this.pool = [];
        this.count = 0;
    }
    clear() { this.count = 0; }
    add(x, y, w, h, side, inset, slope, alpha, clusterId, section, systemId, owned) {
        if (alpha < 0.35)
            return;
        const hit = this.pool[this.count] ?? (this.pool[this.count] = {});
        Object.assign(hit, { x, y, w, h, side, inset, slope, clusterId, section, systemId, owned });
        this.count++;
    }
    pick(x, y) {
        for (let i = this.count - 1; i >= 0; i--) {
            const hit = this.pool[i];
            if (!contains(hit, x, y))
                continue;
            return { clusterId: hit.clusterId, section: hit.section, ...(hit.owned ? { owned: true } : {}), ...(hit.systemId === undefined ? {} : { systemId: hit.systemId }) };
        }
        return null;
    }
}
function contains(h, x, y) {
    if (x < h.x || x > h.x + h.w || y < h.y || y > h.y + h.h)
        return false;
    if (h.side === 2) {
        const px = Math.abs(x - h.x - h.w / 2), py = Math.abs(y - h.y - h.h / 2);
        return Math.max(px * 0.8660254 + py * 0.5, py) <= h.inset * 0.8660254;
    }
    const cut = h.inset + h.slope * (y - h.y) / h.h;
    return h.side === 0 || (h.side > 0 ? x - h.x >= cut : h.x + h.w - x >= cut);
}
//# sourceMappingURL=ribbon-hits.js.map