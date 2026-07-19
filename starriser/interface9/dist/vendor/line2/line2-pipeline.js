/**
 * WebGPU render pipeline(s) for fat Line2 (triangle-list, instanced).
 */
import { LINE2_WGSL } from "./line2-wgsl.js";
/** Transparent blend matching Galaxy connection / overlay layers. */
export const LINE2_BLEND = {
    color: {
        srcFactor: "src-alpha",
        dstFactor: "one-minus-src-alpha",
        operation: "add",
    },
    alpha: {
        srcFactor: "one",
        dstFactor: "one-minus-src-alpha",
        operation: "add",
    },
};
/**
 * Vertex buffer layouts:
 *  0 — template (pos3 + uv2), per-vertex
 *  1 — instance start/end (6 floats), per-instance
 *  2 — instance colors (6 floats), per-instance
 *  3 — instance distances (2 floats), per-instance
 */
export function line2VertexBufferLayouts() {
    return [
        {
            arrayStride: 20, // 5 × f32
            stepMode: "vertex",
            attributes: [
                { shaderLocation: 0, offset: 0, format: "float32x3" }, // position
                { shaderLocation: 1, offset: 12, format: "float32x2" }, // uv
            ],
        },
        {
            arrayStride: 24, // start xyz + end xyz
            stepMode: "instance",
            attributes: [
                { shaderLocation: 2, offset: 0, format: "float32x3" },
                { shaderLocation: 3, offset: 12, format: "float32x3" },
            ],
        },
        {
            arrayStride: 24, // colorStart rgb + colorEnd rgb
            stepMode: "instance",
            attributes: [
                { shaderLocation: 4, offset: 0, format: "float32x3" },
                { shaderLocation: 5, offset: 12, format: "float32x3" },
            ],
        },
        {
            arrayStride: 8, // dStart + dEnd
            stepMode: "instance",
            attributes: [
                { shaderLocation: 6, offset: 0, format: "float32" },
                { shaderLocation: 7, offset: 4, format: "float32" },
            ],
        },
    ];
}
/**
 * Create the fat-line render pipeline.
 * Depth write/compare come from options; toggle depthWrite via a second
 * pipeline if you need runtime flips often (Line2Renderer handles that).
 */
export function createLine2Pipeline(device, options) {
    const sampleCount = options.sampleCount ?? 1;
    const module = device.createShaderModule({
        label: "line2",
        code: LINE2_WGSL,
    });
    // Default null: no depthStencil (Galaxy color-only pass).
    const depthFormat = options.depthFormat === undefined ? null : options.depthFormat;
    const depthStencil = depthFormat != null
        ? {
            format: depthFormat,
            depthWriteEnabled: options.depthWrite ?? false,
            depthCompare: options.depthCompare ?? "less",
        }
        : undefined;
    const pipeline = device.createRenderPipeline({
        label: "line2-pipeline",
        layout: "auto",
        vertex: {
            module,
            entryPoint: "vs_main",
            buffers: line2VertexBufferLayouts(),
        },
        fragment: {
            module,
            entryPoint: "fs_main",
            targets: [
                {
                    format: options.format,
                    blend: LINE2_BLEND,
                },
            ],
        },
        primitive: {
            topology: "triangle-list",
            cullMode: "none",
            frontFace: "ccw",
        },
        multisample: {
            count: sampleCount,
            alphaToCoverageEnabled: (options.alphaToCoverage ?? false) && sampleCount > 1,
        },
        depthStencil,
    });
    return {
        pipeline,
        bindGroupLayout: pipeline.getBindGroupLayout(0),
        shaderModule: module,
    };
}
//# sourceMappingURL=line2-pipeline.js.map