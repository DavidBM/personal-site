import { calculatePositionDelta, isZeroPositionDelta, } from "./worker/galaxy/galaxy-xz-math.js";
export function previewClusterMovement(cluster, position, movedSystems) {
    if (movedSystems)
        movedSystems.length = 0;
    const delta = calculatePositionDelta(cluster.position, position);
    if (isZeroPositionDelta(delta))
        return false;
    setMutablePosition(cluster.position, position);
    moveMatchingSystems(cluster.solarSystems, true, delta, movedSystems);
    return true;
}
export function commitClusterMovement(cluster, startPosition, endPosition, movedSystems) {
    if (movedSystems)
        movedSystems.length = 0;
    const delta = calculatePositionDelta(startPosition, endPosition);
    setMutablePosition(cluster.position, endPosition);
    if (isZeroPositionDelta(delta))
        return false;
    moveMatchingSystems(cluster.solarSystems, false, delta, movedSystems);
    return true;
}
function moveMatchingSystems(systems, jumpGateMatch, delta, movedSystems) {
    for (const system of systems) {
        if (system.isJumpGate !== jumpGateMatch)
            continue;
        offsetMutablePosition(system.position, delta);
        movedSystems?.push(system);
    }
}
function setMutablePosition(target, source) {
    if (typeof target.set === "function") {
        target.set(source.x, source.y, source.z);
        return;
    }
    target.x = source.x;
    target.y = source.y;
    target.z = source.z;
}
function offsetMutablePosition(target, delta) {
    if (typeof target.set === "function") {
        target.set(target.x + delta.x, target.y + delta.y, target.z + delta.z);
        return;
    }
    target.x += delta.x;
    target.y += delta.y;
    target.z += delta.z;
}
//# sourceMappingURL=cluster-movement.js.map