/**
 * CursorStatsWidget
 *
 * Specialized stats widget for displaying pointer stats.
 * Listens for "pointer_event" on the provided Bus (locally),
 * and updates the cursor screen and galaxy positions in the stats box.
 */
export class CursorStatsWidget {
    /**
     * @param {Bus} bus - The event bus to subscribe on.
     * @param {string} [lineId="cursorStats"] - id for the widget's <p> element (for uniqueness).
     */
    constructor(bus, lineId = "cursorStats") {
        this.row = null;
        this.scrXLabel = null;
        this.scrXSpan = null;
        this.scrYLabel = null;
        this.scrYSpan = null;
        this.galXLabel = null;
        this.galXSpan = null;
        this.galYLabel = null;
        this.galYSpan = null;
        this.bus = bus;
        this.lineId = lineId;
        this._setupUI();
        this._onPointerEvent = this._onPointerEvent.bind(this);
        if (!bus._brokerReady)
            return;
        bus.subscribe("pointer_event", this._onPointerEvent);
    }
    _setupUI() {
        const statsBox = document.getElementById("stats");
        if (!statsBox)
            return;
        const existing = document.getElementById(this.lineId);
        if (existing && existing instanceof HTMLParagraphElement) {
            this.row = existing;
        }
        else {
            this.row = document.createElement("p");
            this.row.setAttribute("id", this.lineId);
            this.row.appendChild(document.createTextNode("Cursor: "));
            this.scrXLabel = document.createTextNode("scrX: ");
            this.scrXSpan = document.createElement("span");
            this.scrXSpan.textContent = "0";
            this.scrYLabel = document.createTextNode(", scrY: ");
            this.scrYSpan = document.createElement("span");
            this.scrYSpan.textContent = "0";
            this.galXLabel = document.createTextNode("galX: ");
            this.galXSpan = document.createElement("span");
            this.galXSpan.textContent = "0";
            this.galYLabel = document.createTextNode(", galY: ");
            this.galYSpan = document.createElement("span");
            this.galYSpan.textContent = "0";
            this.row.appendChild(this.scrXLabel);
            this.row.appendChild(this.scrXSpan);
            this.row.appendChild(this.scrYLabel);
            this.row.appendChild(this.scrYSpan);
            this.row.appendChild(document.createElement("br"));
            this.row.appendChild(document.createTextNode("Cursor: "));
            this.row.appendChild(this.galXLabel);
            this.row.appendChild(this.galXSpan);
            this.row.appendChild(this.galYLabel);
            this.row.appendChild(this.galYSpan);
            // Insert after FPS for ergonomics, or at the end
            if (statsBox.children.length > 0) {
                statsBox.insertBefore(this.row, statsBox.children[1] ?? null);
            }
            else {
                statsBox.appendChild(this.row);
            }
        }
    }
    _onPointerEvent(data) {
        const payload = data;
        let sx = 0, sy = 0, gx = 0, gy = 0;
        if (payload && payload.screen_position) {
            sx =
                typeof payload.screen_position.x === "number"
                    ? payload.screen_position.x
                    : 0;
            sy =
                typeof payload.screen_position.y === "number"
                    ? payload.screen_position.y
                    : 0;
        }
        if (payload && payload.galaxy_position) {
            gx =
                typeof payload.galaxy_position.x === "number"
                    ? payload.galaxy_position.x
                    : 0;
            gy =
                typeof payload.galaxy_position.z === "number"
                    ? payload.galaxy_position.z
                    : 0;
        }
        if (this.scrXSpan)
            this.scrXSpan.textContent = sx.toFixed(1);
        if (this.scrYSpan)
            this.scrYSpan.textContent = sy.toFixed(1);
        if (this.galXSpan)
            this.galXSpan.textContent = gx.toFixed(1);
        if (this.galYSpan)
            this.galYSpan.textContent = gy.toFixed(1);
    }
}
//# sourceMappingURL=cursor-stats-widget.js.map