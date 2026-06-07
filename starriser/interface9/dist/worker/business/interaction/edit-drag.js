export function createEmptyEditDragState() {
    return {
        clusterId: null,
        offset: null,
        axis: null,
        start: null,
    };
}
export function resolveEditDragAxis({ handleKind, editDragMode, }) {
    if (handleKind === "axisX")
        return "x";
    if (handleKind === "axisY")
        return "y";
    if (handleKind === "axisZ")
        return "z";
    if (handleKind === "planeXZ")
        return "xz";
    return editDragMode === "y" ? "y" : "xz";
}
export function calculateEditDragOffset(clusterPosition, pointerPosition) {
    return {
        dx: clusterPosition.x - pointerPosition.x,
        dy: 0,
        dz: clusterPosition.z - pointerPosition.z,
    };
}
export function createEditDragStart(screenPosition, clusterPosition) {
    return {
        screenX: screenPosition.x,
        screenY: screenPosition.y,
        position: {
            x: clusterPosition.x,
            y: clusterPosition.y,
            z: clusterPosition.z,
        },
    };
}
export function advanceEditDragState({ state, type, clusterId, clusterPosition, pointerPosition, screenPosition, handleKind, editDragMode, }) {
    if (type === "down") {
        if (!pointerPosition) {
            return {
                state,
                consumed: true,
                effect: "none",
                nextPosition: null,
            };
        }
        return {
            state: {
                clusterId,
                offset: calculateEditDragOffset(clusterPosition, pointerPosition),
                axis: resolveEditDragAxis({ handleKind, editDragMode }),
                start: screenPosition
                    ? createEditDragStart(screenPosition, clusterPosition)
                    : null,
            },
            consumed: true,
            effect: "none",
            nextPosition: null,
        };
    }
    if (type === "move") {
        if (state.clusterId !== clusterId) {
            return {
                state,
                consumed: true,
                effect: "none",
                nextPosition: null,
            };
        }
        return {
            state,
            consumed: true,
            effect: "update",
            nextPosition: calculateEditDragPosition({
                currentPosition: clusterPosition,
                axis: state.axis ?? "xz",
                offset: state.offset,
                start: state.start,
                pointerPosition,
                screenPosition,
            }),
        };
    }
    if (type === "up") {
        if (state.clusterId !== clusterId) {
            return {
                state,
                consumed: true,
                effect: "none",
                nextPosition: null,
            };
        }
        return {
            state: createEmptyEditDragState(),
            consumed: true,
            effect: "commit",
            nextPosition: null,
        };
    }
    return {
        state,
        consumed: false,
        effect: "none",
        nextPosition: null,
    };
}
export function calculateEditDragPosition({ currentPosition, axis, offset, start, pointerPosition, screenPosition, yScreenScale = 2, }) {
    const next = {
        x: currentPosition.x,
        y: currentPosition.y,
        z: currentPosition.z,
    };
    if ((axis === "xz" || axis === "x" || axis === "z") && pointerPosition) {
        if (axis === "xz" || axis === "x") {
            next.x = pointerPosition.x + (offset ? offset.dx : 0);
        }
        if (axis === "xz" || axis === "z") {
            next.z = pointerPosition.z + (offset ? offset.dz : 0);
        }
    }
    if (axis === "y" && start && screenPosition) {
        const dy = screenPosition.y - start.screenY;
        next.y = start.position.y - dy * yScreenScale;
    }
    return next;
}
//# sourceMappingURL=edit-drag.js.map