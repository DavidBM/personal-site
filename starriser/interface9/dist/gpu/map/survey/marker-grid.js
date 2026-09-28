const CELL = 192;
/** Reused screen buckets keep label admission from covering neighboring markers. */
export class SurveyMarkerGrid {
    constructor() {
        this.buckets = [];
        this.columns = 1;
        this.rows = 1;
    }
    rebuild(width, height, anchors) {
        var _a;
        for (const bucket of this.buckets)
            if (bucket)
                bucket.length = 0;
        this.columns = Math.max(1, Math.ceil(width / CELL));
        this.rows = Math.max(1, Math.ceil(height / CELL));
        for (const anchor of anchors) {
            const col = Math.max(0, Math.min(this.columns - 1, Math.floor(anchor.x / CELL)));
            const row = Math.max(0, Math.min(this.rows - 1, Math.floor(anchor.y / CELL)));
            const index = row * this.columns + col;
            ((_a = this.buckets)[index] ?? (_a[index] = [])).push(anchor);
        }
    }
    overlaps(anchor, width, height) {
        // Ring radius is bounded to 11px; reserve an additional 3px breathing room.
        const left = anchor.left - 14, right = anchor.left + width + 14;
        const top = anchor.top - 14, bottom = anchor.top + height + 14;
        const x0 = Math.max(0, Math.floor(left / CELL)), x1 = Math.min(this.columns - 1, Math.floor(right / CELL));
        const y0 = Math.max(0, Math.floor(top / CELL)), y1 = Math.min(this.rows - 1, Math.floor(bottom / CELL));
        for (let y = y0; y <= y1; y++)
            for (let x = x0; x <= x1; x++) {
                const bucket = this.buckets[y * this.columns + x];
                if (bucket?.some(other => other !== anchor && other.x > left && other.x < right && other.y > top && other.y < bottom))
                    return true;
            }
        return false;
    }
}
//# sourceMappingURL=marker-grid.js.map