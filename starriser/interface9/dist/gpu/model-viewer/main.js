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
import { createLowPolyShipMesh } from "../../lib/fleet-sim/visual/lowpoly-ship-mesh.js";
import { GLB_MESH_YAW_HALF, LOWPOLY_MESH_YAW_HALF, } from "../../lib/fleet-sim/visual/mesh-yaw-facing.js";
import { MODEL_LOD_DEFAULT_SCALE } from "../../lib/fleet-sim/visual/fleet-lod.js";
import { buildViewerWorldPositions, rayMeshHit, } from "./ray-mesh.js";
import { createOrbitState, orbitApplyDrag, orbitApplyZoom, orbitEye, } from "./orbit-camera.js";
import { pickGizmoAxis, gizmoDragWorldDelta, addVec3, } from "./gizmo-drag.js";
import { rotatingLightDir } from "./rotating-light.js";
import { VIEWER_MODEL_UNIFORM_SIZE, VIEWER_MODEL_U_MODEL_SCALE, VIEWER_MODEL_WGSL, VIEWER_OVERLAY_UNIFORM_SIZE, VIEWER_OVERLAY_WGSL, } from "./viewer-shaders.js";
const GLB_URL = "models/spaceship_fighter__-_version_1_meshy_6.glb";
const AXIS_LEN = 0.55;
const BALL_R = 0.04 / 25; // 0.0016 — small marker for thruster attach
const HIT_R = 0.025 / 25; // original hit marker, same scale factor
const VIEWER_MESHES = [
    { id: "simplify3", label: "Low-poly 3% (272 tris, rebaked UVs)", url: "models/spaceship_fighter_simplify3.glb" },
    { id: "simplify50", label: "Game high-poly 50% (4.6k, original UVs)", url: "models/spaceship_fighter_simplify50.glb" },
    { id: "glb", label: "Source high-poly (9.1k)", url: GLB_URL },
    { id: "simplify5", label: "Smart 5% (456 tris, original UVs)", url: "models/spaceship_fighter_simplify5.glb" },
    { id: "simplify10", label: "Smart 10% (913 tris, original UVs)", url: "models/spaceship_fighter_simplify10.glb" },
    { id: "simplify1", label: "Smart 1% (90 tris, original UVs)", url: "models/spaceship_fighter_simplify1.glb" },
    { id: "voxel_chunky", label: "Voxel remesh chunky (0.7k, baked)", url: "models/spaceship_fighter_voxel_chunky.glb" },
    { id: "lowpoly", label: "Dart (8 tris)", url: null },
];
const VIEWER_MESH_IDS = new Set(VIEWER_MESHES.map((m) => m.id));
const canvas = document.getElementById("canvas");
const statusEl = document.getElementById("status");
const hx = document.getElementById("hx");
const hy = document.getElementById("hy");
const hz = document.getElementById("hz");
const hhit = document.getElementById("hhit");
const meshSelect = document.getElementById("mesh-select");
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
function selectedMeshId() {
    const v = meshSelect?.value ?? "";
    return VIEWER_MESH_IDS.has(v) ? v : "simplify3";
}
function viewerMeshYawHalf(id) {
    return id === "lowpoly" ? LOWPOLY_MESH_YAW_HALF : GLB_MESH_YAW_HALF;
}
function meshLoadLabel(id) {
    const row = VIEWER_MESHES.find((m) => m.id === id);
    return row ? `Loading ${row.label}…` : "Loading mesh…";
}
async function resolveViewerMesh(id) {
    if (id === "lowpoly")
        return createLowPolyShipMesh();
    const row = VIEWER_MESHES.find((m) => m.id === id);
    const url = row?.url ?? GLB_URL;
    const res = await fetch(url);
    if (!res.ok)
        throw new Error(`Failed to fetch ${url} (${res.status})`);
    return parseGlb(await res.arrayBuffer());
}
function destroyViewerGpuMesh(gpu) {
    if (!gpu)
        return;
    gpu.vbo.destroy();
    gpu.ibo.destroy();
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
async function loadMesh(device, pipeline, sampler, uniform, id, modelScale) {
    const mesh = await resolveViewerMesh(id);
    const meshYawHalf = viewerMeshYawHalf(id);
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
    return {
        mesh,
        worldPositions,
        meshYawHalf,
        vbo,
        ibo,
        baseTex: tex.base,
        nrmTex: tex.nrm,
        specTex: tex.spec,
        bind: createModelBindGroup(device, pipeline, uniform, sampler, tex.base, tex.nrm, tex.spec),
    };
}
function readyStatus(gpu) {
    const tris = (gpu.mesh.indexCount / 3) | 0;
    return `Ready — ${gpu.mesh.vertexCount} verts, ${tris} tris. Click to pick.`;
}
async function main() {
    if (!navigator.gpu) {
        setStatus("WebGPU not available (use Chromium).", true);
        return;
    }
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
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
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
    async function applyMesh(id) {
        const gen = ++meshLoadGen;
        setStatus(meshLoadLabel(id));
        try {
            const next = await loadMesh(device, modelPipeline, sampler, modelUniform, id, modelScale);
            if (gen !== meshLoadGen) {
                destroyViewerGpuMesh(next);
                return gpuMesh != null;
            }
            const prev = gpuMesh;
            gpuMesh = next;
            destroyViewerGpuMesh(prev);
            clearPick();
            if (id !== "lowpoly" && !gltfHasColorAndNormal(next.mesh)) {
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
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
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
        mat4Perspective(proj, (45 * Math.PI) / 180, aspect, 0.05, 200);
        mat4LookAt(view, eye.eyeX, eye.eyeY, eye.eyeZ, eye.targetX, eye.targetY, eye.targetZ);
        mat4ViewProj(viewProj, proj, view);
        mat4Invert(invViewProj, viewProj);
    }
    function pickRay(cssX, cssY) {
        const { w, h } = canvasCssSize();
        const ndc = screenToNdc(cssX, cssY, w, h);
        return rayFromNdc(ndc.x, ndc.y, invViewProj);
    }
    canvas.addEventListener("pointerdown", (e) => {
        canvas.setPointerCapture(e.pointerId);
        const p = pointerToCss(e);
        lastX = p.x;
        lastY = p.y;
        buildViewProj();
        const { w, h } = canvasCssSize();
        // Gizmo first when ball exists
        if (ball) {
            const axis = pickGizmoAxis(p.x, p.y, ball, viewProj, w, h, AXIS_LEN, 16);
            if (axis) {
                dragMode = "gizmo";
                dragAxis = axis;
                return;
            }
        }
        // Ray vs mesh
        if (!gpuMesh)
            return;
        const ray = pickRay(p.x, p.y);
        const hit = rayMeshHit({
            origin: ray.origin,
            dir: {
                x: ray.direction.x,
                y: ray.direction.y,
                z: ray.direction.z,
            },
        }, gpuMesh.worldPositions, gpuMesh.mesh.indices, false);
        if (hit) {
            originalHit = { ...hit.point };
            ball = { ...hit.point };
            updateHud(ball, originalHit);
            dragMode = null;
            dragAxis = null;
            setStatus(`Hit tri ${hit.triIndex}  t=${hit.t.toFixed(4)}  → drag axes to fine-tune`);
            return;
        }
        // Orbit on empty space / miss
        dragMode = "orbit";
        dragAxis = null;
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
            ball = addVec3(ball, d);
            updateHud(ball, originalHit);
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
    meshSelect?.addEventListener("change", () => {
        void applyMesh(selectedMeshId());
    });
    if (!(await applyMesh(selectedMeshId())))
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
        // Model uniforms
        // Layout must match VIEWER_MODEL_UNIFORM_SIZE (112 B / 28 f32).
        // modelScale lives at float index VIEWER_MODEL_U_MODEL_SCALE (=24).
        for (let i = 0; i < 16; i++)
            modelU[i] = viewProj[i];
        modelU[16] = light.x;
        modelU[17] = light.y;
        modelU[18] = light.z;
        modelU[19] = 0.22; // ambient
        modelU[20] = eye.eyeX;
        modelU[21] = eye.eyeY;
        modelU[22] = eye.eyeZ;
        modelU[23] = gpuMesh.meshYawHalf;
        modelU[VIEWER_MODEL_U_MODEL_SCALE] = modelScale;
        modelU[25] = 0;
        modelU[26] = 0;
        modelU[27] = 0;
        device.queue.writeBuffer(modelUniform, 0, modelU);
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
        const pass = enc.beginRenderPass({
            colorAttachments: [
                {
                    view: context.getCurrentTexture().createView(),
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
        pass.setBindGroup(0, gpuMesh.bind);
        pass.setVertexBuffer(0, gpuMesh.vbo);
        pass.setIndexBuffer(gpuMesh.ibo, "uint32");
        pass.drawIndexed(gpuMesh.mesh.indexCount);
        // Overlays always on top of depth (depthCompare always)
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
        pass.end();
        device.queue.submit([enc.finish()]);
    }
    requestAnimationFrame(frame);
}
main().catch((err) => {
    console.error(err);
    setStatus(String(err?.message ?? err), true);
});
//# sourceMappingURL=main.js.map