import { OverlayGeometry } from "./overlay-geometry.js";
import { mat4Identity, mat4Invert } from "../math/mat4.js";
import { hitEditHandleAtGround, layoutFromRadius } from "../math/edit-handle-hit.js";
import { intersectRayPlaneY0, rayFromNdc } from "../math/ground-pick.js";
import { OVERLAY_COLOR_HOVER, OVERLAY_COLOR_SELECT, packEditHandleGizmoLine2, packRingLine2 } from "../map-overlay-pack.js";
import { MAP_OVERLAY_FLOATS_PER_VERT } from "../shaders/map-overlay.wgsl.js";
/** Editor handles and selection/hover overlays, independent of topology and fleet state. */
export class MapOverlayPresentation {
    constructor(overlay, overlayLines, getViewProj, hideGalaxySelectionRings) {
        // --- M4 edit handles + selection/hover rings ---
        this.activeHandles = null;
        this.editLayout = null;
        this.editClusterId = null;
        this.editCenter = { x: 0, z: 0 };
        this.hoverRing = null;
        this.selectRing = null;
        this.overlayDirty = false;
        /** Scratch inv(view·proj) for edit-handle ground pick. */
        this.invViewProj = mat4Identity();
        this.geometry = new OverlayGeometry();
        this.colorsDirty = false;
        /** Last overlay pack included hover/select rings (false while SCENE / fade). */
        this.lastPackedGalaxyRings = false;
        this.overlay = overlay;
        this.overlayLines = overlayLines;
        this.getViewProj = getViewProj;
        this.hideGalaxySelectionRings = hideGalaxySelectionRings;
    }
    // --- M4 overlay geometry (low-level) ---
    /**
     * Upload fat Line2 overlay segments (positions xyz×2 + RGB×2 per segment).
     * Prefer high-level setHoverRing / setSelectRing / showEditHandles.
     */
    setOverlayLine2(pack) {
        // Low-level callers supply already packed absolute f32 coordinates. High-level
        // editor/ring paths below retain their local geometry and double anchor.
        const copy = { positions: pack.positions.slice(0, pack.segmentCount * 6), colors: pack.colors.slice(0, pack.segmentCount * 6), segmentCount: pack.segmentCount };
        this.geometry.setLines([{ pack: copy, x: 0, z: 0 }]);
        this.colorsDirty = true;
        if (pack.segmentCount === 0)
            this.overlayLines.clearGeometry();
    }
    /** Upload triangle-list overlay verts (pos.xyz + rgba). count = vertices. */
    setOverlayFills(data, vertexCount) {
        this.geometry.setFills([{ data: data.slice(0, vertexCount * MAP_OVERLAY_FLOATS_PER_VERT), vertexCount, x: 0, z: 0 }]);
    }
    /** Clear overlay fat lines + fill streams. */
    clearOverlay() {
        this.geometry.clear();
        this.colorsDirty = false;
        this.overlayLines.clearGeometry();
        this.overlay.clear();
    }
    // --- M4 high-level edit handles + rings ---
    showEditHandles(clusterId, handles, radius) {
        const list = [];
        for (let i = 0; i < handles.length; i++) {
            const h = handles[i];
            list.push({
                id: h.id,
                x: h.x,
                z: h.z,
                kind: h.kind,
                clusterId: h.clusterId,
            });
        }
        this.activeHandles = list;
        this.editLayout = layoutFromRadius(radius);
        this.editClusterId = clusterId;
        if (list.length > 0) {
            this.editCenter.x = list[0].x;
            this.editCenter.z = list[0].z;
        }
        this.overlayDirty = true;
    }
    hideEditHandles() {
        if (this.activeHandles == null &&
            this.editLayout == null &&
            this.editClusterId == null) {
            return;
        }
        this.activeHandles = null;
        this.editLayout = null;
        this.editClusterId = null;
        this.overlayDirty = true;
    }
    /**
     * Move edit gizmo center (and handle hit positions) during cluster drag.
     * No-op if no handles are active or clusterId does not match.
     */
    updateEditOverlayPosition(clusterId, pos) {
        if (this.editClusterId !== clusterId || !this.activeHandles)
            return;
        this.editCenter.x = pos.x;
        this.editCenter.z = pos.z;
        for (let i = 0; i < this.activeHandles.length; i++) {
            const h = this.activeHandles[i];
            h.x = pos.x;
            h.z = pos.z;
        }
        this.overlayDirty = true;
    }
    setHoverRing(ring) {
        const prev = this.hoverRing;
        if (ring == null && prev == null)
            return;
        if (ring &&
            prev &&
            prev.x === ring.x &&
            prev.z === ring.z &&
            prev.radius === ring.radius) {
            return;
        }
        this.hoverRing = ring
            ? { x: ring.x, z: ring.z, radius: ring.radius }
            : null;
        this.overlayDirty = true;
    }
    setSelectRing(ring) {
        const prev = this.selectRing;
        if (ring == null && prev == null)
            return;
        if (ring &&
            prev &&
            prev.x === ring.x &&
            prev.z === ring.z &&
            prev.radius === ring.radius) {
            return;
        }
        this.selectRing = ring
            ? { x: ring.x, z: ring.z, radius: ring.radius }
            : null;
        this.overlayDirty = true;
    }
    hasEditHandles() {
        return this.activeHandles != null && this.activeHandles.length > 0;
    }
    /**
     * Ground-plane hit against active edit handles.
     * Recomputes view·proj from current camera so picks match the last setCameraLookAt.
     */
    getEditHandleHit(ndcX, ndcY) {
        if (!this.activeHandles || !this.editLayout)
            return null;
        if (mat4Invert(this.invViewProj, this.getViewProj()) == null)
            return null;
        const ray = rayFromNdc(ndcX, ndcY, this.invViewProj);
        const ground = intersectRayPlaneY0(ray.origin, ray.direction);
        if (!ground)
            return null;
        return hitEditHandleAtGround(ground.x, ground.z, this.activeHandles, this.editLayout);
    }
    /**
     * Pack gizmo + rings into overlay GPU buffers when dirty.
     * Fat lines → Line2; plane fills → MapOverlayGpuLayer.
     * Called once per dirty frame before encode (not every frame).
     */
    packOverlaysIfDirty() {
        if (!this.overlayDirty)
            return;
        this.overlayDirty = false;
        const lines = [], fills = [];
        if (this.activeHandles && this.editLayout) {
            const gizmo = packEditHandleGizmoLine2(0, 0, this.editLayout);
            lines.push({ pack: gizmo.lines, x: this.editCenter.x, z: this.editCenter.z });
            fills.push({ ...gizmo.fills, x: this.editCenter.x, z: this.editCenter.z });
        }
        this.lastPackedGalaxyRings = false;
        if (!this.hideGalaxySelectionRings()) {
            this.appendRing(lines, this.hoverRing, OVERLAY_COLOR_HOVER);
            this.appendRing(lines, this.selectRing, OVERLAY_COLOR_SELECT);
        }
        this.geometry.setLines(lines);
        this.geometry.setFills(fills);
        this.colorsDirty = true;
        if (lines.length === 0)
            this.overlayLines.clearGeometry();
        if (fills.length === 0)
            this.overlay.clear();
    }
    appendRing(lines, ring, color) {
        if (!ring)
            return;
        lines.push({ pack: packRingLine2(0, 0, ring.radius, 48, color), x: ring.x, z: ring.z });
        this.lastPackedGalaxyRings = true;
    }
    encode(pass, width, height, coordinates) {
        const { origin, view, viewProj } = coordinates.galaxy;
        if (this.geometry.packRelative(origin)) {
            if (this.geometry.segmentCount > 0)
                this.overlayLines.setPositions(this.geometry.positions);
            this.overlay.setFillVertices(this.geometry.fillData, this.geometry.vertexCount);
        }
        if (this.colorsDirty) {
            if (this.geometry.segmentCount > 0)
                this.overlayLines.setColors(this.geometry.colors);
            this.colorsDirty = false;
        }
        this.overlay.encode(pass, viewProj);
        this.overlayLines.setResolution(width, height);
        this.overlayLines.writeViewProjection(view, coordinates.projection);
        this.overlayLines.encode(pass);
    }
}
//# sourceMappingURL=overlay-presentation.js.map