const CHART_W = 220;
const CHART_H = 52;
const CHART_N = 90;
const SCALE_W = 34;
/** Count worker frames, not the rate at which the DOM receives observations. */
export function createRenderFrameRateSample() {
    let frame = -1;
    let started = 0;
    return (nextFrame, now) => {
        if (frame < 0 || nextFrame < frame) {
            frame = nextFrame;
            started = now;
            return null;
        }
        const elapsed = now - started;
        if (elapsed < 1000)
            return null;
        const fps = (nextFrame - frame) * 1000 / elapsed;
        frame = nextFrame;
        started = now;
        return fps;
    };
}
export function createRenderPerformancePanel(container) {
    const element = document.createElement("div");
    element.className = "ui-render-performance";
    Object.assign(element.style, {
        display: "flex", flexDirection: "column", gap: "8px",
        font: "11px monospace", padding: "6px 0", color: "#8eddea",
    });
    const draw = document.createElement("div");
    draw.style.color = "#7aa0b8";
    draw.textContent = "";
    const fpsPane = makePane("FPS", "#7ee0a3");
    const cpuPane = makePane("Render CPU", "#8eddea");
    const gpuPane = makePane("GPU", "#e0b07e");
    element.append(fpsPane.wrap, cpuPane.wrap, gpuPane.wrap, draw);
    container.prepend(element);
    const sample = createRenderFrameRateSample();
    const fpsHist = new Float32Array(CHART_N);
    const cpuHist = new Float32Array(CHART_N);
    const gpuHist = new Float32Array(CHART_N);
    let histAt = 0;
    let lastFps = 0;
    let lastWall = 0;
    let lastFrame = -1;
    return {
        update(snapshot) {
            const now = performance.now();
            const rate = sample(snapshot.metrics.frame, now);
            if (rate != null)
                lastFps = rate;
            if (lastFrame >= 0 && snapshot.metrics.frame > lastFrame) {
                const wall = now - lastWall;
                if (wall > 0)
                    lastFps = (snapshot.metrics.frame - lastFrame) * 1000 / wall;
            }
            lastFrame = snapshot.metrics.frame;
            lastWall = now;
            const cpuMs = snapshot.metrics.lastCpuMs;
            const gpuMs = snapshot.metrics.lastGpuMs;
            fpsPane.value.textContent = lastFps > 0 ? lastFps.toFixed(0) : "—";
            cpuPane.value.textContent = `${cpuMs.toFixed(2)} ms`;
            gpuPane.value.textContent = gpuMs > 0 ? `${gpuMs.toFixed(2)} ms` : "—";
            const scene = snapshot.metrics.sceneDraw;
            const cap = snapshot.metrics.graphicsCap;
            draw.textContent = scene
                ? `SCENE ${scene.fleets} fleets · ${scene.ships} ships · hull high ${scene.highFleets} · low ${scene.lowFleets}`
                    + (cap ? ` · cap ${cap.shown}/${cap.cap}` : "")
                : (cap ? `cap ${cap.shown}/${cap.cap}` : "");
            fpsHist[histAt] = lastFps;
            cpuHist[histAt] = cpuMs;
            gpuHist[histAt] = gpuMs;
            histAt = (histAt + 1) % CHART_N;
            paintPane(fpsPane.ctx, fpsHist, histAt, 60, "#7ee0a3");
            paintPane(cpuPane.ctx, cpuHist, histAt, 4, "#8eddea");
            paintPane(gpuPane.ctx, gpuHist, histAt, 4, "#e0b07e");
        },
        dispose: () => element.remove(),
    };
}
function makePane(label, color) {
    const wrap = document.createElement("div");
    Object.assign(wrap.style, { display: "flex", flexDirection: "column", gap: "2px" });
    const head = document.createElement("div");
    Object.assign(head.style, { display: "flex", justifyContent: "space-between", gap: "8px", color });
    const title = document.createElement("span");
    title.textContent = label;
    const value = document.createElement("span");
    value.textContent = "—";
    head.append(title, value);
    const canvas = document.createElement("canvas");
    canvas.width = CHART_W;
    canvas.height = CHART_H;
    canvas.style.width = `${CHART_W}px`;
    canvas.style.height = `${CHART_H}px`;
    canvas.style.display = "block";
    canvas.style.background = "rgba(8, 18, 28, 0.55)";
    wrap.append(head, canvas);
    return { wrap, value, ctx: canvas.getContext("2d") };
}
function niceMax(observed, floor) {
    const m = Math.max(observed, floor);
    if (!(m > 0) || !Number.isFinite(m))
        return floor;
    const pow = 10 ** Math.floor(Math.log10(m));
    const n = m / pow;
    const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
    return nice * pow;
}
function histMax(data) {
    let m = 0;
    for (let i = 0; i < data.length; i++) {
        const v = data[i];
        if (v > m)
            m = v;
    }
    return m;
}
function paintPane(ctx, data, at, floor, color) {
    if (!ctx)
        return;
    const w = ctx.canvas.width, h = ctx.canvas.height, n = data.length;
    const max = niceMax(histMax(data), floor);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(126, 160, 184, 0.35)";
    ctx.font = "9px monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText(formatScale(max), SCALE_W - 3, 1);
    ctx.textBaseline = "middle";
    ctx.fillText(formatScale(max * 0.5), SCALE_W - 3, h * 0.5);
    ctx.textBaseline = "bottom";
    ctx.fillText("0", SCALE_W - 3, h - 1);
    ctx.strokeStyle = "rgba(126, 160, 184, 0.2)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(SCALE_W, 0.5);
    ctx.lineTo(w, 0.5);
    ctx.moveTo(SCALE_W, Math.floor(h * 0.5) + 0.5);
    ctx.lineTo(w, Math.floor(h * 0.5) + 0.5);
    ctx.moveTo(SCALE_W, h - 0.5);
    ctx.lineTo(w, h - 0.5);
    ctx.stroke();
    const plotW = w - SCALE_W;
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.25;
    let started = false;
    for (let i = 0; i < n; i++) {
        const v = data[(at + i) % n];
        if (!(v > 0))
            continue;
        const x = SCALE_W + (i / (n - 1)) * plotW;
        const y = h - Math.min(1, v / max) * (h - 2) - 1;
        if (!started) {
            ctx.moveTo(x, y);
            started = true;
        }
        else
            ctx.lineTo(x, y);
    }
    if (started)
        ctx.stroke();
}
function formatScale(v) {
    if (v >= 100)
        return v.toFixed(0);
    if (v >= 10)
        return v.toFixed(v % 1 === 0 ? 0 : 1);
    return v.toFixed(v % 1 === 0 ? 0 : 1);
}
//# sourceMappingURL=render-performance-panel.js.map