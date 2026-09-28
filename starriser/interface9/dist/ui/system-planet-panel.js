import { bindText, setText, setHidden } from './dom-bindings.js';
import { createFleetCard, FLEET_CARD_CSS } from './fleet-card.js';
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
${FLEET_CARD_CSS}
.ui-planet-panel {
  max-height: calc(100vh - 24px);
  overflow-y: auto;
  pointer-events: auto;
  z-index: 5;
}
.ui-button.ui-planet-row {
  display: flex;
  align-items: baseline;
  height: 24px; min-height: 24px; flex-shrink: 0;
  contain: layout paint; overflow: hidden; white-space: nowrap;
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
.ui-planet-row > span {min-width:0;overflow:hidden;text-overflow:ellipsis;}
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
  height:66px; min-height:66px;
  display: grid; gap: 2px 5px; font-size: 9px; letter-spacing: 0;
  border-color: rgba(105,151,192,.22); padding: 5px 6px;
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
function formatStationed(count) {
    if (!count || count.fleets <= 0)
        return "";
    return `${count.fleets}f · ${count.ships}`;
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
    // Rows own their listeners and survive changing counts, countdowns and GPU
    // admission. Only true membership changes create/destroy components.
    const bodiesHost = document.createElement("div");
    const fleetsHost = document.createElement("div");
    for (const host of [bodiesHost, fleetsHost]) {
        Object.assign(host.style, { display: "flex", flexDirection: "column", gap: "2px" });
    }
    const label = (text, className = "ui-system-section-label") => {
        const element = document.createElement("div");
        element.className = className;
        element.textContent = text;
        return element;
    };
    const fleetHeading = label("Fleets");
    const empty = label("No fleets in this system", "ui-system-empty");
    const cap = label("", "ui-system-empty");
    const drawHeading = label("Draw"), draw = label("", "ui-system-empty");
    const more = ctx.button({ id: "system-fleet-load-more", parent: list.element,
        text: "Load more", title: "Load the next fleets in this system", className: "ui-planet-row",
        onClick: () => actions.loadMoreSceneFleets?.() });
    list.element.append(label("Celestial bodies"), bodiesHost, fleetHeading, fleetsHost, empty, more.element, cap, drawHeading, draw);
    const bodyRows = new Map();
    const fleetRows = new Map();
    const headingText = bindText(fleetHeading), moreText = bindText(more.element, { height: '24px' });
    const capText = bindText(cap, { height: '34px', wrap: true }), drawText = bindText(draw, { height: '34px', wrap: true });
    let lastVisible = false;
    function bodyRow(body) {
        const component = ctx.button({ id: `planet-row-${body.index}`, parent: bodiesHost,
            text: "", className: "ui-planet-row", onClick: () => actions.selectSceneBody?.(body.index) });
        component.element.dataset.index = String(body.index);
        const name = document.createElement("span"), kind = document.createElement("span");
        kind.className = "ui-planet-kind";
        component.element.append(name, kind);
        return { component, name: bindText(name, { width: '40%', height: '16px' }), kind: bindText(kind, { width: '60%', height: '16px' }) };
    }
    function syncBodies(bodies, fleets, focus) {
        const live = new Set(), stationed = stationedByPlanet(fleets);
        let cursor = bodiesHost.firstChild;
        for (const body of bodies) {
            const key = `${body.index}:${body.catalogId}`;
            live.add(key);
            let row = bodyRows.get(key);
            if (!row) {
                row = bodyRow(body);
                bodyRows.set(key, row);
            }
            const element = row.component.element;
            setText(row.name, body.name);
            const parked = formatStationed(stationed.get(body.name));
            setText(row.kind, parked ? `${body.kind} · ${parked}` : body.kind);
            const title = body.isSun ? "Orbit sun" : `Lock ${body.name}`;
            if (element.title !== title)
                element.title = title;
            element.classList.toggle("selected", focus != null && body.index === focus);
            if (cursor !== element)
                bodiesHost.insertBefore(element, cursor);
            cursor = element.nextSibling;
        }
        for (const [key, row] of bodyRows)
            if (!live.has(key)) {
                row.component.destroy();
                bodyRows.delete(key);
            }
    }
    function syncFleets(fleets, selected) {
        const live = new Set();
        let cursor = fleetsHost.firstChild;
        for (const fleet of fleets) {
            live.add(fleet.id);
            let row = fleetRows.get(fleet.id);
            if (!row) {
                const component = ctx.button({ id: `system-fleet-${fleet.id}`, parent: fleetsHost, text: "",
                    className: "ui-planet-row ui-fleet-row", onClick: () => actions.selectSceneFleet?.(fleet.id) });
                component.element.dataset.fleetId = fleet.id;
                row = { component, card: createFleetCard(component.element) };
                fleetRows.set(fleet.id, row);
            }
            row.card.update(fleet);
            row.component.element.classList.toggle("selected", fleet.id === selected);
            if (cursor !== row.component.element)
                fleetsHost.insertBefore(row.component.element, cursor);
            cursor = row.component.element.nextSibling;
        }
        for (const [id, row] of fleetRows)
            if (!live.has(id)) {
                row.component.destroy();
                fleetRows.delete(id);
            }
    }
    function clearRows() {
        for (const row of bodyRows.values())
            row.component.destroy();
        for (const row of fleetRows.values())
            row.component.destroy();
        bodyRows.clear();
        fleetRows.clear();
    }
    const sync = (next) => {
        if (!next.visible) {
            if (lastVisible) {
                panel.element.style.display = "none";
                clearRows();
                lastVisible = false;
            }
            return;
        }
        if (!lastVisible) {
            panel.element.style.display = "";
            lastVisible = true;
        }
        const fleets = next.fleets ?? [], total = next.fleetTotal ?? fleets.length;
        syncBodies(next.bodies, fleets, next.focusIndex);
        syncFleets(fleets, next.selectedFleetId ?? null);
        setText(headingText, `Fleets · ${total}`);
        setHidden(empty, fleets.length > 0);
        setHidden(more.element, total <= fleets.length);
        setText(moreText, `Load more · ${fleets.length} of ${total}`);
        const graphics = next.graphicsCap;
        setHidden(cap, !graphics || graphics.requested <= graphics.shown);
        if (graphics)
            setText(capText, `Graphics cap · ${graphics.shown} of ${graphics.requested} ships`);
        setHidden(draw, !next.sceneDraw);
        setHidden(drawHeading, !next.sceneDraw);
        if (next.sceneDraw)
            setText(drawText, `${next.sceneDraw.fleets} fleets · ${next.sceneDraw.ships} ships`);
    };
    return { panel, sync };
}
//# sourceMappingURL=system-planet-panel.js.map