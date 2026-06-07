export function resolveGalaxyRenderEditHandleCenter(handles) {
    const firstHandle = Array.isArray(handles) ? handles[0] : null;
    if (!firstHandle)
        return { x: 0, y: 0, z: 0 };
    return {
        x: firstHandle.x || 0,
        y: ((firstHandle.yMin || 0) + (firstHandle.yMax || 0)) / 2,
        z: firstHandle.z || 0,
    };
}
export function buildGalaxyRenderEditHandleUserData(clusterId, kind) {
    return {
        __editHandleId: kind === "circle"
            ? `edit_circle_${clusterId}`
            : `edit_pick_${clusterId}`,
        __editHandleKind: "planeXZ",
        __editClusterId: clusterId,
    };
}
export function pickGalaxyRenderEditHandleObject(intersections) {
    if (!intersections.length)
        return null;
    for (const hit of intersections) {
        const object = hit.object;
        if (hasGalaxyRenderEditHandleId(object))
            return object;
        const parent = object.parent;
        if (parent && hasGalaxyRenderEditHandleId(parent))
            return parent;
        if (hasGalaxyRenderEditClusterId(object))
            return object;
    }
    return intersections[0].object;
}
export function readGalaxyRenderEditHandleHit(object) {
    if (!object)
        return null;
    const userData = object.userData ?? {};
    const rawHandleId = userData.__editHandleId;
    const handleId = isGalaxyRenderEditHandleId(rawHandleId)
        ? rawHandleId
        : null;
    const rawHandleKind = userData.__editHandleKind;
    const handleKind = typeof rawHandleKind === "string" ? rawHandleKind : undefined;
    const rawClusterId = userData.__editClusterId;
    const clusterId = typeof rawClusterId === "number" ? rawClusterId : undefined;
    return { handleId, handleKind, clusterId };
}
export function pickGalaxyRenderEditHandleHit(intersections) {
    return readGalaxyRenderEditHandleHit(pickGalaxyRenderEditHandleObject(intersections));
}
function hasGalaxyRenderEditHandleId(object) {
    return isGalaxyRenderEditHandleId(object.userData?.__editHandleId);
}
function hasGalaxyRenderEditClusterId(object) {
    return typeof object.userData?.__editClusterId === "number";
}
function isGalaxyRenderEditHandleId(value) {
    return typeof value === "string" || typeof value === "number";
}
//# sourceMappingURL=galaxy-render-edit-handles.js.map