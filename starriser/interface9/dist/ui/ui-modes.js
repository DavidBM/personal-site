export function resolveUIMode(defaultMode = "editor") {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("ui");
    if (requested === "editor" || requested === "play") {
        return requested;
    }
    return defaultMode;
}
function addModeSwitcher(ctx, app, mode) {
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
                app.setUIMode(value);
            }
        },
    });
}
function forceInput(component) {
    if (!(component.element instanceof HTMLInputElement)) {
        throw new Error(`Expected input element for ${component.id}`);
    }
    return component.element;
}
function createStatLine(ctx, parent, id, label) {
    const row = ctx.row({
        id: `${id}-row`,
        parent,
        template: "minmax(0, 1fr) auto",
    });
    ctx.text({
        id: `${id}-label`,
        parent: row.element,
        text: label,
        className: "ui-label",
    });
    const value = ctx.text({
        id: `${id}-value`,
        parent: row.element,
        text: "0",
        inline: true,
    });
    if (!(value.element instanceof HTMLSpanElement)) {
        throw new Error(`Expected span element for ${id} value`);
    }
    return value.element;
}
export function buildEditorUI(ctx, app) {
    addModeSwitcher(ctx, app, "editor");
    const controls = ctx.panel({
        id: "controls-panel",
        title: "Galaxy Map Generator",
        width: 360,
    });
    controls.element.style.position = "absolute";
    controls.element.style.top = "12px";
    controls.element.style.left = "12px";
    const inputTemplate = "minmax(0, 1fr) 120px";
    const numClustersRow = ctx.row({
        id: "row-numClusters",
        parent: controls.content,
        template: inputTemplate,
    });
    ctx.text({
        id: "label-numClusters",
        parent: numClustersRow.element,
        text: "Number of Clusters:",
        className: "ui-label",
    });
    const numClusters = forceInput(ctx.inputNumber({
        id: "numClusters",
        parent: numClustersRow.element,
        value: 15000,
        min: 1,
        max: 50000,
    }));
    const numSystemsRow = ctx.row({
        id: "row-numSolarSystems",
        parent: controls.content,
        template: inputTemplate,
    });
    ctx.text({
        id: "label-numSolarSystems",
        parent: numSystemsRow.element,
        text: "Solar Systems per Cluster:",
        className: "ui-label",
    });
    const numSolarSystems = forceInput(ctx.inputNumber({
        id: "numSolarSystems",
        parent: numSystemsRow.element,
        value: 80,
        min: 1,
        max: 200,
    }));
    const maxConnectionsRow = ctx.row({
        id: "row-maxConnections",
        parent: controls.content,
        template: inputTemplate,
    });
    ctx.text({
        id: "label-maxConnections",
        parent: maxConnectionsRow.element,
        text: "Max Connections per Cluster:",
        className: "ui-label",
    });
    const maxConnections = forceInput(ctx.inputNumber({
        id: "maxConnections",
        parent: maxConnectionsRow.element,
        value: 3,
        min: 1,
        max: 10,
    }));
    const internalConnectionsRow = ctx.row({
        id: "row-internalConnections",
        parent: controls.content,
        template: inputTemplate,
    });
    ctx.text({
        id: "label-internalConnections",
        parent: internalConnectionsRow.element,
        text: "Internal Connections:",
        className: "ui-label",
    });
    const internalConnections = forceInput(ctx.inputNumber({
        id: "internalConnections",
        parent: internalConnectionsRow.element,
        value: 3,
        min: 1,
        max: 10,
    }));
    const galaxySizeRow = ctx.row({
        id: "row-galaxySize",
        parent: controls.content,
        template: inputTemplate,
    });
    ctx.text({
        id: "label-galaxySize",
        parent: galaxySizeRow.element,
        text: "Galaxy Size:",
        className: "ui-label",
    });
    const galaxySize = forceInput(ctx.inputNumber({
        id: "galaxySize",
        parent: galaxySizeRow.element,
        value: 300000,
        min: 1,
        step: 0.5,
    }));
    const centerBiasRow = ctx.row({
        id: "row-centerBias",
        parent: controls.content,
        template: inputTemplate,
    });
    ctx.text({
        id: "label-centerBias",
        parent: centerBiasRow.element,
        text: "Cluster Center Bias:",
        className: "ui-label",
    });
    const centerBias = forceInput(ctx.inputNumber({
        id: "centerBias",
        parent: centerBiasRow.element,
        value: 0.6,
        min: -2,
        max: 4,
        step: 0.01,
    }));
    const minDistanceRow = ctx.row({
        id: "row-minDistance",
        parent: controls.content,
        template: inputTemplate,
    });
    ctx.text({
        id: "label-minDistance",
        parent: minDistanceRow.element,
        text: "Minimum Cluster Distance:",
        className: "ui-label",
    });
    const minDistance = forceInput(ctx.inputNumber({
        id: "minDistance",
        parent: minDistanceRow.element,
        value: 1500,
        min: 100,
        max: 2000,
    }));
    const heightVariationRow = ctx.row({
        id: "row-heightVariation",
        parent: controls.content,
        template: inputTemplate,
    });
    ctx.text({
        id: "label-heightVariation",
        parent: heightVariationRow.element,
        text: "Height Variation (%):",
        className: "ui-label",
    });
    const heightVariation = forceInput(ctx.inputNumber({
        id: "heightVariation",
        parent: heightVariationRow.element,
        value: 0,
        min: 0,
        max: 20,
    }));
    const showLabelsRow = ctx.row({
        id: "row-showLabels",
        parent: controls.content,
        template: "minmax(0, 1fr) auto",
    });
    ctx.text({
        id: "label-showLabels",
        parent: showLabelsRow.element,
        text: "Show Cluster Labels:",
        className: "ui-label",
    });
    const showLabels = ctx.checkbox({
        id: "showLabels",
        parent: showLabelsRow.element,
        checked: true,
    }).element;
    const buttonRow = ctx.container({
        id: "controls-buttons",
        parent: controls.content,
        className: "ui-panel-content",
    });
    const buttonHandlers = (event, action) => {
        event.preventDefault();
        event.stopPropagation();
        action();
    };
    ctx.button({
        id: "generateClusters",
        parent: buttonRow.element,
        text: "Generate Galaxy",
        onClick: (event) => buttonHandlers(event, () => app.generateGalaxy()),
    });
    ctx.button({
        id: "generateInternalConnections",
        parent: buttonRow.element,
        text: "Create Internal Connections",
        onClick: (event) => buttonHandlers(event, () => app.generateInternalConnections()),
    });
    ctx.button({
        id: "clearGalaxy",
        parent: buttonRow.element,
        text: "Clear Galaxy",
        onClick: (event) => buttonHandlers(event, () => app.clearGalaxy()),
    });
    ctx.button({
        id: "toggleDimensionality",
        parent: buttonRow.element,
        text: "Flip 2D / 3D",
        title: "Toggle between 2D (flat) and 3D (default) layout of the galaxy map.",
        onClick: (event) => buttonHandlers(event, () => app.renderer.toggleDimensionality()),
    });
    const statsPanel = ctx.panel({
        id: "stats-panel",
        title: "Stats",
        width: 300,
    });
    statsPanel.element.style.position = "absolute";
    statsPanel.element.style.top = "12px";
    statsPanel.element.style.right = "12px";
    const totalClusters = createStatLine(ctx, statsPanel.content, "totalClusters", "Clusters:");
    const totalSystems = createStatLine(ctx, statsPanel.content, "totalSystems", "Solar Systems:");
    const totalGates = createStatLine(ctx, statsPanel.content, "totalGates", "Jump Gates:");
    const internalLinks = createStatLine(ctx, statsPanel.content, "internalLinks", "Internal Links:");
    const statsBindings = {
        container: statsPanel.content,
        clusters: totalClusters,
        systems: totalSystems,
        gates: totalGates,
        internalLinks,
    };
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
            app.handleContextMenuAction(value);
        },
    });
    if (!(actionSelect.element instanceof HTMLSelectElement)) {
        throw new Error("Cluster context action must be a select element");
    }
    return {
        mode: "editor",
        stats: statsBindings,
        getGenerationParams: () => ({
            numClusters: Number.parseInt(numClusters.value, 10),
            numSolarSystems: Number.parseInt(numSolarSystems.value, 10),
            maxConnections: Number.parseInt(maxConnections.value, 10),
            internalConnections: Number.parseInt(internalConnections.value, 10),
            galaxySize: Number.parseFloat(galaxySize.value),
            centerBias: Number.parseFloat(centerBias.value),
            minDistance: Number.parseFloat(minDistance.value),
            heightVariation: Number.parseFloat(heightVariation.value),
            showLabels: showLabels.checked,
            generateInternalConnections: false,
        }),
        contextMenu: {
            panel: contextMenu,
            select: actionSelect.element,
        },
        panels: {
            controls,
            stats: statsPanel,
        },
    };
}
export function buildPlayUI(ctx, app) {
    addModeSwitcher(ctx, app, "play");
    ctx.sidebar({
        id: "play-sidebar",
        items: [
            { id: "nav", icon: "N", title: "Navigation" },
            { id: "fleet", icon: "F", title: "Fleet" },
            { id: "intel", icon: "I", title: "Intel" },
            { id: "market", icon: "M", title: "Market" },
        ],
    });
    const statusPanel = ctx.panel({
        id: "play-status",
        title: "Command Feed",
        width: 280,
    });
    statusPanel.element.style.position = "absolute";
    statusPanel.element.style.right = "16px";
    statusPanel.element.style.bottom = "16px";
    ctx.text({
        id: "play-status-line-1",
        parent: statusPanel.content,
        text: "Awaiting orders...",
        muted: true,
    });
    ctx.text({
        id: "play-status-line-2",
        parent: statusPanel.content,
        text: "No fleet activity detected.",
        muted: true,
    });
    ctx.select({
        id: "play-focus-select",
        options: [
            { value: "routes", label: "Routes" },
            { value: "targets", label: "Targets" },
            { value: "signals", label: "Signals" },
        ],
        value: "routes",
        floating: true,
        draggable: true,
        position: {
            x: window.innerWidth * 0.5 - 90,
            y: window.innerHeight * 0.5 - 40,
        },
        onChange: (value) => {
            console.log("Play focus set:", value);
        },
    });
    return {
        mode: "play",
        panels: {
            status: statusPanel,
        },
    };
}
//# sourceMappingURL=ui-modes.js.map