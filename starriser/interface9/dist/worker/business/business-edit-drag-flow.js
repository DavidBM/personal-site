import { applyBusinessEditDragEffect, } from "./business-state.js";
import { advanceEditDragState, createEmptyEditDragState, } from "./interaction/edit-drag.js";
export function applyBusinessEditDragFlow({ state, projection, worldData, cluster, type, pointerPosition, screenPosition, handleKind, editDragMode, }) {
    if (!cluster) {
        return {
            state: createEmptyEditDragState(),
            consumed: false,
            publication: null,
        };
    }
    const dragStep = advanceEditDragState({
        state,
        type,
        clusterId: cluster.id,
        clusterPosition: cluster.position,
        pointerPosition,
        screenPosition,
        handleKind,
        editDragMode,
    });
    const publication = applyBusinessEditDragEffect({
        projection,
        worldData,
        cluster,
        effect: dragStep.effect,
        nextPosition: dragStep.nextPosition,
    });
    return {
        state: dragStep.state,
        consumed: dragStep.consumed,
        publication,
    };
}
//# sourceMappingURL=business-edit-drag-flow.js.map