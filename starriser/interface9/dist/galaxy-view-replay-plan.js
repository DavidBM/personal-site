export function canConnectGalaxyViewReplaySolarSystems(solarSystemId1, solarSystemId2) {
    return solarSystemId1 !== solarSystemId2;
}
export function canUseGalaxyViewReplayJumpGate(jumpGate, connectedClusterId) {
    return (jumpGate.isJumpGate === true &&
        (jumpGate.connectedToClusterId === null ||
            jumpGate.connectedToClusterId === undefined ||
            jumpGate.connectedToClusterId === connectedClusterId));
}
export function canConnectGalaxyViewReplayClusterConnection(ref) {
    if (ref.cluster1.id === ref.cluster2.id)
        return false;
    return (canUseGalaxyViewReplayJumpGate(ref.jumpGate1, ref.cluster2.id) &&
        canUseGalaxyViewReplayJumpGate(ref.jumpGate2, ref.cluster1.id));
}
export function planGalaxyViewReplayConnectionRemoval(jumpGate1, jumpGate2) {
    if (!jumpGate1 || !jumpGate2) {
        return { mode: "clusterPair" };
    }
    return {
        mode: "specificConnection",
        jumpGate1,
        jumpGate2,
    };
}
export function buildGalaxyViewClusterPayloadSolarSystemReplayPlan(solarSystems, existingSolarSystems = []) {
    const normalizedSolarSystems = normalizeGalaxyViewClusterPayloadSolarSystems(solarSystems);
    const nextSolarSystemIds = new Set(normalizedSolarSystems.map((system) => system.id));
    const solarSystemIdsToRemove = normalizedSolarSystems.length === 0
        ? []
        : collectMissingGalaxyViewSolarSystemIds(existingSolarSystems, nextSolarSystemIds);
    return {
        solarSystems: normalizedSolarSystems.map((payload) => buildGalaxyViewSolarSystemReplayPlan(payload, nextSolarSystemIds)),
        solarSystemIdsToRemove,
        requestedConnections: buildGalaxyViewSolarSystemConnectionReplayRequests(normalizedSolarSystems, nextSolarSystemIds),
    };
}
export function buildGalaxyViewSolarSystemReplayPlan(payload, validSolarSystemIds) {
    return {
        payload,
        createPayload: {
            ...payload,
            connections: [],
        },
        requestedConnections: buildGalaxyViewSolarSystemConnectionReplayRequests([
            payload,
        ], validSolarSystemIds).map((request) => request.connectedId),
    };
}
export function buildGalaxyViewAddSolarSystemReplayPlan(payload, existingSolarSystems = []) {
    return buildGalaxyViewSolarSystemReplayPlan(payload, collectGalaxyViewReplayKnownSolarSystemIds(existingSolarSystems, payload.id));
}
export function buildGalaxyViewClusterReplayPlan(payload, existingSolarSystems = []) {
    return {
        payload,
        createPayload: {
            ...payload,
            connectedTo: payload.connectedTo.slice(),
            solarSystems: [],
        },
        solarSystemPlan: buildGalaxyViewClusterPayloadSolarSystemReplayPlan(payload.solarSystems, existingSolarSystems),
    };
}
export function buildGalaxyViewSolarSystemConnectionReplayRequests(solarSystems, validSolarSystemIds) {
    const requests = [];
    const seenKeys = new Set();
    for (const solarSystem of solarSystems) {
        for (const connectedId of solarSystem.connections ?? []) {
            if (!canConnectGalaxyViewReplaySolarSystems(solarSystem.id, connectedId)) {
                continue;
            }
            if (validSolarSystemIds &&
                (!validSolarSystemIds.has(solarSystem.id) ||
                    !validSolarSystemIds.has(connectedId))) {
                continue;
            }
            const key = makeGalaxyViewSolarSystemConnectionReplayRequestKey(solarSystem.id, connectedId);
            if (seenKeys.has(key)) {
                continue;
            }
            seenKeys.add(key);
            requests.push({
                solarSystemId: solarSystem.id,
                connectedId,
            });
        }
    }
    return requests;
}
export function collectGalaxyViewReplayKnownSolarSystemIds(existingSolarSystems, includedSolarSystemId) {
    const ids = new Set();
    for (const solarSystem of existingSolarSystems) {
        ids.add(solarSystem.id);
    }
    ids.add(includedSolarSystemId);
    return ids;
}
function makeGalaxyViewSolarSystemConnectionReplayRequestKey(solarSystemId1, solarSystemId2) {
    return solarSystemId1 < solarSystemId2
        ? `${solarSystemId1}:${solarSystemId2}`
        : `${solarSystemId2}:${solarSystemId1}`;
}
export function normalizeGalaxyViewClusterPayloadSolarSystems(solarSystems) {
    const systemsById = new Map();
    const systemOrder = [];
    for (const payload of solarSystems) {
        if (!systemsById.has(payload.id)) {
            systemOrder.push(payload.id);
        }
        systemsById.set(payload.id, payload);
    }
    return systemOrder
        .map((id) => systemsById.get(id))
        .filter((payload) => Boolean(payload));
}
function collectMissingGalaxyViewSolarSystemIds(existingSolarSystems, nextSolarSystemIds) {
    const removed = [];
    for (const solarSystem of existingSolarSystems) {
        if (!nextSolarSystemIds.has(solarSystem.id)) {
            removed.push(solarSystem.id);
        }
    }
    return removed;
}
//# sourceMappingURL=galaxy-view-replay-plan.js.map