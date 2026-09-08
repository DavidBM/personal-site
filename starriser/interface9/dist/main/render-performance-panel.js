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
    Object.assign(element.style, { display: "flex", gap: "12px", font: "11px monospace", padding: "6px 0", color: "#8eddea" });
    const fps = document.createElement("span");
    const cpu = document.createElement("span");
    const gpu = document.createElement("span");
    fps.textContent = "FPS —";
    cpu.textContent = "Render CPU —";
    gpu.textContent = "GPU —";
    element.append(fps, cpu, gpu);
    container.prepend(element);
    const sample = createRenderFrameRateSample();
    return {
        update(snapshot) {
            const rate = sample(snapshot.metrics.frame, performance.now());
            if (rate != null)
                fps.textContent = `FPS ${rate.toFixed(0)}`;
            cpu.textContent = `Render CPU ${snapshot.metrics.lastCpuMs.toFixed(2)} ms`;
            gpu.textContent = snapshot.metrics.lastGpuMs > 0
                ? `GPU ${snapshot.metrics.lastGpuMs.toFixed(2)} ms` : "GPU —";
        },
        dispose: () => element.remove(),
    };
}
//# sourceMappingURL=render-performance-panel.js.map