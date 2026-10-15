/**
 * LOD timeline for the model viewer: like a video timeline, but the axis is the
 * hull's projected size in render pixels (log scale). One lane per detail level
 * holds that level's [min, max) range; drag its ends to resize it, its body to
 * move it, or type exact values. Ranges may overlap (a ship keeps its current
 * level inside an overlap). The marker is the current on-screen size; dragging
 * it, or clicking the axis, zooms the camera to that size. Two strips show what
 * the game would draw while zooming out and while zooming in, so overlaps and
 * gaps are visible. Wheel zooms the axis, dragging empty track pans it.
 */
import { HULL_LEVELS, selectHullLevel, } from "../../lib/fleet-sim/visual/hull-lod.js";
export const LOD_LEVEL_NAMES = { full: "Full", mid: "Mid", low: "Low", dart: "Dart", point: "Point" };
const AXIS_MIN = 0.1, AXIS_MAX = 4000;
const SWEEP_SAMPLES = 320;
function el(tag, className = "", text) {
    const node = document.createElement(tag);
    if (className)
        node.className = className;
    if (text != null)
        node.textContent = text;
    return node;
}
/** Steps that keep typed and dragged values readable. */
function snap(px) {
    const step = px < 1 ? 0.05 : px < 10 ? 0.1 : px < 100 ? 1 : 5;
    return Number((Math.round(px / step) * step).toFixed(2));
}
export function formatPx(px) {
    if (!Number.isFinite(px))
        return "∞";
    if (px === 0)
        return "0";
    return px < 10 ? String(+px.toFixed(2)) : String(Math.round(px));
}
function parsePx(text) {
    const t = text.trim();
    if (t === "" || t === "∞" || /^inf/i.test(t))
        return Infinity;
    const v = Number(t);
    return Number.isFinite(v) && v >= 0 ? v : null;
}
/** Level drawn at each sample while sweeping the size down (zoom out) or up (zoom in). */
function sweep(bands, samples, descending) {
    const order = descending ? [...samples].reverse() : samples;
    let level = null;
    const out = order.map((px) => (level = selectHullLevel(px, level, bands)));
    return descending ? out.reverse() : out;
}
export function createLodTimeline(root, tuning, scrub, exportJson = () => tuning.exportJson()) {
    let classKey = null;
    let px = 0, currentLevel = null;
    let lo = Math.log10(0.4), hi = Math.log10(400);
    let drag = null;
    const title = el("strong", "tl-title");
    const editedTag = el("span", "tl-edited", "edited");
    const button = (label, hint, onClick) => {
        const b = el("button", "tl-button", label);
        b.type = "button";
        b.title = hint;
        b.addEventListener("click", onClick);
        return b;
    };
    const exportBox = el("div", "tl-export");
    const exportText = el("textarea", "");
    exportText.readOnly = true;
    exportText.spellcheck = false;
    const exportNote = el("span", "tl-export-note");
    exportBox.append(exportNote, button("Close", "Hide the export", () => { exportBox.hidden = true; }), exportText);
    exportBox.hidden = true;
    const header = el("header", "tl-header");
    header.append(title, editedTag, el("span", "tl-spacer"), button("−", "Show a wider pixel range", () => zoomAxis(1 / 0.6, 0.5)), button("+", "Show a narrower pixel range around the marker", () => zoomAxis(0.6, frac(px))), button("Fit", "Show every range edge", fit), button("Reset class", "Back to the catalog ranges", () => classKey && tuning.reset(classKey)), button("Use for all classes", "Copy these ranges to every class", () => classKey && tuning.applyToAll(classKey)), button("Export JSON", "Copy all classes as JSON", exportAll));
    const grid = el("div", "tl-grid");
    const overlay = el("div", "tl-overlay");
    const marker = el("div", "tl-marker");
    const markerLabel = el("span", "tl-marker-label");
    marker.append(markerLabel);
    overlay.append(marker);
    const hint = el("p", "tl-hint", "LOD tuning applies to the new-ship classes. Pick one on the left.");
    const lanes = HULL_LEVELS.map((level) => {
        const label = el("div", `tl-label lvl-${level}`, LOD_LEVEL_NAMES[level]);
        const tris = el("small", "");
        label.append(tris);
        const track = el("div", "tl-track");
        const bar = el("div", `tl-bar lvl-${level}`);
        const text = el("span", "tl-bar-text");
        const minHandle = el("span", "tl-handle min"), maxHandle = el("span", "tl-handle max");
        bar.append(minHandle, text, maxHandle);
        track.append(bar);
        const inputs = el("div", "tl-inputs");
        const min = el("input", ""), max = el("input", "");
        for (const [input, edge] of [[min, "min"], [max, "max"]]) {
            input.inputMode = "decimal";
            input.size = 5;
            input.title = edge === "min" ? "From px (inclusive)" : "To px (exclusive, empty = no limit)";
            input.addEventListener("change", () => typed(level, edge, input));
        }
        inputs.append(min, el("span", "", "–"), max, el("span", "tl-unit", "px"));
        grid.append(label, track, inputs);
        bar.addEventListener("pointerdown", (e) => {
            if (!classKey)
                return;
            const kind = e.target === minHandle ? "min" : e.target === maxHandle ? "max" : "body";
            begin(e, { kind, level, startPx: pxAt(e.clientX), start: tuning.bands(classKey)[level] });
        });
        return { level, label, tris, track, bar, text, min, max };
    });
    const sweepRows = ["out", "in"].map((direction) => {
        const label = el("div", "tl-label tl-sweep-label", direction === "out" ? "Zooming out" : "Zooming in");
        const track = el("div", "tl-track tl-sweep");
        grid.append(label, track, el("div", ""));
        return { direction, track };
    });
    const axisLabel = el("div", "tl-label tl-axis-label", "Screen size");
    const axis = el("div", "tl-track tl-axis");
    grid.append(axisLabel, axis, el("div", ""), overlay);
    root.append(header, grid, hint, exportBox);
    function frac(value) {
        return (Math.log10(Math.max(value, AXIS_MIN)) - lo) / (hi - lo);
    }
    function pxAt(clientX) {
        const r = axis.getBoundingClientRect();
        const f = (clientX - r.left) / Math.max(r.width, 1);
        return 10 ** (lo + f * (hi - lo));
    }
    function trackFrac(clientX) {
        const r = axis.getBoundingClientRect();
        return (clientX - r.left) / Math.max(r.width, 1);
    }
    function setRange(nextLo, nextHi) {
        const span = Math.min(Math.max(nextHi - nextLo, 0.3), Math.log10(AXIS_MAX / AXIS_MIN));
        let a = nextLo;
        a = Math.min(Math.max(a, Math.log10(AXIS_MIN)), Math.log10(AXIS_MAX) - span);
        lo = a;
        hi = a + span;
        render();
    }
    function zoomAxis(factor, around) {
        const f = Math.min(Math.max(around, 0), 1), centre = lo + f * (hi - lo), span = (hi - lo) * factor;
        setRange(centre - f * span, centre - f * span + span);
    }
    function fit() {
        if (!classKey)
            return;
        const edges = HULL_LEVELS.flatMap((l) => tuning.bands(classKey)[l]).filter((v) => v > 0 && Number.isFinite(v));
        if (px > 0)
            edges.push(px);
        setRange(Math.log10(Math.min(...edges) / 1.6), Math.log10(Math.max(...edges) * 1.6));
    }
    function typed(level, edge, input) {
        if (!classKey)
            return;
        const value = parsePx(input.value);
        const [min, max] = tuning.bands(classKey)[level];
        if (value === null || (edge === "min" && !(value < max)) || (edge === "max" && !(value > min))) {
            render();
            return;
        }
        tuning.set(classKey, level, edge === "min" ? [value, max] : [min, value]);
    }
    /** Range end below the axis start snaps to 0, past its end to no limit; a moved body keeps open ends open. */
    function draggedBand(drag, clientX) {
        const at = pxAt(clientX), [min, max] = drag.start;
        if (drag.kind === "min")
            return [Math.min(at < AXIS_MIN * 1.25 ? 0 : snap(at), max / 1.02), max];
        if (drag.kind === "max")
            return [min, Math.max(trackFrac(clientX) > 1.01 ? Infinity : snap(at), min * 1.02, min + 0.05)];
        const factor = at / drag.startPx;
        const band = [min === 0 ? 0 : snap(min * factor), Number.isFinite(max) ? snap(max * factor) : Infinity];
        return band[0] < band[1] ? band : null;
    }
    function begin(e, next) {
        e.preventDefault();
        e.stopPropagation();
        drag = next;
        root.setPointerCapture(e.pointerId);
        root.classList.add("dragging");
        if (next.kind === "marker")
            scrub(pxAt(e.clientX));
    }
    root.addEventListener("pointermove", (e) => {
        if (!drag)
            return;
        if (drag.kind === "marker") {
            scrub(pxAt(e.clientX));
            return;
        }
        if (drag.kind === "pan") {
            const r = axis.getBoundingClientRect(), shift = ((e.clientX - drag.startX) / Math.max(r.width, 1)) * (drag.hi - drag.lo);
            setRange(drag.lo - shift, drag.hi - shift);
            return;
        }
        const band = draggedBand(drag, e.clientX);
        if (classKey && band)
            tuning.set(classKey, drag.level, band);
    });
    const end = (e) => {
        if (!drag)
            return;
        drag = null;
        root.classList.remove("dragging");
        if (root.hasPointerCapture(e.pointerId))
            root.releasePointerCapture(e.pointerId);
    };
    root.addEventListener("pointerup", end);
    root.addEventListener("pointercancel", end);
    marker.addEventListener("pointerdown", (e) => begin(e, { kind: "marker" }));
    axis.addEventListener("pointerdown", (e) => begin(e, { kind: "marker" }));
    for (const target of [...lanes.map((l) => l.track), ...sweepRows.map((r) => r.track)]) {
        target.addEventListener("pointerdown", (e) => {
            if (e.target === target)
                begin(e, { kind: "pan", startX: e.clientX, lo, hi });
        });
    }
    grid.addEventListener("wheel", (e) => {
        e.preventDefault();
        zoomAxis(Math.exp(e.deltaY * 0.0015), trackFrac(e.clientX));
    }, { passive: false });
    function exportAll() {
        const json = exportJson();
        exportText.value = json;
        exportBox.hidden = false;
        exportText.focus();
        exportText.select();
        exportNote.textContent = "Select-all and copy, or paste from the clipboard.";
        void navigator.clipboard?.writeText(json).then(() => { exportNote.textContent = "Copied to the clipboard. Paste it to Claude."; }, () => { });
    }
    function placeBar(bar, band) {
        const left = band[0] <= 0 ? -0.02 : frac(band[0]), right = Number.isFinite(band[1]) ? frac(band[1]) : 1.02;
        const a = Math.max(left, -0.02), b = Math.min(right, 1.02);
        bar.hidden = b <= -0.02 || a >= 1.02 || b <= a;
        bar.style.left = `${a * 100}%`;
        bar.style.width = `${(b - a) * 100}%`;
        bar.classList.toggle("open-left", band[0] <= 0);
        bar.classList.toggle("open-right", !Number.isFinite(band[1]));
    }
    function renderSweeps(bands) {
        const samples = Array.from({ length: SWEEP_SAMPLES }, (_, i) => 10 ** (lo + ((i + 0.5) / SWEEP_SAMPLES) * (hi - lo)));
        const covered = (value) => HULL_LEVELS.some((l) => value >= bands[l][0] && value < bands[l][1]);
        for (const row of sweepRows) {
            const levels = sweep(bands, samples, row.direction === "out");
            const parts = [];
            let start = 0;
            for (let i = 1; i <= samples.length; i++) {
                if (i < samples.length && levels[i] === levels[start] && covered(samples[i]) === covered(samples[start]))
                    continue;
                const segment = el("span", `tl-segment lvl-${levels[start]}${covered(samples[start]) ? "" : " gap"}`);
                segment.style.left = `${(start / samples.length) * 100}%`;
                segment.style.width = `${((i - start) / samples.length) * 100}%`;
                if ((i - start) / samples.length > 0.04)
                    segment.textContent = LOD_LEVEL_NAMES[levels[start]];
                parts.push(segment);
                start = i;
            }
            row.track.replaceChildren(...parts);
        }
    }
    function renderAxis() {
        const ticks = [];
        for (let decade = Math.floor(lo) - 1; decade <= Math.ceil(hi); decade++) {
            for (const m of [1, 2, 5]) {
                const value = m * 10 ** decade, f = frac(value);
                if (f < -0.001 || f > 1.001)
                    continue;
                const tick = el("span", `tl-tick${m === 1 ? " major" : ""}`, formatPx(value));
                tick.style.left = `${f * 100}%`;
                ticks.push(tick);
            }
        }
        axis.replaceChildren(...ticks);
    }
    function renderMarker() {
        // Outside the visible range the marker waits at the nearer edge; drag it back in to zoom.
        const f = frac(px), outside = f < 0 || f > 1;
        marker.hidden = !(px > 0);
        marker.classList.toggle("outside", outside);
        marker.style.left = `${Math.min(Math.max(f, 0), 1) * 100}%`;
        const arrow = f < 0 ? "◀ " : f > 1 ? " ▶" : "";
        const text = `${formatPx(px)} px${currentLevel ? ` · ${LOD_LEVEL_NAMES[currentLevel]}` : ""}`;
        markerLabel.textContent = f < 0 ? arrow + text : text + arrow;
        for (const lane of lanes)
            lane.label.classList.toggle("active", lane.level === currentLevel);
    }
    function render() {
        grid.hidden = !classKey;
        hint.hidden = !!classKey;
        editedTag.hidden = !classKey || !tuning.edited(classKey);
        if (!classKey)
            return;
        const bands = tuning.bands(classKey);
        for (const lane of lanes) {
            const band = bands[lane.level];
            placeBar(lane.bar, band);
            lane.text.textContent = `${formatPx(band[0])} – ${formatPx(band[1])} px`;
            for (const [input, value] of [[lane.min, band[0]], [lane.max, band[1]]]) {
                if (document.activeElement !== input)
                    input.value = Number.isFinite(value) ? formatPx(value) : "";
            }
            lane.max.placeholder = "∞";
        }
        renderSweeps(bands);
        renderAxis();
        renderMarker();
    }
    tuning.subscribe(render);
    return {
        setClass(shipClass, triangles = {}) {
            classKey = shipClass && tuning.classes.includes(shipClass.key) ? shipClass.key : null;
            title.textContent = shipClass ? `LOD ranges · ${shipClass.name}` : "LOD ranges";
            for (const lane of lanes)
                lane.tris.textContent = triangles[lane.level] ? ` ${triangles[lane.level]}` : "";
            render();
        },
        setPixels(next, level) {
            const rounded = Number(next.toPrecision(3));
            if (rounded === px && level === currentLevel)
                return;
            px = rounded;
            currentLevel = level;
            renderMarker();
        },
        setVisible(on) { root.hidden = !on; if (on)
            render(); },
    };
}
//# sourceMappingURL=lod-timeline.js.map