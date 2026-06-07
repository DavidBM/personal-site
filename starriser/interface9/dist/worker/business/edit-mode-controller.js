export function createEditModeController() {
    let uiObjects = [];
    let currentlyEditingClusterId = null;
    let editDragClusterId = null;
    let editDragOffset = null;
    let editDragAxis = null;
    let editDragStart = null;
    const resetDrag = () => {
        editDragClusterId = null;
        editDragOffset = null;
        editDragAxis = null;
        editDragStart = null;
    };
    return {
        getEditingClusterId: () => currentlyEditingClusterId,
        setEditingClusterId: (clusterId) => {
            currentlyEditingClusterId = clusterId;
        },
        hasUIObjects: () => uiObjects.length > 0,
        clearUIObjects: () => {
            uiObjects = [];
        },
        clearAll: () => {
            uiObjects = [];
            currentlyEditingClusterId = null;
            resetDrag();
        },
        resetDrag,
        attachUIObjectsForCluster: (cluster) => {
            const axisLength = (cluster.radius || 400) * 1.5;
            uiObjects = [
                {
                    id: `axis_x_${cluster.id}`,
                    x: cluster.position.x,
                    z: cluster.position.z,
                    yMin: 0,
                    yMax: 0,
                    kind: "axisX",
                    clusterId: cluster.id,
                },
                {
                    id: `axis_z_${cluster.id}`,
                    x: cluster.position.x,
                    z: cluster.position.z,
                    yMin: 0,
                    yMax: 0,
                    kind: "axisZ",
                    clusterId: cluster.id,
                },
                {
                    id: `plane_xz_${cluster.id}`,
                    x: cluster.position.x,
                    z: cluster.position.z,
                    yMin: 0,
                    yMax: 0,
                    kind: "planeXZ",
                    clusterId: cluster.id,
                },
            ];
            return uiObjects;
        },
        handlePointerEvent: (data, cluster) => {
            const pointerPos = data.galaxy_position;
            const screenPos = data.screen_position;
            if (data.type === "down" && pointerPos) {
                editDragClusterId = cluster.id;
                editDragOffset = {
                    dx: cluster.position.x - pointerPos.x,
                    dy: 0,
                    dz: cluster.position.z - pointerPos.z,
                };
                editDragAxis =
                    data.handleKind === "axisX"
                        ? "x"
                        : data.handleKind === "axisZ"
                            ? "z"
                            : data.handleKind === "planeXZ"
                                ? "xz"
                                : "xz";
                editDragStart = {
                    screenX: screenPos.x,
                    screenY: screenPos.y,
                    position: {
                        x: cluster.position.x,
                        y: 0,
                        z: cluster.position.z,
                    },
                };
            }
            if (data.type === "move" && editDragClusterId === cluster.id) {
                const axis = editDragAxis ?? "xz";
                if ((axis === "xz" || axis === "x" || axis === "z") && pointerPos) {
                    if (axis === "xz" || axis === "x") {
                        cluster.position.x =
                            pointerPos.x + (editDragOffset ? editDragOffset.dx : 0);
                    }
                    if (axis === "xz" || axis === "z") {
                        cluster.position.z =
                            pointerPos.z + (editDragOffset ? editDragOffset.dz : 0);
                    }
                }
                cluster.position.y = 0;
                return {
                    consumed: true,
                    update: { clusterId: cluster.id, position: cluster.position },
                };
            }
            if (data.type === "up" && editDragClusterId === cluster.id) {
                resetDrag();
                return {
                    consumed: true,
                    commit: { clusterId: cluster.id, position: cluster.position },
                };
            }
            return {
                consumed: data.type === "move" || data.type === "down" || data.type === "up",
            };
        },
    };
}
//# sourceMappingURL=edit-mode-controller.js.map