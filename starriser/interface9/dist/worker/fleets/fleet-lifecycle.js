export function enqueueFleetIntraPath(route, clusterId, startId, endId, findSolarPath) {
    if (startId === endId)
        return null;
    const path = findSolarPath(clusterId, startId, endId);
    if (path.length < 2) {
        return { clusterId, solarSystemId: endId };
    }
    route.intraPath = path;
    route.intraIndex = 2;
    return { clusterId, solarSystemId: path[1] };
}
export function resolveNextFleetNode(route, findSolarPath) {
    const current = route.currentNode;
    if (route.intraPath) {
        if (route.intraIndex < route.intraPath.length) {
            const nextId = route.intraPath[route.intraIndex];
            route.intraIndex += 1;
            return { clusterId: current.clusterId, solarSystemId: nextId };
        }
        route.intraPath = null;
    }
    if (route.pendingEdges.length > 0) {
        const edge = route.pendingEdges[0];
        if (current.clusterId === edge.fromClusterId) {
            if (current.solarSystemId !== edge.fromGateId) {
                const next = enqueueFleetIntraPath(route, current.clusterId, current.solarSystemId, edge.fromGateId, findSolarPath);
                if (next)
                    return next;
            }
            route.pendingEdges.shift();
            return {
                clusterId: edge.toClusterId,
                solarSystemId: edge.toGateId,
            };
        }
    }
    if (current.clusterId === route.destination.clusterId) {
        if (current.solarSystemId !== route.destination.solarSystemId) {
            const next = enqueueFleetIntraPath(route, current.clusterId, current.solarSystemId, route.destination.solarSystemId, findSolarPath);
            if (next)
                return next;
            return route.destination;
        }
        return null;
    }
    return null;
}
export function startNextFleetJump(fleet, now, { findSolarPath, computeJumpDuration }) {
    const nextNode = resolveNextFleetNode(fleet, findSolarPath);
    if (!nextNode)
        return { type: "removeFleet" };
    const durationMs = computeJumpDuration(fleet.currentNode, nextNode);
    fleet.state = {
        state: "jumping",
        startTime: now,
        startNode: fleet.currentNode,
        endNode: nextNode,
        durationMs,
    };
    return { type: "publishState", state: fleet.state };
}
export function advanceFleetLifecycle(fleet, now, options) {
    if (fleet.state.state === "jumping") {
        if (now - fleet.state.startTime < fleet.state.durationMs) {
            return { type: "none" };
        }
        fleet.currentNode = fleet.state.endNode;
        fleet.state = {
            state: "cooldown",
            startTime: now,
            node: fleet.currentNode,
            durationMs: options.cooldownMs,
        };
        return { type: "publishState", state: fleet.state };
    }
    if (fleet.state.state === "cooldown") {
        if (now - fleet.state.startTime < fleet.state.durationMs) {
            return { type: "none" };
        }
        return startNextFleetJump(fleet, now, options);
    }
    return { type: "none" };
}
//# sourceMappingURL=fleet-lifecycle.js.map