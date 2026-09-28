import { SurveyMarkerGrid } from './marker-grid.js';
import { hexToRgb } from '../../../utils/color.js';
export const LABEL_WIDTH = 168, LABEL_HEIGHT = 47, LABEL_LIMIT = 64;
/** Reused anchors; bounded label collision work. No ship walk or DOM measurement. */
export class SurveyLayout {
    constructor() {
        this.visible = [];
        this.panelClusters = new Set();
        this.anchors = new Map();
        this.expanded = new Set();
        this.children = new Map();
        this.occupied = [];
        this.generation = -1;
        this.markers = new SurveyMarkerGrid();
        this.bounds = { x: 0, z: 0, extent: 10000 };
    }
    update(metas, revision, frame, width, height, focal, systems, activity) {
        if (revision !== this.generation)
            this.refresh(metas, revision);
        this.visible.length = 0;
        this.occupied.length = 0;
        for (const anchor of this.anchors.values()) {
            if (activity?.hasCluster(anchor.meta.clusterId) === false) {
                anchor.label = false;
                this.children.delete(anchor.meta.clusterId);
                continue;
            }
            const visible = projectAnchor(anchor, frame, width, height, focal);
            const id = anchor.meta.clusterId;
            const detailed = this.wantsSystems(id, anchor.span);
            if (detailed)
                this.expanded.add(id);
            else
                this.expanded.delete(id);
            if (systems && detailed && clusterIntersectsScreen(anchor, width, height)) {
                anchor.label = false;
                this.projectSystems(anchor, systems, frame, width, height, focal, activity);
            }
            else {
                this.children.delete(id);
                if (visible)
                    this.visible.push(anchor);
                else
                    anchor.label = false;
            }
        }
        this.markers.rebuild(width, height, this.visible);
        // Stable old admissions first, then original cluster insertion order.
        this.admit(width, height, true);
        this.admit(width, height, false);
        this.updatePanelClusters();
    }
    updatePanelClusters() {
        this.panelClusters.clear();
        for (const anchor of this.occupied)
            if (anchor.systemId === undefined)
                this.panelClusters.add(anchor.meta.clusterId);
    }
    wantsSystems(id, span) {
        return span >= (this.expanded.has(id) ? 400 : 480);
    }
    /** Only expanded on-screen clusters visit their systems; never walk the galaxy roster. */
    projectSystems(parent, systems, frame, width, height, focal, activity) {
        const id = parent.meta.clusterId;
        let children = this.children.get(id);
        if (!children) {
            children = [];
            const radius = parent.meta.radius / Math.sqrt(Math.max(1, parent.meta.systemIds.length));
            for (const systemId of parent.meta.systemIds) {
                const rec = systems.get(systemId);
                if (!rec)
                    continue;
                children.push({ systemId, isJumpGate: rec.isJumpGate,
                    meta: { ...parent.meta, name: rec.name, x: rec.x, z: rec.z, radius, systemIds: [] },
                    rgb: parent.rgb, x: 0, y: 0, radius: 6, span: 0, label: false, left: 0, top: 0 });
            }
            this.children.set(id, children);
        }
        for (const child of children) {
            if (activity && !activity.hasSystem(child.systemId)) {
                child.label = false;
                continue;
            }
            if (projectAnchor(child, frame, width, height, focal)) {
                child.radius = child.isJumpGate ? 8 : 6;
                this.visible.push(child);
            }
            else
                child.label = false;
        }
    }
    refresh(metas, revision) {
        this.generation = revision;
        this.children.clear();
        this.expanded.clear();
        for (const id of this.anchors.keys())
            if (!metas.has(id))
                this.anchors.delete(id);
        let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
        for (const [id, meta] of metas) {
            const rgb = Array.isArray(meta.color) ? meta.color : hexToRgb(meta.color);
            const old = this.anchors.get(id);
            if (old) {
                old.meta = meta;
                old.rgb = rgb;
            }
            else
                this.anchors.set(id, { meta, rgb, x: 0, y: 0, radius: 10, span: 0, label: false, left: 0, top: 0 });
            minX = Math.min(minX, meta.x - meta.radius);
            maxX = Math.max(maxX, meta.x + meta.radius);
            minZ = Math.min(minZ, meta.z - meta.radius);
            maxZ = Math.max(maxZ, meta.z + meta.radius);
        }
        if (metas.size) {
            this.bounds.x = (minX + maxX) / 2;
            this.bounds.z = (minZ + maxZ) / 2;
            this.bounds.extent = Math.max(1000, maxX - minX, maxZ - minZ);
        }
    }
    admit(width, height, retained) {
        for (const anchor of this.visible) {
            if (anchor.label !== retained || this.occupied.includes(anchor))
                continue;
            anchor.label = false;
            if (this.occupied.length >= LABEL_LIMIT || anchor.span < (retained ? 48 : 64))
                continue;
            if (!this.place(anchor, width, height))
                continue;
            anchor.label = true;
            this.occupied.push(anchor);
        }
    }
    place(anchor, width, height) {
        anchor.top = anchor.y - LABEL_HEIGHT / 2;
        if (anchor.top < 8 || anchor.top + LABEL_HEIGHT > height - 8)
            return false;
        for (const side of [1, -1]) {
            anchor.left = anchor.x - (side < 0 ? LABEL_WIDTH : 0);
            if (anchor.left < 8 || anchor.left + LABEL_WIDTH > width - 8)
                continue;
            if (this.occupied.some(other => overlaps(anchor, other)))
                continue;
            if (!this.markers.overlaps(anchor, LABEL_WIDTH, LABEL_HEIGHT))
                return true;
        }
        return false;
    }
}
export function overlaps(a, b) {
    return Math.abs(a.left - b.left) < LABEL_WIDTH + 12 && Math.abs(a.top - b.top) < LABEL_HEIGHT + 10;
}
/** Project doubles relative to the same origin as topology, including near/behind rejection. */
export function projectAnchor(a, frame, width, height, focal) {
    const x = a.meta.x - frame.origin.x, y = -frame.origin.y, z = a.meta.z - frame.origin.z, m = frame.viewProj;
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    const depth = m[2] * x + m[6] * y + m[10] * z + m[14];
    a.span = 0;
    if (!(w > 0) || depth < 0 || depth > w)
        return false;
    a.x = ((m[0] * x + m[4] * y + m[8] * z + m[12]) / w + 1) * width / 2;
    a.y = (1 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / w) * height / 2;
    a.span = 2 * a.meta.radius * focal / w;
    a.radius = Math.max(3, Math.min(11, a.span * 0.16));
    return a.x >= -16 && a.x <= width + 16 && a.y >= -16 && a.y <= height + 16;
}
function clusterIntersectsScreen(a, width, height) {
    const reach = a.span / 2;
    return a.x + reach >= 0 && a.x - reach <= width && a.y + reach >= 0 && a.y - reach <= height;
}
//# sourceMappingURL=layout.js.map