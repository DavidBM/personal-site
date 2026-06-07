function forceInput(component) {
    if (!(component.element instanceof HTMLInputElement)) {
        throw new Error(`Expected input element for ${component.id}`);
    }
    return component.element;
}
export function buildEditorGenerationPanel(ctx, actions) {
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
        onClick: (event) => buttonHandlers(event, () => actions.generateGalaxy()),
    });
    ctx.button({
        id: "generateFleet",
        parent: buttonRow.element,
        text: "Generate a Fleet",
        onClick: (event) => buttonHandlers(event, () => actions.generateFleet()),
    });
    ctx.button({
        id: "generateFleetsBulk",
        parent: buttonRow.element,
        text: "Generate 1000 Fleets",
        onClick: (event) => buttonHandlers(event, () => actions.generateFleetsBulk(1000)),
    });
    ctx.button({
        id: "clearGalaxy",
        parent: buttonRow.element,
        text: "Clear Galaxy",
        onClick: (event) => buttonHandlers(event, () => actions.clearGalaxy()),
    });
    return {
        panel: controls,
        getGenerationParams: () => ({
            numClusters: Number.parseInt(numClusters.value, 10),
            numSolarSystems: Number.parseInt(numSolarSystems.value, 10),
            maxConnections: Number.parseInt(maxConnections.value, 10),
            galaxySize: Number.parseFloat(galaxySize.value),
            centerBias: Number.parseFloat(centerBias.value),
            minDistance: Number.parseFloat(minDistance.value),
            heightVariation: 0,
        }),
    };
}
//# sourceMappingURL=editor-generation-panel.js.map