import { MAP_OVERLAY_FLOATS_PER_VERT } from "../shaders/map-overlay.wgsl.js";
export class OverlayGeometry {
    constructor() {
        this.lines = [];
        this.fills = [];
        this.positions = new Float32Array(0);
        this.colors = new Float32Array(0);
        this.fillData = new Float32Array(0);
        this.segmentCount = 0;
        this.vertexCount = 0;
        this.packedX = NaN;
        this.packedY = NaN;
        this.packedZ = NaN;
    }
    setLines(chunks) {
        this.lines = chunks;
        this.segmentCount = chunks.reduce((sum, chunk) => sum + chunk.pack.segmentCount, 0);
        const count = this.segmentCount * 6;
        if (this.positions.length !== count)
            this.positions = new Float32Array(count);
        if (this.colors.length !== count)
            this.colors = new Float32Array(count);
        let offset = 0;
        for (const chunk of chunks) {
            const length = chunk.pack.segmentCount * 6;
            this.colors.set(chunk.pack.colors.subarray(0, length), offset);
            offset += length;
        }
        this.invalidate();
    }
    setFills(chunks) {
        this.fills = chunks;
        this.vertexCount = chunks.reduce((sum, chunk) => sum + chunk.vertexCount, 0);
        const count = this.vertexCount * MAP_OVERLAY_FLOATS_PER_VERT;
        if (this.fillData.length !== count)
            this.fillData = new Float32Array(count);
        this.invalidate();
    }
    invalidate() { this.packedX = NaN; }
    /** True only when GPU positions/fills need upload. Colors change on setLines. */
    packRelative(origin) {
        if (this.packedX === origin.x && this.packedY === origin.y && this.packedZ === origin.z)
            return false;
        this.packLines(origin);
        this.packFills(origin);
        this.packedX = origin.x;
        this.packedY = origin.y;
        this.packedZ = origin.z;
        return true;
    }
    packLines(origin) {
        let offset = 0;
        for (const chunk of this.lines) {
            const dx = chunk.x - origin.x, dz = chunk.z - origin.z;
            const data = chunk.pack.positions;
            for (let i = 0; i < chunk.pack.segmentCount * 6; i += 3) {
                this.positions[offset++] = dx + data[i];
                this.positions[offset++] = data[i + 1] - origin.y;
                this.positions[offset++] = dz + data[i + 2];
            }
        }
    }
    packFills(origin) {
        let offset = 0;
        const stride = MAP_OVERLAY_FLOATS_PER_VERT;
        for (const chunk of this.fills) {
            const dx = chunk.x - origin.x, dz = chunk.z - origin.z;
            for (let i = 0; i < chunk.vertexCount * stride; i += stride) {
                for (let c = 3; c < stride; c++)
                    this.fillData[offset + c] = chunk.data[i + c];
                this.fillData[offset] = dx + chunk.data[i];
                this.fillData[offset + 1] = chunk.data[i + 1] - origin.y;
                this.fillData[offset + 2] = dz + chunk.data[i + 2];
                offset += stride;
            }
        }
    }
    clear() { this.setLines([]); this.setFills([]); }
}
//# sourceMappingURL=overlay-geometry.js.map