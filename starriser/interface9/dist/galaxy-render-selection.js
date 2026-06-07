export function createGalaxyRenderSelectionPanel(documentRef, cluster) {
    const panel = documentRef.createElement("div");
    panel.className = "ui-panel webgl-selection-panel";
    panel.style.padding = "8px 10px";
    panel.style.pointerEvents = "none";
    const title = documentRef.createElement("div");
    title.className = "ui-panel-title";
    title.textContent = `Cluster ${cluster.id}`;
    panel.appendChild(title);
    const radius = documentRef.createElement("div");
    radius.className = "ui-muted";
    radius.textContent = `Radius: ${Math.round(cluster.radius)}`;
    panel.appendChild(radius);
    return panel;
}
export function buildGalaxyRenderClusterSelection(cluster, html) {
    return {
        id: `cluster_${cluster.id}`,
        getPosition: () => cluster.position,
        size: {
            x: cluster.radius * 2,
            y: Math.max(120, cluster.radius * 0.5),
            z: cluster.radius * 2,
        },
        html,
        htmlOffset: { x: 8, y: -12 },
        htmlAnchor: "box-right",
        htmlDraggable: false,
    };
}
//# sourceMappingURL=galaxy-render-selection.js.map