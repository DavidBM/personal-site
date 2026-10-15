/**
 * Full-screen ship model viewer: high-poly, Meshopt simplify, voxel remesh, or dart + game-style
 * lighting, orbit camera, ray hit red ball, always-on XYZ gizmo, tether, HUD.
 *
 * Entry: model-viewer.html → dist/gpu/model-viewer/main.js
 */
import { createWebGpuBootstrap } from "../device.js";
import { mat4LookAt, mat4Perspective, mat4ViewProj, mat4Invert, } from "../math/mat4.js";
import { screenToNdc, rayFromNdc } from "../math/ground-pick.js";
import { parseGlb, gltfHasColorAndNormal, } from "../../lib/fleet-sim/visual/gltf-static-mesh.js";
import { createLowPolyShipMesh, createPointShipMesh } from "../../lib/fleet-sim/visual/lowpoly-ship-mesh.js";
import { DEFAULT_HULL_LOD, HULL_LEVELS, HULL_POINT_PX, hullRadiusForPixels, selectHullLevel, } from "../../lib/fleet-sim/visual/hull-lod.js";
import { MODEL_LOD_DEFAULT_SCALE } from "../../lib/fleet-sim/visual/fleet-lod.js";
import { NEW_SHIP_CLASSES, VIEWER_DEFAULT_MESH, VIEWER_MESHES, VIEWER_REVIEW_RADIUS, buildEdgeIndices, normalizeInterleaved, viewerLodChain, viewerMeshEntry, viewerShipClass, } from "./viewer-catalog.js";
import { createShipPicker } from "./ship-picker.js";
import { loadHullLodTuning } from "./hull-lod-tuning.js";
import { LOD_LEVEL_NAMES, createLodTimeline, formatPx } from "./lod-timeline.js";
import { createUvPanel } from "./uv-panel.js";
import { PERSON_HEIGHT_M, createPersonMesh, defaultShipLengthM } from "./scale-figure.js";
import { TRAIL_EXPORT_UNIT, createTrailEditor, loadPublishedShipFx } from "./trail-editor.js";
import { createTrailTextures } from "./trail-textures.js";
import { TRAIL_TEXTURE_UNIT } from "../thruster-texture/trail-config.js";
import { buildViewerWorldPositions, rayMeshHit, } from "./ray-mesh.js";
import { createOrbitState, orbitApplyDrag, orbitApplyZoom, orbitEye, orbitSetRadius, } from "./orbit-camera.js";
import { pickGizmoAxis, gizmoDragWorldDelta, addVec3, } from "./gizmo-drag.js";
import { rotatingLightDir } from "./rotating-light.js";
import { VIEWER_EDGE_UNIFORM_SIZE, VIEWER_EDGE_WGSL, VIEWER_MODEL_UNIFORM_SIZE, VIEWER_MODEL_U_HAS_METAL_ROUGH, VIEWER_MODEL_U_MODEL_SCALE, VIEWER_MODEL_U_SURFACE, VIEWER_MODEL_WGSL, VIEWER_OVERLAY_UNIFORM_SIZE, VIEWER_OVERLAY_WGSL, VIEWER_SURFACE, } from "./viewer-shaders.js";
const AXIS_LEN = 0.55;
const BALL_R = 0.04 / 25; // 0.0016 — small marker for thruster attach
const HIT_R = 0.025 / 25; // original hit marker, same scale factor
const EDGE_MODES = ["off", "visible", "xray"];
/** Fraction of the eye distance edges move toward the camera to beat their own surface. */
const EDGE_NUDGE = 0.0015;
/** Above this many triangles edges are faded and the status suggests zooming in. */
const DENSE_EDGE_TRIANGLES = 200000;
const canvas = document.getElementById("canvas");
const statusEl = document.getElementById("status");
const hx = document.getElementById("hx");
const hy = document.getElementById("hy");
const hz = document.getElementById("hz");
const hhit = document.getElementById("hhit");
const pickerRoot = document.getElementById("ship-picker-body");
const surfaceSelect = document.getElementById("surface-select");
const edgesSelect = document.getElementById("edges-select");
const meshStats = document.getElementById("mesh-stats");
const detailSelect = document.getElementById("detail-select");
const lodReadout = document.getElementById("lod-readout");
const modeTabs = document.getElementById("viewer-mode");
const timelineRoot = document.getElementById("lod-timeline");
const sizeBox = document.getElementById("size-box");
const sizeBoxToggle = document.getElementById("size-box-toggle");
const uvSelect = document.getElementById("uv-select");
const uvRoot = document.getElementById("uv-panel");
const personToggle = document.getElementById("person-toggle");
const shipLengthInput = document.getElementById("ship-length");
const lookPersonButton = document.getElementById("look-person");
const scaleReadout = document.getElementById("scale-readout");
const trailPanel = document.getElementById("trail-panel");
const trailTexturePanel = document.getElementById("trail-textures");
function setStatus(msg, error = false) {
    statusEl.textContent = msg;
    statusEl.classList.toggle("error", error);
}
function fmt(n) {
    if (!Number.isFinite(n))
        return "—";
    const a = Math.abs(n);
    if (a >= 100)
        return n.toFixed(2);
    if (a >= 1)
        return n.toFixed(4);
    return n.toFixed(6);
}
function updateHud(ball, hit) {
    if (!ball) {
        hx.textContent = "—";
        hy.textContent = "—";
        hz.textContent = "—";
    }
    else {
        hx.textContent = fmt(ball.x);
        hy.textContent = fmt(ball.y);
        hz.textContent = fmt(ball.z);
    }
    if (!hit) {
        hhit.textContent = "none";
    }
    else {
        hhit.textContent = `${fmt(hit.x)}, ${fmt(hit.y)}, ${fmt(hit.z)}`;
    }
}
/** Unit icosphere-ish (subdivided octahedron) for red/hit balls. */
function buildSphereMesh(radius, subdiv = 2) {
    // Start with unit octahedron
    let verts = [
        { x: 1, y: 0, z: 0 },
        { x: -1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 0, y: -1, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 0, y: 0, z: -1 },
    ];
    let tris = [
        [0, 2, 4],
        [2, 1, 4],
        [1, 3, 4],
        [3, 0, 4],
        [2, 0, 5],
        [1, 2, 5],
        [3, 1, 5],
        [0, 3, 5],
    ];
    const midCache = new Map();
    const mid = (a, b) => {
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        const hit = midCache.get(key);
        if (hit != null)
            return hit;
        const va = verts[a];
        const vb = verts[b];
        let x = va.x + vb.x;
        let y = va.y + vb.y;
        let z = va.z + vb.z;
        const len = Math.hypot(x, y, z) || 1;
        x /= len;
        y /= len;
        z /= len;
        const i = verts.length;
        verts.push({ x, y, z });
        midCache.set(key, i);
        return i;
    };
    for (let s = 0; s < subdiv; s++) {
        const next = [];
        for (const [a, b, c] of tris) {
            const ab = mid(a, b);
            const bc = mid(b, c);
            const ca = mid(c, a);
            next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
        }
        tris = next;
        midCache.clear();
    }
    const positions = new Float32Array(verts.length * 3);
    for (let i = 0; i < verts.length; i++) {
        positions[i * 3] = verts[i].x * radius;
        positions[i * 3 + 1] = verts[i].y * radius;
        positions[i * 3 + 2] = verts[i].z * radius;
    }
    const indices = new Uint16Array(tris.length * 3);
    for (let i = 0; i < tris.length; i++) {
        indices[i * 3] = tris[i][0];
        indices[i * 3 + 1] = tris[i][1];
        indices[i * 3 + 2] = tris[i][2];
    }
    return { positions, indices };
}
async function decodeImage(device, bytes, mimeType) {
    const blob = new Blob([bytes.slice()], { type: mimeType || "image/png" });
    const bmp = await createImageBitmap(blob);
    const tex = device.createTexture({
        size: [bmp.width, bmp.height],
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_DST |
            GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture({ source: bmp }, { texture: tex }, [bmp.width, bmp.height]);
    bmp.close();
    return tex;
}
function solidTex(device, r, g, b, a = 255) {
    const tex = device.createTexture({
        size: [1, 1],
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_DST |
            GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.writeTexture({ texture: tex }, new Uint8Array([r, g, b, a]), { bytesPerRow: 4 }, [1, 1]);
    return tex;
}
/** ?mesh=… picks the initial ship; unknown ids fall back to the default. */
function initialMeshId() {
    const mesh = new URLSearchParams(location.search).get("mesh");
    return mesh && VIEWER_MESHES.some((m) => m.id === mesh) ? mesh : VIEWER_DEFAULT_MESH;
}
/** ?glb=path/to/file.glb reviews any same-origin GLB (recentred, nose +Z) outside the catalog. */
function urlReviewEntry() {
    const url = new URLSearchParams(location.search).get("glb");
    if (!url || !/^[\w./-]+\.glb$/.test(url) || url.includes(".."))
        return null;
    return { id: `glb:${url}`, label: url.split("/").pop(), detail: "?glb", url, yawHalf: 0, normalize: "fit", thumb: null };
}
function selectedSurface() {
    const v = surfaceSelect?.value ?? "studio";
    return v in VIEWER_SURFACE ? v : "studio";
}
function selectedEdges() {
    const v = edgesSelect?.value ?? "off";
    return EDGE_MODES.includes(v) ? v : "off";
}
/** ?surface=studio|game|clay&edges=off|visible|xray preselects the view controls. */
function applyUrlSelection() {
    const params = new URLSearchParams(location.search);
    const choose = (select, value, valid) => {
        if (select && value && valid(value))
            select.value = value;
    };
    choose(surfaceSelect, params.get("surface"), (v) => v in VIEWER_SURFACE);
    choose(edgesSelect, params.get("edges"), (v) => EDGE_MODES.includes(v));
    choose(detailSelect, params.get("detail"), (v) => v === "auto");
    if (sizeBoxToggle && params.get("sizeBox") === "0")
        sizeBoxToggle.checked = false;
    choose(uvSelect, params.get("uv"), (v) => ["off", "base", "normal", "metalRough", "checker"].includes(v));
    if (personToggle && params.get("person") === "0")
        personToggle.checked = false;
}
/** Game class of any viewer mesh: new-ship classes, previous Aster Vale hulls, and the legacy fighter. */
function shipClassKey(entry) {
    return viewerShipClass(entry.id)?.key ?? /^av-([a-z]+)-/.exec(entry.id)?.[1] ?? (entry.normalize === false ? "fighter" : null);
}
let viewerMode = new URLSearchParams(location.search).get("mode") === "tune" ? "tune" : "browse";
function autoLod() {
    return viewerMode === "tune" || detailSelect?.value === "auto";
}
let lodReadoutText = "";
function showLodReadout(level, px, mesh) {
    const text = level && mesh
        ? `Screen size ${formatPx(px)} px → ${mesh.entry.selectedOnly ? "Very high" : LOD_LEVEL_NAMES[level]} (${((mesh.mesh.indexCount / 3) | 0).toLocaleString()} tris)`
        : autoLod() ? "Auto LOD needs a new-ship class (loading…)" : "";
    if (text === lodReadoutText || !lodReadout)
        return;
    lodReadoutText = text;
    lodReadout.textContent = text;
}
let sizeBoxKey = "";
/** The square the game measures (projected diameter, render px) around the hull centre, in CSS px. */
function showSizeBox(px, level, centre, cssPerRenderPx) {
    if (!sizeBox)
        return;
    const on = !!centre && sizeBoxToggle?.checked !== false && px > 0;
    const side = Math.max(px * cssPerRenderPx, 1);
    const key = on ? `${px.toPrecision(3)}|${level}|${centre.x.toFixed(1)}|${centre.y.toFixed(1)}|${side.toFixed(1)}` : "off";
    if (key === sizeBoxKey)
        return;
    sizeBoxKey = key;
    sizeBox.hidden = !on;
    if (!on)
        return;
    Object.assign(sizeBox.style, { left: `${centre.x - side / 2}px`, top: `${centre.y - side / 2}px`, width: `${side}px`, height: `${side}px` });
    sizeBox.firstElementChild.textContent = `${formatPx(Number(px.toPrecision(3)))} px${level ? ` · ${LOD_LEVEL_NAMES[level]}` : ""}`;
}
async function resolveViewerMesh(entry) {
    if (!entry.url)
        return entry.procedural === "game-point" ? createPointShipMesh() : createLowPolyShipMesh();
    const res = await fetch(entry.url);
    if (!res.ok)
        throw new Error(`Failed to fetch ${entry.url} (${res.status})`);
    return parseGlb(await res.arrayBuffer());
}
function destroyViewerGpuMesh(gpu) {
    if (!gpu)
        return;
    gpu.vbo.destroy();
    gpu.ibo.destroy();
    gpu.edgeIbo?.destroy();
    gpu.baseTex.destroy();
    gpu.nrmTex.destroy();
    gpu.specTex.destroy();
}
function createModelBindGroup(device, pipeline, uniform, sampler, base, nrm, spec) {
    return device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: uniform } },
            { binding: 1, resource: base.createView() },
            { binding: 2, resource: nrm.createView() },
            { binding: 3, resource: spec.createView() },
            { binding: 4, resource: sampler },
        ],
    });
}
/** Decode glTF images when present; otherwise keep solid cool defaults. */
async function loadMeshTextures(device, mesh) {
    let base = null;
    let nrm = null;
    let spec = null;
    try {
        const colorIm = mesh.images[mesh.baseColorImage];
        if (colorIm)
            base = await decodeImage(device, colorIm.data, colorIm.mimeType);
        const nrmIm = mesh.images[mesh.normalImage];
        if (nrmIm)
            nrm = await decodeImage(device, nrmIm.data, nrmIm.mimeType);
        const specIm = mesh.images[mesh.diffuseSpecularImage];
        if (specIm)
            spec = await decodeImage(device, specIm.data, specIm.mimeType);
    }
    catch (e) {
        console.warn("texture decode failed", e);
    }
    return {
        base: base ?? solidTex(device, 90, 170, 220),
        nrm: nrm ?? solidTex(device, 128, 128, 255),
        spec: spec ?? solidTex(device, 255, 255, 255),
    };
}
async function loadMesh(device, pipeline, sampler, uniform, entry, legacyScale) {
    const mesh = await resolveViewerMesh(entry);
    const meshYawHalf = entry.yawHalf;
    // Review meshes come from different tools in arbitrary units and origins.
    // 'unit' meshes already share a unit-radius origin (runtime LOD chain): scale only.
    const modelScale = entry.normalize === "fit"
        ? normalizeInterleaved(mesh.interleaved, mesh.floatsPerVertex, VIEWER_REVIEW_RADIUS)
        : entry.normalize === "unit" ? VIEWER_REVIEW_RADIUS : legacyScale;
    const worldPositions = buildViewerWorldPositions(mesh.interleaved, mesh.floatsPerVertex, meshYawHalf, modelScale);
    const vbo = device.createBuffer({
        size: Math.max(4, mesh.interleaved.byteLength),
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    if (mesh.interleaved.byteLength > 0) {
        device.queue.writeBuffer(vbo, 0, mesh.interleaved);
    }
    const ibo = device.createBuffer({
        size: Math.max(4, mesh.indices.byteLength),
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    if (mesh.indices.byteLength > 0) {
        device.queue.writeBuffer(ibo, 0, mesh.indices);
    }
    const tex = await loadMeshTextures(device, mesh);
    let farthest = 0;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i + 2 < worldPositions.length; i += 3) {
        farthest = Math.max(farthest, Math.hypot(worldPositions[i], worldPositions[i + 1], worldPositions[i + 2]));
        for (let a = 0; a < 3; a++) {
            min[a] = Math.min(min[a], worldPositions[i + a]);
            max[a] = Math.max(max[a], worldPositions[i + a]);
        }
    }
    return {
        entry,
        mesh,
        worldPositions,
        meshYawHalf,
        modelScale,
        boundRadius: entry.normalize ? VIEWER_REVIEW_RADIUS : farthest,
        bounds: { min, max },
        vbo,
        ibo,
        edgeIbo: null,
        edgeIndexCount: 0,
        baseTex: tex.base,
        nrmTex: tex.nrm,
        specTex: tex.spec,
        bind: createModelBindGroup(device, pipeline, uniform, sampler, tex.base, tex.nrm, tex.spec),
    };
}
/** Upload line-list edges the first time edges are requested for a mesh. */
function ensureEdges(device, gpu) {
    if (gpu.edgeIbo)
        return;
    const edges = buildEdgeIndices(gpu.mesh.indices, gpu.mesh.vertexCount);
    gpu.edgeIbo = device.createBuffer({
        size: Math.max(4, edges.byteLength),
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    if (edges.byteLength > 0)
        device.queue.writeBuffer(gpu.edgeIbo, 0, edges);
    gpu.edgeIndexCount = edges.length;
}
function textureSizeLabel(mesh, index) {
    return index >= 0 && mesh.images[index]?.data.byteLength ? "yes" : "none";
}
function writeMeshStats(gpu) {
    if (!meshStats)
        return;
    const tris = (gpu.mesh.indexCount / 3) | 0;
    const rows = [
        ["Triangles", tris.toLocaleString()],
        ["Vertices", gpu.mesh.vertexCount.toLocaleString()],
        ["Colour map", textureSizeLabel(gpu.mesh, gpu.mesh.baseColorImage)],
        ["Normal map", textureSizeLabel(gpu.mesh, gpu.mesh.normalImage)],
        ["Metal/rough map", textureSizeLabel(gpu.mesh, gpu.mesh.diffuseSpecularImage)],
    ];
    if (gpu.edgeIbo)
        rows.splice(2, 0, ["Edges drawn", (gpu.edgeIndexCount / 2).toLocaleString()]);
    meshStats.replaceChildren(...rows.map(([label, value]) => {
        const row = document.createElement("div");
        row.className = "row";
        const l = document.createElement("span");
        l.className = "label";
        l.textContent = label;
        const v = document.createElement("span");
        v.className = "val";
        v.textContent = value;
        row.append(l, v);
        return row;
    }));
}
/** Model uniform; layout must match VIEWER_MODEL_UNIFORM_SIZE (112 B / 28 f32). */
function writeModelUniform(out, viewProj, light, eye, gpu, surface) {
    out.set(viewProj, 0);
    out.set([light.x, light.y, light.z, 0.22], 16); // light direction + ambient
    out.set([eye.eyeX, eye.eyeY, eye.eyeZ, gpu.meshYawHalf], 20);
    out[VIEWER_MODEL_U_MODEL_SCALE] = gpu.modelScale;
    out[VIEWER_MODEL_U_SURFACE] = VIEWER_SURFACE[surface];
    out[VIEWER_MODEL_U_HAS_METAL_ROUGH] = gpu.mesh.diffuseSpecularImage >= 0 ? 1 : 0;
    out[27] = 0;
}
/** Dark lines read best on clay, bright cyan on textured hulls; x-ray and dense meshes fade. */
function edgeColor(surface, edges, triangles) {
    const color = surface === "clay" ? [0.02, 0.03, 0.05, 0.85] : [0.1, 0.85, 1.0, 0.55];
    if (edges === "xray")
        color[3] = 0.3;
    // Dense scan-like meshes put several edges in every pixel; fade so shading still reads.
    if (triangles > DENSE_EDGE_TRIANGLES)
        color[3] *= 0.35;
    return color;
}
/** Edge uniform; layout must match VIEWER_EDGE_UNIFORM_SIZE (112 B / 28 f32). */
function writeEdgeUniform(out, viewProj, eye, gpu, surface, edges) {
    out.set(viewProj, 0);
    out.set([eye.eyeX, eye.eyeY, eye.eyeZ, gpu.meshYawHalf], 16);
    out.set(edgeColor(surface, edges, gpu.mesh.indexCount / 3), 20);
    out[24] = gpu.modelScale;
    out[25] = edges === "visible" ? EDGE_NUDGE : 0;
}
function readyStatus(gpu) {
    const tris = (gpu.mesh.indexCount / 3) | 0;
    const dense = tris > DENSE_EDGE_TRIANGLES ? " Dense mesh: zoom in to separate polygon edges." : "";
    return `Ready — ${gpu.entry.label} (${gpu.entry.detail}): ${gpu.mesh.vertexCount} verts, ${tris} tris. Click to pick.${dense}`;
}
function shipLengthM() {
    const value = Number(shipLengthInput?.value);
    return Number.isFinite(value) && value > 0 ? value : 20;
}
/**
 * The scale figure's GPU mesh: its own uniform and solid orange material on the
 * shared model pipeline. Placed with its feet at the hull's lowest point, one
 * metre beside its widest side; world units per metre come from the hull length.
 */
function createScalePerson(device, pipeline, sampler) {
    const mesh = createPersonMesh();
    const vbo = device.createBuffer({ size: mesh.interleaved.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    const ibo = device.createBuffer({ size: mesh.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(ibo, 0, mesh.indices);
    const uniform = device.createBuffer({ size: VIEWER_MODEL_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const bind = createModelBindGroup(device, pipeline, uniform, sampler, solidTex(device, 255, 140, 40), solidTex(device, 128, 128, 255), solidTex(device, 255, 255, 255));
    const data = new Float32Array(VIEWER_MODEL_UNIFORM_SIZE / 4);
    let key = "", scale = 1, centre = [0, 0, 0];
    function place(ship, lengthM) {
        if (`${ship.entry.id}|${lengthM}` === key)
            return;
        key = `${ship.entry.id}|${lengthM}`;
        const { min, max } = ship.bounds;
        scale = Math.max(max[2] - min[2], 1e-6) / lengthM;
        const feet = [max[0] / scale + 1.0, min[1] / scale, (min[2] + max[2]) / 2 / scale];
        device.queue.writeBuffer(vbo, 0, createPersonMesh(feet).interleaved);
        centre = [feet[0] * scale, (feet[1] + PERSON_HEIGHT_M / 2) * scale, feet[2] * scale];
        if (scaleReadout)
            scaleReadout.textContent = `Ship ${lengthM.toLocaleString()} m long · person ${PERSON_HEIGHT_M} m`;
    }
    return {
        centre: () => centre,
        scale: () => scale,
        draw(pass, ship, lengthM, viewProj, light, eye, surface) {
            place(ship, lengthM);
            writeModelUniform(data, viewProj, light, eye, { meshYawHalf: 0, modelScale: scale, mesh }, surface);
            device.queue.writeBuffer(uniform, 0, data);
            // Polygon edges change the active pipeline before the scale figure draws.
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, bind);
            pass.setVertexBuffer(0, vbo);
            pass.setIndexBuffer(ibo, "uint32");
            pass.drawIndexed(mesh.indexCount);
        },
    };
}
function createUvPanelIn(root, onClose) {
    return root ? createUvPanel(root, onClose) : null;
}
/** HUD controls for the UV map and the scale figure. */
function bindScaleAndUvControls(handlers) {
    uvSelect?.addEventListener("change", handlers.uv);
    shipLengthInput?.addEventListener("change", handlers.length);
    lookPersonButton?.addEventListener("click", handlers.look);
}
async function main() {
    if (!navigator.gpu) {
        setStatus("WebGPU not available (use Chromium).", true);
        return;
    }
    const publishedFx = loadPublishedShipFx();
    const boot = await createWebGpuBootstrap({
        canvas,
        label: "model-viewer",
        clearColor: { r: 0, g: 0, b: 21 / 255, a: 1 },
    });
    const { device, context, format } = boot;
    boot.configureContext(window.innerWidth, window.innerHeight);
    const modelScale = MODEL_LOD_DEFAULT_SCALE;
    // --- Model GPU (mesh uploaded via loadMesh) ---
    const modelModule = device.createShaderModule({
        label: "viewer-model",
        code: VIEWER_MODEL_WGSL,
    });
    const modelPipeline = device.createRenderPipeline({
        label: "viewer-model-pipe",
        layout: "auto",
        vertex: {
            module: modelModule,
            entryPoint: "vs_main",
            buffers: [
                {
                    arrayStride: 32,
                    attributes: [
                        { shaderLocation: 0, offset: 0, format: "float32x3" },
                        { shaderLocation: 1, offset: 12, format: "float32x3" },
                        { shaderLocation: 2, offset: 24, format: "float32x2" },
                    ],
                },
            ],
        },
        fragment: {
            module: modelModule,
            entryPoint: "fs_main",
            targets: [{ format }],
        },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: {
            format: "depth24plus",
            depthWriteEnabled: true,
            depthCompare: "less",
        },
    });
    const sampler = device.createSampler({
        magFilter: "linear",
        minFilter: "linear",
        addressModeU: "repeat",
        addressModeV: "repeat",
    });
    const modelUniform = device.createBuffer({
        size: VIEWER_MODEL_UNIFORM_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // --- Overlay (depth always) ---
    const ovModule = device.createShaderModule({
        label: "viewer-overlay",
        code: VIEWER_OVERLAY_WGSL,
    });
    // Overlay verts: pos.xyz + color.rgba (28 B)
    const OV_STRIDE = 28;
    const makeOverlayPipe = (topology) => device.createRenderPipeline({
        label: `viewer-overlay-${topology}`,
        layout: "auto",
        vertex: {
            module: ovModule,
            entryPoint: "vs_main",
            buffers: [
                {
                    arrayStride: OV_STRIDE,
                    attributes: [
                        { shaderLocation: 0, offset: 0, format: "float32x3" },
                        { shaderLocation: 1, offset: 12, format: "float32x4" },
                    ],
                },
            ],
        },
        fragment: {
            module: ovModule,
            entryPoint: "fs_main",
            targets: [
                {
                    format,
                    blend: {
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
                    },
                },
            ],
        },
        primitive: { topology, cullMode: "none" },
        depthStencil: {
            format: "depth24plus",
            depthWriteEnabled: false,
            depthCompare: "always", // always visible through hull
        },
    });
    const linePipe = makeOverlayPipe("line-list");
    const triPipe = makeOverlayPipe("triangle-list");
    // --- Triangle edges: visible (depth-tested) or x-ray (through the hull) ---
    const edgeModule = device.createShaderModule({ label: "viewer-edges", code: VIEWER_EDGE_WGSL });
    const makeEdgePipe = (depthCompare) => device.createRenderPipeline({
        label: `viewer-edges-${depthCompare}`,
        layout: "auto",
        vertex: {
            module: edgeModule,
            entryPoint: "vs_main",
            buffers: [{ arrayStride: 32, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] }],
        },
        fragment: {
            module: edgeModule,
            entryPoint: "fs_main",
            targets: [
                {
                    format,
                    blend: {
                        color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
                        alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
                    },
                },
            ],
        },
        primitive: { topology: "line-list" },
        depthStencil: { format: "depth24plus", depthWriteEnabled: false, depthCompare },
    });
    const edgePipes = {
        visible: makeEdgePipe("less-equal"),
        xray: makeEdgePipe("always"),
    };
    const edgeUniform = device.createBuffer({
        size: VIEWER_EDGE_UNIFORM_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const edgeBinds = {
        visible: device.createBindGroup({
            layout: edgePipes.visible.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: { buffer: edgeUniform } }],
        }),
        xray: device.createBindGroup({
            layout: edgePipes.xray.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: { buffer: edgeUniform } }],
        }),
    };
    const edgeU = new Float32Array(VIEWER_EDGE_UNIFORM_SIZE / 4);
    function drawEdges(pass, gpu, edges) {
        if (edges === "off" || !gpu.edgeIbo)
            return;
        pass.setPipeline(edgePipes[edges]);
        pass.setBindGroup(0, edgeBinds[edges]);
        pass.setVertexBuffer(0, gpu.vbo);
        pass.setIndexBuffer(gpu.edgeIbo, "uint32");
        pass.drawIndexed(gpu.edgeIndexCount);
    }
    const sphere = buildSphereMesh(1, 2);
    // Two spheres (hit + ball) interleaved pos+color
    const sphereVertFloats = sphere.positions.length / 3 * 7;
    const sphereVbo = device.createBuffer({
        size: Math.max(4, sphereVertFloats * 4 * 2),
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    const sphereIbo = device.createBuffer({
        size: sphere.indices.byteLength,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(sphereIbo, 0, sphere.indices);
    // Lines: tether (2) + 3 axes (2 each) = 8 verts × 7 floats
    const lineVbo = device.createBuffer({
        size: 8 * OV_STRIDE,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    const ovUniform = device.createBuffer({
        size: VIEWER_OVERLAY_UNIFORM_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const ovBindLine = device.createBindGroup({
        layout: linePipe.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: ovUniform } }],
    });
    const ovBindTri = device.createBindGroup({
        layout: triPipe.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: ovUniform } }],
    });
    function writeVert(out, i, x, y, z, r, g, b, a = 1) {
        const o = i * 7;
        out[o] = x;
        out[o + 1] = y;
        out[o + 2] = z;
        out[o + 3] = r;
        out[o + 4] = g;
        out[o + 5] = b;
        out[o + 6] = a;
        return i + 1;
    }
    function packSphere(out, baseVert, cx, cy, cz, radius, r, g, b, a = 1) {
        const n = sphere.positions.length / 3;
        for (let i = 0; i < n; i++) {
            writeVert(out, baseVert + i, sphere.positions[i * 3] * radius + cx, sphere.positions[i * 3 + 1] * radius + cy, sphere.positions[i * 3 + 2] * radius + cz, r, g, b, a);
        }
    }
    // Depth
    let depthTex = device.createTexture({
        size: [canvas.width, canvas.height],
        format: "depth24plus",
        // Sampled by the glow pass (visibility of each glow's centre).
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    // State
    let orbit = createOrbitState({
        yaw: 0.85,
        pitch: 0.4,
        radius: 2.8,
    });
    let originalHit = null;
    let ball = null;
    let dragMode = null;
    let dragAxis = null;
    let lastX = 0;
    let lastY = 0;
    let t0 = performance.now();
    let gpuMesh = null;
    let meshLoadGen = 0;
    function clearPick() {
        originalHit = null;
        ball = null;
        dragMode = null;
        dragAxis = null;
        updateHud(null, null);
    }
    function applyEdges() {
        const shown = lodShown ?? gpuMesh;
        if (shown && selectedEdges() !== "off")
            ensureEdges(device, shown);
        if (shown)
            writeMeshStats(shown);
        if (shown && uvSelect?.value !== "off")
            uvPanel?.setMesh(shown.mesh, `${shown.entry.label} (${shown.entry.detail})`);
    }
    // --- UV map panel: the displayed mesh's texture and UV wireframe ---
    const uvPanel = createUvPanelIn(uvRoot, () => { if (uvSelect)
        uvSelect.value = "off"; applyUv(); });
    function applyUv() {
        const value = uvSelect?.value ?? "off";
        if (value !== "off")
            uvPanel?.setTexture(value);
        uvPanel?.setVisible(value !== "off");
        applyEdges();
    }
    // --- Person for scale: a 1.8 m figure beside the hull at the chosen ship length ---
    const person = createScalePerson(device, modelPipeline, sampler);
    const shipLengths = new Map();
    let lookingAtPerson = false;
    /** Default the length field when the class changes; keep lengths typed for a class. */
    function syncShipLength(entry) {
        const key = shipClassKey(entry) ?? "review";
        if (shipLengthInput)
            shipLengthInput.value = String(shipLengths.get(key) ?? defaultShipLengthM(shipClassKey(entry)));
    }
    function drawPerson(pass, light, eye, surface) {
        if (gpuMesh && personToggle?.checked !== false)
            person.draw(pass, gpuMesh, shipLengthM(), viewProj, light, eye, surface);
    }
    function lookAtPerson() {
        lookingAtPerson = !lookingAtPerson;
        const [x, y, z] = lookingAtPerson ? person.centre() : [0, 0, 0], height = PERSON_HEIGHT_M * person.scale();
        orbit = orbitSetRadius({ ...orbit, targetX: x, targetY: y, targetZ: z, minRadius: lookingAtPerson ? height * 0.6 : undefined }, lookingAtPerson ? height * 2.5 : 2.8);
        if (lookPersonButton)
            lookPersonButton.textContent = lookingAtPerson ? "Back to ship" : "Look at person";
    }
    // --- Trail emitters and glows: authored per class on the in-game hulls (catalog hull space) ---
    const published = await publishedFx;
    const trailTextures = createTrailTextures(device, trailTexturePanel, published?.textures ?? null);
    /**
     * Everything the trail tools add to the LOD export, complete enough to rebuild
     * the game's trail data and images from the JSON alone: every class's emitters
     * and glows (empty when none) and the full texture settings.
     */
    function trailExport() {
        const { trails: emitters, glows } = trails.exportTrails();
        const perClass = (map) => Object.fromEntries(NEW_SHIP_CLASSES.map((c) => [c.key, map[c.key] ?? []]));
        return { galaxyShipFx: 1, trailUnit: TRAIL_EXPORT_UNIT, trails: perClass(emitters), glows: perClass(glows),
            trailTextureUnit: TRAIL_TEXTURE_UNIT, trailTextures: trailTextures.exportConfig() };
    }
    const exportAll = () => (tuning ? tuning.exportJson(trailExport()) : JSON.stringify(trailExport(), null, 2));
    const trails = createTrailEditor(device, format, trailPanel, exportAll, trailTextures, published);
    /** Editing is on for the runtime chain (catalog space, unit radius); other meshes keep the single attach ball. */
    function syncTrailTarget() {
        const ship = gpuMesh, key = ship && ship.entry.normalize === "unit" ? viewerShipClass(ship.entry.id)?.key ?? null : null;
        const lengthMesh = ship ? (ship.bounds.max[2] - ship.bounds.min[2]) / ship.modelScale : 2;
        trails.setTarget(key, ship?.modelScale ?? 1, lengthMesh, shipLengthM());
    }
    // --- Auto LOD preview: the game's projected-size ranges over the class's runtime chain ---
    const lodMeshes = new Map();
    let lodChainKey = "";
    let lodLoadGen = 0;
    let lodLevel = null;
    let lodShown = null;
    let tuning = null;
    let timeline = null;
    function trianglesLabel(gpu) {
        const tris = (gpu.mesh.indexCount / 3) | 0;
        return tris >= 1000 ? `${(tris / 1000).toFixed(1)}k` : String(tris);
    }
    function syncTimelineClass() {
        if (!timeline)
            return;
        const triangles = {};
        for (const [level, gpu] of lodMeshes)
            triangles[level] = trianglesLabel(gpu);
        timeline.setClass(gpuMesh ? viewerShipClass(gpuMesh.entry.id) : null, triangles);
    }
    async function syncLodChain() {
        const chain = autoLod() && gpuMesh ? viewerLodChain(gpuMesh.entry.id) : [];
        const key = chain.map((e) => e.id).join("|");
        if (key === lodChainKey) {
            syncTimelineClass();
            return;
        }
        lodChainKey = key;
        const gen = ++lodLoadGen;
        for (const m of lodMeshes.values())
            destroyViewerGpuMesh(m);
        lodMeshes.clear();
        lodLevel = null;
        lodShown = null;
        syncTimelineClass();
        for (const entry of chain) {
            const m = await loadMesh(device, modelPipeline, sampler, modelUniform, entry, modelScale);
            if (gen !== lodLoadGen) {
                destroyViewerGpuMesh(m);
                return;
            }
            lodMeshes.set(entry.lod, m);
        }
        syncTimelineClass();
        applyEdges();
    }
    /** Projected diameter in render pixels, the renderer's measure (diameter = |proj[1][1]| * radius * height / depth). */
    function screenPixels(gpu) {
        const eye = orbitEye(orbit);
        return Math.abs(proj[5]) * gpu.boundRadius * canvas.height / Math.max(Math.hypot(eye.eyeX, eye.eyeY, eye.eyeZ), 1e-6);
    }
    /** In auto mode, the chain level the game would draw at this zoom; otherwise the selected mesh. */
    function drawMesh(selected) {
        const px = screenPixels(selected);
        if (!autoLod() || lodMeshes.size < HULL_LEVELS.length) {
            lodShown = null;
            showLodReadout(null, 0, null);
            return { mesh: selected, level: selected.entry.lod ?? null, px };
        }
        const shipClass = viewerShipClass(selected.entry.id);
        const bands = tuning && shipClass ? tuning.bands(shipClass.key) : DEFAULT_HULL_LOD;
        lodLevel = selectHullLevel(px, lodLevel, bands);
        const mesh = lodLevel === "full" && selected.entry.selectedOnly ? selected : lodMeshes.get(lodLevel);
        if (mesh !== lodShown) {
            lodShown = mesh;
            applyEdges();
        }
        showLodReadout(lodLevel, px, mesh);
        return { mesh, level: lodLevel, px };
    }
    /** The point level faces the camera at the hull's size, at least HULL_POINT_PX, as in the game's hull shader. */
    const pointVertices = new Float32Array(3 * 8);
    function facePointToCamera(gpu, eye) {
        if (gpu.entry.procedural !== "game-point")
            return;
        const distance = Math.hypot(eye.eyeX, eye.eyeY, eye.eyeZ);
        const f = [-eye.eyeX / distance, -eye.eyeY / distance, -eye.eyeZ / distance];
        const hint = Math.abs(f[1]) > 0.99 ? [1, 0, 0] : [0, 1, 0];
        let r = [f[1] * hint[2] - f[2] * hint[1], f[2] * hint[0] - f[0] * hint[2], f[0] * hint[1] - f[1] * hint[0]];
        const rl = Math.hypot(r[0], r[1], r[2]);
        r = r.map((v) => v / rl);
        const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
        const radius = Math.max(gpu.boundRadius, hullRadiusForPixels(HULL_POINT_PX, distance, Math.abs(proj[5]) * canvas.height)) / gpu.modelScale;
        for (let v = 0; v < 3; v++) {
            const cx = gpu.mesh.interleaved[v * 8], cy = gpu.mesh.interleaved[v * 8 + 1];
            for (let a = 0; a < 3; a++) {
                pointVertices[v * 8 + a] = (r[a] * cx + u[a] * cy) * radius;
                pointVertices[v * 8 + 3 + a] = -f[a];
            }
        }
        device.queue.writeBuffer(gpu.vbo, 0, pointVertices);
    }
    /** Timeline marker and size box: the box sits on the hull centre (orbit target), its side the measured diameter. */
    function reportScreenSize(px, level) {
        timeline?.setPixels(px, level);
        const w = viewProj[15];
        const { w: cssW, h: cssH } = canvasCssSize();
        const centre = w > 0 ? { x: (viewProj[12] / w + 1) / 2 * cssW, y: (1 - viewProj[13] / w) / 2 * cssH } : null;
        showSizeBox(px, autoLod() ? level : null, centre, cssH / Math.max(canvas.height, 1));
    }
    function scrubToPixels(px) {
        const radius = gpuMesh ? (lodShown ?? gpuMesh).boundRadius : VIEWER_REVIEW_RADIUS;
        if (lookingAtPerson)
            lookAtPerson();
        orbit = orbitSetRadius({ ...orbit, targetX: 0, targetY: 0, targetZ: 0, minRadius: undefined }, Math.abs(proj[5]) * radius * canvas.height / Math.max(px, 1e-3));
    }
    let detailBeforeTune = "selected";
    function applyMode(mode) {
        viewerMode = mode;
        for (const tab of modeTabs?.querySelectorAll("[data-mode]") ?? []) {
            tab.setAttribute("aria-selected", String(tab.dataset.mode === mode));
        }
        if (detailSelect) {
            // Tuning always previews the game's choice; leaving restores the previous detail mode.
            if (mode === "tune" && !detailSelect.disabled) {
                detailBeforeTune = detailSelect.value;
                detailSelect.value = "auto";
            }
            if (mode === "browse" && detailSelect.disabled)
                detailSelect.value = detailBeforeTune;
            detailSelect.disabled = mode === "tune";
        }
        timeline?.setVisible(mode === "tune");
        document.body.classList.toggle("tuning", mode === "tune");
        void syncLodChain();
        applyEdges();
    }
    async function applyMesh(entry) {
        const gen = ++meshLoadGen;
        setStatus(`Loading ${entry.label}…`);
        try {
            const next = await loadMesh(device, modelPipeline, sampler, modelUniform, entry, modelScale);
            if (gen !== meshLoadGen) {
                destroyViewerGpuMesh(next);
                return gpuMesh != null;
            }
            const prev = gpuMesh;
            gpuMesh = next;
            destroyViewerGpuMesh(prev);
            clearPick();
            syncShipLength(entry);
            syncTrailTarget();
            if (lookingAtPerson)
                lookAtPerson();
            applyEdges();
            void syncLodChain();
            // Legacy attach meshes must carry both maps; review hulls may omit a normal map.
            if (!entry.normalize && entry.url && !gltfHasColorAndNormal(next.mesh)) {
                setStatus("GLB missing baseColor or normal map", true);
            }
            else {
                setStatus(readyStatus(next));
            }
            return true;
        }
        catch (err) {
            if (gen !== meshLoadGen)
                return gpuMesh != null;
            setStatus(String(err?.message ?? err), true);
            return false;
        }
    }
    const view = new Float32Array(16);
    const proj = new Float32Array(16);
    const viewProj = new Float32Array(16);
    const invViewProj = new Float32Array(16);
    const modelU = new Float32Array(VIEWER_MODEL_UNIFORM_SIZE / 4);
    const ovU = new Float32Array(VIEWER_OVERLAY_UNIFORM_SIZE / 4);
    const lineCPU = new Float32Array(8 * 7);
    const sphereCPU = new Float32Array(sphereVertFloats * 2);
    function resize() {
        boot.configureContext(window.innerWidth, window.innerHeight);
        depthTex.destroy();
        depthTex = device.createTexture({
            size: [canvas.width, canvas.height],
            format: "depth24plus",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
    }
    window.addEventListener("resize", resize);
    function writeOverlayViewProj() {
        for (let i = 0; i < 16; i++)
            ovU[i] = viewProj[i];
        device.queue.writeBuffer(ovUniform, 0, ovU);
    }
    function canvasCssSize() {
        const r = canvas.getBoundingClientRect();
        return { w: r.width || 1, h: r.height || 1 };
    }
    function pointerToCss(e) {
        const r = canvas.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    function buildViewProj() {
        const eye = orbitEye(orbit);
        const aspect = canvas.width / Math.max(canvas.height, 1);
        // Near/far follow the eye distance so the scale figure can be framed up close.
        mat4Perspective(proj, (45 * Math.PI) / 180, aspect, Math.min(0.05, orbit.radius * 0.05), orbit.radius * 2.5 + 10);
        mat4LookAt(view, eye.eyeX, eye.eyeY, eye.eyeZ, eye.targetX, eye.targetY, eye.targetZ);
        mat4ViewProj(viewProj, proj, view);
        mat4Invert(invViewProj, viewProj);
    }
    function pickRay(cssX, cssY) {
        const { w, h } = canvasCssSize();
        const ndc = screenToNdc(cssX, cssY, w, h);
        return rayFromNdc(ndc.x, ndc.y, invViewProj);
    }
    /** While editing emitters, the gizmo sits on the selected emitter (no tether). */
    function followTrailSelection() {
        if (!trails.active())
            return;
        ball = trails.selectedWorld();
        originalHit = null;
    }
    /** Ray against the displayed hull at a CSS point. */
    function hitMesh(cssX, cssY) {
        if (!gpuMesh)
            return null;
        const ray = pickRay(cssX, cssY);
        return rayMeshHit({ origin: ray.origin, dir: { x: ray.direction.x, y: ray.direction.y, z: ray.direction.z } }, gpuMesh.worldPositions, gpuMesh.mesh.indices, false);
    }
    /** Trail editing: add an emitter where the hull was hit. */
    function trailAdd(cssX, cssY) {
        const hit = hitMesh(cssX, cssY);
        if (!hit)
            return false;
        trails.addAt(hit.point);
        updateHud(trails.selectedWorld(), null);
        setStatus("Emitter added → drag the arrows to move it; set its width in the panel");
        return true;
    }
    function legacyClick(cssX, cssY) {
        const hit = hitMesh(cssX, cssY);
        if (!hit)
            return false;
        originalHit = { ...hit.point };
        ball = { ...hit.point };
        updateHud(ball, originalHit);
        setStatus(`Hit tri ${hit.triIndex}  t=${hit.t.toFixed(4)}  → drag axes to fine-tune`);
        return true;
    }
    canvas.addEventListener("pointerdown", (e) => {
        canvas.setPointerCapture(e.pointerId);
        const p = pointerToCss(e);
        lastX = p.x;
        lastY = p.y;
        buildViewProj();
        const { w, h } = canvasCssSize();
        dragMode = null;
        // Another emitter's marker wins over the selected one's arrows drawn across it.
        if (trails.active() && trails.pick(p.x, p.y, viewProj, w, h)) {
            updateHud(trails.selectedWorld(), null);
            return;
        }
        dragAxis = ball ? pickGizmoAxis(p.x, p.y, ball, viewProj, w, h, AXIS_LEN, 16) : null;
        if (dragAxis) {
            dragMode = "gizmo";
            return;
        }
        const handled = trails.active() ? trailAdd(p.x, p.y) : legacyClick(p.x, p.y);
        // Orbit on empty space / miss
        if (!handled)
            dragMode = "orbit";
    });
    canvas.addEventListener("pointermove", (e) => {
        if (!dragMode)
            return;
        const p = pointerToCss(e);
        const dx = p.x - lastX;
        const dy = p.y - lastY;
        lastX = p.x;
        lastY = p.y;
        if (dragMode === "orbit") {
            orbit = orbitApplyDrag(orbit, dx, dy);
            return;
        }
        if (dragMode === "gizmo" && dragAxis && ball) {
            buildViewProj();
            const { w, h } = canvasCssSize();
            const d = gizmoDragWorldDelta(dragAxis, dx, dy, ball, viewProj, w, h);
            if (trails.active())
                trails.moveSelected(d);
            else
                ball = addVec3(ball, d);
            updateHud(trails.selectedWorld() ?? ball, originalHit);
        }
    });
    canvas.addEventListener("pointerup", () => {
        dragMode = null;
        dragAxis = null;
    });
    canvas.addEventListener("pointercancel", () => {
        dragMode = null;
        dragAxis = null;
    });
    canvas.addEventListener("wheel", (e) => {
        e.preventDefault();
        orbit = orbitApplyZoom(orbit, e.deltaY);
    }, { passive: false });
    const initialMesh = initialMeshId();
    if (pickerRoot)
        createShipPicker(pickerRoot, initialMesh, (id) => void applyMesh(viewerMeshEntry(id)));
    edgesSelect?.addEventListener("change", applyEdges);
    bindScaleAndUvControls({
        uv: applyUv,
        length: () => { if (gpuMesh)
            shipLengths.set(shipClassKey(gpuMesh.entry) ?? "review", shipLengthM()); syncTrailTarget(); },
        look: lookAtPerson,
    });
    detailSelect?.addEventListener("change", () => { void syncLodChain(); applyEdges(); });
    for (const tab of modeTabs?.querySelectorAll("[data-mode]") ?? []) {
        tab.addEventListener("click", () => applyMode(tab.dataset.mode === "tune" ? "tune" : "browse"));
    }
    applyUrlSelection();
    applyUv();
    void loadHullLodTuning(NEW_SHIP_CLASSES.map((c) => c.key)).then((loaded) => {
        tuning = loaded;
        if (timelineRoot)
            timeline = createLodTimeline(timelineRoot, loaded, scrubToPixels, exportAll);
        applyMode(viewerMode);
    });
    if (!(await applyMesh(urlReviewEntry() ?? viewerMeshEntry(initialMesh))))
        return;
    function frame(now) {
        if (boot.isLost)
            return;
        requestAnimationFrame(frame);
        if (!gpuMesh)
            return;
        const tSec = (now - t0) / 1000;
        buildViewProj();
        const eye = orbitEye(orbit);
        const light = rotatingLightDir(tSec);
        const shown = drawMesh(gpuMesh);
        const draw = shown.mesh;
        facePointToCamera(draw, eye);
        reportScreenSize(shown.px, shown.level);
        followTrailSelection();
        const surface = selectedSurface();
        writeModelUniform(modelU, viewProj, light, eye, draw, surface);
        device.queue.writeBuffer(modelUniform, 0, modelU);
        const edges = selectedEdges();
        if (edges !== "off") {
            writeEdgeUniform(edgeU, viewProj, eye, draw, surface, edges);
            device.queue.writeBuffer(edgeUniform, 0, edgeU);
        }
        // Overlay geometry (pos+color interleaved — one upload, multi-draw safe)
        let lineCount = 0;
        if (ball) {
            let vi = 0;
            if (originalHit) {
                vi = writeVert(lineCPU, vi, originalHit.x, originalHit.y, originalHit.z, 1, 0.85, 0.2, 0.95);
                vi = writeVert(lineCPU, vi, ball.x, ball.y, ball.z, 1, 0.85, 0.2, 0.95);
            }
            // X red
            vi = writeVert(lineCPU, vi, ball.x, ball.y, ball.z, 1, 0.15, 0.15, 1);
            vi = writeVert(lineCPU, vi, ball.x + AXIS_LEN, ball.y, ball.z, 1, 0.15, 0.15, 1);
            // Y green
            vi = writeVert(lineCPU, vi, ball.x, ball.y, ball.z, 0.2, 0.95, 0.25, 1);
            vi = writeVert(lineCPU, vi, ball.x, ball.y + AXIS_LEN, ball.z, 0.2, 0.95, 0.25, 1);
            // Z blue
            vi = writeVert(lineCPU, vi, ball.x, ball.y, ball.z, 0.25, 0.45, 1, 1);
            vi = writeVert(lineCPU, vi, ball.x, ball.y, ball.z + AXIS_LEN, 0.25, 0.45, 1, 1);
            lineCount = vi;
            device.queue.writeBuffer(lineVbo, 0, lineCPU);
            const nSphere = sphere.positions.length / 3;
            let base = 0;
            if (originalHit) {
                packSphere(sphereCPU, base, originalHit.x, originalHit.y, originalHit.z, HIT_R, 0.3, 0.95, 1, 0.9);
                base += nSphere;
            }
            packSphere(sphereCPU, base, ball.x, ball.y, ball.z, BALL_R, 1, 0.08, 0.08, 1);
            device.queue.writeBuffer(sphereVbo, 0, sphereCPU);
        }
        writeOverlayViewProj();
        const enc = device.createCommandEncoder();
        const colorView = context.getCurrentTexture().createView();
        const pass = enc.beginRenderPass({
            colorAttachments: [
                {
                    view: colorView,
                    clearValue: boot.clearColor,
                    loadOp: "clear",
                    storeOp: "store",
                },
            ],
            depthStencilAttachment: {
                view: depthTex.createView(),
                depthClearValue: 1,
                depthLoadOp: "clear",
                depthStoreOp: "store",
            },
        });
        // Model
        pass.setPipeline(modelPipeline);
        pass.setBindGroup(0, draw.bind);
        pass.setVertexBuffer(0, draw.vbo);
        pass.setIndexBuffer(draw.ibo, "uint32");
        pass.drawIndexed(draw.mesh.indexCount);
        drawEdges(pass, draw, edges);
        drawPerson(pass, light, eye, surface);
        trails.drawRibbons(pass, viewProj, eye);
        pass.end();
        // Glows read the finished depth (attached read-only), then markers and the gizmo draw on top.
        const overlay = enc.beginRenderPass({
            colorAttachments: [{ view: colorView, loadOp: "load", storeOp: "store" }],
            depthStencilAttachment: { view: depthTex.createView(), depthReadOnly: true },
        });
        trails.drawOverlay(overlay, viewProj, eye, depthTex);
        drawGizmo(overlay, lineCount);
        overlay.end();
        device.queue.submit([enc.finish()]);
    }
    /** Attach ball, original hit and tether, always on top (depthCompare always). */
    function drawGizmo(pass, lineCount) {
        if (ball && lineCount > 0) {
            pass.setPipeline(linePipe);
            pass.setBindGroup(0, ovBindLine);
            pass.setVertexBuffer(0, lineVbo);
            pass.draw(lineCount);
            pass.setPipeline(triPipe);
            pass.setBindGroup(0, ovBindTri);
            pass.setVertexBuffer(0, sphereVbo);
            pass.setIndexBuffer(sphereIbo, "uint16");
            const nSphere = sphere.positions.length / 3;
            // drawIndexed draws one mesh; for two spheres we need two index draws
            // with vertex buffer offset — WebGPU drawIndexed firstVertex.
            if (originalHit) {
                pass.drawIndexed(sphere.indices.length, 1, 0, 0, 0);
                pass.drawIndexed(sphere.indices.length, 1, 0, nSphere, 0);
            }
            else {
                pass.drawIndexed(sphere.indices.length, 1, 0, 0, 0);
            }
        }
    }
    requestAnimationFrame(frame);
}
main().catch((err) => {
    console.error(err);
    setStatus(String(err?.message ?? err), true);
});
//# sourceMappingURL=main.js.map