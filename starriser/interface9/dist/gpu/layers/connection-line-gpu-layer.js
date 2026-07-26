/**
 * M2 — topology connection edges (cluster jump gates + solar links).
 * Draws via fat screen-space Line2 ribbons (not GPU line-list).
 * CPU store layout is already segment pairs: 6 pos floats + 6 color floats/edge.
 */
import { CONNECTION_FLOATS_PER_SLOT, } from "../connection-line-store.js";
import { MAP_MSAA_SAMPLES } from "../map-msaa.js";
import { Line2Renderer } from "../../vendor/line2/index.js";
/** Screen-space topology stroke (buffer px). Slightly thinner than M4 overlays (2.5). */
export const CONNECTION_LINEWIDTH_PX = 1.75;
export class ConnectionLineGpuLayer {
    constructor(bootstrap) {
        this.name = "connection-lines";
        this.line2 = null;
        /** Last uploaded segment count (store.count high-water, includes soft holes). */
        this.segmentCount = 0;
        this.bootstrap = bootstrap;
    }
    /**
     * @param options.sampleCount Must match the map color pass (default {@link MAP_MSAA_SAMPLES}).
     *   Line2 also enables alphaToCoverage when sampleCount > 1 for long-edge AA.
     */
    init(options) {
        const { device, format } = this.bootstrap;
        const sampleCount = options?.sampleCount ?? MAP_MSAA_SAMPLES;
        // Color-only map pass → depthFormat null (Line2 default).
        this.line2 = new Line2Renderer(device, {
            format,
            sampleCount,
            alphaToCoverage: sampleCount > 1,
            material: {
                color: [1, 1, 1, 0.9],
                linewidth: CONNECTION_LINEWIDTH_PX,
                worldUnits: false,
                // Topology edges: body-only (no round endcap pills / soft discs).
                endcaps: false,
                softAA: false,
                vertexColors: true,
                depthTest: false,
                depthWrite: false,
            },
        });
    }
    /** Drawing-buffer size (DPR-scaled canvas); required for correct thickness. */
    setResolution(width, height) {
        this.line2?.setResolution(width, height);
    }
    /**
     * Upload store → Line2 when dirty. Positions and colors are always
     * co-uploaded so a grow does not leave white vertex colors.
     */
    syncFromStore(store) {
        if (!this.line2) {
            throw new Error("ConnectionLineGpuLayer.init() required");
        }
        const edgeCount = store.count;
        if (edgeCount <= 0) {
            this.line2.clearGeometry();
            this.segmentCount = 0;
            store.clearDirty();
            return;
        }
        const dirty = store.positionDirty.kind !== "clean" ||
            store.colorDirty.kind !== "clean";
        if (!dirty && edgeCount === this.segmentCount)
            return;
        const nFloats = edgeCount * CONNECTION_FLOATS_PER_SLOT;
        this.line2.setPositions(store.positions.subarray(0, nFloats));
        this.line2.setColors(store.colors.subarray(0, nFloats));
        this.segmentCount = edgeCount;
        store.clearDirty();
    }
    /**
     * Encode fat connection ribbons. Requires separate view + projection
     * (Line2 expands in screen space; fused viewProj is wrong).
     */
    encode(pass, view, projection) {
        if (!this.line2 || this.segmentCount <= 0)
            return;
        this.line2.writeViewProjection(view, projection);
        this.line2.encode(pass);
    }
    getSegmentCount() {
        return this.segmentCount;
    }
    dispose() {
        this.line2?.dispose();
        this.line2 = null;
        this.segmentCount = 0;
    }
}
//# sourceMappingURL=connection-line-gpu-layer.js.map