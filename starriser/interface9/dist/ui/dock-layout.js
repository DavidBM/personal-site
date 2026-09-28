/**
 * Snap-together panels. Each window remembers a screen edge or another window.
 * Positions are reapplied on resize and stored across reloads.
 */
import { paintSimPauseButtons, registerSimPauseButton } from "./sim-pause-button.js";
export const DOCK_SNAP_PX = 16;
export const DOCK_INSET_PX = 12;
export const DOCK_MIN_W = 180;
export const DOCK_MIN_H = 96;
const STORAGE_KEY = "galaxy.ui.dock.v1";
export function screenAnchor(edgeX, edgeY, x, y, w, h, alignX) {
    return { kind: "screen", edgeX, edgeY, x, y, w, h, alignX };
}
export function widgetAnchor(target, side, gap, along, w, h) {
    return { kind: "widget", target, side, gap, along, w, h };
}
function clampSize(w, h) {
    return {
        w: Math.max(DOCK_MIN_W, w),
        h: Math.max(DOCK_MIN_H, h),
    };
}
function keepOnScreen(rect, viewport) {
    const size = clampSize(rect.w, rect.h);
    const w = Math.min(size.w, Math.max(DOCK_MIN_W, viewport.w - 24));
    const h = Math.min(size.h, Math.max(DOCK_MIN_H, viewport.h - 24));
    const maxLeft = Math.max(0, viewport.w - Math.min(w, 48));
    const maxTop = Math.max(0, viewport.h - Math.min(h, 48));
    return {
        left: Math.min(maxLeft, Math.max(-w + 48, rect.left)),
        top: Math.min(maxTop, Math.max(-h + 48, rect.top)),
        w,
        h,
    };
}
export function placeAnchor(anchor, viewport, placed) {
    const size = clampSize(anchor.w, anchor.h);
    if (anchor.kind === "screen") {
        const left = anchor.alignX === "center"
            ? (viewport.w - size.w) / 2
            : anchor.edgeX === "left"
                ? anchor.x
                : viewport.w - anchor.x - size.w;
        const top = anchor.edgeY === "top" ? anchor.y : viewport.h - anchor.y - size.h;
        return keepOnScreen({ left, top, w: size.w, h: size.h }, viewport);
    }
    const parent = placed.get(anchor.target);
    if (!parent) {
        return keepOnScreen({ left: DOCK_INSET_PX, top: DOCK_INSET_PX, w: size.w, h: size.h }, viewport);
    }
    let left = parent.left;
    let top = parent.top;
    if (anchor.side === "left") {
        left = parent.left - anchor.gap - size.w;
        top = parent.top + anchor.along;
    }
    else if (anchor.side === "right") {
        left = parent.left + parent.w + anchor.gap;
        top = parent.top + anchor.along;
    }
    else if (anchor.side === "top") {
        top = parent.top - anchor.gap - size.h;
        left = parent.left + anchor.along;
    }
    else {
        top = parent.top + parent.h + anchor.gap;
        left = parent.left + anchor.along;
    }
    return keepOnScreen({ left, top, w: size.w, h: size.h }, viewport);
}
function dependsOn(anchor) {
    return anchor.kind === "widget" ? anchor.target : null;
}
/** Screen anchors first, then windows whose parent is already ordered. Cycles drop to a screen corner. */
export function orderAnchors(anchors) {
    const pending = new Map(anchors);
    const ordered = [];
    const ready = new Set();
    let guard = pending.size + 2;
    while (pending.size > 0 && guard-- > 0) {
        let moved = false;
        for (const [id, anchor] of pending) {
            const parent = dependsOn(anchor);
            if (parent && parent !== id && pending.has(parent) && !ready.has(parent))
                continue;
            const use = parent && (parent === id || !anchors.has(parent))
                ? screenAnchor("left", "top", DOCK_INSET_PX, DOCK_INSET_PX, anchor.w, anchor.h)
                : anchor;
            ordered.push({ id, anchor: use });
            ready.add(id);
            pending.delete(id);
            moved = true;
        }
        if (!moved) {
            const [id, anchor] = pending.entries().next().value;
            ordered.push({
                id,
                anchor: screenAnchor("left", "top", DOCK_INSET_PX, DOCK_INSET_PX, anchor.w, anchor.h),
            });
            ready.add(id);
            pending.delete(id);
        }
    }
    return ordered;
}
export function layoutDock(anchors, viewport) {
    const placed = new Map();
    for (const row of orderAnchors(anchors)) {
        placed.set(row.id, placeAnchor(row.anchor, viewport, placed));
    }
    return placed;
}
function axisOverlap(a0, a1, b0, b1) {
    return Math.min(a1, b1) - Math.max(a0, b0);
}
function nearerInset(distance) {
    if (distance <= DOCK_SNAP_PX || Math.abs(distance - DOCK_INSET_PX) <= DOCK_SNAP_PX)
        return DOCK_INSET_PX;
    return distance;
}
/** Drop a dragged rect onto a window edge or the nearer screen sides. */
export function snapDrag(rect, viewport, others) {
    const size = clampSize(rect.w, rect.h);
    let best = null;
    for (const [id, other] of others) {
        const candidates = [
            {
                score: Math.abs(other.left - (rect.left + rect.w)),
                side: "left",
                gap: 0,
                along: rect.top - other.top,
            },
            {
                score: Math.abs(rect.left - (other.left + other.w)),
                side: "right",
                gap: 0,
                along: rect.top - other.top,
            },
            {
                score: Math.abs(other.top - (rect.top + rect.h)),
                side: "top",
                gap: 0,
                along: rect.left - other.left,
            },
            {
                score: Math.abs(rect.top - (other.top + other.h)),
                side: "bottom",
                gap: 0,
                along: rect.left - other.left,
            },
        ];
        for (const candidate of candidates) {
            const vertical = candidate.side === "left" || candidate.side === "right";
            const overlap = vertical
                ? axisOverlap(rect.top, rect.top + rect.h, other.top, other.top + other.h)
                : axisOverlap(rect.left, rect.left + rect.w, other.left, other.left + other.w);
            if (candidate.score > DOCK_SNAP_PX || overlap < 24)
                continue;
            const along = Math.abs(candidate.along) <= DOCK_SNAP_PX ? 0 : candidate.along;
            if (!best || candidate.score < best.score) {
                best = {
                    score: candidate.score,
                    anchor: widgetAnchor(id, candidate.side, candidate.gap, along, size.w, size.h),
                };
            }
        }
    }
    if (best)
        return best.anchor;
    const edgeX = rect.left + rect.w / 2 < viewport.w / 2 ? "left" : "right";
    const edgeY = rect.top + rect.h / 2 < viewport.h / 2 ? "top" : "bottom";
    const xRaw = edgeX === "left" ? rect.left : viewport.w - (rect.left + rect.w);
    const yRaw = edgeY === "top" ? rect.top : viewport.h - (rect.top + rect.h);
    return screenAnchor(edgeX, edgeY, nearerInset(xRaw), nearerInset(yRaw), size.w, size.h);
}
export function resizeAnchor(anchor, viewport, placed, start, dx, dy, edges) {
    let left = start.left;
    let top = start.top;
    let w = start.w;
    let h = start.h;
    if (edges.left) {
        left += dx;
        w -= dx;
    }
    if (edges.right)
        w += dx;
    if (edges.top) {
        top += dy;
        h -= dy;
    }
    if (edges.bottom)
        h += dy;
    const size = clampSize(w, h);
    if (w < DOCK_MIN_W && edges.left)
        left -= DOCK_MIN_W - w;
    if (h < DOCK_MIN_H && edges.top)
        top -= DOCK_MIN_H - h;
    w = size.w;
    h = size.h;
    if (anchor.kind === "screen") {
        return screenAnchor(anchor.edgeX, anchor.edgeY, anchor.edgeX === "left" ? left : viewport.w - (left + w), anchor.edgeY === "top" ? top : viewport.h - (top + h), w, h);
    }
    const parent = placed.get(anchor.target);
    if (!parent)
        return { ...anchor, w, h };
    if (anchor.side === "left" || anchor.side === "right") {
        const gap = anchor.side === "left" ? parent.left - (left + w) : left - (parent.left + parent.w);
        return widgetAnchor(anchor.target, anchor.side, gap, top - parent.top, w, h);
    }
    const gap = anchor.side === "top" ? parent.top - (top + h) : top - (parent.top + parent.h);
    return widgetAnchor(anchor.target, anchor.side, gap, left - parent.left, w, h);
}
function viewportOf() {
    return { w: window.innerWidth, h: window.innerHeight };
}
function readSaved() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw)
            return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed.windows !== "object" || parsed.windows == null)
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
function writeSaved(windows, sidebarOpen) {
    const payload = { windows: {}, sidebarOpen };
    for (const windowRow of windows) {
        payload.windows[windowRow.id] = { anchor: windowRow.anchor, hidden: windowRow.hidden };
    }
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    }
    catch {
        /* private mode or a full quota — the session still keeps the layout */
    }
}
function isAnchor(value) {
    if (!value || typeof value !== "object")
        return false;
    const row = value;
    if (row.kind === "screen") {
        return (row.edgeX === "left" || row.edgeX === "right")
            && (row.edgeY === "top" || row.edgeY === "bottom")
            && Number.isFinite(row.w) && Number.isFinite(row.h);
    }
    if (row.kind === "widget") {
        return typeof row.target === "string"
            && (row.side === "left" || row.side === "right" || row.side === "top" || row.side === "bottom")
            && Number.isFinite(row.w) && Number.isFinite(row.h);
    }
    return false;
}
function applyRect(element, rect) {
    element.style.position = "absolute";
    element.style.left = `${Math.round(rect.left)}px`;
    element.style.top = `${Math.round(rect.top)}px`;
    element.style.width = `${Math.round(rect.w)}px`;
    element.style.height = `${Math.round(rect.h)}px`;
    element.style.right = "auto";
    element.style.bottom = "auto";
    element.style.maxHeight = "none";
    element.style.boxSizing = "border-box";
}
const DOCK_ICON = {
    "controls-panel": `<circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="6.2" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="17.5" cy="7.2" r="1.1" fill="currentColor" stroke="none"/><circle cx="16.2" cy="16.4" r="1" fill="currentColor" stroke="none"/><path d="M8 15.5c1.2-3.2 3-5 6.2-5.6"/>`,
    "stats-panel": `<path d="M5 19V11M12 19V5M19 19v-6"/>`,
    "system-planet-panel": `<circle cx="12" cy="12" r="4.2"/><ellipse cx="12" cy="12" rx="9" ry="3.2" transform="rotate(-24 12 12)"/>`,
    "ui-mode-switcher": `<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="9" cy="7" r="2.1" fill="currentColor"/><circle cx="15" cy="12" r="2.1" fill="currentColor"/><circle cx="8" cy="17" r="2.1" fill="currentColor"/>`,
    "play-status": `<path d="M8 7h11M8 12h11M8 17h7"/><circle cx="4.5" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="4.5" cy="17" r="1" fill="currentColor" stroke="none"/>`,
    "ship-tuning-panel": `<path d="M4 8h10M4 12h16M4 16h7"/><circle cx="16" cy="8" r="2.1" fill="currentColor"/><circle cx="9" cy="16" r="2.1" fill="currentColor"/>`,
    "dock-rail": `<rect x="3.5" y="4" width="7" height="16" rx="1.4"/><rect x="13.5" y="4" width="7" height="9" rx="1.4"/>`,
    "sim-pause": `<path d="M8 5 V19 M16 5 V19"/>`,
};
function dockIcon(id) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.7");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = DOCK_ICON[id] ?? `<circle cx="12" cy="12" r="6"/>`;
    return svg;
}
const STYLE_ID = "galaxy-dock-styles";
function ensureStyles() {
    if (document.getElementById(STYLE_ID))
        return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
.dock-window { contain: strict; box-sizing:border-box; display: flex; flex-direction: column; overflow: hidden; }
.dock-window > .ui-panel-title { cursor: grab; user-select: none; flex: 0 0 auto; }
.dock-window > .ui-panel-content { flex: 1 1 auto; min-height: 0; min-width:0; overflow: auto; scrollbar-gutter:stable; }
.dock-user-hidden { display: none !important; }
#galaxy-dock-debug {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 40;
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  box-sizing: border-box;
  padding: 8px;
  background: rgba(6, 12, 20, 0.92);
  border-left: 1px solid rgba(120, 160, 200, 0.35);
  color: #d5e4f5;
  font: 11px/1.3 "Fira Mono", Menlo, Consolas, monospace;
  overflow: auto;
}
#galaxy-dock-debug.collapsed { width: 48px; }
#galaxy-dock-debug.collapsed .dock-label { display: none !important; }
#galaxy-dock-debug.open { width: 188px; }
#galaxy-dock-debug button.dock-toggle,
#galaxy-dock-debug button.dock-window-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  box-sizing: border-box;
  background: transparent;
  border: 1px solid transparent;
  color: #8aa0b8;
  border-radius: 6px;
  padding: 6px;
  cursor: pointer;
  text-align: left;
  font: inherit;
}
#galaxy-dock-debug.collapsed button.dock-toggle,
#galaxy-dock-debug.collapsed button.dock-window-toggle {
  justify-content: center;
  padding: 7px 4px;
}
#galaxy-dock-debug button.dock-toggle {
  color: #d5e4f5;
  border-color: rgba(120, 160, 200, 0.35);
  margin-bottom: 4px;
}
#galaxy-dock-debug button.dock-window-toggle[aria-pressed="true"] {
  color: #e8f3ff;
  background: rgba(42, 93, 150, 0.5);
  border-color: rgba(140, 180, 220, 0.45);
}
#galaxy-dock-debug button.dock-window-toggle:hover {
  color: #e8f3ff;
  background: rgba(26, 61, 102, 0.45);
}
#galaxy-dock-debug button svg {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  display: block;
}
`;
    document.head.appendChild(style);
}
function edgeHit(event, element) {
    const rect = element.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const left = x <= 6;
    const right = rect.width - x <= 6;
    const top = y <= 6;
    const bottom = rect.height - y <= 6;
    if (!left && !right && !top && !bottom)
        return null;
    return { left, right, top, bottom };
}
let activeDispose = null;
export function installDockLayout(host, windows, pause) {
    activeDispose?.();
    ensureStyles();
    const saved = readSaved();
    const live = windows.map((row) => {
        const prior = saved?.windows?.[row.id];
        const anchor = prior && isAnchor(prior.anchor) ? prior.anchor : row.anchor;
        return { ...row, anchor, hidden: prior?.hidden === true };
    });
    let sidebarOpen = saved?.sidebarOpen === true;
    const anchors = () => new Map(live.map((row) => [row.id, row.anchor]));
    const layout = () => {
        const placed = layoutDock(anchors(), viewportOf());
        for (const row of live) {
            const rect = placed.get(row.id);
            if (!rect)
                continue;
            row.element.classList.add("dock-window");
            row.element.classList.toggle("dock-user-hidden", row.hidden);
            applyRect(row.element, rect);
        }
    };
    const persist = () => writeSaved(live, sidebarOpen);
    const onResize = () => layout();
    window.addEventListener("resize", onResize);
    for (const row of live) {
        const title = row.element.querySelector(".ui-panel-title") ?? row.element;
        title.addEventListener("pointerdown", (event) => {
            if (event.button !== 0)
                return;
            const target = event.target;
            if (target && target.closest("button, input, select, textarea, a"))
                return;
            if (edgeHit(event, row.element))
                return;
            const origin = row.element.getBoundingClientRect();
            const startX = event.clientX;
            const startY = event.clientY;
            const move = (ev) => {
                applyRect(row.element, {
                    left: origin.left + ev.clientX - startX,
                    top: origin.top + ev.clientY - startY,
                    w: origin.width,
                    h: origin.height,
                });
            };
            const up = (ev) => {
                document.removeEventListener("pointermove", move);
                document.removeEventListener("pointerup", up);
                const rect = row.element.getBoundingClientRect();
                const others = layoutDock(anchors(), viewportOf());
                others.delete(row.id);
                const dragged = {
                    left: origin.left + ev.clientX - startX,
                    top: origin.top + ev.clientY - startY,
                    w: rect.width,
                    h: rect.height,
                };
                row.anchor = snapDrag(dragged, viewportOf(), others);
                layout();
                persist();
            };
            document.addEventListener("pointermove", move);
            document.addEventListener("pointerup", up);
            event.preventDefault();
        });
        row.element.addEventListener("pointerdown", (event) => {
            if (event.button !== 0)
                return;
            const edges = edgeHit(event, row.element);
            if (!edges)
                return;
            const origin = row.element.getBoundingClientRect();
            const start = { left: origin.left, top: origin.top, w: origin.width, h: origin.height };
            const startX = event.clientX;
            const startY = event.clientY;
            const move = (ev) => {
                const placed = layoutDock(anchors(), viewportOf());
                row.anchor = resizeAnchor(row.anchor, viewportOf(), placed, start, ev.clientX - startX, ev.clientY - startY, edges);
                layout();
            };
            const up = () => {
                document.removeEventListener("pointermove", move);
                document.removeEventListener("pointerup", up);
                persist();
            };
            document.addEventListener("pointermove", move);
            document.addEventListener("pointerup", up);
            event.preventDefault();
            event.stopPropagation();
        });
    }
    const aside = document.createElement("aside");
    aside.id = "galaxy-dock-debug";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "dock-toggle";
    toggle.title = "Show or hide window names";
    toggle.append(dockIcon("dock-rail"), Object.assign(document.createElement("span"), { className: "dock-label", textContent: "Windows" }));
    const paintSidebar = () => {
        aside.className = sidebarOpen ? "open" : "collapsed";
        toggle.setAttribute("aria-expanded", sidebarOpen ? "true" : "false");
    };
    toggle.addEventListener("click", () => {
        sidebarOpen = !sidebarOpen;
        paintSidebar();
        persist();
    });
    aside.appendChild(toggle);
    let unregisterPause;
    if (pause) {
        const pauseButton = document.createElement("button");
        pauseButton.type = "button";
        pauseButton.id = "dock-sim-pause";
        pauseButton.className = "dock-window-toggle";
        pauseButton.dataset.simPause = "1";
        const pauseName = document.createElement("span");
        pauseName.className = "dock-label";
        pauseName.textContent = "Pause";
        pauseButton.append(dockIcon("sim-pause"), pauseName);
        pauseButton.addEventListener("click", () => pause.toggle());
        aside.appendChild(pauseButton);
        unregisterPause = registerSimPauseButton(pauseButton);
    }
    for (const row of live) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "dock-window-toggle";
        button.title = row.title;
        button.setAttribute("aria-pressed", row.hidden ? "false" : "true");
        const name = document.createElement("span");
        name.className = "dock-label";
        name.textContent = row.title;
        button.append(dockIcon(row.id), name);
        button.addEventListener("click", () => {
            row.hidden = !row.hidden;
            button.setAttribute("aria-pressed", row.hidden ? "false" : "true");
            layout();
            persist();
        });
        aside.appendChild(button);
    }
    paintSidebar();
    host.appendChild(aside);
    if (pause)
        paintSimPauseButtons(pause.paused());
    layout();
    const dispose = () => {
        if (activeDispose === dispose)
            activeDispose = null;
        window.removeEventListener("resize", onResize);
        unregisterPause?.();
        aside.remove();
    };
    activeDispose = dispose;
    return dispose;
}
//# sourceMappingURL=dock-layout.js.map