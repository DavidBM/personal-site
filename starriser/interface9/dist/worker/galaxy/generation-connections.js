import { attemptGeneratedClusterConnection, buildClusterConnectionCandidatesFromGrid, buildClusterJumpGateMap, buildClusterSpatialGrid, buildInitialClusterConnectionCounts, } from "./generation-graph.js";
import { buildGeneratedClusterConnectionOps } from "./generation-ops.js";
export function connectGeneratedClusters(input) {
    const nearbyCandidateLimit = input.nearbyCandidateLimit ?? Math.max(12, input.maxConnections * 8);
    const cellSize = Math.max(input.minDistance, 1);
    const acceptedConnections = [];
    const connectionCounts = buildInitialClusterConnectionCounts(input.clusters);
    const tempConnectionSet = new Set(input.committedConnectionKeys);
    const clusterJumpGates = buildClusterJumpGateMap(input.clusters);
    const clusterGrid = buildClusterSpatialGrid(input.clusters, cellSize);
    const attachedJumpGateIds = new Set();
    const ops = [];
    let nextSystemId = input.nextSystemId;
    for (let i = 0; i < input.clusters.length; ++i) {
        const clusterA = input.clusters[i];
        if ((connectionCounts.get(clusterA.id) ?? 0) >= input.maxConnections) {
            continue;
        }
        const { candidates } = buildClusterConnectionCandidatesFromGrid({
            grid: clusterGrid,
            cluster: clusterA,
            cellSize,
            allClusters: input.clusters,
            connectionCounts,
            existingConnectionKeys: tempConnectionSet,
            maxConnections: input.maxConnections,
            nearbyCandidateLimit,
        });
        for (const { clusterB, key } of candidates) {
            if ((connectionCounts.get(clusterA.id) ?? 0) >= input.maxConnections) {
                continue;
            }
            if ((connectionCounts.get(clusterB.id) ?? 0) >= input.maxConnections) {
                break;
            }
            const attempt = attemptGeneratedClusterConnection({
                state: {
                    acceptedConnections,
                    tempConnectionKeys: tempConnectionSet,
                    committedConnectionKeys: input.committedConnectionKeys,
                    connectionCounts,
                },
                clusters: input.clusters,
                jumpGatesByClusterId: clusterJumpGates,
                attachedJumpGateIds,
                nextSystemId,
                clusterA,
                clusterB,
                key,
            });
            nextSystemId = attempt.nextSystemId;
            if (attempt.accepted) {
                const connectionOps = buildGeneratedClusterConnectionOps({
                    clusterAId: clusterA.id,
                    clusterBId: clusterB.id,
                    gateA: attempt.gateA,
                    gateB: attempt.gateB,
                    attachedJumpGates: attempt.attachedJumpGates,
                });
                ops.push(...connectionOps);
                input.onConnectionOps?.(connectionOps);
                if ((connectionCounts.get(clusterA.id) ?? 0) >= input.maxConnections) {
                    break;
                }
            }
        }
    }
    return {
        nextSystemId,
        acceptedConnections,
        ops,
    };
}
//# sourceMappingURL=generation-connections.js.map