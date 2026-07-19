/**
 * Cluster regeneration: plan local OPs and apply them through injected deps.
 * Keeps regeneration algorithms out of the App composition root.
 */
import { buildClusterSolarSystemPlan } from "../cluster-solar-system-plan.js";
import { angleXZ, pointAtAngle } from "../math/galaxy-xz-math.js";
import { opAddSolarSystem, opConnectClusters, opConnectSolarSystems, opRemoveConnection, opRemoveSolarSystem, } from "../worker/galaxy/galaxy-ops.js";
/**
 * Center cluster + sorted neighbor ids (extended regenerate).
 */
export function collectExtendedClusterIds(galaxy, clusterId) {
    const cluster = galaxy.getClusterById(clusterId);
    if (!cluster)
        return [];
    const neighborIds = new Set();
    for (const conn of galaxy.connections) {
        if (conn.cluster1.id === clusterId) {
            neighborIds.add(conn.cluster2.id);
        }
        else if (conn.cluster2.id === clusterId) {
            neighborIds.add(conn.cluster1.id);
        }
    }
    return [clusterId, ...Array.from(neighborIds).sort((a, b) => a - b)];
}
/**
 * Build OP batch to regenerate one cluster's solar systems and jump gates.
 * Does not apply OPs — pure plan. Returns null if cluster missing.
 */
export function buildClusterRegenerationOps(galaxy, clusterId, params, nextSystemIdStart) {
    const cluster = galaxy.getClusterById(clusterId);
    if (!cluster)
        return null;
    const connections = galaxy.connections.filter((conn) => conn.cluster1.id === clusterId || conn.cluster2.id === clusterId);
    const neighborInfo = connections.map((conn) => {
        const isCluster1 = conn.cluster1.id === clusterId;
        return {
            neighbor: isCluster1 ? conn.cluster2 : conn.cluster1,
            neighborGate: isCluster1 ? conn.jumpGate2 : conn.jumpGate1,
            neighborCluster: galaxy.getClusterById(isCluster1 ? conn.cluster2.id : conn.cluster1.id),
        };
    });
    const ops = [];
    for (const conn of connections) {
        ops.push(opRemoveConnection(conn.cluster1.id, conn.cluster2.id, { id: conn.jumpGate1.id }, { id: conn.jumpGate2.id }));
    }
    for (const sys of cluster.solarSystems.slice()) {
        ops.push(opRemoveSolarSystem(cluster.id, sys.id));
    }
    if (neighborInfo.length === 0) {
        return { ops, nextSystemId: nextSystemIdStart, maxSystemDistance: 0 };
    }
    let nextId = nextSystemIdStart;
    const newGateSeeds = [];
    const newGateByNeighbor = new Map();
    for (const info of neighborInfo) {
        const neighborCluster = info.neighborCluster;
        if (!neighborCluster)
            continue;
        const angle = angleXZ(cluster.position, neighborCluster.position);
        const pos = pointAtAngle(cluster.position, cluster.radius * 1.07, angle);
        const gate = {
            id: nextId++,
            name: `JumpGate ${cluster.id}->${info.neighbor.id}`,
            position: pos,
            connections: [],
            isJumpGate: true,
            connectedToClusterId: info.neighbor.id,
        };
        newGateSeeds.push({ neighborId: info.neighbor.id, gate });
        newGateByNeighbor.set(info.neighbor.id, { id: gate.id });
    }
    const plan = buildClusterSolarSystemPlan({
        clusterId: cluster.id,
        clusterPosition: {
            x: cluster.position.x,
            y: cluster.position.y,
            z: cluster.position.z,
        },
        clusterRadius: cluster.radius,
        numSolarSystems: params.numSolarSystems,
        jumpGates: newGateSeeds.map(({ gate }) => ({
            id: gate.id,
            name: gate.name,
            position: gate.position,
            connectedToClusterId: gate.connectedToClusterId,
        })),
        nextSystemId: nextId,
    });
    for (const { gate } of newGateSeeds) {
        ops.push(opAddSolarSystem(cluster.id, gate));
    }
    for (const sys of plan.systems) {
        ops.push(opAddSolarSystem(cluster.id, sys));
    }
    for (const [id1, id2] of plan.connections) {
        ops.push(opConnectSolarSystems(cluster.id, id1, id2));
    }
    for (const info of neighborInfo) {
        const gate = newGateByNeighbor.get(info.neighbor.id);
        if (!gate)
            continue;
        ops.push(opConnectClusters(cluster.id, info.neighbor.id, { id: gate.id }, { id: info.neighborGate.id }));
    }
    return {
        ops,
        nextSystemId: plan.nextSystemId,
        maxSystemDistance: plan.maxSystemDistance,
    };
}
/**
 * Regenerate one or more clusters: lifecycle topics + local OPs.
 */
export function regenerateClusters(deps, clusterIds) {
    if (!clusterIds.length)
        return;
    const uniqueIds = [];
    const seen = new Set();
    for (const id of clusterIds) {
        if (seen.has(id))
            continue;
        if (!deps.galaxy.getClusterById(id))
            continue;
        seen.add(id);
        uniqueIds.push(id);
    }
    if (!uniqueIds.length)
        return;
    const regenerationId = Date.now();
    deps.publishRegenerationLifecycle("started", regenerationId, uniqueIds);
    for (const id of uniqueIds) {
        regenerateClusterInternal(deps, id);
    }
    deps.updateStats();
    deps.publishRegenerationLifecycle("complete", regenerationId, uniqueIds);
    deps.publishOpsComplete({
        source: "regeneration",
        regenerationId,
        clusterIds: uniqueIds,
        finalizeBuffers: false,
    });
}
function regenerateClusterInternal(deps, clusterId) {
    const cluster = deps.galaxy.getClusterById(clusterId);
    if (!cluster)
        return;
    const result = buildClusterRegenerationOps(deps.galaxy, clusterId, deps.getGenerationParams(), deps.getMaxSolarSystemId() + 1);
    if (!result)
        return;
    deps.applyLocalOps(result.ops);
    // maxSolarSystemId is advanced by processOps inside applyLocalOps
    cluster.maxSystemDistance = result.maxSystemDistance;
}
//# sourceMappingURL=cluster-regenerator.js.map