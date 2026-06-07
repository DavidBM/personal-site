import { angleXZ, distZX, lineIntersectsClusterZX, lineSegmentsCrossXZ, pointAtAngle, } from "./galaxy-xz-math.js";
export const DEFAULT_SHARED_JUMP_GATE_ANGLE_THRESHOLD = (15 * Math.PI) / 180;
export function makeGeneratorConnectionKey(clusterId1, clusterId2) {
    return `${Math.min(clusterId1, clusterId2)}:${Math.max(clusterId1, clusterId2)}`;
}
export function buildClusterSpatialGrid(clusters, cellSize) {
    const grid = new Map();
    for (const cluster of clusters) {
        const key = gridKey(cluster.position, cellSize);
        const cell = grid.get(key);
        if (cell) {
            cell.push(cluster);
        }
        else {
            grid.set(key, [cluster]);
        }
    }
    return grid;
}
export function collectNearbyClusters(grid, cluster, cellSize, limit, maxRing = 4) {
    const [cx, cz] = cellCoords(cluster.position, cellSize);
    const nearby = [];
    const seen = new Set();
    for (let ring = 0; ring <= maxRing && nearby.length < limit; ++ring) {
        for (let gx = cx - ring; gx <= cx + ring; ++gx) {
            for (let gz = cz - ring; gz <= cz + ring; ++gz) {
                if (ring > 0 &&
                    gx > cx - ring &&
                    gx < cx + ring &&
                    gz > cz - ring &&
                    gz < cz + ring) {
                    continue;
                }
                const cell = grid.get(`${gx}:${gz}`);
                if (!cell)
                    continue;
                for (const other of cell) {
                    if (seen.has(other.id))
                        continue;
                    seen.add(other.id);
                    nearby.push(other);
                    if (nearby.length >= limit)
                        break;
                }
                if (nearby.length >= limit)
                    break;
            }
            if (nearby.length >= limit)
                break;
        }
    }
    return nearby;
}
export function buildClusterConnectionCandidates(clusterA, clusters, connectionCounts, existingConnectionKeys, maxConnections) {
    const candidates = [];
    for (const clusterB of clusters) {
        if (clusterA.id === clusterB.id)
            continue;
        if ((connectionCounts.get(clusterB.id) ?? 0) >= maxConnections)
            continue;
        const key = makeGeneratorConnectionKey(clusterA.id, clusterB.id);
        if (existingConnectionKeys.has(key))
            continue;
        if (clusterA.connectedTo.includes(clusterB.id) ||
            clusterB.connectedTo.includes(clusterA.id)) {
            continue;
        }
        candidates.push({
            clusterB,
            distance: distZX(clusterA.position, clusterB.position),
            key,
        });
    }
    return candidates;
}
export function buildInitialClusterConnectionCounts(clusters) {
    const connectionCounts = new Map();
    for (const cluster of clusters) {
        connectionCounts.set(cluster.id, cluster.connectedTo.length);
    }
    return connectionCounts;
}
export function buildClusterJumpGateMap(clusters) {
    const jumpGatesByClusterId = new Map();
    for (const cluster of clusters) {
        jumpGatesByClusterId.set(cluster.id, cluster.solarSystems.filter((system) => system.isJumpGate));
    }
    return jumpGatesByClusterId;
}
export function buildNearestClusterConnectionCandidates(clusterA, nearbyClusters, allClusters, connectionCounts, existingConnectionKeys, maxConnections, nearbyCandidateLimit) {
    let candidates = buildClusterConnectionCandidates(clusterA, nearbyClusters, connectionCounts, existingConnectionKeys, maxConnections);
    let usedFallback = false;
    if (!candidates.length) {
        candidates = buildClusterConnectionCandidates(clusterA, allClusters, connectionCounts, existingConnectionKeys, maxConnections);
        usedFallback = true;
    }
    candidates.sort((a, b) => a.distance - b.distance);
    if (!usedFallback && candidates.length > nearbyCandidateLimit) {
        candidates.length = nearbyCandidateLimit;
    }
    return { candidates, usedFallback };
}
export function buildClusterConnectionCandidatesFromGrid(input) {
    const nearbyClusters = collectNearbyClusters(input.grid, input.cluster, input.cellSize, input.nearbyCandidateLimit, input.maxRing);
    return buildNearestClusterConnectionCandidates(input.cluster, nearbyClusters, input.allClusters, input.connectionCounts, input.existingConnectionKeys, input.maxConnections, input.nearbyCandidateLimit);
}
export function findReusableJumpGateForClusterConnection(cluster, targetCluster, jumpGates, angleThreshold = DEFAULT_SHARED_JUMP_GATE_ANGLE_THRESHOLD) {
    const targetAngle = angleXZ(cluster.position, targetCluster.position);
    for (const gate of jumpGates) {
        const gateAngle = angleXZ(cluster.position, gate.position);
        if (angleDifference(targetAngle, gateAngle) <= angleThreshold) {
            return gate;
        }
    }
    return null;
}
export function buildJumpGateForClusterConnection(cluster, targetCluster, nextSystemId, radiusMultiplier = 1.07) {
    const targetAngle = angleXZ(cluster.position, targetCluster.position);
    return {
        jumpGate: {
            id: nextSystemId,
            name: `JumpGate ${cluster.id}->${targetCluster.id}`,
            position: pointAtAngle(cluster.position, cluster.radius * radiusMultiplier, targetAngle),
            connections: [],
            isJumpGate: true,
            connectedToClusterId: targetCluster.id,
        },
        nextSystemId: nextSystemId + 1,
    };
}
export function resolveJumpGateForClusterConnection(cluster, targetCluster, jumpGates, nextSystemId, angleThreshold = DEFAULT_SHARED_JUMP_GATE_ANGLE_THRESHOLD) {
    const existingGate = findReusableJumpGateForClusterConnection(cluster, targetCluster, jumpGates, angleThreshold);
    if (existingGate) {
        existingGate.connectedToClusterId = null;
        existingGate.name = `Shared JumpGate ${cluster.id}`;
        return {
            jumpGate: existingGate,
            nextSystemId,
            created: false,
        };
    }
    const gatePlanning = buildJumpGateForClusterConnection(cluster, targetCluster, nextSystemId);
    jumpGates.push(gatePlanning.jumpGate);
    return {
        jumpGate: gatePlanning.jumpGate,
        nextSystemId: gatePlanning.nextSystemId,
        created: true,
    };
}
export function resolveClusterJumpGateFromMap(cluster, targetCluster, jumpGatesByClusterId, nextSystemId, angleThreshold = DEFAULT_SHARED_JUMP_GATE_ANGLE_THRESHOLD) {
    let jumpGates = jumpGatesByClusterId.get(cluster.id);
    if (!jumpGates) {
        jumpGates = [];
        jumpGatesByClusterId.set(cluster.id, jumpGates);
    }
    return resolveJumpGateForClusterConnection(cluster, targetCluster, jumpGates, nextSystemId, angleThreshold);
}
export function attemptGeneratedClusterConnection(input) {
    const gateAResolution = resolveClusterJumpGateFromMap(input.clusterA, input.clusterB, input.jumpGatesByClusterId, input.nextSystemId, input.angleThreshold);
    const gateBResolution = resolveClusterJumpGateFromMap(input.clusterB, input.clusterA, input.jumpGatesByClusterId, gateAResolution.nextSystemId, input.angleThreshold);
    const nextSystemId = gateBResolution.nextSystemId;
    const gateA = gateAResolution.jumpGate;
    const gateB = gateBResolution.jumpGate;
    const blocked = isClusterConnectionBlockedByGeometry({
        clusterA: input.clusterA,
        clusterB: input.clusterB,
        gateA,
        gateB,
    }, input.state.acceptedConnections, input.clusters);
    if (blocked) {
        return {
            accepted: false,
            blocked: true,
            nextSystemId,
            gateA,
            gateB,
            connection: null,
            attachedJumpGates: [],
        };
    }
    const accepted = acceptGeneratedClusterConnection(input.state, input.clusterA, input.clusterB, gateA, gateB, input.key, input.attachedJumpGateIds);
    return {
        accepted: true,
        blocked: false,
        nextSystemId,
        gateA,
        gateB,
        connection: accepted.connection,
        attachedJumpGates: accepted.attachedJumpGates,
    };
}
export function isClusterConnectionBlockedByGeometry(candidate, acceptedConnections, clusters) {
    const posA = {
        x: candidate.gateA.position.x,
        z: candidate.gateA.position.z,
    };
    const posB = {
        x: candidate.gateB.position.x,
        z: candidate.gateB.position.z,
    };
    for (const accepted of acceptedConnections) {
        const posC = {
            x: accepted.gateA.position.x,
            z: accepted.gateA.position.z,
        };
        const posD = {
            x: accepted.gateB.position.x,
            z: accepted.gateB.position.z,
        };
        if (candidate.clusterA.id !== accepted.clusterA.id &&
            candidate.clusterA.id !== accepted.clusterB.id &&
            candidate.clusterB.id !== accepted.clusterA.id &&
            candidate.clusterB.id !== accepted.clusterB.id &&
            lineSegmentsCrossXZ(posA, posB, posC, posD)) {
            return true;
        }
    }
    return lineIntersectsClusterZX(posA, posB, clusters, [
        candidate.clusterA.id,
        candidate.clusterB.id,
    ]);
}
export function acceptClusterConnectionState(state, clusterA, clusterB, gateA, gateB, key) {
    const connection = {
        clusterA,
        clusterB,
        gateA,
        gateB,
        key,
    };
    state.acceptedConnections.push(connection);
    state.tempConnectionKeys.add(key);
    state.committedConnectionKeys.add(key);
    incrementConnectionCount(state.connectionCounts, clusterA.id);
    incrementConnectionCount(state.connectionCounts, clusterB.id);
    addUniqueClusterConnection(clusterA.connectedTo, clusterB.id);
    addUniqueClusterConnection(clusterB.connectedTo, clusterA.id);
    return connection;
}
export function attachGeneratedJumpGateToCluster(cluster, jumpGate) {
    if (cluster.solarSystems.some((system) => system.id === jumpGate.id)) {
        return false;
    }
    cluster.solarSystems.push(jumpGate);
    return true;
}
export function acceptGeneratedClusterConnection(state, clusterA, clusterB, gateA, gateB, key, attachedJumpGateIds) {
    const attachedJumpGates = [];
    if (!attachedJumpGateIds.has(gateA.id)) {
        if (attachGeneratedJumpGateToCluster(clusterA, gateA)) {
            attachedJumpGates.push({ clusterId: clusterA.id, jumpGate: gateA });
        }
        attachedJumpGateIds.add(gateA.id);
    }
    if (!attachedJumpGateIds.has(gateB.id)) {
        if (attachGeneratedJumpGateToCluster(clusterB, gateB)) {
            attachedJumpGates.push({ clusterId: clusterB.id, jumpGate: gateB });
        }
        attachedJumpGateIds.add(gateB.id);
    }
    const connection = acceptClusterConnectionState(state, clusterA, clusterB, gateA, gateB, key);
    return { connection, attachedJumpGates };
}
export function removeUnconnectedGeneratedClusters(clusters) {
    const remainingClusters = [];
    const removedClusterIds = [];
    for (const cluster of clusters) {
        if (cluster.connectedTo.length === 0) {
            removedClusterIds.push(cluster.id);
        }
        else {
            remainingClusters.push(cluster);
        }
    }
    return { remainingClusters, removedClusterIds };
}
function gridKey(position, cellSize) {
    const [x, z] = cellCoords(position, cellSize);
    return `${x}:${z}`;
}
function cellCoords(position, cellSize) {
    return [
        Math.floor(position.x / cellSize),
        Math.floor(position.z / cellSize),
    ];
}
function angleDifference(angleA, angleB) {
    const diff = Math.abs(angleA - angleB);
    return diff > Math.PI ? 2 * Math.PI - diff : diff;
}
function incrementConnectionCount(connectionCounts, clusterId) {
    connectionCounts.set(clusterId, (connectionCounts.get(clusterId) ?? 0) + 1);
}
function addUniqueClusterConnection(connectedTo, clusterId) {
    if (!connectedTo.includes(clusterId)) {
        connectedTo.push(clusterId);
    }
}
//# sourceMappingURL=generation-graph.js.map