/**
 * planning.ts
 *
 * PHASE 1: Pure planning utilities that operate on flat data.
 *
 * These functions take and return only plain data (from galaxy-data.ts)
 * and produce the ops or other artifacts needed by the rest of the system.
 *
 * Goal: Extract the "what should happen" logic out of app.ts (regeneration)
 * and the data generator into testable, pure functions.
 *
 * This module is growing as the main home for regeneration and planning logic
 * during the move from rich objects to flat data + functions.
 */
import { buildClusterSolarSystemPlan } from "../../cluster-solar-system-plan.js";
import { findClusterConnectionsInGalaxyData, getConnectedClusterIdsFromGalaxyData, } from "../../galaxy-data-query.js";
import { opAddSolarSystem, opConnectClusters, opConnectSolarSystems, opRemoveConnection, opRemoveSolarSystem, } from "./galaxy-ops.js";
import { angleXZ, pointAtAngle } from "./galaxy-xz-math.js";
export { getConnectedClusterIdsFromGalaxyData } from "../../galaxy-data-query.js";
/**
 * Given a completed cluster solar system plan, produce the ops needed
 * to add the new solar systems and their internal connections.
 *
 * This is a pure function — no side effects, no rich objects.
 */
export function solarSystemPlanToOps(clusterId, plan) {
    const ops = [];
    for (const sys of plan.systems) {
        // Convert the seed back into the shape expected by opAddSolarSystem
        ops.push(opAddSolarSystem(clusterId, {
            id: sys.id,
            name: sys.name,
            position: sys.position,
            isJumpGate: sys.isJumpGate,
            connections: sys.connections,
            connectedToClusterId: sys.connectedToClusterId,
        }));
    }
    for (const [id1, id2] of plan.connections) {
        ops.push(opConnectSolarSystems(clusterId, id1, id2));
    }
    return ops;
}
export function materializeSolarSystemPlanData(jumpGates, plan) {
    const solarSystems = [
        ...jumpGates.map((gate) => ({
            id: gate.id,
            name: gate.name,
            position: copyPosition(gate.position),
            connections: [],
            isJumpGate: true,
            connectedToClusterId: gate.connectedToClusterId ?? null,
        })),
        ...plan.systems.map((sys) => ({
            id: sys.id,
            name: sys.name,
            position: copyPosition(sys.position),
            connections: [],
            isJumpGate: sys.isJumpGate,
            connectedToClusterId: sys.connectedToClusterId ?? null,
        })),
    ];
    const idToSystem = new Map(solarSystems.map((sys) => [sys.id, sys]));
    for (const [id1, id2] of plan.connections) {
        const sys1 = idToSystem.get(id1);
        const sys2 = idToSystem.get(id2);
        if (!sys1 || !sys2)
            continue;
        addUniqueConnection(sys1.connections, sys2.id);
        addUniqueConnection(sys2.connections, sys1.id);
    }
    return {
        solarSystems,
        maxSystemDistance: plan.maxSystemDistance,
    };
}
export function collectJumpGateSeedsForSolarSystemPlan(solarSystems) {
    return solarSystems
        .filter((system) => system.isJumpGate)
        .map((gate) => ({
        id: gate.id,
        name: gate.name,
        position: copyPosition(gate.position),
        connectedToClusterId: gate.connectedToClusterId ?? null,
    }));
}
export function buildGeneratedClusterSolarSystemUpdate(clusterId, jumpGates, plan) {
    if (!plan.success) {
        return {
            success: false,
            solarSystems: jumpGates.map((gate) => ({
                id: gate.id,
                name: gate.name,
                position: copyPosition(gate.position),
                connections: [],
                isJumpGate: true,
                connectedToClusterId: gate.connectedToClusterId ?? null,
            })),
            maxSystemDistance: 0,
            ops: [],
        };
    }
    const materialized = materializeSolarSystemPlanData(jumpGates, plan);
    return {
        success: true,
        solarSystems: materialized.solarSystems,
        maxSystemDistance: materialized.maxSystemDistance,
        ops: solarSystemPlanToOps(clusterId, plan),
    };
}
export function planGeneratedClusterSolarSystemUpdate({ cluster, numSolarSystems, nextSystemId, buildPlan = buildClusterSolarSystemPlan, }) {
    const jumpGates = collectJumpGateSeedsForSolarSystemPlan(cluster.solarSystems);
    if (!jumpGates.length) {
        return {
            jumpGates,
            nextSystemId,
            update: null,
        };
    }
    const plan = buildPlan({
        clusterId: cluster.id,
        clusterPosition: cluster.position,
        clusterRadius: cluster.radius,
        numSolarSystems,
        jumpGates,
        nextSystemId,
    });
    return {
        jumpGates,
        nextSystemId: plan.nextSystemId,
        update: buildGeneratedClusterSolarSystemUpdate(cluster.id, jumpGates, plan),
    };
}
// =============================================================================
// Regeneration Planning Helpers (Phase 1 pure functions)
// =============================================================================
/**
 * Pure function that, given neighbor connection info for a moved cluster,
 * produces the new jump gate seeds that will be needed.
 *
 * This extracts logic that was previously inline in app.ts regeneration.
 */
export function buildJumpGateSeedsForRegeneration(input) {
    const newGateSeeds = [];
    const newGateByNeighbor = new Map();
    let nextId = input.startingNextId;
    for (const info of input.neighbors) {
        const angle = angleXZ(input.clusterPosition, info.neighbor.position);
        const pos = pointAtAngle(input.clusterPosition, input.clusterRadius * 1.07, angle);
        const gate = {
            id: nextId++,
            name: `JumpGate ${input.clusterId}->${info.neighbor.id}`,
            position: pos,
            connections: [],
            isJumpGate: true,
            connectedToClusterId: info.neighbor.id,
        };
        newGateSeeds.push({ neighborId: info.neighbor.id, gate });
        newGateByNeighbor.set(info.neighbor.id, { id: gate.id });
    }
    return {
        newGateSeeds,
        newGateByNeighbor,
        nextId,
    };
}
/**
 * Pure adapter that converts connection-like records into the flat structure
 * used by regeneration planning helpers.
 *
 * This is an adapter during the transition from rich models to flat data.
 */
export function buildRegenerationConnectionInfo(connections, clusterId) {
    const result = [];
    for (const conn of connections) {
        if (conn.cluster1.id !== clusterId && conn.cluster2.id !== clusterId) {
            continue;
        }
        const isCluster1 = conn.cluster1.id === clusterId;
        const neighbor = isCluster1 ? conn.cluster2 : conn.cluster1;
        const neighborGate = isCluster1 ? conn.jumpGate2 : conn.jumpGate1;
        result.push({
            clusterId1: conn.cluster1.id,
            clusterId2: conn.cluster2.id,
            jumpGate1: { id: conn.jumpGate1.id },
            jumpGate2: { id: conn.jumpGate2.id },
            neighbor: {
                id: neighbor.id,
                position: {
                    x: neighbor.position.x,
                    y: neighbor.position.y,
                    z: neighbor.position.z,
                },
            },
            neighborGate: {
                id: neighborGate.id,
            },
        });
    }
    return result;
}
export function selectRegenerationClusterIdsFromGalaxyData(worldData, clusterIds) {
    const selectedIds = [];
    const seen = new Set();
    for (const clusterId of clusterIds) {
        if (seen.has(clusterId))
            continue;
        if (!worldData.clusters[clusterId])
            continue;
        seen.add(clusterId);
        selectedIds.push(clusterId);
    }
    return selectedIds;
}
export function buildExtendedRegenerationClusterIdsFromGalaxyData(worldData, clusterId) {
    if (!worldData.clusters[clusterId])
        return [];
    return selectRegenerationClusterIdsFromGalaxyData(worldData, [
        clusterId,
        ...getConnectedClusterIdsFromGalaxyData(worldData, clusterId),
    ]);
}
export function buildRegenerationConnectionInfoFromGalaxyData(worldData, clusterId) {
    const connections = findClusterConnectionsInGalaxyData(worldData, clusterId).flatMap((conn) => {
        const cluster1 = worldData.clusters[conn.clusterId1];
        const cluster2 = worldData.clusters[conn.clusterId2];
        if (!cluster1 || !cluster2)
            return [];
        return [
            {
                cluster1: { id: cluster1.id, position: cluster1.position },
                cluster2: { id: cluster2.id, position: cluster2.position },
                jumpGate1: conn.jumpGate1,
                jumpGate2: conn.jumpGate2,
            },
        ];
    });
    return buildRegenerationConnectionInfo(connections, clusterId);
}
export function buildClusterRegenerationFromGalaxyData(input) {
    const cluster = input.worldData.clusters[input.clusterId];
    if (!cluster)
        return null;
    const connections = buildRegenerationConnectionInfoFromGalaxyData(input.worldData, input.clusterId);
    const currentSolarSystemIds = cluster.solarSystems.map((sys) => sys.id);
    const gatePlanning = buildJumpGateSeedsForRegeneration({
        clusterId: cluster.id,
        clusterPosition: cluster.position,
        clusterRadius: cluster.radius,
        neighbors: connections,
        startingNextId: input.startingNextId,
    });
    const plan = buildClusterSolarSystemPlan({
        clusterId: cluster.id,
        clusterPosition: cluster.position,
        clusterRadius: cluster.radius,
        numSolarSystems: input.numSolarSystems,
        jumpGates: gatePlanning.newGateSeeds.map(({ gate }) => ({
            id: gate.id,
            name: gate.name,
            position: gate.position,
            connectedToClusterId: gate.connectedToClusterId,
        })),
        nextSystemId: gatePlanning.nextId,
    });
    const ops = buildClusterRegenerationOps({
        clusterId: cluster.id,
        currentSolarSystemIds,
        connections,
        newGateSeeds: gatePlanning.newGateSeeds,
        newGateByNeighbor: gatePlanning.newGateByNeighbor,
        plan,
    });
    return {
        clusterId: cluster.id,
        currentSolarSystemIds,
        connections,
        plan,
        ops,
        nextSystemId: plan.nextSystemId,
        maxSystemDistance: plan.maxSystemDistance,
    };
}
export function buildRemovalOpsForClusterRegeneration(clusterId, currentSolarSystemIds, connections) {
    const ops = [];
    for (const conn of connections) {
        ops.push(opRemoveConnection(conn.clusterId1, conn.clusterId2, { id: conn.jumpGate1.id }, { id: conn.jumpGate2.id }));
    }
    for (const solarSystemId of currentSolarSystemIds) {
        ops.push(opRemoveSolarSystem(clusterId, solarSystemId));
    }
    return ops;
}
export function buildClusterRegenerationOps(input) {
    const ops = buildRemovalOpsForClusterRegeneration(input.clusterId, input.currentSolarSystemIds, input.connections);
    if (input.connections.length === 0) {
        return ops;
    }
    for (const { gate } of input.newGateSeeds) {
        ops.push(opAddSolarSystem(input.clusterId, gate));
    }
    ops.push(...solarSystemPlanToOps(input.clusterId, input.plan));
    ops.push(...buildReconnectionOps(input.clusterId, input.connections, input.newGateByNeighbor));
    return ops;
}
/**
 * Pure function to build the reconnection ops after planning new jump gates.
 * Replaces inline logic in regeneration.
 */
export function buildReconnectionOps(clusterId, neighborInfo, newGateByNeighbor) {
    const ops = [];
    for (const info of neighborInfo) {
        const gate = newGateByNeighbor.get(info.neighbor.id);
        if (!gate)
            continue;
        ops.push(opConnectClusters(clusterId, info.neighbor.id, { id: gate.id }, { id: info.neighborGate.id }));
    }
    return ops;
}
function copyPosition(position) {
    return {
        x: position.x,
        y: position.y,
        z: position.z,
    };
}
function addUniqueConnection(connections, solarSystemId) {
    if (!connections.includes(solarSystemId)) {
        connections.push(solarSystemId);
    }
}
//# sourceMappingURL=planning.js.map