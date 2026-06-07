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
export function buildEditorStatsPanel(ctx) {
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
    return {
        panel: statsPanel,
        stats: {
            container: statsPanel.content,
            clusters: totalClusters,
            systems: totalSystems,
            gates: totalGates,
            internalLinks,
        },
    };
}
//# sourceMappingURL=editor-stats-panel.js.map