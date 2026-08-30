import { buildEditorGenerationPanel } from "./editor-generation-panel.js";
import { buildEditorStatsPanel } from "./editor-stats-panel.js";
import { buildPlayUIPanels } from "./play-ui.js";
import { buildSystemPlanetPanel, } from "./system-planet-panel.js";
export function resolveUIMode(defaultMode = "editor") {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("ui");
    if (requested === "editor" || requested === "play") {
        return requested;
    }
    return defaultMode;
}
function addModeSwitcher(ctx, actions, mode) {
    const switcher = ctx.panel({
        id: "ui-mode-switcher",
        title: "UI Mode",
        floating: true,
        draggable: true,
        width: 200,
        position: {
            x: window.innerWidth * 0.5 - 100,
            y: 16,
        },
    });
    ctx.select({
        id: "ui-mode-select",
        parent: switcher.content,
        options: [
            { value: "editor", label: "Editor" },
            { value: "play", label: "Play" },
        ],
        value: mode,
        onChange: (value) => {
            if (value === "editor" || value === "play") {
                actions.setUIMode(value);
            }
        },
    });
}
function buildEditorContextMenu(ctx, actions) {
    const contextMenu = ctx.panel({
        id: "cluster-context-menu",
        title: "Cluster",
        floating: true,
        width: 180,
    });
    contextMenu.element.style.display = "none";
    const actionSelect = ctx.select({
        id: "cluster-context-action",
        parent: contextMenu.content,
        options: [
            { value: "inspect", label: "Inspect" },
            { value: "regenerate", label: "Regenerate" },
            { value: "regenerate_extended", label: "Extended Regenerate" },
        ],
        value: "inspect",
        onChange: (value) => {
            actions.handleContextMenuAction(value);
        },
    });
    if (!(actionSelect.element instanceof HTMLSelectElement)) {
        throw new Error("Cluster context action must be a select element");
    }
    return {
        panel: contextMenu,
        select: actionSelect.element,
    };
}
export function buildEditorUI(ctx, actions) {
    addModeSwitcher(ctx, actions, "editor");
    const generation = buildEditorGenerationPanel(ctx, actions);
    const stats = buildEditorStatsPanel(ctx);
    const contextMenu = buildEditorContextMenu(ctx, actions);
    const planetPanel = buildSystemPlanetPanel(ctx, actions, {
        placement: "editor",
    });
    return {
        mode: "editor",
        stats: stats.stats,
        getGenerationParams: generation.getGenerationParams,
        contextMenu,
        panels: {
            controls: generation.panel,
            stats: stats.panel,
        },
        fleets: stats.fleets,
        planetPanel,
    };
}
export function buildPlayUI(ctx, actions) {
    addModeSwitcher(ctx, actions, "play");
    const play = buildPlayUIPanels(ctx);
    const planetPanel = buildSystemPlanetPanel(ctx, actions, {
        placement: "play",
    });
    return {
        mode: "play",
        panels: play.panels,
        planetPanel,
    };
}
//# sourceMappingURL=ui-modes.js.map