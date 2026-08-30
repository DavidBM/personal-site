/**
 * Right-side sun + planet list while a compact Kepler SCENE is loaded.
 * Click → UIActions.selectSceneBody (sun orbit / planet lockBody + 4K).
 */
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
function listIdentity(bodies) {
    let s = String(bodies.length);
    for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i];
        s += `|${b.index}:${b.catalogId}`;
    }
    return s;
}
function applySelected(rows, focusIndex) {
    for (let i = 0; i < rows.length; i++) {
        const el = rows[i];
        const idx = Number(el.dataset.index);
        el.classList.toggle("selected", focusIndex != null && idx === focusIndex);
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
    const rebuild = (bodies, focusIndex) => {
        for (const c of rowComponents)
            c.destroy();
        rowComponents.length = 0;
        rowEls.length = 0;
        while (list.element.firstChild) {
            list.element.removeChild(list.element.firstChild);
        }
        for (let i = 0; i < bodies.length; i++) {
            const body = bodies[i];
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
            kindEl.textContent = body.kind;
            btn.element.appendChild(nameEl);
            btn.element.appendChild(kindEl);
            rowComponents.push(btn);
            rowEls.push(btn.element);
        }
        applySelected(rowEls, focusIndex);
    };
    const sync = (next) => {
        if (!next.visible) {
            if (lastVisible) {
                panel.element.style.display = "none";
                lastVisible = false;
            }
            lastIdentity = "";
            lastFocus = undefined;
            return;
        }
        if (!lastVisible) {
            panel.element.style.display = "";
            lastVisible = true;
        }
        const identity = listIdentity(next.bodies);
        if (identity === lastIdentity) {
            if (next.focusIndex !== lastFocus) {
                applySelected(rowEls, next.focusIndex);
                lastFocus = next.focusIndex;
            }
            return;
        }
        rebuild(next.bodies, next.focusIndex);
        lastIdentity = identity;
        lastFocus = next.focusIndex;
    };
    return { panel, sync };
}
//# sourceMappingURL=system-planet-panel.js.map