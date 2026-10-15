import { SurveyMarkerGrid } from './marker-grid.js';
import { hexToRgb } from '../../../utils/color.js';
import { clusterMarkerRadius, CLUSTER_LABEL_WIDTH, CLUSTER_LABEL_HEIGHT } from './cluster-marker.js';
export const LABEL_WIDTH = 168, LABEL_HEIGHT = 47, LABEL_LIMIT = 64;
/** Reused anchors; bounded label collision work. No ship walk or DOM measurement. */
export class SurveyLayout {
    constructor() {
        this.visible = [];
        this.collapsedClusters = new Set();
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
        this.collapsedClusters.clear();
        for (const anchor of this.anchors.values()) {
            if (!hasVisibleMetadata(anchor, activity)) {
                anchor.label = false;
                this.children.delete(anchor.meta.clusterId);
                continue;
            }
            const visible = projectAnchor(anchor, frame, width, height, focal);
            const id = anchor.meta.clusterId;
            const detailed = this.wantsSystems(anchor);
            if (detailed)
                this.expanded.add(id);
            else
                this.expanded.delete(id);
            // Reveal system geometry under the ribbons before switching to individual labels.
            if (anchor.span < 144)
                this.collapsedClusters.add(id);
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
    }
    wantsSystems(anchor) {
        return anchor.meta.systemIds.length > 0 && anchor.span >= (this.expanded.has(anchor.meta.clusterId) ? 400 : 480);
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
                    rgb: parent.rgb, x: 0, y: 0, radius: 6, span: 0, depth: 0, label: false, left: 0, top: 0 });
            }
            this.children.set(id, children);
        }
        for (const child of children) {
            if (projectAnchor(child, frame, width, height, focal)) {
                child.radius = clusterMarkerRadius(child.span);
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
                this.anchors.set(id, { meta, rgb, x: 0, y: 0, radius: 10, span: 0, depth: 0, label: false, left: 0, top: 0 });
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
            if (this.occupied.length >= LABEL_LIMIT || anchor.span < (retained ? 32 : 40))
                continue;
            if (!this.place(anchor, width, height))
                continue;
            anchor.label = true;
            this.occupied.push(anchor);
        }
    }
    place(anchor, width, height) {
        anchor.left = anchor.x - CLUSTER_LABEL_WIDTH / 2;
        anchor.top = anchor.y - CLUSTER_LABEL_HEIGHT / 2;
        return this.fits(anchor, width, height);
    }
    fits(anchor, width, height) {
        const w = labelWidth(anchor), h = labelHeight(anchor);
        return anchor.left >= 8 && anchor.left + w <= width - 8 && anchor.top >= 8 && anchor.top + h <= height - 8
            && !this.occupied.some(other => overlaps(anchor, other)) && !this.markers.overlaps(anchor, w, h);
    }
}
export function overlaps(a, b) {
    return a.left < b.left + labelWidth(b) + 12 && a.left + labelWidth(a) + 12 > b.left
        && a.top < b.top + labelHeight(b) + 10 && a.top + labelHeight(a) + 10 > b.top;
}
export const labelWidth = (a) => CLUSTER_LABEL_WIDTH;
export const labelHeight = (a) => CLUSTER_LABEL_HEIGHT;
/** Project doubles relative to the same origin as topology, including near/behind rejection. */
export function projectAnchor(a, frame, width, height, focal) {
    const x = a.meta.x - frame.origin.x, y = -frame.origin.y, z = a.meta.z - frame.origin.z, m = frame.viewProj;
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    const depth = m[2] * x + m[6] * y + m[10] * z + m[14];
    a.span = 0;
    if (!(w > 0) || depth < 0 || depth > w)
        return false;
    const view = frame.view;
    a.depth = -(view[2] * x + view[6] * y + view[10] * z + view[14]);
    a.x = ((m[0] * x + m[4] * y + m[8] * z + m[12]) / w + 1) * width / 2;
    a.y = (1 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / w) * height / 2;
    a.span = 2 * a.meta.radius * focal / w;
    a.radius = a.systemId === undefined ? clusterMarkerRadius(a.span) : 6;
    return a.x >= -22 && a.x <= width + 22 && a.y >= -22 && a.y <= height + 22;
}
function clusterIntersectsScreen(a, width, height) {
    const reach = a.span / 2;
    return a.x + reach >= 0 && a.x - reach <= width && a.y + reach >= 0 && a.y - reach <= height;
}
function hasVisibleMetadata(anchor, activity) {
    return anchor.meta.publicAtlas === true || anchor.meta.systemIds.length > 0 || activity?.hasCluster(anchor.meta.clusterId) !== false;
}
//# sourceMappingURL=layout.js.map