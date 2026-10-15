/**
 * Trail preview drawing for the model viewer: textured ribbons, glow sprites
 * and editing markers, all in viewer world space.
 *
 * Ribbons are camera-facing strips trailing aft (-Z) from each emitter at a
 * constant width; its ribbon style's layer of the ribbon texture array supplies
 * the shape (u along: 0 at the emitter, v across). They add light and are depth-tested against the hull in
 * the main pass.
 *
 * Glows are bright lights, drawn like lens flares: never depth-tested (so no
 * polygon slices the sprite), but scaled by how visible their centre is. In a
 * pass after the hull, each glow's vertex shader reads the scene depth at a
 * small disc of taps around where its centre lands on screen, testing a point
 * `GLOW_OCCLUSION_LIFT` of its radius in front of the surface it sits on (so
 * that face does not hide it). Seen from behind, a glow blooms over the nozzle
 * edge; from the front its centre is behind the hull and it fades out; edges
 * passing over the centre fade it smoothly. A glow's `facing` also fades it as
 * the camera moves ahead of the ship (engine light points aft, -Z). Each glow
 * samples its style's layer of the glow texture array. Markers are octahedra drawn over everything.
 */
import { VIEWER_OVERLAY_UNIFORM_SIZE, VIEWER_OVERLAY_WGSL } from "./viewer-shaders.js";
/** Where a glow's visibility is tested: this fraction of its radius toward the camera from its centre. */
export const GLOW_OCCLUSION_LIFT = 0.3;
/** Exhaust direction in viewer (catalog) space. */
const AFT = { x: 0, y: 0, z: -1 };
const SEGMENTS = 24;
const RIBBON_FLOATS = 6; // position, uv, texture layer
const MARKER_FLOATS = 7; // position, colour
const UNIFORM_SIZE = 96; // viewProj, eye, params
const GLOW_FLOATS = 6; // position, size, texture layer, facing
export const TRAIL_PREVIEW_WGSL = /* wgsl */ `
struct U {
  viewProj : mat4x4<f32>,
  eye : vec4<f32>,
  params : vec4<f32>, // x: occlusion test lift (fraction of glow radius); yzw: aft direction
};
@group(0) @binding(0) var<uniform> u : U;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var ribbonTex : texture_2d_array<f32>;
@group(0) @binding(3) var glowTex : texture_2d_array<f32>;
@group(0) @binding(4) var sceneDepth : texture_depth_2d;

struct RibbonOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) uv : vec2<f32>,
  @location(1) @interpolate(flat) layer : u32,
};

@vertex
fn vs_ribbon(@location(0) pos : vec3<f32>, @location(1) uv : vec2<f32>, @location(2) layer : f32) -> RibbonOut {
  var out : RibbonOut;
  out.clip = u.viewProj * vec4(pos, 1.0);
  out.uv = uv;
  out.layer = u32(layer + 0.5);
  return out;
}

struct GlowOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) uv : vec2<f32>,
  @location(1) @interpolate(flat) layer : u32,
  @location(2) @interpolate(flat) visible : f32,
};

const TAPS = 13u;

/** Share of depth taps around the projected test point with nothing nearer than it (taps off screen read the edge). */
fn centreVisibility(test : vec3<f32>, tapWorld : vec3<f32>) -> f32 {
  let clip = u.viewProj * vec4(test, 1.0);
  if (clip.w <= 0.0) { return 0.0; }
  let size = vec2<f32>(textureDimensions(sceneDepth));
  let toPixels = vec2(0.5, -0.5) * size;
  let centre = (clip.xy / clip.w) * toPixels + 0.5 * size;
  let edge = u.viewProj * vec4(test + tapWorld, 1.0);
  let tapPx = clamp(length((edge.xy / edge.w) * toPixels + 0.5 * size - centre), 1.5, 12.0);
  let depth = clip.z / clip.w;
  var seen = 0.0;
  for (var i = 0u; i < TAPS; i++) {
    // Centre, then two rings of six (radius 0.5 and 1, the outer ring turned 30°).
    let ring = select(select(1.0, 0.5, i < 7u), 0.0, i == 0u);
    let angle = f32(i) * 1.0471976 + select(0.0, 0.5235988, i >= 7u);
    let p = centre + vec2(cos(angle), sin(angle)) * ring * tapPx;
    let texel = vec2<i32>(clamp(p, vec2(0.0), size - 1.0));
    seen += select(0.0, 1.0, depth <= textureLoad(sceneDepth, texel, 0));
  }
  return seen / f32(TAPS);
}

@vertex
fn vs_glow(@builtin(vertex_index) vi : u32, @location(0) glow : vec4<f32>, @location(1) layer : f32, @location(2) facing : f32) -> GlowOut {
  var corners = array<vec2<f32>, 6>(vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(1.0, 1.0), vec2(-1.0, -1.0), vec2(1.0, 1.0), vec2(-1.0, 1.0));
  let c = corners[vi];
  let radius = 0.5 * glow.w;
  let toEye = normalize(u.eye.xyz - glow.xyz);
  let right = normalize(cross(select(vec3(0.0, 1.0, 0.0), vec3(0.0, 0.0, 1.0), abs(toEye.y) > 0.99), toEye));
  let up = cross(toEye, right);
  let lift = min(u.params.x * radius, 0.5 * distance(u.eye.xyz, glow.xyz));
  // Full from behind (and up to 45° off), half from the side, nothing from 45° ahead onward.
  let behind = smoothstep(-0.7, 0.7, dot(toEye, u.params.yzw));
  let visible = centreVisibility(glow.xyz + toEye * lift, up * 0.2 * radius) * mix(1.0, behind, facing);
  var out : GlowOut;
  // A hidden glow collapses to a point so it costs no fragments.
  out.clip = u.viewProj * vec4(glow.xyz + (right * c.x + up * c.y) * radius * select(0.0, 1.0, visible > 0.0), 1.0);
  out.uv = c * vec2(0.5, -0.5) + 0.5;
  out.layer = u32(layer + 0.5);
  out.visible = visible;
  return out;
}

@fragment
fn fs_ribbon(input : RibbonOut) -> @location(0) vec4<f32> {
  return textureSample(ribbonTex, samp, input.uv, input.layer);
}

@fragment
fn fs_glow(input : GlowOut) -> @location(0) vec4<f32> {
  return textureSample(glowTex, samp, input.uv, input.layer) * input.visible;
}
`;
/** Octahedron corners and faces (radius 1). */
const OCTA = [
    { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 },
];
const OCTA_FACES = [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]];
/** Camera-facing strip from `at` aft along -Z: two vertices per cross-section, v = 0 on one edge and 1 on the other. */
function writeRibbon(out, start, r, length, eye) {
    let i = start;
    const edge = (t, side) => {
        const z = r.at.z - length * t;
        let sx = eye.y - r.at.y, sy = -(eye.x - r.at.x); // axis (0, 0, -1) x toEye
        const l = Math.hypot(sx, sy) || 1;
        sx /= l;
        sy /= l;
        const half = 0.5 * r.width * side;
        return [r.at.x + sx * half, r.at.y + sy * half, z, t, (side + 1) / 2, r.layer];
    };
    for (let s = 0; s < SEGMENTS; s++) {
        const a = s / SEGMENTS, b = (s + 1) / SEGMENTS;
        for (const [t, side] of [[a, -1], [a, 1], [b, 1], [a, -1], [b, 1], [b, -1]]) {
            out.set(edge(t, side), i * RIBBON_FLOATS);
            i++;
        }
    }
    return i;
}
export function createTrailRenderer(device, format, maxItems, textures) {
    const module = device.createShaderModule({ label: "viewer-trail-preview", code: TRAIL_PREVIEW_WGSL });
    const additive = { color: { srcFactor: "one", dstFactor: "one", operation: "add" },
        alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" } };
    const textured = (label, kind, buffer, depthCompare) => device.createRenderPipeline({
        label, layout: "auto", vertex: { module, entryPoint: `vs_${kind}`, buffers: [buffer] },
        fragment: { module, entryPoint: `fs_${kind}`, targets: [{ format, blend: additive }] },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: { format: "depth24plus", depthWriteEnabled: false, depthCompare },
    });
    const ribbonPipe = textured("viewer-trail-ribbons", "ribbon", { arrayStride: RIBBON_FLOATS * 4, attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x3" }, { shaderLocation: 1, offset: 12, format: "float32x2" },
            { shaderLocation: 2, offset: 20, format: "float32" }
        ] }, "less-equal");
    const glowPipe = textured("viewer-trail-glows", "glow", { arrayStride: GLOW_FLOATS * 4, stepMode: "instance", attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x4" }, { shaderLocation: 1, offset: 16, format: "float32" },
            { shaderLocation: 2, offset: 20, format: "float32" }
        ] }, "always");
    const overlay = device.createShaderModule({ label: "viewer-trail-markers", code: VIEWER_OVERLAY_WGSL });
    const markerPipe = device.createRenderPipeline({
        label: "viewer-trail-markers", layout: "auto",
        vertex: { module: overlay, entryPoint: "vs_main", buffers: [{ arrayStride: MARKER_FLOATS * 4, attributes: [
                        { shaderLocation: 0, offset: 0, format: "float32x3" }, { shaderLocation: 1, offset: 12, format: "float32x4" }
                    ] }] },
        fragment: { module: overlay, entryPoint: "fs_main", targets: [{ format, blend: {
                        color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
                        alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" }
                    } }] },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: { format: "depth24plus", depthWriteEnabled: false, depthCompare: "always" },
    });
    const uniform = device.createBuffer({ size: UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const markerUniform = device.createBuffer({ size: VIEWER_OVERLAY_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
    const ribbonBind = device.createBindGroup({ layout: ribbonPipe.getBindGroupLayout(0), entries: [
            { binding: 0, resource: { buffer: uniform } }, { binding: 1, resource: sampler }, { binding: 2, resource: textures.ribbons.createView({ dimension: "2d-array" }) }
        ] });
    const glowView = textures.glows.createView({ dimension: "2d-array" });
    /** Rebuilt when the viewer replaces its depth texture (resize). */
    let glowBind = null;
    const glowBindFor = (depth) => {
        if (glowBind?.depth !== depth)
            glowBind = { depth, group: device.createBindGroup({ layout: glowPipe.getBindGroupLayout(0), entries: [
                        { binding: 0, resource: { buffer: uniform } }, { binding: 1, resource: sampler }, { binding: 3, resource: glowView },
                        { binding: 4, resource: depth.createView() }
                    ] }) };
        return glowBind.group;
    };
    const markerBind = device.createBindGroup({ layout: markerPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: markerUniform } }] });
    const ribbonData = new Float32Array(maxItems * SEGMENTS * 6 * RIBBON_FLOATS);
    const glowData = new Float32Array(maxItems * GLOW_FLOATS);
    const markerData = new Float32Array(maxItems * 2 * OCTA_FACES.length * 3 * MARKER_FLOATS);
    const vbo = (data) => device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    const ribbonVbo = vbo(ribbonData), glowVbo = vbo(glowData), markerVbo = vbo(markerData);
    const uniformData = new Float32Array(UNIFORM_SIZE / 4);
    /** Same values from both draws of a frame, so whichever write lands last is right. */
    function writeView(viewProj, eye) {
        uniformData.set(viewProj, 0);
        uniformData.set([eye.x, eye.y, eye.z, 1, GLOW_OCCLUSION_LIFT, AFT.x, AFT.y, AFT.z], 16);
        device.queue.writeBuffer(uniform, 0, uniformData);
        device.queue.writeBuffer(markerUniform, 0, uniformData, 0, 16);
    }
    function writeMarkers(markers) {
        let i = 0;
        for (const m of markers.slice(0, maxItems * 2))
            for (const face of OCTA_FACES)
                for (const k of face) {
                    const o = OCTA[k];
                    markerData.set([m.at.x + o.x * m.radius, m.at.y + o.y * m.radius, m.at.z + o.z * m.radius, ...m.colour], i * MARKER_FLOATS);
                    i++;
                }
        return i;
    }
    return {
        drawRibbons(pass, viewProj, eye, ribbons, length) {
            writeView(viewProj, eye);
            let r = 0;
            for (const ribbon of ribbons.slice(0, maxItems))
                r = writeRibbon(ribbonData, r, ribbon, length, eye);
            if (!r)
                return;
            device.queue.writeBuffer(ribbonVbo, 0, ribbonData, 0, r * RIBBON_FLOATS);
            pass.setPipeline(ribbonPipe);
            pass.setBindGroup(0, ribbonBind);
            pass.setVertexBuffer(0, ribbonVbo);
            pass.draw(r);
        },
        drawOverlay(pass, viewProj, eye, depth, glows, markers) {
            writeView(viewProj, eye);
            const g = Math.min(glows.length, maxItems);
            glows.slice(0, g).forEach((glow, k) => glowData.set([glow.at.x, glow.at.y, glow.at.z, glow.size, glow.layer, glow.facing], k * GLOW_FLOATS));
            if (g) {
                device.queue.writeBuffer(glowVbo, 0, glowData, 0, g * GLOW_FLOATS);
                pass.setPipeline(glowPipe);
                pass.setBindGroup(0, glowBindFor(depth));
                pass.setVertexBuffer(0, glowVbo);
                pass.draw(6, g);
            }
            const m = writeMarkers(markers);
            if (m) {
                device.queue.writeBuffer(markerVbo, 0, markerData, 0, m * MARKER_FLOATS);
                pass.setPipeline(markerPipe);
                pass.setBindGroup(0, markerBind);
                pass.setVertexBuffer(0, markerVbo);
                pass.draw(m);
            }
        },
    };
}
//# sourceMappingURL=trail-render.js.map