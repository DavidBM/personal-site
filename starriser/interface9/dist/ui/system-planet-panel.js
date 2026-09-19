/**
 * Right-side sun + planet list while a compact Kepler SCENE is loaded.
 * Click → UIActions.selectSceneBody (sun orbit / planet lockBody + 4K).
 */
export function stationedByPlanet(fleets) {
    const out = new Map();
    for (let i = 0; i < fleets.length; i++) {
        const name = fleets[i].planetName;
        if (!name)
            continue;
        let row = out.get(name);
        if (!row) {
            row = { fleets: 0, ships: 0 };
            out.set(name, row);
        }
        row.fleets++;
        row.ships += fleets[i].shipCount | 0;
    }
    return out;
}
/** Right-side fleet meta: `12 · jumping 12s Inferno`. */
export function formatSceneFleetDetail(fleet) {
    let detail = `${fleet.shipCount} · ${fleet.state}`;
    if (fleet.remainingSec != null)
        detail += ` ${fleet.remainingSec}s`;
    if (fleet.planetName)
        detail += ` ${fleet.planetName}`;
    return detail;
}
const PANEL_WIDTH = 240;
/** Editor Stats is `top:12px; right:12px; width:300` — sit to its left. */
const EDITOR_STATS_RIGHT_PX = 12;
const EDITOR_STATS_WIDTH_PX = 300;
const EDITOR_GAP_PX = 12;
const STYLE_ID = "ui-system-planet-panel-styles";
function ensurePlanetPanelStyles() {
    if (document.getElementById(STYLE_ID))
        return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
.ui-planet-panel {
  max-height: calc(100vh - 24px);
  overflow-y: auto;
  pointer-events: auto;
  z-index: 5;
}
.ui-button.ui-planet-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  box-sizing: border-box;
  text-align: left;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 3px;
  padding: 4px 6px;
  color: #8aa0b8;
  font-size: 11px;
  letter-spacing: 0.04em;
  cursor: pointer;
  user-select: none;
}
.ui-button.ui-planet-row:hover {
  background: rgba(26, 61, 102, 0.35);
  color: #c9d8ee;
}
.ui-button.ui-planet-row.selected {
  background: rgba(42, 93, 150, 0.42);
  border-color: rgba(120, 160, 200, 0.38);
  color: #e6f1ff;
}
.ui-system-section-label {
  margin: 8px 6px 2px;
  color: #5e7893;
  font-size: 9px;
  letter-spacing: 0.15em;
  text-transform: uppercase;
}
.ui-button.ui-fleet-row {
  position: relative;
  overflow: hidden;
}
.ui-button.ui-fleet-row::before {
  content: "";
  position: absolute;
  left: 0;
  top: 20%;
  bottom: 20%;
  width: 2px;
  background: #60e2ff;
  box-shadow: 0 0 8px rgba(96, 226, 255, 0.85);
  opacity: 0.45;
}
.ui-button.ui-fleet-row:hover::before,
.ui-button.ui-fleet-row.selected::before { opacity: 1; }
.ui-system-empty {
  padding: 5px 6px;
  color: #53677c;
  font-size: 10px;
}
.ui-planet-kind {
  color: #6d8299;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  flex-shrink: 0;
}
.ui-button.ui-planet-row.selected .ui-planet-kind {
  color: #9eb2c9;
}
`;
    document.head.appendChild(style);
}
function listIdentity(bodies, fleets, cap) {
    let s = String(bodies.length);
    for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i];
        s += `|${b.index}:${b.catalogId}`;
    }
    for (let i = 0; i < fleets.length; i++) {
        const f = fleets[i];
        s += `|f:${f.id}:${f.shipCount}:${f.state}:${f.planetName ?? ""}`;
    }
    if (cap && cap.requested > cap.shown)
        s += `|cap:${cap.shown}:${cap.requested}:${cap.cap}`;
    return s;
}
function formatStationed(count) {
    if (!count || count.fleets <= 0)
        return "";
    return `${count.fleets}f · ${count.ships}`;
}
function applySelected(rows, focusIndex, fleetId) {
    for (let i = 0; i < rows.length; i++) {
        const el = rows[i];
        const idx = el.dataset.index == null ? NaN : Number(el.dataset.index);
        el.classList.toggle("selected", el.dataset.fleetId != null
            ? el.dataset.fleetId === fleetId
            : focusIndex != null && idx === focusIndex);
    }
}
export function buildSystemPlanetPanel(ctx, actions, opts) {
    ensurePlanetPanelStyles();
    const placement = opts?.placement ?? "play";
    const panel = ctx.panel({
        id: "system-planet-panel",
        title: "System",
        width: PANEL_WIDTH,
        className: "ui-planet-panel",
    });
    panel.element.style.position = "absolute";
    if (placement === "editor") {
        // Do not cover the Stats title (same corner, 300px wide).
        panel.element.style.top = "12px";
        panel.element.style.right = `${EDITOR_STATS_RIGHT_PX + EDITOR_STATS_WIDTH_PX + EDITOR_GAP_PX}px`;
    }
    else {
        panel.element.style.top = "12px";
        panel.element.style.right = "12px";
    }
    panel.element.style.display = "none";
    const list = ctx.container({
        id: "system-planet-list",
        parent: panel.content,
    });
    list.element.style.display = "flex";
    list.element.style.flexDirection = "column";
    list.element.style.gap = "2px";
    const rowComponents = [];
    const rowEls = [];
    let lastVisible = false;
    let lastIdentity = "";
    let lastFocus;
    let lastFleet;
    const rebuild = (bodies, fleets, fleetTotal, focusIndex, selectedFleetId, graphicsCap, sceneDraw) => {
        for (const c of rowComponents)
            c.destroy();
        rowComponents.length = 0;
        rowEls.length = 0;
        while (list.element.firstChild) {
            list.element.removeChild(list.element.firstChild);
        }
        const addLabel = (text) => {
            const label = document.createElement("div");
            label.className = "ui-system-section-label";
            label.textContent = text;
            list.element.appendChild(label);
        };
        addLabel("Celestial bodies");
        const stationed = stationedByPlanet(fleets);
        for (let i = 0; i < bodies.length; i++) {
            const body = bodies[i];
            const parked = stationed.get(body.name);
            const btn = ctx.button({
                id: `planet-row-${body.index}`,
                parent: list.element,
                text: body.name,
                title: body.isSun ? "Orbit sun" : `Lock ${body.name}`,
                className: "ui-planet-row",
                onClick: () => {
                    actions.selectSceneBody?.(body.index);
                },
            });
            btn.element.dataset.index = String(body.index);
            btn.element.textContent = "";
            const nameEl = document.createElement("span");
            nameEl.textContent = body.name;
            const kindEl = document.createElement("span");
            kindEl.className = "ui-planet-kind";
            const parkedText = formatStationed(parked);
            kindEl.textContent = parkedText ? `${body.kind} · ${parkedText}` : body.kind;
            btn.element.appendChild(nameEl);
            btn.element.appendChild(kindEl);
            rowComponents.push(btn);
            rowEls.push(btn.element);
        }
        addLabel(`Fleets · ${fleetTotal}`);
        if (fleets.length === 0) {
            const empty = document.createElement("div");
            empty.className = "ui-system-empty";
            empty.textContent = "No fleets in this system";
            list.element.appendChild(empty);
        }
        for (const fleet of fleets) {
            const btn = ctx.button({
                id: `system-fleet-${fleet.id}`,
                parent: list.element,
                text: fleet.id,
                title: `Select fleet ${fleet.id}`,
                className: "ui-planet-row ui-fleet-row",
                onClick: () => actions.selectSceneFleet?.(fleet.id),
            });
            btn.element.dataset.fleetId = fleet.id;
            btn.element.textContent = "";
            const nameEl = document.createElement("span");
            nameEl.textContent = fleet.id;
            const detailEl = document.createElement("span");
            detailEl.className = "ui-planet-kind";
            detailEl.textContent = formatSceneFleetDetail(fleet);
            btn.element.append(nameEl, detailEl);
            rowComponents.push(btn);
            rowEls.push(btn.element);
        }
        if (fleetTotal > fleets.length) {
            const more = ctx.button({ id: "system-fleet-load-more", parent: list.element,
                text: `Load more · ${fleets.length} of ${fleetTotal}`,
                title: "Load the next fleets in this system", className: "ui-planet-row",
                onClick: () => actions.loadMoreSceneFleets?.() });
            rowComponents.push(more);
        }
        if (graphicsCap && graphicsCap.requested > graphicsCap.shown) {
            const cap = document.createElement("div");
            cap.className = "ui-system-empty";
            cap.textContent = `Graphics cap · ${graphicsCap.shown} of ${graphicsCap.requested} ships`;
            list.element.appendChild(cap);
        }
        if (sceneDraw) {
            addLabel("Draw");
            const stats = document.createElement("div");
            stats.className = "ui-system-empty";
            stats.textContent = `${sceneDraw.fleets} fleets · ${sceneDraw.ships} ships · high ${sceneDraw.highFleets} · low ${sceneDraw.lowFleets}`;
            list.element.appendChild(stats);
        }
        applySelected(rowEls, focusIndex, selectedFleetId);
    };
    const sync = (next) => {
        if (!next.visible) {
            if (lastVisible) {
                panel.element.style.display = "none";
                lastVisible = false;
            }
            lastIdentity = "";
            lastFocus = undefined;
            lastFleet = undefined;
            return;
        }
        if (!lastVisible) {
            panel.element.style.display = "";
            lastVisible = true;
        }
        const fleets = next.fleets ?? [];
        const fleetTotal = next.fleetTotal ?? fleets.length;
        const fleetId = next.selectedFleetId ?? null;
        const identity = listIdentity(next.bodies, fleets, next.graphicsCap)
            + (next.sceneDraw ? `|d:${next.sceneDraw.fleets}:${next.sceneDraw.ships}:${next.sceneDraw.highFleets}:${next.sceneDraw.lowFleets}` : "");
        if (identity === lastIdentity) {
            for (let i = 0; i < fleets.length; i++) {
                const fleet = fleets[i];
                const el = rowEls.find((row) => row.dataset.fleetId === fleet.id);
                const detail = el?.querySelector(".ui-planet-kind");
                if (detail)
                    detail.textContent = formatSceneFleetDetail(fleet);
            }
            if (next.focusIndex !== lastFocus || fleetId !== lastFleet) {
                applySelected(rowEls, next.focusIndex, fleetId);
                lastFocus = next.focusIndex;
                lastFleet = fleetId;
            }
            return;
        }
        rebuild(next.bodies, fleets, fleetTotal, next.focusIndex, fleetId, next.graphicsCap, next.sceneDraw);
        lastIdentity = identity;
        lastFocus = next.focusIndex;
        lastFleet = fleetId;
    };
    return { panel, sync };
}
//# sourceMappingURL=system-planet-panel.js.map