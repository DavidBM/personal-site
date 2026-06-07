export function createEmptyEditHandleState() {
    return { handles: [] };
}
export function clearEditHandleState(state, currentlyEditingClusterId) {
    return {
        state: createEmptyEditHandleState(),
        hideEditHandlesFor: state.handles.length > 0 && currentlyEditingClusterId !== null
            ? currentlyEditingClusterId
            : null,
    };
}
export function attachEditHandlesForCluster(state, currentlyEditingClusterId, cluster) {
    return {
        state: {
            handles: buildEditHandlesForCluster(cluster),
        },
        hideEditHandlesFor: state.handles.length > 0 && currentlyEditingClusterId !== null
            ? currentlyEditingClusterId
            : null,
    };
}
export function buildEditHandlesForCluster(cluster) {
    const axisLength = (cluster.radius || 400) * 1.5;
    return [
        {
            id: `axis_x_${cluster.id}`,
            x: cluster.position.x,
            z: cluster.position.z,
            yMin: cluster.position.y - 40,
            yMax: cluster.position.y + 40,
            kind: "axisX",
            clusterId: cluster.id,
        },
        {
            id: `axis_y_${cluster.id}`,
            x: cluster.position.x,
            z: cluster.position.z,
            yMin: cluster.position.y,
            yMax: cluster.position.y + axisLength,
            kind: "axisY",
            clusterId: cluster.id,
        },
        {
            id: `axis_z_${cluster.id}`,
            x: cluster.position.x,
            z: cluster.position.z,
            yMin: cluster.position.y - 40,
            yMax: cluster.position.y + 40,
            kind: "axisZ",
            clusterId: cluster.id,
        },
        {
            id: `plane_xz_${cluster.id}`,
            x: cluster.position.x,
            z: cluster.position.z,
            yMin: cluster.position.y - 50,
            yMax: cluster.position.y + 50,
            kind: "planeXZ",
            clusterId: cluster.id,
        },
    ];
}
//# sourceMappingURL=edit-handles.js.map