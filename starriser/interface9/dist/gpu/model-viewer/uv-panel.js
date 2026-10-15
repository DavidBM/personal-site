/**
 * UV map panel for the model viewer: one of the mesh's textures (or a checker)
 * in UV space with every triangle edge drawn on top, so seams, island packing
 * and texel use can be judged next to the 3D view. Canvas 2D; the edge path is
 * built once per mesh and redrawn on pan/zoom. glTF UV (0, 0) is the image's
 * top-left pixel, so u, v map to image x, y directly.
 */
import { dragByHeader } from "./floating-panel.js";
export const UV_TEXTURE_LABELS = {
    base: "Colour", normal: "Normal", metalRough: "Metal / rough", checker: "Checker",
};
/** Above this many triangles the wireframe is skipped (the texture still shows). */
const MAX_WIRE_TRIANGLES = 600000;
const UV_STRIDE = 8, U_OFFSET = 6;
/**
 * UV area in use (sum of triangle areas; overlaps count twice), triangles
 * leaving [0,1], and mirrored triangles (the minority UV winding).
 */
export function uvStats(mesh) {
    const { interleaved: v, indices } = mesh;
    let area = 0, outside = 0, positive = 0;
    const triangles = Math.floor(indices.length / 3);
    for (let t = 0; t < triangles; t++) {
        const a = indices[t * 3] * UV_STRIDE + U_OFFSET, b = indices[t * 3 + 1] * UV_STRIDE + U_OFFSET, c = indices[t * 3 + 2] * UV_STRIDE + U_OFFSET;
        const signed = ((v[b] - v[a]) * (v[c + 1] - v[a + 1]) - (v[c] - v[a]) * (v[b + 1] - v[a + 1])) / 2;
        area += Math.abs(signed);
        if (signed > 0)
            positive++;
        for (const i of [a, b, c]) {
            if (v[i] < 0 || v[i] > 1 || v[i + 1] < 0 || v[i + 1] > 1) {
                outside++;
                break;
            }
        }
    }
    return { triangles, areaUsed: area, outside, mirrored: Math.min(positive, triangles - positive) };
}
/** Unique triangle edges as one path in UV units. */
function edgePath(mesh) {
    const { interleaved: v, indices } = mesh;
    const triangles = Math.floor(indices.length / 3);
    if (triangles > MAX_WIRE_TRIANGLES)
        return null;
    const path = new Path2D(), seen = new Set(), n = mesh.vertexCount;
    for (let t = 0; t < triangles; t++) {
        for (let k = 0; k < 3; k++) {
            const a = indices[t * 3 + k], b = indices[t * 3 + ((k + 1) % 3)];
            const key = Math.min(a, b) * n + Math.max(a, b);
            if (seen.has(key))
                continue;
            seen.add(key);
            path.moveTo(v[a * UV_STRIDE + U_OFFSET], v[a * UV_STRIDE + U_OFFSET + 1]);
            path.lineTo(v[b * UV_STRIDE + U_OFFSET], v[b * UV_STRIDE + U_OFFSET + 1]);
        }
    }
    return path;
}
function imageIndex(mesh, texture) {
    return texture === "base" ? mesh.baseColorImage : texture === "normal" ? mesh.normalImage
        : texture === "metalRough" ? mesh.diffuseSpecularImage : -1;
}
async function decodeBitmap(source) {
    try {
        return await createImageBitmap(new Blob([source.data.slice()], { type: source.mimeType || "image/png" }));
    }
    catch {
        return null;
    }
}
function closeBitmap(image) {
    if (image instanceof ImageBitmap)
        image.close();
}
function checker() {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d");
    for (let y = 0; y < 16; y++)
        for (let x = 0; x < 16; x++) {
            g.fillStyle = (x + y) % 2 ? "#cfd8e3" : "#9fb0c4";
            g.fillRect(x * 16, y * 16, 16, 16);
        }
    return c;
}
export function createUvPanel(root, onClose) {
    const title = document.createElement("strong");
    title.className = "uv-title";
    const stats = document.createElement("span");
    stats.className = "uv-stats";
    const fit = document.createElement("button");
    fit.type = "button";
    fit.textContent = "Fit";
    fit.title = "Show the whole 0–1 UV square";
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "×";
    close.title = "Hide the UV map";
    const header = document.createElement("header");
    header.className = "uv-header";
    header.append(title, fit, close);
    const canvas = document.createElement("canvas");
    canvas.className = "uv-canvas";
    const note = document.createElement("p");
    note.className = "uv-note";
    root.append(header, stats, canvas, note);
    let mesh = null, path = null, texture = "base";
    let image = null, imageKey = "";
    let view = { x: 0, y: 0, scale: 1 }; // UV origin in CSS px and CSS px per UV unit
    let drag = null;
    let decodeGen = 0, drawQueued = false;
    const checkerImage = checker();
    function fitView() {
        const w = canvas.clientWidth, h = canvas.clientHeight, size = Math.max(16, Math.min(w, h) - 16);
        view = { x: (w - size) / 2, y: (h - size) / 2, scale: size };
        draw();
    }
    /** What to show for the current mesh and texture: image bytes to decode, or a ready fallback. */
    function wanted() {
        const index = mesh ? imageIndex(mesh, texture) : -1;
        const source = index >= 0 ? mesh.images[index] : undefined;
        return { key: `${index}|${texture}`, bytes: source?.data.length ? source : undefined,
            fallback: texture === "checker" || !mesh ? checkerImage : null };
    }
    async function loadImage() {
        const next = wanted();
        if (next.key === imageKey && image)
            return;
        imageKey = next.key;
        const gen = ++decodeGen;
        const decoded = next.bytes ? await decodeBitmap(next.bytes) : next.fallback;
        if (gen !== decodeGen) {
            closeBitmap(decoded);
            return;
        }
        if (image !== decoded)
            closeBitmap(image);
        image = decoded;
        draw();
    }
    function draw() {
        if (drawQueued)
            return;
        drawQueued = true;
        requestAnimationFrame(() => { drawQueued = false; paint(); });
    }
    function paint() {
        const dpr = devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
        if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
            canvas.width = Math.round(w * dpr);
            canvas.height = Math.round(h * dpr);
        }
        const g = canvas.getContext("2d");
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.fillStyle = "#070d18";
        g.fillRect(0, 0, canvas.width, canvas.height);
        if (!mesh)
            return;
        g.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.x, dpr * view.y);
        g.imageSmoothingEnabled = view.scale < 2048;
        if (image)
            g.drawImage(image, 0, 0, 1, 1);
        else {
            g.fillStyle = "#1a2433";
            g.fillRect(0, 0, 1, 1);
        }
        g.lineWidth = 1 / view.scale;
        g.strokeStyle = "rgba(255, 214, 102, 0.9)";
        g.strokeRect(0, 0, 1, 1);
        if (path) {
            g.strokeStyle = texture === "checker" || !image ? "rgba(10, 20, 40, 0.75)" : "rgba(80, 230, 255, 0.55)";
            g.stroke(path);
        }
    }
    canvas.addEventListener("wheel", (e) => {
        e.preventDefault();
        const r = canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
        const factor = Math.exp(-e.deltaY * 0.0015), scale = Math.min(Math.max(view.scale * factor, 8), 200000);
        view = { x: px - (px - view.x) * (scale / view.scale), y: py - (py - view.y) * (scale / view.scale), scale };
        draw();
    }, { passive: false });
    canvas.addEventListener("pointerdown", (e) => {
        canvas.setPointerCapture(e.pointerId);
        drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    });
    canvas.addEventListener("pointermove", (e) => {
        if (!drag)
            return;
        view = { ...view, x: drag.vx + e.clientX - drag.x, y: drag.vy + e.clientY - drag.y };
        draw();
    });
    const release = () => { drag = null; };
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);
    fit.addEventListener("click", fitView);
    close.addEventListener("click", onClose);
    dragByHeader(root, header); // resize from the corner
    new ResizeObserver(() => draw()).observe(canvas);
    return {
        setMesh(next, label) {
            if (next === mesh)
                return;
            mesh = next;
            path = next ? edgePath(next) : null;
            imageKey = "";
            title.textContent = next ? `UV map · ${label}` : "UV map";
            if (next) {
                const s = uvStats(next);
                stats.textContent = `${s.triangles.toLocaleString()} tris · UV area used ${(s.areaUsed * 100).toFixed(0)}%`
                    + ` · ${s.mirrored.toLocaleString()} mirrored · ${s.outside.toLocaleString()} outside 0–1`;
            }
            else
                stats.textContent = "";
            note.textContent = next && !path ? "Too many triangles to draw the wireframe; showing the texture only." : "";
            void loadImage();
            if (!root.hidden)
                fitView();
        },
        setTexture(next) { texture = next; imageKey = ""; void loadImage(); },
        setVisible(on) { root.hidden = !on; if (on) {
            fitView();
            void loadImage();
        } },
    };
}
//# sourceMappingURL=uv-panel.js.map