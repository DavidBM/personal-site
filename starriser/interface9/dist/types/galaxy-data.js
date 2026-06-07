/**
 * galaxy-data.ts
 *
 * Phase 0 — Initial flat, data-only contracts for the world state.
 *
 * GOAL (long term):
 * - All core simulation, planning, validation, and mutation logic operates on
 *   plain, serializable data structures.
 * - No THREE.js objects, no circular references, minimal methods.
 * - These types are the single source of truth for "what the galaxy IS".
 *
 * This file is intentionally minimal and forward-looking.
 * Existing code still uses the older *Payload / rich class shapes.
 * We will migrate incrementally during later phases.
 *
 * See AGENTS.md sections 10 and 11 for context on the data model direction.
 */
import { makeGalaxyDataClusterPairKey, makeGalaxyDataSolarSystemConnectionKey, } from "../galaxy-data-connections.js";
// =============================================================================
// Lightweight Validation / Harness Support (Phase 0)
// =============================================================================
/**
 * Structural validation for GalaxyData.
 * This intentionally stays dependency-free so it can run in workers, browser
 * consoles, and the lightweight Node test harness.
 */
export function validateGalaxyData(data) {
    const errors = [];
    if (!data.clusters || typeof data.clusters !== "object") {
        errors.push("clusters must be an object");
    }
    if (!Array.isArray(data.clusterOrder)) {
        errors.push("clusterOrder must be an array");
    }
    if (!Array.isArray(data.connections)) {
        errors.push("connections must be an array");
    }
    validateGalaxySelectionState(data.selection, data.clusters ?? {}, errors);
    const clusters = data.clusters ?? {};
    const clusterOrder = data.clusterOrder ?? [];
    const clusterOrderSet = new Set();
    for (const id of clusterOrder) {
        if (clusterOrderSet.has(id)) {
            errors.push(`clusterOrder contains duplicate cluster ${id}`);
        }
        clusterOrderSet.add(id);
        if (!clusters[id]) {
            errors.push(`clusterOrder references missing cluster ${id}`);
        }
    }
    const clusterIds = Object.keys(clusters).map((id) => Number(id));
    for (const id of clusterIds) {
        if (!clusterOrderSet.has(id)) {
            errors.push(`cluster ${id} is missing from clusterOrder`);
        }
    }
    const systemsByCluster = new Map();
    const connectedClusterPairs = new Set();
    for (const id of clusterIds) {
        const cluster = clusters[id];
        if (!cluster)
            continue;
        if (cluster.id !== id) {
            errors.push(`cluster key ${id} does not match cluster id ${cluster.id}`);
        }
        validateClusterConnectedTo(cluster, clusters, errors);
        if (!Array.isArray(cluster.solarSystems)) {
            errors.push(`cluster ${cluster.id} solarSystems must be an array`);
            continue;
        }
        const systems = new Map();
        systemsByCluster.set(cluster.id, systems);
        for (const sys of cluster.solarSystems) {
            if (systems.has(sys.id)) {
                errors.push(`cluster ${cluster.id} contains duplicate solar system ${sys.id}`);
            }
            validateSolarSystemConnectedToCluster(sys, cluster, clusters, errors);
            systems.set(sys.id, sys);
        }
        for (const sys of cluster.solarSystems) {
            if (!Array.isArray(sys.connections)) {
                errors.push(`solar system ${cluster.id}:${sys.id} connections must be an array`);
                continue;
            }
            const connectedIds = new Set();
            for (const connectedId of sys.connections) {
                if (connectedIds.has(connectedId)) {
                    errors.push(`solar system ${cluster.id}:${sys.id} contains duplicate local connection ${connectedId}`);
                }
                connectedIds.add(connectedId);
                if (connectedId === sys.id) {
                    errors.push(`solar system ${cluster.id}:${sys.id} references itself`);
                }
                const connected = systems.get(connectedId);
                if (!connected) {
                    errors.push(`solar system ${cluster.id}:${sys.id} references unknown local system ${connectedId}`);
                    continue;
                }
                if (!connected.connections.includes(sys.id)) {
                    errors.push(`solar system connection ${cluster.id}:${sys.id}-${connectedId} is not symmetric`);
                }
            }
        }
    }
    const getSystem = (clusterId, solarSystemId) => systemsByCluster.get(clusterId)?.get(solarSystemId) ?? null;
    const connectionKeys = new Set();
    for (const conn of data.connections ?? []) {
        validateClusterConnection(conn, clusters, getSystem, connectionKeys, connectedClusterPairs, errors);
    }
    validateConnectedToBackedByConnections(clusterIds, clusters, connectedClusterPairs, errors);
    return {
        valid: errors.length === 0,
        errors,
    };
}
export function computeGalaxyDataStats(data) {
    let solarSystems = 0;
    let jumpGates = 0;
    const internalConnectionKeys = new Set();
    for (const cluster of Object.values(data.clusters)) {
        solarSystems += cluster.solarSystems.length;
        for (const system of cluster.solarSystems) {
            if (system.isJumpGate) {
                jumpGates++;
            }
            for (const connectedId of system.connections) {
                internalConnectionKeys.add(makeGalaxyDataSolarSystemConnectionKey(cluster.id, system.id, connectedId));
            }
        }
    }
    return {
        clusters: Object.keys(data.clusters).length,
        solarSystems,
        jumpGates,
        connections: data.connections.length,
        internalConnections: internalConnectionKeys.size,
    };
}
function validateClusterConnectedTo(cluster, clusters, errors) {
    if (!Array.isArray(cluster.connectedTo)) {
        errors.push(`cluster ${cluster.id} connectedTo must be an array`);
        return;
    }
    const connectedIds = new Set();
    for (const connectedId of cluster.connectedTo) {
        if (connectedIds.has(connectedId)) {
            errors.push(`cluster ${cluster.id} connectedTo contains duplicate cluster ${connectedId}`);
        }
        connectedIds.add(connectedId);
        if (connectedId === cluster.id) {
            errors.push(`cluster ${cluster.id} connectedTo references itself`);
        }
        if (!clusters[connectedId]) {
            errors.push(`cluster ${cluster.id} connectedTo references unknown cluster ${connectedId}`);
        }
        else if (Array.isArray(clusters[connectedId].connectedTo) &&
            !clusters[connectedId].connectedTo.includes(cluster.id)) {
            errors.push(`cluster connection ${cluster.id}-${connectedId} is not symmetric`);
        }
    }
}
function validateClusterConnection(conn, clusters, getSystem, connectionKeys, connectedClusterPairs, errors) {
    if (conn.clusterId1 === conn.clusterId2) {
        errors.push(`connection references the same cluster ${conn.clusterId1}`);
    }
    const connectionKey = makeConnectionValidationKey(conn);
    if (connectionKeys.has(connectionKey)) {
        errors.push(`connections contain duplicate link ${connectionKey}`);
    }
    connectionKeys.add(connectionKey);
    connectedClusterPairs.add(makeGalaxyDataClusterPairKey(conn.clusterId1, conn.clusterId2));
    validateConnectionClusterEndpoint(conn, conn.clusterId1, conn.clusterId2, clusters, errors);
    validateConnectionClusterEndpoint(conn, conn.clusterId2, conn.clusterId1, clusters, errors);
    validateConnectionJumpGateEndpoint(conn.clusterId1, conn.clusterId2, conn.jumpGate1.id, getSystem(conn.clusterId1, conn.jumpGate1.id), errors);
    validateConnectionJumpGateEndpoint(conn.clusterId2, conn.clusterId1, conn.jumpGate2.id, getSystem(conn.clusterId2, conn.jumpGate2.id), errors);
}
function validateSolarSystemConnectedToCluster(system, cluster, clusters, errors) {
    const connectedToClusterId = system.connectedToClusterId;
    if (connectedToClusterId === null)
        return;
    if (typeof connectedToClusterId !== "number") {
        errors.push(`solar system ${cluster.id}:${system.id} connectedToClusterId must be a cluster id or null`);
        return;
    }
    if (!system.isJumpGate) {
        errors.push(`solar system ${cluster.id}:${system.id} connectedToClusterId is set but system is not a jump gate`);
    }
    if (connectedToClusterId === cluster.id) {
        errors.push(`solar system ${cluster.id}:${system.id} connectedToClusterId references its own cluster`);
    }
    if (!clusters[connectedToClusterId]) {
        errors.push(`solar system ${cluster.id}:${system.id} connectedToClusterId references unknown cluster ${connectedToClusterId}`);
    }
}
function validateConnectionClusterEndpoint(conn, clusterId, connectedClusterId, clusters, errors) {
    const cluster = clusters[clusterId];
    if (!cluster) {
        errors.push(`connection references unknown cluster ${clusterId}`);
        return;
    }
    if (Array.isArray(cluster.connectedTo) &&
        !cluster.connectedTo.includes(connectedClusterId)) {
        errors.push(`connection ${conn.clusterId1}-${conn.clusterId2} missing connectedTo on cluster ${clusterId}`);
    }
}
function validateConnectionJumpGateEndpoint(clusterId, connectedClusterId, solarSystemId, gate, errors) {
    if (!gate) {
        errors.push(`connection references missing jump gate ${clusterId}:${solarSystemId}`);
    }
    else if (!gate.isJumpGate) {
        errors.push(`connection endpoint ${clusterId}:${solarSystemId} is not a jump gate`);
    }
    else if (typeof gate.connectedToClusterId === "number" &&
        gate.connectedToClusterId !== connectedClusterId) {
        errors.push(`connection endpoint ${clusterId}:${solarSystemId} points to cluster ${gate.connectedToClusterId} instead of ${connectedClusterId}`);
    }
}
function validateConnectedToBackedByConnections(clusterIds, clusters, connectedClusterPairs, errors) {
    for (const id of clusterIds) {
        const cluster = clusters[id];
        if (!cluster || !Array.isArray(cluster.connectedTo))
            continue;
        for (const connectedId of cluster.connectedTo) {
            if (!clusters[connectedId])
                continue;
            if (!connectedClusterPairs.has(makeGalaxyDataClusterPairKey(cluster.id, connectedId))) {
                errors.push(`cluster ${cluster.id} connectedTo ${connectedId} has no matching connection`);
            }
        }
    }
}
function validateGalaxySelectionState(selection, clusters, errors) {
    if (!selection || typeof selection !== "object") {
        errors.push("selection must be an object");
        return;
    }
    validateGalaxySelectionReference("hoveredId", selection.hoveredId, clusters, errors);
    validateGalaxySelectionReference("selectedId", selection.selectedId, clusters, errors);
    validateGalaxySelectionReference("editingClusterId", selection.editingClusterId, clusters, errors);
}
function validateGalaxySelectionReference(field, clusterId, clusters, errors) {
    if (clusterId === null)
        return;
    if (typeof clusterId !== "number") {
        errors.push(`selection.${field} must be a cluster id or null`);
        return;
    }
    if (!clusters[clusterId]) {
        errors.push(`selection.${field} references unknown cluster ${clusterId}`);
    }
}
function makeConnectionValidationKey(conn) {
    if (conn.clusterId1 < conn.clusterId2 ||
        (conn.clusterId1 === conn.clusterId2 &&
            conn.jumpGate1.id <= conn.jumpGate2.id)) {
        return `${conn.clusterId1}:${conn.jumpGate1.id}-${conn.clusterId2}:${conn.jumpGate2.id}`;
    }
    return `${conn.clusterId2}:${conn.jumpGate2.id}-${conn.clusterId1}:${conn.jumpGate1.id}`;
}
/**
 * Example usage (for manual / agent-driven validation):
 *
 *   import { validateGalaxyData } from "./types/galaxy-data.js";
 *   const result = validateGalaxyData(someGalaxyData);
 *   if (!result.valid) console.error(result.errors);
 *
 * This is intentionally simple. We can grow a richer set of pure validators
 * and generators as the functional core develops in Phase 1+.
 */
// =============================================================================
// Notes for Future Phases
// =============================================================================
/*
 * Migration thoughts (not implemented yet):
 *
 * 1. The existing `ClusterPayload` and `SolarSystemPayload` are already
 *    reasonably flat. We can evolve them toward the `*Data` shapes above.
 *
 * 2. Rich `Cluster` and `SolarSystem` classes will gradually become thin
 *    "view" or "renderable" wrappers that only the renderer and immediate
 *    interaction code use. They should not be the source of truth.
 *
 * 3. Functions like `buildClusterSolarSystemPlan`, regeneration planning,
 *    BFS coloring, fleet pathing, etc. should be rewritten (or new pure
 *    versions written) to accept and return the `*Data` types.
 *
 * 4. SelectionService, spatial index usage, and edit drag logic will
 *    eventually operate purely on `GalaxyWorldData` + `SelectionState`.
 *
 * This file will grow as we extract the functional core in Phase 1+.
 */
//# sourceMappingURL=galaxy-data.js.map