"use strict";
/**
 * Cost-timeline gallery UI — cumulative feature steps with Δms arrows.
 * Labels are plain language (no A/B/C). Primary: planet + sun stacks.
 */
const SECTION_TITLES = {
    "planet-layers": "Planet cost timeline (cumulative features)",
    "sun-layers": "Sun cost timeline (cumulative features)",
    "draw-class": "Draw isolation (absolute times · not a feature stack)",
};
const SECTION_ORDER = ["planet-layers", "sun-layers", "draw-class"];
function formatDeltaMs(delta) {
    const sign = delta >= 0 ? "+" : "−";
    return `${sign}${Math.abs(delta).toFixed(2)} ms`;
}
function fillGallery(root, result) {
    let host = root.querySelector(".gallery-content");
    if (!host) {
        host = document.createElement("div");
        host.className = "gallery-content";
        root.appendChild(host);
    }
    host.innerHTML = "";
    const hint = document.getElementById("gallery-hint");
    if (hint) {
        hint.textContent = `Planet body ${result.body} · ${result.width}×${result.height} · ${result.usesTimestamps ? "GPU timestamps" : "submit→done"} · ${result.stages.length} steps · n≈${result.stages[0]?.n ?? "—"} samples/step · arrows = extra ms vs previous`;
    }
    const bySection = new Map();
    for (const s of result.stages) {
        const sec = s.section || "stages";
        if (!bySection.has(sec))
            bySection.set(sec, []);
        bySection.get(sec).push(s);
    }
    const keys = [
        ...SECTION_ORDER.filter((k) => bySection.has(k)),
        ...[...bySection.keys()].filter((k) => !SECTION_ORDER.includes(k)),
    ];
    for (const sec of keys) {
        const tiles = bySection.get(sec);
        const h2 = document.createElement("h2");
        h2.className = "gallery-section-title";
        h2.textContent = SECTION_TITLES[sec] || sec;
        host.appendChild(h2);
        const isTimeline = sec === "planet-layers" || sec === "sun-layers";
        const row = document.createElement("div");
        row.className = isTimeline ? "timeline-row" : "gallery-grid gallery-grid--secondary";
        for (let i = 0; i < tiles.length; i++) {
            const s = tiles[i];
            if (isTimeline && i > 0) {
                const arrow = document.createElement("div");
                arrow.className = "timeline-arrow";
                const dLab = s.deltaLabel != null
                    ? s.deltaLabel
                    : s.deltaMs != null
                        ? formatDeltaMs(s.deltaMs)
                        : "—";
                arrow.innerHTML = `<span class="timeline-delta">${escapeHtml(dLab)}</span><span class="timeline-arrow-mark" aria-hidden="true">→</span>`;
                arrow.setAttribute("title", `Extra GPU time vs previous step: ${dLab}`);
                row.appendChild(arrow);
            }
            const fig = document.createElement("figure");
            fig.className = "gallery-tile";
            const title = s.label || s.stage;
            fig.dataset.stage = title;
            if (s.deltaLabel)
                fig.dataset.delta = s.deltaLabel;
            const img = document.createElement("img");
            img.alt = title;
            img.loading = "lazy";
            if (s.dataUrl)
                img.src = s.dataUrl;
            else
                img.classList.add("missing");
            const d = s.drawCounts || { rings: 0, sun: 0, planets: 0 };
            const cap = document.createElement("figcaption");
            cap.innerHTML = `
        <strong class="stage-name">${escapeHtml(title)}</strong>
        <span class="stage-ms">${s.meanMs.toFixed(2)} ms mean</span>
        <span class="stage-footnote">median ${s.medianMs.toFixed(2)} · n=${s.n}
        · body ${escapeHtml(String(s.body ?? "—"))}
        · draws R/S/P ${d.rings}/${d.sun}/${d.planets}</span>`;
            fig.appendChild(img);
            fig.appendChild(cap);
            row.appendChild(fig);
        }
        host.appendChild(row);
    }
}
function escapeHtml(s) {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
function getTest() {
    return (window.__solarSystemTest ??
        null);
}
window.__onStageGalleryReady = (result) => {
    const root = document.getElementById("stage-gallery");
    if (!root)
        return;
    fillGallery(root, result);
    window.__stageGalleryResult = result;
};
async function waitTest(timeoutMs = 120000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        const t = getTest();
        if (t?.ready && typeof t.runStageGallery === "function")
            return t;
        await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("timeout waiting for __solarSystemTest.runStageGallery");
}
async function rerun() {
    const btn = document.getElementById("rerun-btn");
    const select = document.getElementById("body-select");
    const status = document.getElementById("status");
    if (btn)
        btn.disabled = true;
    try {
        if (status) {
            status.textContent = "Re-running cost timelines @ 4K…";
            status.classList.remove("error");
        }
        const t = await waitTest();
        const body = select?.value || "azure";
        const result = await t.runStageGallery({
            body,
            frames: 10,
            width: 3840,
            height: 2160,
            radiusMul: 1.6,
            settleFrames: 5,
        });
        const root = document.getElementById("stage-gallery");
        if (root)
            fillGallery(root, result);
        window.__stageGalleryResult = result;
        if (status) {
            status.textContent = `Timeline ready · ${result.stages.length} steps · ${result.width}×${result.height}`;
        }
    }
    catch (err) {
        console.error(err);
        if (status) {
            status.textContent = err instanceof Error ? err.message : String(err);
            status.classList.add("error");
        }
    }
    finally {
        if (btn)
            btn.disabled = false;
    }
}
function wireUi() {
    document.getElementById("rerun-btn")?.addEventListener("click", () => {
        void rerun();
    });
}
wireUi();
//# sourceMappingURL=stage-gallery.js.map