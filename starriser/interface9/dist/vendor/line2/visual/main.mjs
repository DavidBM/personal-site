/**
 * Line2 visual suite — multi-tile WebGPU demo for human evaluation.
 * Serve repo root, open /js/vendor/line2/visual/index.html
 *
 * AA policy (the setup that looked good):
 *   - MSAA ×4 + alphaToCoverage on depth-bearing tiles (long-edge quality)
 *   - softAA = library endcap fwidth only (no ribbon-skirt gradients)
 *   - I01 color-only pipeline draws in a 1-sample pass after resolve
 */

import { Line2Renderer } from "/dist/vendor/line2/index.js";
import {
  cameraDollyPerspective,
  cameraExtremeFov,
  cameraNearClipW,
  cameraOrbit,
  cameraOrthoTopDown,
  cameraPerspective,
  cameraWorldUnitsNearEye,
} from "./cameras.mjs";
import { ALL_CASES, filterCases } from "./cases.mjs";
import { computeTileRects, placeCaptionElements } from "./layout.mjs";

const canvas = document.getElementById("gpu");
const captionsEl = document.getElementById("captions");
const emptyEl = document.getElementById("empty");
const hudEl = document.getElementById("hud");
const statusEl = document.getElementById("status");
const legendEl = document.getElementById("legend");

const ui = {
  pause: document.getElementById("pause"),
  animate: document.getElementById("animate"),
  softAA: document.getElementById("softAA"),
  width: document.getElementById("width"),
  widthVal: document.getElementById("widthVal"),
  filter: document.getElementById("filter"),
  kind: document.getElementById("kind"),
};

/** MSAA for long-edge quality (three.js Line2 path with alphaToCoverage). */
const MSAA_SAMPLES = 4;

/** @type {GPUDevice} */
let device;
/** @type {GPUCanvasContext} */
let ctx;
/** @type {GPUTextureFormat} */
let format;
/** @type {GPUTexture | null} */
let depthTex = null;
/** @type {GPUTexture | null} */
let msaaColorTex = null;
/** @type {GPURenderPipeline | null} */
let occluderPipeline = null;
/** @type {GPUBuffer | null} */
let occluderVerts = null;
/** @type {GPUBuffer | null} */
let occluderUniforms = null;
/** @type {GPUBindGroup | null} */
let occluderBind = null;

/** @type {Map<string, Line2Renderer>} */
const renderers = new Map();

/** Per-tile CPU bookkeeping (not on Line2Renderer). */
const tileState = new Map();

let cases = ALL_CASES.slice();
let t0 = performance.now();
let lastFpsT = t0;
let frames = 0;
let fps = 0;
let totalSegments = 0;
let paused = false;
let globalWidthScale = 1;
/** @type {boolean | null} null = per-case material.softAA */
let forceSoftAA = null;
let animate = true;
/** Avoid rebuilding caption DOM every rAF (skews FPS / GC for perf tiles). */
let captionLayoutKey = "";

const viewScratch = new Float32Array(16);
const projScratch = new Float32Array(16);
const occluderMat = new Float32Array(32);

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", isError);
}

function ensureMsaaTargets(w, h) {
  if (
    msaaColorTex &&
    depthTex &&
    msaaColorTex.width === w &&
    msaaColorTex.height === h
  ) {
    return;
  }
  msaaColorTex?.destroy();
  depthTex?.destroy();
  msaaColorTex = device.createTexture({
    label: "line2-visual-msaa-color",
    size: [w, h],
    sampleCount: MSAA_SAMPLES,
    format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  depthTex = device.createTexture({
    label: "line2-visual-msaa-depth",
    size: [w, h],
    sampleCount: MSAA_SAMPLES,
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth || window.innerWidth;
  const cssH = canvas.clientHeight || window.innerHeight;
  const w = Math.max(1, Math.floor(cssW * dpr));
  const h = Math.max(1, Math.floor(cssH * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  if (device) ensureMsaaTargets(w, h);
  return { w, h, cssW, cssH, dpr };
}

function ensureRenderer(c) {
  let r = renderers.get(c.id);
  if (r) return r;
  // I01: Galaxy color-only, 1 sample (after MSAA resolve).
  // Others: MSAA + alphaToCoverage for long-edge quality.
  const msaa = !c.depthFormatNull;
  r = new Line2Renderer(device, {
    format,
    depthFormat: c.depthFormatNull ? null : "depth24plus",
    sampleCount: msaa ? MSAA_SAMPLES : 1,
    alphaToCoverage: msaa,
    material: { ...c.material },
  });
  renderers.set(c.id, r);
  return r;
}

function disposeUnused(activeIds) {
  for (const [id, r] of renderers) {
    if (!activeIds.has(id)) {
      r.dispose();
      renderers.delete(id);
      tileState.delete(id);
    }
  }
}

/** Drop every Line2Renderer + tile cache so next frame rebuilds all examples. */
function reloadExamples() {
  for (const [, r] of renderers) {
    try {
      r.dispose();
    } catch {
      /* ignore */
    }
  }
  renderers.clear();
  tileState.clear();
  captionLayoutKey = "";
  t0 = performance.now();
}

function softAALabel() {
  if (forceSoftAA === null) return "case default";
  return forceSoftAA ? "force on" : "force off";
}

function applySoftAAFromUi() {
  if (!ui.softAA) return;
  const v = ui.softAA.value;
  forceSoftAA = v === "default" ? null : v === "on";
  reloadExamples();
  if (statusEl && !statusEl.classList.contains("error")) {
    setStatus(
      `WebGPU ready · ${cases.length}/${ALL_CASES.length} cases · ${format} · MSAA×${MSAA_SAMPLES}+a2c · softAA ${softAALabel()}`,
    );
  }
}

function segmentCountOf(built) {
  if (!built?.positions) return 0;
  if (built.polyline) {
    return Math.max(0, built.positions.length / 3 - 1);
  }
  return built.positions.length / 6;
}

function applyGeometry(renderer, built) {
  renderer.setPositions(built.positions, {
    polyline: !!built.polyline,
    computeDistances: built.computeDistances,
  });
  if (built.colors) {
    renderer.setColors(built.colors, { polyline: !!built.colorsPolyline });
  }
}

function cameraFor(c, aspect, timeSec) {
  switch (c.camera) {
    case "ortho":
      return cameraOrthoTopDown(viewScratch, projScratch, 6.5, aspect, 40);
    case "perspective":
      return cameraPerspective(viewScratch, projScratch, aspect, {
        eye: [0, 3, 11],
        fovyDeg: 50,
      });
    case "nearClip":
      return cameraNearClipW(viewScratch, projScratch, aspect, timeSec);
    case "extremeFov":
      return cameraExtremeFov(viewScratch, projScratch, aspect, timeSec);
    case "worldNear":
      return cameraWorldUnitsNearEye(viewScratch, projScratch, aspect, timeSec);
    case "dolly":
      return cameraDollyPerspective(viewScratch, projScratch, aspect, timeSec, 14);
    case "orbit":
      return cameraOrbit(viewScratch, projScratch, aspect, timeSec, 14, 48);
    default:
      return cameraOrthoTopDown(viewScratch, projScratch, 6, aspect);
  }
}

function initOccluder() {
  const code = /* wgsl */ `
struct U { view: mat4x4f, proj: mat4x4f, }
@group(0) @binding(0) var<uniform> u: U;
struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) col: vec3f,
}
@vertex fn vs(@location(0) p: vec3f) -> VSOut {
  var o: VSOut;
  o.pos = u.proj * u.view * vec4f(p, 1.0);
  o.col = vec3f(0.15, 0.18, 0.25);
  return o;
}
@fragment fn fs(i: VSOut) -> @location(0) vec4f {
  return vec4f(i.col, 0.95);
}
`;
  const mod = device.createShaderModule({ code });
  const bgl = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: "uniform" },
      },
    ],
  });
  occluderPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
    vertex: {
      module: mod,
      entryPoint: "vs",
      buffers: [
        {
          arrayStride: 12,
          attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
        },
      ],
    },
    fragment: {
      module: mod,
      entryPoint: "fs",
      targets: [{ format }],
    },
    primitive: { topology: "triangle-list" },
    multisample: { count: MSAA_SAMPLES },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: true,
      depthCompare: "less",
    },
  });
  const v = new Float32Array([
    -1.2, -1.2, 1.0, 1.2, -1.2, 1.0, 1.2, 1.2, 1.0,
    -1.2, -1.2, 1.0, 1.2, 1.2, 1.0, -1.2, 1.2, 1.0,
  ]);
  occluderVerts = device.createBuffer({
    size: v.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(occluderVerts, 0, v);
  occluderUniforms = device.createBuffer({
    size: 128,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  occluderBind = device.createBindGroup({
    layout: bgl,
    entries: [{ binding: 0, resource: { buffer: occluderUniforms } }],
  });
}

function encodeMultiWidth(renderer, positions, pass, baseColor, soft) {
  const segFloats = 6;
  for (let i = 0; i < 12; i++) {
    const slice = positions.subarray(i * segFloats, (i + 1) * segFloats);
    renderer.setMaterial({
      color: baseColor,
      linewidth: (i + 1) * globalWidthScale,
      softAA: soft,
    });
    renderer.setPositions(slice);
    renderer.encode(pass);
  }
}

function syncLegendActive() {
  if (!legendEl) return;
  const kind = ui.kind.value;
  for (const el of legendEl.querySelectorAll("[data-kind]")) {
    el.classList.toggle("active", el.getAttribute("data-kind") === kind);
  }
}

function refreshCaseList() {
  const kind = ui.kind.value;
  let list = kind === "all" ? ALL_CASES.slice() : ALL_CASES.filter((c) => c.kind === kind);
  list = filterCases(list, ui.filter.value);
  cases = list;
  syncLegendActive();
  if (emptyEl) emptyEl.classList.toggle("show", cases.length === 0);
  captionLayoutKey = "";
}

async function init() {
  if (!navigator.gpu) {
    setStatus("WebGPU not available in this browser.", true);
    return;
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    setStatus("requestAdapter() failed.", true);
    return;
  }
  device = await adapter.requestDevice();
  device.addEventListener("uncapturederror", (e) => {
    console.error("WebGPU uncaptured:", e.error);
    setStatus(`GPU error: ${e.error?.message || e.error}`, true);
  });
  format = navigator.gpu.getPreferredCanvasFormat();
  ctx = canvas.getContext("webgpu");
  ctx.configure({
    device,
    format,
    alphaMode: "opaque",
  });

  const { w, h } = resize();
  ensureMsaaTargets(w, h);
  initOccluder();

  ui.pause.addEventListener("change", () => {
    paused = ui.pause.checked;
  });
  ui.animate.addEventListener("change", () => {
    animate = ui.animate.checked;
  });
  // Default: case softAA (usually on for endcaps). Change reloads examples.
  if (ui.softAA) {
    ui.softAA.value = "default";
    forceSoftAA = null;
    ui.softAA.addEventListener("change", () => {
      applySoftAAFromUi();
    });
  }
  ui.width.addEventListener("input", () => {
    globalWidthScale = Number(ui.width.value) || 1;
    ui.widthVal.textContent = `${globalWidthScale.toFixed(2)}×`;
  });
  ui.filter.addEventListener("input", refreshCaseList);
  ui.kind.addEventListener("change", refreshCaseList);
  if (legendEl) {
    legendEl.addEventListener("click", (ev) => {
      const t = ev.target;
      if (!(t instanceof HTMLElement)) return;
      const k = t.getAttribute("data-kind");
      if (!k) return;
      ui.kind.value = k;
      refreshCaseList();
    });
  }
  window.addEventListener("resize", () => resize());

  refreshCaseList();
  setStatus(
    `WebGPU ready · ${cases.length}/${ALL_CASES.length} cases · ${format} · MSAA×${MSAA_SAMPLES}+a2c · softAA case default`,
  );
  requestAnimationFrame(frame);
}

function frame(now) {
  requestAnimationFrame(frame);
  if (paused) return;

  frames++;
  if (now - lastFpsT >= 500) {
    fps = (frames * 1000) / (now - lastFpsT);
    frames = 0;
    lastFpsT = now;
  }

  const { w, h, dpr } = resize();
  const timeSec = animate ? (now - t0) * 0.001 : 0;

  const { rects } = computeTileRects(w, h, cases.length, {
    cols: Math.ceil(Math.sqrt(cases.length * (w / Math.max(h, 1)))),
    pad: 6,
    headerPx: 0,
  });

  const nextCaptionKey = `${cases.map((c) => c.id).join(",")}|${w}x${h}|${dpr}`;
  if (nextCaptionKey !== captionLayoutKey) {
    captionLayoutKey = nextCaptionKey;
    placeCaptionElements(captionsEl, rects, cases, dpr, dpr);
  }

  const active = new Set(cases.map((c) => c.id));
  disposeUnused(active);

  ensureMsaaTargets(w, h);
  const swapView = ctx.getCurrentTexture().createView();
  const msaaView = msaaColorTex.createView();
  const depthView = depthTex.createView();

  function drawTile(pass, c, r) {
    if (!r || r.w < 2 || r.h < 2) return;

    pass.setViewport(r.x, r.y, r.w, r.h, 0, 1);
    pass.setScissorRect(r.x, r.y, r.w, r.h);

    const aspect = r.w / r.h;
    const cam = cameraFor(c, aspect, timeSec);
    const renderer = ensureRenderer(c);
    let state = tileState.get(c.id);
    if (!state) {
      state = { geomReady: false };
      tileState.set(c.id, state);
    }

    const soft = forceSoftAA === null ? !!c.material.softAA : forceSoftAA;
    const mat = { ...c.material, softAA: soft };
    if (mat.linewidth != null && !c.multiWidth) {
      mat.linewidth = (c.material.linewidth ?? 1) * globalWidthScale;
    }
    renderer.setMaterial(mat);
    renderer.setResolution(r.w, r.h);
    renderer.writeCamera({ modelView: cam.view, projection: cam.projection });

    if (c.depth && occluderPipeline) {
      occluderMat.set(cam.view, 0);
      occluderMat.set(cam.projection, 16);
      device.queue.writeBuffer(occluderUniforms, 0, occluderMat);
      pass.setPipeline(occluderPipeline);
      pass.setBindGroup(0, occluderBind);
      pass.setVertexBuffer(0, occluderVerts);
      pass.draw(6);
    }

    if (c.multiWidth) {
      const built = c.build(timeSec);
      encodeMultiWidth(
        renderer,
        built.positions,
        pass,
        c.material.color || [1, 1, 1, 1],
        soft,
      );
      totalSegments += 12;
      return;
    }

    if (c.animateGeometry || !state.geomReady) {
      const built = c.build(timeSec);
      applyGeometry(renderer, built);
      totalSegments += segmentCountOf(built);
      state.geomReady = !c.animateGeometry;
    } else {
      totalSegments += state.lastSegs || 0;
    }
    if (!c.animateGeometry) {
      state.lastSegs = state.lastSegs || segmentCountOf(c.build(0));
    }

    renderer.encode(pass);
  }

  totalSegments = 0;

  // Pass 1: MSAA depth tiles → resolve to swapchain.
  const encoder = device.createCommandEncoder({ label: "line2-visual" });
  const passDepth = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: msaaView,
        resolveTarget: swapView,
        clearValue: { r: 0.06, g: 0.07, b: 0.09, a: 1 },
        loadOp: "clear",
        storeOp: "discard",
      },
    ],
    depthStencilAttachment: {
      view: depthView,
      depthClearValue: 1,
      depthLoadOp: "clear",
      depthStoreOp: "discard",
    },
  });

  for (let i = 0; i < cases.length; i++) {
    if (cases[i].depthFormatNull) continue;
    drawTile(passDepth, cases[i], rects[i]);
  }
  passDepth.end();

  // Pass 2: I01 depthFormat:null (1-sample) on resolved canvas.
  const nullDepthIdx = [];
  for (let i = 0; i < cases.length; i++) {
    if (cases[i].depthFormatNull) nullDepthIdx.push(i);
  }
  if (nullDepthIdx.length > 0) {
    const passColor = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: swapView,
          loadOp: "load",
          storeOp: "store",
        },
      ],
    });
    for (const i of nullDepthIdx) {
      drawTile(passColor, cases[i], rects[i]);
    }
    passColor.end();
  }

  device.queue.submit([encoder.finish()]);

  const kindLabel = ui.kind.value;
  const filterQ = (ui.filter.value || "").trim();
  const filterBit = filterQ ? ` · filter “${filterQ}”` : "";
  const softLabel =
    forceSoftAA === null ? "case" : forceSoftAA ? "on" : "off";
  hudEl.textContent =
    `FPS ${fps.toFixed(1)} · kind ${kindLabel} · tiles ${cases.length}/${ALL_CASES.length}${filterBit} · ` +
    `~segs ${Math.round(totalSegments)} · ${w}×${h} (${dpr.toFixed(2)}×) · MSAA×${MSAA_SAMPLES} · softAA ${softLabel} · width ${globalWidthScale.toFixed(2)}×` +
    (animate ? "" : " · animate off");
}

init().catch((e) => {
  console.error(e);
  setStatus(String(e?.message || e), true);
});
