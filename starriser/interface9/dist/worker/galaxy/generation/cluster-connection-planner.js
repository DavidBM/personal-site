import { distZX, lineIntersectsClusterZX, lineSegmentsCrossXZ, } from "../../../math/galaxy-xz-math.js";
import { createJumpGatePlanner } from "./jump-gate-planner.js";
export function planClusterConnections({ clusters, maxConnections, minDistance, connectionSet, nextSystemId, }) {
    const NEARBY_CANDIDATE_LIMIT = Math.max(12, maxConnections * 8);
    const cellSize = Math.max(minDistance, 1);
    const validConnections = [];
    const connectionCounts = new Map();
    const tempConnectionSet = new Set(connectionSet);
    const jumpGates = createJumpGatePlanner({ clusters, nextSystemId });
    const addedGateIds = new Set();
    for (const cl of clusters) {
        connectionCounts.set(cl.id, cl.connectedTo.length);
    }
    const clusterGrid = buildClusterGrid(clusters, cellSize);
    for (let i = 0; i < clusters.length; ++i) {
        const clusterA = clusters[i];
        if ((connectionCounts.get(clusterA.id) ?? 0) >= maxConnections)
            continue;
        const nearbyClusters = collectNearbyClusters(clusterA, clusterGrid, cellSize, NEARBY_CANDIDATE_LIMIT);
        let candidates = buildCandidates(clusterA, nearbyClusters, connectionCounts, tempConnectionSet, maxConnections);
        let usedFallback = false;
        if (!candidates.length) {
            candidates = buildCandidates(clusterA, clusters, connectionCounts, tempConnectionSet, maxConnections);
            usedFallback = true;
        }
        candidates.sort((a, b) => a.distance - b.distance);
        if (!usedFallback && candidates.length > NEARBY_CANDIDATE_LIMIT) {
            candidates.length = NEARBY_CANDIDATE_LIMIT;
        }
        for (const { clusterB, key } of candidates) {
            if ((connectionCounts.get(clusterA.id) ?? 0) >= maxConnections) {
                continue;
            }
            if ((connectionCounts.get(clusterB.id) ?? 0) >= maxConnections) {
                break;
            }
            const gateA = jumpGates.getOrCreateJumpGate(clusterA, clusterB);
            const gateB = jumpGates.getOrCreateJumpGate(clusterB, clusterA);
            if (isConnectionBlocked(clusterA, clusterB, gateA, gateB, clusters, validConnections)) {
                continue;
            }
            tempConnectionSet.add(key);
            connectionCounts.set(clusterA.id, (connectionCounts.get(clusterA.id) ?? 0) + 1);
            connectionCounts.set(clusterB.id, (connectionCounts.get(clusterB.id) ?? 0) + 1);
            connectionSet.add(key);
            const gateAdditions = [];
            if (addGateToCluster(clusterA, gateA, addedGateIds)) {
                gateAdditions.push({ cluster: clusterA, gate: gateA });
            }
            if (addGateToCluster(clusterB, gateB, addedGateIds)) {
                gateAdditions.push({ cluster: clusterB, gate: gateB });
            }
            clusterA.connectedTo.push(clusterB.id);
            clusterB.connectedTo.push(clusterA.id);
            validConnections.push({
                clusterA,
                clusterB,
                gateA,
                gateB,
                key,
                gateAdditions,
            });
            if ((connectionCounts.get(clusterA.id) ?? 0) >= maxConnections)
                break;
        }
    }
    return {
        connections: validConnections,
        nextSystemId: jumpGates.getNextSystemId(),
    };
}
function buildClusterGrid(clusters, cellSize) {
    const clusterGrid = new Map();
    for (const cluster of clusters) {
        const key = gridKey(cluster.position.x, cluster.position.z, cellSize);
        const cell = clusterGrid.get(key);
        if (cell) {
            cell.push(cluster);
        }
        else {
            clusterGrid.set(key, [cluster]);
        }
    }
    return clusterGrid;
}
function collectNearbyClusters(cluster, clusterGrid, cellSize, limit) {
    const [cx, cz] = cellCoords(cluster.position, cellSize);
    const nearby = [];
    const seen = new Set();
    const maxRing = 4;
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
                const cell = clusterGrid.get(`${gx}:${gz}`);
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
function buildCandidates(clusterA, clusters, connectionCounts, tempConnectionSet, maxConnections) {
    const candidates = [];
    for (const clusterB of clusters) {
        if (clusterA === clusterB)
            continue;
        if ((connectionCounts.get(clusterB.id) ?? 0) >= maxConnections)
            continue;
        const key = `${Math.min(clusterA.id, clusterB.id)}:${Math.max(clusterA.id, clusterB.id)}`;
        if (tempConnectionSet.has(key))
            continue;
        if (clusterA.connectedTo.includes(clusterB.id) ||
            clusterB.connectedTo.includes(clusterA.id)) {
            continue;
        }
        const distance = distZX(clusterA.position, clusterB.position);
        candidates.push({ clusterB, distance, key });
    }
    return candidates;
}
function isConnectionBlocked(clusterA, clusterB, gateA, gateB, clusters, validConnections) {
    const posA = { x: gateA.position.x, z: gateA.position.z };
    const posB = { x: gateB.position.x, z: gateB.position.z };
    for (const validConn of validConnections) {
        const posC = {
            x: validConn.gateA.position.x,
            z: validConn.gateA.position.z,
        };
        const posD = {
            x: validConn.gateB.position.x,
            z: validConn.gateB.position.z,
        };
        if (clusterA.id !== validConn.clusterA.id &&
            clusterA.id !== validConn.clusterB.id &&
            clusterB.id !== validConn.clusterA.id &&
            clusterB.id !== validConn.clusterB.id &&
            lineSegmentsCrossXZ(posA, posB, posC, posD)) {
            return true;
        }
    }
    return lineIntersectsClusterZX(posA, posB, clusters, [
        clusterA.id,
        clusterB.id,
    ]);
}
function addGateToCluster(cluster, gate, addedGateIds) {
    if (addedGateIds.has(gate.id))
        return false;
    const isNewInCluster = !cluster.solarSystems.find((s) => s.id === gate.id);
    if (isNewInCluster) {
        cluster.solarSystems.push(gate);
    }
    addedGateIds.add(gate.id);
    return isNewInCluster;
}
function gridKey(x, z, cellSize) {
    return `${Math.floor(x / cellSize)}:${Math.floor(z / cellSize)}`;
}
function cellCoords(pos, cellSize) {
    return [Math.floor(pos.x / cellSize), Math.floor(pos.z / cellSize)];
}
//# sourceMappingURL=cluster-connection-planner.js.map