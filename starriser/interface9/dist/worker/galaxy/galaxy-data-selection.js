export function createGalaxyDataSelectionState(selection = {}) {
    return {
        hoveredId: selection.hoveredId ?? null,
        selectedId: selection.selectedId ?? null,
        editingClusterId: selection.editingClusterId ?? null,
    };
}
export function setGalaxyDataSelectionState(data, selection) {
    const current = data.selection ?? createGalaxyDataSelectionState();
    data.selection = {
        hoveredId: selection.hoveredId === undefined
            ? current.hoveredId
            : selection.hoveredId,
        selectedId: selection.selectedId === undefined
            ? current.selectedId
            : selection.selectedId,
        editingClusterId: selection.editingClusterId === undefined
            ? current.editingClusterId
            : selection.editingClusterId,
    };
    return data.selection;
}
export function clearGalaxyDataSelectionState(data) {
    data.selection = createGalaxyDataSelectionState();
    return data.selection;
}
export function clearGalaxyDataSelectionReferences(data, clusterId) {
    return setGalaxyDataSelectionState(data, {
        hoveredId: data.selection?.hoveredId === clusterId
            ? null
            : data.selection?.hoveredId,
        selectedId: data.selection?.selectedId === clusterId
            ? null
            : data.selection?.selectedId,
        editingClusterId: data.selection?.editingClusterId === clusterId
            ? null
            : data.selection?.editingClusterId,
    });
}
//# sourceMappingURL=galaxy-data-selection.js.map