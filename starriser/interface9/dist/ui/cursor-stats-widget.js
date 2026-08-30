import { subscribeTopic, Topics } from "../worker/protocol/topics.js";
/**
 * Compact cursor readout in the stats panel (3 lines):
 * Screen coordinates · Map coordinates · Zoom level.
 */
export class CursorStatsWidget {
    constructor(bus, lineId = "cursorStats", container, getZoom) {
        this.root = null;
        this.scrSpan = null;
        this.mapSpan = null;
        this.zoomSpan = null;
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
        subscribeTopic(bus, Topics.pointerEvent, this._onPointerEvent);
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
            "white-space: nowrap",
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
    _formatZoom(z) {
        if (!Number.isFinite(z))
            return "—";
        // Camera height spans 1e2…1e6; whole units stay readable.
        if (Math.abs(z) >= 1000)
            return Math.round(z).toLocaleString("en-US");
        return z.toFixed(1);
    }
    _updateZoom() {
        if (!this.zoomSpan)
            return;
        const z = this.getZoom?.() ?? null;
        this.zoomSpan.textContent =
            z == null || !Number.isFinite(z) ? "—" : this._formatZoom(z);
    }
    _onPointerEvent(payload) {
        let sx = 0;
        let sy = 0;
        let mx = 0;
        let my = 0;
        if (payload?.screen_position) {
            sx =
                typeof payload.screen_position.x === "number"
                    ? payload.screen_position.x
                    : 0;
            sy =
                typeof payload.screen_position.y === "number"
                    ? payload.screen_position.y
                    : 0;
        }
        if (payload?.galaxy_position) {
            mx =
                typeof payload.galaxy_position.x === "number"
                    ? payload.galaxy_position.x
                    : 0;
            // Galaxy plane uses XZ; show as (x, y) with y ← z for the readout.
            my =
                typeof payload.galaxy_position.z === "number"
                    ? payload.galaxy_position.z
                    : 0;
        }
        if (this.scrSpan) {
            this.scrSpan.textContent = `(${sx.toFixed(1)}, ${sy.toFixed(1)})`;
        }
        if (this.mapSpan) {
            this.mapSpan.textContent = `(${mx.toFixed(1)}, ${my.toFixed(1)})`;
        }
        this._updateZoom();
    }
}
//# sourceMappingURL=cursor-stats-widget.js.map