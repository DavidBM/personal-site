import { gpuBudgetControl } from './gpu-budget-control.js';
import { renderResolutionControl } from './render-resolution-control.js';
import { buildEditorGenerationPanel } from "./editor-generation-panel.js";
import { buildEditorStatsPanel } from "./editor-stats-panel.js";
import { buildPlayUIPanels } from "./play-ui.js";
import { buildSystemPlanetPanel, } from "./system-planet-panel.js";
import { installDockLayout, screenAnchor, widgetAnchor } from "./dock-layout.js";
import { buildBattleTuningPanel } from '../features/battles/tuning-panel.js';
import { buildShipTuningPanel } from "./ship-tuning-panel.js";
import { mountSimPauseButton } from "./sim-pause-button.js";
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
    if (mode === 'play')
        switcher.content.append(renderResolutionControl(actions), gpuBudgetControl());
    return switcher.element;
}
function buildEditorContextMenu(ctx, actions, extraWindows = []) {
    const contextMenu = ctx.panel({
        id: "cluster-context-menu",
        title: "Cluster",
        floating: true,
        width: 160,
    });
    contextMenu.element.id = "cluster-context-menu";
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
export function buildEditorUI(ctx, actions, extraWindows = []) {
    const modeSwitcher = addModeSwitcher(ctx, actions, "editor");
    const generation = buildEditorGenerationPanel(ctx, actions);
    const stats = buildEditorStatsPanel(ctx);
    const contextMenu = buildEditorContextMenu(ctx, actions);
    const planetPanel = buildSystemPlanetPanel(ctx, actions, {
        placement: "editor",
    });
    const tuning = buildShipTuningPanel(ctx, actions);
    const battleTuning = buildBattleTuningPanel(ctx, actions);
    const dock = installDockLayout(ctx.root.root, [
        ...extraWindows,
        { id: 'battle-tuning-panel', title: 'Battle', initiallyHidden: true, element: battleTuning.panel.element, anchor: screenAnchor('right', 'top', 56, 12, 310, 530) },
        {
            id: "controls-panel",
            title: "Galaxy",
            element: generation.panel.element,
            anchor: screenAnchor("left", "top", 12, 12, 240, 280),
        },
        {
            id: "ship-tuning-panel",
            title: "Ships",
            element: tuning.panel.element,
            anchor: screenAnchor("left", "bottom", 12, 16, 340, 200),
        },
        {
            id: "stats-panel",
            title: "Stats",
            element: stats.panel.element,
            anchor: screenAnchor("right", "top", 56, 12, 300, 640),
        },
        {
            id: "system-planet-panel",
            title: "System",
            element: planetPanel.panel.element,
            anchor: widgetAnchor("stats-panel", "left", 12, 0, 240, 520),
        },
        {
            id: "ui-mode-switcher",
            title: "Mode",
            element: modeSwitcher,
            anchor: screenAnchor("left", "top", 12, 16, 200, 96, "center"),
        },
    ], {
        paused: () => actions.isSimPaused(),
        toggle: () => actions.toggleSimPaused(),
    }, () => actions.resetCameraOrientation?.());
    ctx.root.register({ id: 'window-dock', kind: 'sidebar', element: dock.element, destroy: dock });
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
function buildLocalPlayDock(ctx, actions) {
    const switcher = addModeSwitcher(ctx, actions, "play");
    const { panels } = buildPlayUIPanels(ctx);
    const battle = buildBattleTuningPanel(ctx, actions);
    const ships = buildShipTuningPanel(ctx, actions);
    const pauseRow = document.createElement('div');
    pauseRow.className = 'micro-actions';
    pauseRow.append(mountSimPauseButton(ctx, actions));
    panels.status.content.prepend(pauseRow);
    const windows = [
        { id: 'battle-tuning-panel', title: 'Battle', initiallyHidden: true, element: battle.panel.element,
            anchor: screenAnchor('right', 'top', 56, 12, 310, 530) },
        { id: 'ship-tuning-panel', title: 'Ships', element: ships.panel.element,
            anchor: screenAnchor('left', 'bottom', 12, 16, 340, 200) },
        { id: 'play-status', title: 'Feed', element: panels.status.element,
            anchor: screenAnchor('right', 'bottom', 56, 16, 280, 140) },
        { id: 'ui-mode-switcher', title: 'Mode', element: switcher,
            anchor: screenAnchor('left', 'top', 12, 16, 200, 96, 'center') },
    ];
    return { panels, windows };
}
export function buildPlayUI(ctx, actions, online = false, extraWindows = []) {
    const local = online ? { panels: {}, windows: [] } : buildLocalPlayDock(ctx, actions);
    const planetPanel = buildSystemPlanetPanel(ctx, actions, { placement: 'play' });
    const performance = online ? ctx.panel({ id: 'stats-panel', title: 'Stats', width: 300 }) : undefined;
    const windows = [
        { id: 'system-planet-panel', title: 'System', element: planetPanel.panel.element,
            anchor: screenAnchor('right', 'top', 56, 12, 240, 520) },
        ...local.windows, ...extraWindows,
    ];
    if (performance)
        windows.push({ id: 'stats-panel', title: 'Stats', element: performance.element,
            initiallyHidden: true, anchor: screenAnchor('right', 'top', 56, 12, 300, 540) });
    const dock = installDockLayout(ctx.root.root, windows, online ? undefined : {
        paused: () => actions.isSimPaused(), toggle: () => actions.toggleSimPaused(),
    }, () => actions.resetCameraOrientation?.());
    ctx.root.register({ id: 'window-dock', kind: 'sidebar', element: dock.element, destroy: dock });
    return { mode: 'play', panels: { ...local.panels, performance }, planetPanel };
}
//# sourceMappingURL=ui-modes.js.map