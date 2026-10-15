/**
 * Trail texture authoring in the model viewer: ribbon styles (the layered jet
 * equations of the thruster texture creator, `thruster-texture.html`) and glow
 * styles (`glow-generator.ts`: a free stack of disc, halo, bloom, rays, streak
 * and ring layers, each with its own size and noise). Both tabs keep a list of
 * named styles (create from a preset, copy, rename, delete); each emitter picks
 * a ribbon style and each glow a glow style. Every change regenerates the
 * image on the CPU (pure generators, as in Node) and uploads it to its layer of
 * a fixed-size GPU texture array that the trail preview samples, so the hull
 * view updates live. Settings persist in localStorage and join the exported JSON.
 */
import { encodePngRgba } from "../thruster-texture/encode-png.js";
import { cloneParams, generateThrusterTexture, paramsForPreset, PRESET_NAMES } from "../thruster-texture/generator.js";
import { generateGlowTexture, GLOW_LAYER_LABELS, GLOW_LAYER_TYPES, GLOW_PRESET_NAMES, glowStyleForPreset, makeGlowLayer, } from "../thruster-texture/glow-generator.js";
import { GLOW_TEXTURE_SIZE as GLOW_SIZE, glowImageName, MAX_GLOW_STYLES, MAX_RIBBON_STYLES, normalizeGlowStyles, normalizeRibbonStyles, RIBBON_TEXTURE_H as RIBBON_H, RIBBON_TEXTURE_W as RIBBON_W, ribbonImageName, ribbonStyleForPreset, } from "../thruster-texture/trail-config.js";
import { dragByHeader } from "./floating-panel.js";
import { createParamForm } from "./param-form.js";
const STORAGE_KEY = "galaxy.model-viewer.trail-textures.v1";
const num = (key, label, min, max, step) => ({ key, label, min, max, step });
const color = { key: "color", label: "Colour", color: true };
const intensity = (max) => num("intensity", "Intensity", 0, max, 0.05);
const jetLayer = (key, label) => ({ key, label, fields: [color, intensity(5),
        num("radialSigma", "Radius σ", 0.01, 1.5, 0.005), num("lengthDecay", "Length decay", 0, 8, 0.05), num("lengthPower", "Tip taper", 0, 6, 0.05),
        num("lengthExtent", "Length", 0.05, 2, 0.01), num("lengthOffset", "Start offset", 0, 0.5, 0.01)] });
const RIBBON_SECTIONS = [
    { key: null, label: "Shape and exposure", open: true, fields: [num("trailWidth", "Width", 0.2, 2.5, 0.01), num("trailLength", "Length", 0.3, 2.5, 0.01),
            num("exposure", "Exposure", 0, 3, 0.01), num("gamma", "Gamma", 0.4, 2.2, 0.01),
            num("edgeFade", "Edge fade", 0, 1, 0.01), num("edgeClearPx", "Clear rows px", 0, 16, 1)] },
    jetLayer("core", "Core"), jetLayer("midGlow", "Mid glow"), jetLayer("outerGlow", "Outer glow"), jetLayer("wash", "Wash (base bloom)"),
    { key: "rings", label: "Distance rings", fields: [color, intensity(5), num("count", "Count", 0, 40, 1), num("thickness", "Thickness", 0.002, 0.2, 0.001),
            num("uStart", "Start", 0, 1, 0.01), num("uEnd", "End", 0, 1, 0.01), num("radialSigma", "Radius σ", 0.02, 1, 0.01)] },
    { key: "shocks", label: "Shock diamonds", fields: [color, intensity(5), num("count", "Count", 0, 20, 1), num("uStart", "Start", 0, 1, 0.01),
            num("spacing", "Spacing", 0.02, 0.5, 0.005), num("halfLength", "Half length", 0.005, 0.2, 0.001), num("radialSigma", "Radius σ", 0.01, 0.5, 0.005)] },
    { key: "noise", label: "Noise / filaments", fields: [num("intensity", "Intensity", 0, 1.5, 0.01), num("freqU", "Frequency along", 1, 64, 0.5),
            num("freqV", "Frequency across", 1, 64, 0.5)] },
];
const LAYER_COMMON = [color, intensity(6), num("size", "Size", 0.01, 1, 0.005)];
const LAYER_NOISE = [num("noise", "Noise", 0, 1, 0.01), num("noiseLobes", "Noise lobes", 2, 64, 1), num("noiseSeed", "Noise seed", 0, 99, 1)];
const thickness = (max) => num("thickness", "Thickness", 0.002, max, 0.001);
const LAYER_FIELDS = {
    disc: [num("softness", "Softness", 0, 1, 0.01)],
    halo: [],
    bloom: [num("falloff", "Falloff", 0.01, 0.5, 0.005)],
    rays: [num("count", "Count", 1, 16, 1), thickness(0.1), num("rotation", "Rotation °", 0, 180, 1), num("jitter", "Length jitter", 0, 1, 0.01),
        num("seed", "Seed", 0, 99, 1)],
    streak: [thickness(0.1), num("rotation", "Angle °", 0, 180, 1)],
    ring: [thickness(0.3)],
};
/** Per-kind facts the shared style bar needs. */
const KIND = {
    ribbon: { max: MAX_RIBBON_STYLES, prefix: "ribbon", label: "Trail", presets: PRESET_NAMES, imageName: ribbonImageName },
    glow: { max: MAX_GLOW_STYLES, prefix: "glow", label: "Glow", presets: GLOW_PRESET_NAMES, imageName: glowImageName },
};
function readStored() {
    let stored = {};
    try {
        stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") ?? {};
    }
    catch { /* defaults */ }
    const ribbonStyles = normalizeRibbonStyles(stored.ribbonStyles, stored.ribbon); // `ribbon`: saved before ribbon styles
    const glowStyles = normalizeGlowStyles(stored.glowStyles);
    const wanted = (stored.selected ?? {});
    const pick = (list, id) => (list.some((s) => s.id === id) ? String(id) : list[0].id);
    return {
        ribbonStyles, glowStyles, tab: stored.tab === "glow" ? "glow" : "ribbon",
        selected: { ribbon: pick(ribbonStyles, wanted.ribbon), glow: pick(glowStyles, wanted.glow ?? stored.glowStyle) },
    };
}
function uniqueStyleId(styles, prefix) {
    let n = styles.length + 1;
    while (styles.some((s) => s.id === `${prefix}-${n}`))
        n++;
    return `${prefix}-${n}`;
}
export function createTrailTextures(device, root) {
    const state = readStored();
    const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST;
    const textures = {
        ribbon: device.createTexture({ label: "viewer-trail-ribbons", size: [RIBBON_W, RIBBON_H, MAX_RIBBON_STYLES], format: "rgba8unorm", usage }),
        glow: device.createTexture({ label: "viewer-trail-glows", size: [GLOW_SIZE, GLOW_SIZE, MAX_GLOW_STYLES], format: "rgba8unorm", usage }),
    };
    const list = (kind) => (kind === "ribbon" ? state.ribbonStyles : state.glowStyles);
    const current = (kind) => list(kind).find((s) => s.id === state.selected[kind]) ?? list(kind)[0];
    const key = (kind, id) => `${kind}:${id}`;
    const images = new Map(); // by key()
    const dirty = new Set();
    const listeners = [];
    let queued = false;
    function regenerate() {
        queued = false;
        for (const kind of ["ribbon", "glow"])
            list(kind).forEach((style, index) => {
                if (!dirty.has(key(kind, style.id)))
                    return;
                const image = kind === "ribbon" ? generateThrusterTexture(style.params) : generateGlowTexture(style);
                images.set(key(kind, style.id), image);
                device.queue.writeTexture({ texture: textures[kind], origin: [0, 0, index] }, image.rgba, { bytesPerRow: image.width * 4 }, [image.width, image.height]);
            });
        dirty.clear();
        ui?.paint();
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        }
        catch { /* private mode */ }
    }
    function changed(kind, id) {
        dirty.add(key(kind, id));
        if (!queued) {
            queued = true;
            requestAnimationFrame(regenerate);
        }
    }
    /** Styles were added, removed or renamed: every layer index may have moved. */
    function stylesChanged(kind) {
        for (const s of list(kind))
            changed(kind, s.id);
        for (const listener of listeners)
            listener();
    }
    for (const kind of ["ribbon", "glow"])
        for (const s of list(kind))
            dirty.add(key(kind, s.id));
    const ui = root ? buildPanel(root) : null;
    regenerate();
    function buildPanel(panel) {
        const el = (tag, className = "", text = "") => Object.assign(document.createElement(tag), className ? { className } : {}, text ? { textContent: text } : {});
        const button = (text, onClick, title = "") => {
            const b = el("button", "", text);
            b.type = "button";
            b.title = title;
            b.addEventListener("click", onClick);
            return b;
        };
        const header = el("header", "tex-header");
        const tabs = ["ribbon", "glow"].map((tab) => button(tab === "ribbon" ? "Ribbon" : "Glow", () => { state.tab = tab; sync(); }));
        header.append(el("strong", "", "Trail textures"), ...tabs, button("×", () => { panel.hidden = true; }, "Hide"));
        const canvas = el("canvas", "tex-preview"), hint = el("p", "tex-hint");
        // Styles of the open tab: pick, create from a preset, copy, delete, rename.
        const styleSelect = el("select");
        styleSelect.addEventListener("change", () => { state.selected[state.tab] = styleSelect.value; sync(); changed(state.tab, styleSelect.value); });
        const addStyle = (style) => {
            const kind = state.tab, styles = list(kind);
            if (styles.length >= KIND[kind].max)
                return;
            styles.push(style);
            state.selected[kind] = style.id;
            stylesChanged(kind);
            sync();
        };
        const freshId = () => uniqueStyleId(list(state.tab), KIND[state.tab].prefix);
        const newStyle = button("New", () => {
            const id = freshId(), name = `${KIND[state.tab].label} ${id.slice(KIND[state.tab].prefix.length + 1)}`;
            addStyle(state.tab === "ribbon" ? ribbonStyleForPreset(preset.value, id, name)
                : glowStyleForPreset(preset.value, id, name, GLOW_SIZE));
        }, "New style from the chosen preset");
        const copyStyle = button("Copy", () => addStyle({ ...structuredClone(current(state.tab)), id: freshId(), name: `${current(state.tab).name} copy` }), "Duplicate this style");
        const deleteStyle = button("Delete", () => {
            const kind = state.tab, styles = list(kind);
            if (styles.length < 2)
                return;
            styles.splice(styles.indexOf(current(kind)), 1);
            state.selected[kind] = styles[0].id;
            stylesChanged(kind);
            sync();
        }, "Delete this style (whatever used it falls back to the first style)");
        const styleBar = el("div", "tex-tools");
        styleBar.append(styleSelect, newStyle, copyStyle, deleteStyle);
        const nameInput = el("input");
        nameInput.type = "text";
        nameInput.placeholder = "Style name";
        nameInput.addEventListener("input", () => {
            current(state.tab).name = nameInput.value;
            styleSelect.selectedOptions[0].text = nameInput.value;
            for (const l of listeners)
                l();
            changed(state.tab, current(state.tab).id);
        });
        const nameRow = el("label", "tex-name", "Name");
        nameRow.append(nameInput);
        const preset = el("select");
        const applyPreset = button("Apply preset", () => {
            if (state.tab === "ribbon") {
                current("ribbon").params = cloneParams(paramsForPreset(preset.value, RIBBON_W, RIBBON_H));
                ribbonForm.refresh();
            }
            else {
                current("glow").layers = glowStyleForPreset(preset.value).layers;
                buildGlowForm();
            }
            changed(state.tab, current(state.tab).id);
        }, "Replace this style's settings with the preset");
        const download = button("Download PNG", () => {
            const style = current(state.tab), image = images.get(key(state.tab, style.id));
            if (!image)
                return;
            const url = URL.createObjectURL(new Blob([encodePngRgba(image).slice()], { type: "image/png" }));
            const a = el("a");
            a.href = url;
            a.download = KIND[state.tab].imageName(style.id); // the names the bake script writes
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        });
        const tools = el("div", "tex-tools");
        tools.append(preset, applyPreset, download);
        const ribbonRoot = el("div", "tex-form"), glowRoot = el("div", "tex-form");
        const ribbonForm = createParamForm(ribbonRoot, RIBBON_SECTIONS, () => current("ribbon").params, () => changed("ribbon", current("ribbon").id));
        const layerType = el("select");
        layerType.append(...GLOW_LAYER_TYPES.map((t) => new Option(GLOW_LAYER_LABELS[t], t)));
        const opened = new WeakSet();
        const addLayer = button("Add layer", () => {
            const style = current("glow"), layer = makeGlowLayer(layerType.value);
            style.layers.push(layer);
            opened.add(layer);
            buildGlowForm();
            changed("glow", style.id);
        });
        const addRow = el("div", "tex-tools");
        addRow.append(layerType, addLayer);
        const glowForm = el("div");
        glowRoot.append(glowForm, addRow);
        const common = el("div");
        common.append(styleBar, nameRow, tools);
        panel.append(header, canvas, hint, common, ribbonRoot, glowRoot);
        dragByHeader(panel, header);
        /** Rebuilt whenever the style or its layer list changes. */
        function buildGlowForm() {
            const style = current("glow");
            glowForm.replaceChildren();
            createParamForm(glowForm, [
                { key: null, label: "Exposure and facing", open: true, fields: [num("exposure", "Exposure", 0, 3, 0.01), num("gamma", "Gamma", 0.4, 2.2, 0.01),
                        num("facing", "Facing aft", 0, 1, 0.01)] },
                ...style.layers.map((layer, i) => ({
                    key: null, label: `${i + 1}. ${GLOW_LAYER_LABELS[layer.type]}`, open: opened.has(layer), object: () => layer,
                    fields: [...LAYER_COMMON, ...LAYER_FIELDS[layer.type], ...LAYER_NOISE],
                    onToggle: (open) => { if (open)
                        opened.add(layer);
                    else
                        opened.delete(layer); },
                    actions: [{ label: "×", title: "Remove layer", onClick: () => { style.layers.splice(i, 1); buildGlowForm(); changed("glow", style.id); } }],
                })),
            ], () => style, () => changed("glow", style.id));
            if (!style.layers.length)
                glowForm.append(el("p", "tex-hint", "No layers: add one below."));
        }
        function sync() {
            const kind = state.tab, ribbon = kind === "ribbon", styles = list(kind);
            tabs.forEach((b, i) => b.setAttribute("aria-pressed", String((i === 0) === ribbon)));
            ribbonRoot.hidden = !ribbon;
            glowRoot.hidden = ribbon;
            const chosen = preset.value; // kept while the tab stays the same
            preset.replaceChildren(...KIND[kind].presets.map((name) => new Option(name, name, false, name === chosen)));
            styleSelect.replaceChildren(...styles.map((s) => new Option(s.name, s.id, false, s.id === current(kind).id)));
            nameInput.value = current(kind).name;
            newStyle.disabled = copyStyle.disabled = styles.length >= KIND[kind].max;
            deleteStyle.disabled = styles.length < 2;
            hint.textContent = ribbon ? "Left = emitter (full strength), right = tail end, stretched over the trail's length. Each emitter picks a style."
                : "Light at the centre; the sprite faces the camera. Each placed glow picks a style.";
            if (ribbon)
                ribbonForm.refresh();
            else
                buildGlowForm();
            paint();
        }
        /** The image over black with alpha ignored: how it looks added onto space. */
        function paint() {
            const image = images.get(key(state.tab, current(state.tab).id));
            if (!image || panel.hidden)
                return;
            const w = canvas.clientWidth || 300, h = state.tab === "ribbon" ? Math.round(w / 4) : Math.min(w, 220);
            const dpr = devicePixelRatio || 1;
            canvas.style.height = `${h}px`;
            canvas.width = Math.round(w * dpr);
            canvas.height = Math.round(h * dpr);
            const flat = new ImageData(image.width, image.height);
            flat.data.set(image.rgba);
            for (let i = 3; i < flat.data.length; i += 4)
                flat.data[i] = 255;
            const source = el("canvas");
            source.width = image.width;
            source.height = image.height;
            source.getContext("2d").putImageData(flat, 0, 0);
            const g = canvas.getContext("2d");
            g.fillStyle = "#000";
            g.fillRect(0, 0, canvas.width, canvas.height);
            const scale = Math.min(canvas.width / image.width, canvas.height / image.height);
            g.drawImage(source, (canvas.width - image.width * scale) / 2, (canvas.height - image.height * scale) / 2, image.width * scale, image.height * scale);
        }
        sync();
        return { paint, sync };
    }
    return {
        ribbons: textures.ribbon,
        glows: textures.glow,
        styles: (kind) => list(kind).map(({ id, name }) => ({ id, name })),
        layer: (kind, id) => Math.max(0, list(kind).findIndex((s) => s.id === id)),
        glowFacing: (id) => (state.glowStyles.find((s) => s.id === id) ?? state.glowStyles[0]).facing,
        currentStyle: (kind) => current(kind).id,
        onStylesChanged(listener) { listeners.push(listener); },
        setVisible(on) { if (root) {
            root.hidden = !on;
            if (on)
                ui?.sync();
        } },
        visible: () => !!root && !root.hidden,
        exportConfig: () => ({ ribbons: state.ribbonStyles, glows: state.glowStyles }),
    };
}
//# sourceMappingURL=trail-textures.js.map