import { createDomUpdates } from './dom-updates.js';
import { bindText } from './dom-bindings.js';
import { subscribeTopic, Topics } from "../worker/protocol/topics.js";
function coordinate(value) {
    return typeof value === "number" ? value : 0;
}
/**
 * Compact cursor readout in the stats panel (3 lines):
 * Screen coordinates · Map coordinates · Zoom level.
 */
export class CursorStatsWidget {
    constructor(bus, lineId = "cursorStats", container, getZoom, updates) {
        this.root = null;
        this.scrSpan = null;
        this.mapSpan = null;
        this.zoomSpan = null;
        this.scrValue = null;
        this.mapValue = null;
        this.zoomValue = null;
        this.unsubscribePointer = null;
        this.updates = updates ?? createDomUpdates();
        this.ownsUpdates = !updates;
        this.bus = bus;
        this.lineId = lineId;
        this.container = container ?? null;
        this.getZoom = getZoom ?? null;
        this.onWheelBound = () => this._updateZoom();
        this._setupUI();
        this._onPointerEvent = this._onPointerEvent.bind(this);
        // Wheel changes zoom without a pointer move — refresh the third line.
        window.addEventListener("wheel", this.onWheelBound, { passive: true });
        if (!bus.isPubSubReady())
            return;
        this.unsubscribePointer = subscribeTopic(bus, Topics.pointerEvent, this._onPointerEvent);
    }
    dispose() {
        window.removeEventListener("wheel", this.onWheelBound);
        this.unsubscribePointer?.();
        this.unsubscribePointer = null;
        this.scrValue?.dispose();
        this.mapValue?.dispose();
        this.zoomValue?.dispose();
        if (this.ownsUpdates)
            this.updates.dispose();
        this.root?.remove();
        this.getZoom = null;
    }
    /** Optional late bind (e.g. camera ready after UI). */
    setZoomProvider(getZoom) {
        this.getZoom = getZoom;
        this._updateZoom();
    }
    /** Director / rAF: zoom is camera height, not pointer. */
    refreshZoom() {
        this._updateZoom();
    }
    _lineStyle() {
        return [
            "margin: 0",
            "padding: 0",
            "white-space: nowrap", "overflow:hidden", "contain:layout paint",
        ].join(";");
    }
    _makeLine(label, spanClass, initial) {
        const line = document.createElement("p");
        line.className = "cursor-stats-row";
        line.style.cssText = this._lineStyle();
        line.appendChild(document.createTextNode(`${label} `));
        const span = document.createElement("span");
        span.className = spanClass;
        span.textContent = initial;
        line.appendChild(span);
        return { line, span };
    }
    _setupUI() {
        const statsBox = this.container ?? document.getElementById("stats");
        if (!statsBox)
            return;
        const existing = document.getElementById(this.lineId);
        if (existing) {
            // Drop legacy single-line markup so structure stays consistent.
            existing.remove();
        }
        this.root = document.createElement("div");
        this.root.id = this.lineId;
        this.root.className = "ui-muted cursor-stats";
        this.root.style.cssText = [
            "margin: 2px 0 0",
            "padding: 0",
            "font-size: 11px",
            "line-height: 1.35",
            'font-family: "Fira Mono", "Menlo", "Monaco", "Consolas", monospace',
        ].join(";");
        const scr = this._makeLine("Screen coordinates", "cursor-scr", "(0.0, 0.0)");
        const map = this._makeLine("Map coordinates", "cursor-map", "(0.0, 0.0)");
        const zoom = this._makeLine("Zoom level", "cursor-zoom", "—");
        this.scrSpan = scr.span;
        this.mapSpan = map.span;
        this.zoomSpan = zoom.span;
        this.scrValue = coordinateReadout(this.updates, bindText(scr.span, { width: '17ch' }));
        this.mapValue = coordinateReadout(this.updates, bindText(map.span, { width: '20ch' }));
        this.zoomValue = this.updates.number(bindText(zoom.span, { width: '12ch' }), { decimals: 1, format: formatZoom });
        this.root.appendChild(scr.line);
        this.root.appendChild(map.line);
        this.root.appendChild(zoom.line);
        if (statsBox.children.length > 0) {
            statsBox.insertBefore(this.root, statsBox.children[1] ?? null);
        }
        else {
            statsBox.appendChild(this.root);
        }
        this._updateZoom();
    }
    setContainer(container) {
        this.container = container;
        this.scrValue?.setActive(!!container);
        this.mapValue?.setActive(!!container);
        this.zoomValue?.setActive(!!container);
        if (!container) {
            if (this.root)
                this.root.remove();
            return;
        }
        if (!this.root) {
            this._setupUI();
            return;
        }
        if (this.root.parentElement !== container) {
            if (container.children.length > 0) {
                container.insertBefore(this.root, container.children[1] ?? null);
            }
            else {
                container.appendChild(this.root);
            }
        }
    }
    _updateZoom() {
        const z = this.getZoom?.() ?? NaN;
        this.zoomValue?.queue(Math.abs(z) >= 1000 ? Math.round(z) : z);
    }
    _onPointerEvent(payload) {
        const screen = payload?.screen_position;
        const galaxy = payload?.galaxy_position;
        const sx = coordinate(screen?.x);
        const sy = coordinate(screen?.y);
        const mx = coordinate(galaxy?.x);
        // Galaxy plane uses XZ; show as (x, y) with y ← z for the readout.
        const my = coordinate(galaxy?.z);
        this.scrValue?.queue(sx, sy);
        this.mapValue?.queue(mx, my);
        this._updateZoom();
    }
}
function formatZoom(z) {
    if (!Number.isFinite(z))
        return '—';
    return Math.abs(z) >= 1000 ? z.toLocaleString('en-US') : z.toFixed(1);
}
// Two coordinates share one text leaf: retain scalars, format once after pointer bursts.
function coordinateReadout(updates, text) {
    let x = 0, y = 0, sx = 0, sy = 0, shownX = 0, shownY = 0;
    const job = updates.job(() => { sx = x; sy = y; }, () => {
        if (sx === shownX && sy === shownY)
            return;
        text.data = `(${(sx / 10).toFixed(1)}, ${(sy / 10).toFixed(1)})`;
        shownX = sx;
        shownY = sy;
        updates.metrics.formats++;
        updates.metrics.writes++;
    });
    return { ...job, queue(nextX, nextY) {
            const nx = Math.round(nextX * 10), ny = Math.round(nextY * 10);
            if (nx === x && ny === y)
                return;
            x = nx;
            y = ny;
            job.invalidate();
        } };
}
//# sourceMappingURL=cursor-stats-widget.js.map