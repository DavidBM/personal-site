export function decideTapInteraction({ hitClusterId, withinSelectThreshold, selectedId, currentlyEditingClusterId, }) {
    if (!withinSelectThreshold || hitClusterId === null) {
        return {
            action: "clearSelection",
            hideEditHandlesFor: currentlyEditingClusterId,
            nextEditingClusterId: null,
            selectedId: null,
        };
    }
    if (currentlyEditingClusterId === hitClusterId) {
        return {
            action: "exitEditMode",
            clusterId: hitClusterId,
            hideEditHandlesFor: currentlyEditingClusterId,
            nextEditingClusterId: null,
        };
    }
    if (selectedId === hitClusterId && currentlyEditingClusterId === null) {
        return {
            action: "enterEditMode",
            clusterId: hitClusterId,
            nextEditingClusterId: hitClusterId,
        };
    }
    return {
        action: "selectCluster",
        clusterId: hitClusterId,
        hideEditHandlesFor: currentlyEditingClusterId,
        nextEditingClusterId: null,
        selectedId: hitClusterId,
    };
}
export function planTapInteractionEffects(decision) {
    if (decision.action === "clearSelection") {
        return {
            hideEditHandlesFor: decision.hideEditHandlesFor,
            nextEditingClusterId: decision.nextEditingClusterId,
            clearUIObjects: true,
            setSelectedId: decision.selectedId,
            showEditHandlesFor: null,
            connectionColorAction: { type: "none", clusterId: null },
            editModeChanged: null,
        };
    }
    if (decision.action === "exitEditMode") {
        return {
            hideEditHandlesFor: decision.hideEditHandlesFor,
            nextEditingClusterId: decision.nextEditingClusterId,
            clearUIObjects: true,
            setSelectedId: undefined,
            showEditHandlesFor: null,
            connectionColorAction: {
                type: "gradient",
                clusterId: decision.clusterId,
            },
            editModeChanged: { clusterId: decision.clusterId, editMode: false },
        };
    }
    if (decision.action === "enterEditMode") {
        return {
            hideEditHandlesFor: null,
            nextEditingClusterId: decision.nextEditingClusterId,
            clearUIObjects: false,
            setSelectedId: undefined,
            showEditHandlesFor: decision.clusterId,
            connectionColorAction: { type: "clear", clusterId: null },
            editModeChanged: { clusterId: decision.clusterId, editMode: true },
        };
    }
    return {
        hideEditHandlesFor: decision.hideEditHandlesFor,
        nextEditingClusterId: decision.nextEditingClusterId,
        clearUIObjects: true,
        setSelectedId: decision.selectedId,
        showEditHandlesFor: null,
        connectionColorAction: { type: "none", clusterId: null },
        editModeChanged: null,
    };
}
export function planTapInteractionPublications({ effects, handles = [], connectionColors = {}, }) {
    const publications = [];
    if (effects.hideEditHandlesFor !== null) {
        publications.push({
            topic: "hide_edit_handles",
            payload: { clusterId: effects.hideEditHandlesFor },
        });
    }
    if (effects.showEditHandlesFor !== null) {
        publications.push({
            topic: "show_edit_handles",
            payload: {
                clusterId: effects.showEditHandlesFor,
                handles,
            },
        });
    }
    if (effects.connectionColorAction.type === "clear") {
        publications.push({
            topic: "setConnectionColors",
            payload: {},
        });
    }
    else if (effects.connectionColorAction.type === "gradient") {
        publications.push({
            topic: "setConnectionColors",
            payload: connectionColors,
        });
    }
    if (effects.editModeChanged) {
        publications.push({
            topic: "edit_mode_changed",
            payload: effects.editModeChanged,
        });
    }
    return publications;
}
//# sourceMappingURL=tap-selection.js.map