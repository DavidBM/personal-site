/**
 * Engine trail emitters and glows authored in the model viewer, per game class.
 *
 * Positions and sizes live in the catalog's hull space: the hull's bounding
 * radius is 1, +Z forward, +Y up (models/fleet-v2), so one set serves every
 * detail level of a class and the game can scale it with the class draw scale.
 * An emitter starts a ribbon trailing aft; `width` is the ribbon's full width.
 * A glow is one bright camera-facing sprite placed anywhere (typically where a
 * ribbon meets the hull, to hide the join); `size` is its full diameter. Each
 * names the ribbon or glow style it uses (`style`, from `trail-textures.ts`).
 * Click the hull to add the chosen kind, click a marker to select it, drag the
 * gizmo to move it.
 * Everything persists in localStorage and joins the exported JSON.
 */
import { createTrailRenderer } from "./trail-render.js";
const textureKindOf = (kind) => (kind === "emitter" ? "ribbon" : "glow");
const STORAGE = { emitter: "galaxy.model-viewer.trails.v1", glow: "galaxy.model-viewer.glows.v1" };
export const TRAIL_EXPORT_UNIT = "trail emitters and glows per class in catalog hull space (bounding radius 1, +Z forward, +Y up); "
    + "an emitter's width is its ribbon's full width at the emitter and its style a trailTextures.ribbons id, "
    + "a glow's size is the sprite's full diameter and its style a trailTextures.glows id; "
    + "glows draw without depth testing, scaled by the share of their centre visible in the scene depth (tested 0.3 of their radius toward the camera) "
    + "and by their style's facing (aft = -Z)";
const MAX_POINTS = 32;
/** File name of the downloaded export (the same JSON as Export JSON). */
const EXPORT_FILE = "galaxy-hull-config.json";
/** Preview ribbon length in hull radii (the game's length follows speed). */
const PREVIEW_LENGTH = 2.6;
const DEFAULT_SIZE = { emitter: 0.08, glow: 0.16 };
/** Marker sphere radius in hull radii. */
const MARKER_RADIUS = 0.02;
const MARKER_COLOUR = {
    emitter: [1, 0.62, 0.15, 0.95], glow: [0.55, 0.95, 1, 0.95], selected: [1, 0.12, 0.1, 1],
};
const round = (v) => Math.round(v * 1e4) / 1e4;
function readStore(key) {
    try {
        const value = JSON.parse(localStorage.getItem(key) ?? "{}");
        return value && typeof value === "object" ? value : {};
    }
    catch {
        return {};
    }
}
export function createTrailEditor(device, format, panel, exportJson, textures) {
    const stores = { emitter: readStore(STORAGE.emitter), glow: readStore(STORAGE.glow) };
    for (const p of Object.values(stores.emitter).flat())
        delete p.particles; // retired field
    let classKey = null, scale = 1, lengthMesh = 2, lengthM = 20;
    let selected = null, addKind = "emitter";
    const show = { glows: true, markers: true };
    const nextSize = { ...DEFAULT_SIZE };
    const items = (kind) => { var _a; return (classKey ? ((_a = stores[kind])[classKey] ?? (_a[classKey] = [])) : []); };
    const save = () => {
        try {
            for (const kind of ["emitter", "glow"])
                localStorage.setItem(STORAGE[kind], JSON.stringify(stores[kind]));
        }
        catch { /* private mode */ }
    };
    const sizeKey = (kind) => (kind === "emitter" ? "width" : "size");
    const world = (p) => ({ x: p.at[0] * scale, y: p.at[1] * scale, z: p.at[2] * scale });
    const selectedItem = () => (selected ? items(selected.kind)[selected.index] : undefined);
    const renderer = createTrailRenderer(device, format, MAX_POINTS, textures);
    textures.onStylesChanged(() => render());
    // --- HUD panel
    const note = document.createElement("p");
    note.className = "trail-note";
    const modeBar = document.createElement("div");
    modeBar.className = "trail-mode";
    const modeButtons = ["emitter", "glow"].map((kind) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = kind === "emitter" ? "Trail emitter" : "Glow";
        b.addEventListener("click", () => { addKind = kind; render(); });
        return b;
    });
    modeBar.append("Click adds:", ...modeButtons);
    const lists = { emitter: document.createElement("div"), glow: document.createElement("div") };
    for (const l of Object.values(lists))
        l.className = "trail-list";
    const heading = (text) => { const h = document.createElement("h2"); h.className = "trail-heading"; h.textContent = text; return h; };
    const buttons = document.createElement("div");
    buttons.className = "trail-buttons";
    const button = (label, onClick) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        b.addEventListener("click", onClick);
        buttons.append(b);
        return b;
    };
    const exportBox = document.createElement("textarea");
    exportBox.className = "trail-export";
    exportBox.readOnly = true;
    exportBox.hidden = true;
    button("Clear class", () => { if (classKey) {
        stores.emitter[classKey] = [];
        stores.glow[classKey] = [];
        selected = null;
        save();
        render();
    } });
    button("Textures…", () => textures.setVisible(!textures.visible()));
    button("Export JSON", () => {
        const json = exportJson();
        exportBox.value = json;
        exportBox.hidden = false;
        exportBox.select();
        void navigator.clipboard?.writeText(json).then(() => { note.textContent = "Copied all classes (LOD ranges, trails, glows, textures) to the clipboard."; }, () => { });
    });
    button("Download JSON", () => {
        const url = URL.createObjectURL(new Blob([exportJson()], { type: "application/json" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = EXPORT_FILE;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        note.textContent = `Saved ${EXPORT_FILE}: LOD ranges, trails, glows and texture settings for every class.`;
    });
    const toggles = document.createElement("div");
    toggles.className = "trail-toggles";
    for (const key of ["glows", "markers"]) {
        const label = document.createElement("label");
        label.className = "trail-toggle";
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = true;
        box.addEventListener("change", () => { show[key] = box.checked; });
        label.append(box, key === "glows" ? "Glows" : "Markers");
        toggles.append(label);
    }
    panel?.append(note, modeBar, heading("Emitters"), lists.emitter, heading("Glows"), lists.glow, buttons, toggles, exportBox);
    const metres = (w) => (w * lengthM / Math.max(lengthMesh, 1e-6));
    function sizeField(kind, p) {
        const key = sizeKey(kind), value = p[key] ?? DEFAULT_SIZE[kind];
        const name = document.createElement("span");
        name.textContent = key;
        const input = document.createElement("input");
        input.type = "number";
        input.min = "0.001";
        input.step = "0.005";
        input.value = String(value);
        input.title = kind === "emitter" ? "Ribbon width in hull radii" : "Glow diameter in hull radii";
        const m = document.createElement("span");
        m.className = "trail-m";
        m.textContent = `≈${metres(value).toFixed(1)} m`;
        input.addEventListener("change", () => {
            const v = Number(input.value);
            if (Number.isFinite(v) && v > 0) {
                p[key] = nextSize[kind] = round(v);
                save();
            }
            render();
        });
        return [name, input, m];
    }
    /** Which ribbon or glow style an emitter or glow uses. */
    function styleField(kind, p) {
        const textureKind = textureKindOf(kind), select = document.createElement("select");
        select.title = `${kind === "emitter" ? "Ribbon" : "Glow"} style (edit styles under Textures…)`;
        const styles = textures.styles(textureKind), current = styles[textures.layer(textureKind, p.style)]?.id;
        select.append(...styles.map((s) => new Option(s.name, s.id, false, s.id === current)));
        select.addEventListener("change", () => { p.style = select.value; save(); });
        return select;
    }
    function rowFor(kind, p, index) {
        const row = document.createElement("div");
        row.className = "trail-row";
        row.setAttribute("aria-selected", String(selected?.kind === kind && selected.index === index));
        const label = document.createElement("span");
        label.className = "trail-at";
        label.textContent = `${index + 1}: ${p.at.map((v) => v.toFixed(3)).join(", ")}`;
        const del = document.createElement("button");
        del.type = "button";
        del.textContent = "×";
        del.title = "Remove";
        del.addEventListener("click", (e) => {
            e.stopPropagation();
            items(kind).splice(index, 1);
            if (selected?.kind === kind)
                selected = index === selected.index ? null : { kind, index: selected.index - (index < selected.index ? 1 : 0) };
            save();
            render();
        });
        const sizes = document.createElement("div");
        sizes.className = "trail-sizes";
        sizes.append(...sizeField(kind, p));
        sizes.append(styleField(kind, p));
        row.addEventListener("click", (e) => { if (!e.target.closest("input, button")) {
            selected = { kind, index };
            render();
        } });
        row.append(label, del, sizes);
        return row;
    }
    function render() {
        if (!panel)
            return;
        panel.hidden = !classKey;
        if (!classKey)
            return;
        note.textContent = "Click the hull to add the chosen kind; click a marker to select it; drag the arrows to move it.";
        modeButtons.forEach((b, i) => b.setAttribute("aria-pressed", String((i === 0) === (addKind === "emitter"))));
        for (const kind of ["emitter", "glow"]) {
            const rows = items(kind).map((p, index) => rowFor(kind, p, index));
            lists[kind].replaceChildren(...(rows.length ? rows : [Object.assign(document.createElement("p"), { className: "trail-empty", textContent: "None yet." })]));
        }
    }
    function markers() {
        if (!show.markers)
            return [];
        return ["emitter", "glow"].flatMap((kind) => items(kind).map((p, index) => ({
            at: world(p), radius: MARKER_RADIUS * scale,
            colour: selected?.kind === kind && selected.index === index ? MARKER_COLOUR.selected : MARKER_COLOUR[kind],
        })));
    }
    return {
        setTarget(key, modelScale, hullLengthMesh, shipLengthM) {
            if (key !== classKey)
                selected = null;
            classKey = key;
            scale = modelScale;
            lengthMesh = hullLengthMesh;
            lengthM = shipLengthM;
            render();
        },
        active: () => classKey !== null,
        selectedWorld: () => { const p = selectedItem(); return p ? world(p) : null; },
        pick(cssX, cssY, viewProj, cssW, cssH) {
            let best = null, bestD = 12;
            const m = viewProj;
            for (const kind of ["emitter", "glow"])
                items(kind).forEach((p, index) => {
                    if (selected?.kind === kind && selected.index === index)
                        return; // its arrows start here; dragging them wins
                    const c = world(p);
                    const x = m[0] * c.x + m[4] * c.y + m[8] * c.z + m[12], y = m[1] * c.x + m[5] * c.y + m[9] * c.z + m[13];
                    const w = m[3] * c.x + m[7] * c.y + m[11] * c.z + m[15];
                    if (w <= 0)
                        return;
                    const d = Math.hypot((x / w + 1) / 2 * cssW - cssX, (1 - y / w) / 2 * cssH - cssY);
                    if (d < bestD) {
                        bestD = d;
                        best = { kind, index };
                    }
                });
            if (!best)
                return false;
            selected = best;
            render();
            return true;
        },
        addAt(p) {
            const list = items(addKind);
            if (!classKey || list.length >= MAX_POINTS)
                return;
            list.push({ at: [round(p.x / scale), round(p.y / scale), round(p.z / scale)], [sizeKey(addKind)]: nextSize[addKind],
                style: textures.currentStyle(textureKindOf(addKind)) });
            selected = { kind: addKind, index: list.length - 1 };
            save();
            render();
        },
        moveSelected(d) {
            const p = selectedItem();
            if (!p)
                return;
            p.at = [round(p.at[0] + d.x / scale), round(p.at[1] + d.y / scale), round(p.at[2] + d.z / scale)];
            save();
            render();
        },
        drawRibbons(pass, viewProj, eye) {
            if (!classKey)
                return;
            const ribbons = items("emitter").map((p) => ({ at: world(p), width: (p.width ?? DEFAULT_SIZE.emitter) * scale, layer: textures.layer("ribbon", p.style) }));
            renderer.drawRibbons(pass, viewProj, { x: eye.eyeX, y: eye.eyeY, z: eye.eyeZ }, ribbons, PREVIEW_LENGTH * scale);
        },
        drawOverlay(pass, viewProj, eye, depth) {
            if (!classKey)
                return;
            const glows = show.glows ? items("glow").map((p) => ({
                at: world(p), size: (p.size ?? DEFAULT_SIZE.glow) * scale, layer: textures.layer("glow", p.style), facing: textures.glowFacing(p.style),
            })) : [];
            renderer.drawOverlay(pass, viewProj, { x: eye.eyeX, y: eye.eyeY, z: eye.eyeZ }, depth, glows, markers());
        },
        exportTrails: () => {
            // What is drawn: a missing or deleted style is exported as the style used in its place.
            const resolved = (kind, p) => ({ at: p.at, [sizeKey(kind)]: p[sizeKey(kind)] ?? DEFAULT_SIZE[kind],
                style: textures.styles(textureKindOf(kind))[textures.layer(textureKindOf(kind), p.style)].id });
            const perClass = (kind) => Object.fromEntries(Object.entries(stores[kind]).filter(([, list]) => list.length)
                .map(([key, list]) => [key, list.map((p) => resolved(kind, p))]));
            return { trails: perClass("emitter"), glows: perClass("glow") };
        },
    };
}
//# sourceMappingURL=trail-editor.js.map