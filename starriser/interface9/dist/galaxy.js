/**
 * Topology model for the main-thread galaxy mirror.
 * Applies structural mutations and notifies optional view hooks — no GPU imports.
 */
import { makeConnectionKey } from "./contracts/connection-key.js";
import { GalaxyMetrics } from "./galaxy-metrics.js";
/**
 * Data model for galaxy topology. View updates go through GalaxyViewHooks.
 */
export class Galaxy {
    constructor(hooks = {}, metrics = null) {
        this._lastEditHandleClusterId = null;
        this.hooks = hooks;
        this.metrics = metrics ?? new GalaxyMetrics();
        this.clusters = [];
        this.idToCluster = new Map();
        this.idToSolarSystem = new Map();
        this.connectionIdMap = new Map();
        this.connections = [];
    }
    addCluster(cluster) {
        this.clusters.push(cluster);
        this.idToCluster.set(cluster.id, cluster);
        this.hooks.onClusterAdded?.(cluster);
        this.metrics.incrementClusters();
        return cluster;
    }
    getClusterById(clusterId) {
        return this.idToCluster.get(clusterId) ?? null;
    }
    getSolarSystemById(clusterId, solarSystemId) {
        const key = `${clusterId}:${solarSystemId}`;
        return this.idToSolarSystem.get(key) ?? null;
    }
    removeCluster(cluster) {
        const idx = this.clusters.indexOf(cluster);
        if (idx !== -1) {
            this.clusters.splice(idx, 1);
            cluster.dispose();
            this.idToCluster.delete(cluster.id);
            this.hooks.onClusterRemoved?.(cluster);
            this.metrics.decrementClusters();
        }
    }
    /**
     * Add a solar system to a cluster and update lookup maps + view.
     */
    addSolarSystem(cluster, solarSystem) {
        cluster.addSolarSystem(solarSystem);
        this.idToSolarSystem.set(`${cluster.id}:${solarSystem.id}`, solarSystem);
        this.hooks.onSolarSystemAdded?.(cluster, solarSystem);
        this.metrics.incrementSolarSystems();
        if (solarSystem.isJumpGate) {
            this.metrics.incrementJumpGates();
        }
        return solarSystem;
    }
    removeSolarSystem(cluster, solarSystem) {
        if (solarSystem.isJumpGate) {
            const toRemove = this.connections.filter((conn) => (conn.cluster1.id === cluster.id &&
                conn.jumpGate1.id === solarSystem.id) ||
                (conn.cluster2.id === cluster.id &&
                    conn.jumpGate2.id === solarSystem.id) ||
                (conn.cluster1.id === cluster.id &&
                    conn.jumpGate2.id === solarSystem.id) ||
                (conn.cluster2.id === cluster.id &&
                    conn.jumpGate1.id === solarSystem.id));
            for (const conn of toRemove) {
                this.removeClusterConnection(conn.cluster1, conn.cluster2, conn.jumpGate1, conn.jumpGate2);
            }
        }
        if (Array.isArray(solarSystem.connections)) {
            const connections = solarSystem.connections.slice();
            for (const connectedId of connections) {
                const other = this.getSolarSystemById(cluster.id, connectedId);
                if (other) {
                    this.removeSolarSystemConnection(cluster, solarSystem, other);
                }
            }
        }
        const idx = cluster.solarSystems.indexOf(solarSystem);
        if (idx !== -1) {
            cluster.solarSystems.splice(idx, 1);
            solarSystem.dispose();
            this.idToSolarSystem.delete(`${cluster.id}:${solarSystem.id}`);
            this.hooks.onSolarSystemRemoved?.(cluster, solarSystem);
            this.metrics.decrementSolarSystems();
            if (solarSystem.isJumpGate) {
                this.metrics.decrementJumpGates();
            }
        }
    }
    removeClusterConnection(cluster1, cluster2, jumpGate1, jumpGate2) {
        const key = makeConnectionKey(cluster1, cluster2, jumpGate1, jumpGate2);
        const index = this.connections.findIndex((conn) => makeConnectionKey(conn.cluster1, conn.cluster2, conn.jumpGate1, conn.jumpGate2) === key);
        if (index !== -1) {
            this.connections.splice(index, 1);
            this.connectionIdMap.delete(key);
            this.hooks.onClusterConnectionRemoved?.(cluster1, cluster2, jumpGate1, jumpGate2);
            this.metrics.decrementClusterConnections();
            return true;
        }
        return false;
    }
    connectClusters(cluster1, cluster2, jumpGate1, jumpGate2) {
        const connection = {
            cluster1,
            cluster2,
            jumpGate1,
            jumpGate2,
        };
        this.connections.push(connection);
        const key = makeConnectionKey(cluster1, cluster2, jumpGate1, jumpGate2);
        this.connectionIdMap.set(key, connection);
        this.hooks.onClusterConnectionAdded?.(cluster1, cluster2, jumpGate1, jumpGate2);
        this.metrics.incrementClusterConnections();
    }
    /**
     * Intra-cluster solar system connection (topology + view).
     */
    addSolarSystemConnection(cluster, solarSystemA, solarSystemB, options = {}) {
        if (!solarSystemA.connections.includes(solarSystemB.id)) {
            solarSystemA.connections.push(solarSystemB.id);
        }
        if (!solarSystemB.connections.includes(solarSystemA.id)) {
            solarSystemB.connections.push(solarSystemA.id);
        }
        this.hooks.onSolarSystemConnectionAdded?.(cluster, solarSystemA, solarSystemB, options);
        this.metrics.incrementSolarSystemConnections();
    }
    removeSolarSystemConnection(cluster, solarSystemA, solarSystemB) {
        solarSystemA.connections = solarSystemA.connections.filter((id) => id !== solarSystemB.id);
        solarSystemB.connections = solarSystemB.connections.filter((id) => id !== solarSystemA.id);
        this.hooks.onSolarSystemConnectionRemoved?.(cluster, solarSystemA, solarSystemB);
        this.metrics.decrementSolarSystemConnections();
    }
    clear() {
        for (const c of this.clusters)
            c.dispose();
        this.clusters = [];
        this.connections = [];
        this.idToCluster.clear();
        this.idToSolarSystem.clear();
        this.connectionIdMap.clear();
        this._lastEditHandleClusterId = null;
        this.metrics.reset();
    }
    getStatistics() {
        return this.metrics.getStatistics();
    }
    setHoveredCluster(cluster) {
        this.hooks.onHoveredCluster?.(cluster);
    }
    setSelectedCluster(cluster) {
        this.hooks.onSelectedCluster?.(cluster);
    }
    /**
     * Preview cluster drag: move center + jump gates only (topic-synced, not an OP).
     */
    previewMoveCluster(cluster, position) {
        const deltaX = position.x - cluster.position.x;
        const deltaY = position.y - cluster.position.y;
        const deltaZ = position.z - cluster.position.z;
        if (deltaX === 0 && deltaY === 0 && deltaZ === 0)
            return;
        cluster.position.x = position.x;
        cluster.position.y = position.y;
        cluster.position.z = position.z;
        const movedJumpGates = [];
        for (const sys of cluster.solarSystems) {
            if (!sys.isJumpGate)
                continue;
            sys.position.x += deltaX;
            sys.position.y += deltaY;
            sys.position.z += deltaZ;
            movedJumpGates.push(sys);
        }
        if (movedJumpGates.length > 0) {
            this.hooks.onSolarSystemPositionsUpdated?.(movedJumpGates);
            this.hooks.onClusterConnectionsUpdated?.(cluster.id);
        }
    }
    /**
     * Commit cluster drag: move non-gate systems + refresh connections (topic-synced, not an OP).
     */
    commitMoveCluster(cluster, startPosition, endPosition) {
        const deltaX = endPosition.x - startPosition.x;
        const deltaY = endPosition.y - startPosition.y;
        const deltaZ = endPosition.z - startPosition.z;
        if (deltaX === 0 && deltaY === 0 && deltaZ === 0) {
            cluster.position.x = endPosition.x;
            cluster.position.y = endPosition.y;
            cluster.position.z = endPosition.z;
            return;
        }
        cluster.position.x = endPosition.x;
        cluster.position.y = endPosition.y;
        cluster.position.z = endPosition.z;
        const movedSystems = [];
        for (const sys of cluster.solarSystems) {
            if (sys.isJumpGate)
                continue;
            sys.position.x += deltaX;
            sys.position.y += deltaY;
            sys.position.z += deltaZ;
            movedSystems.push(sys);
        }
        if (movedSystems.length > 0) {
            this.hooks.onSolarSystemPositionsUpdated?.(movedSystems);
        }
        this.hooks.onSolarSystemConnectionsUpdated?.(cluster);
        this.hooks.onClusterConnectionsUpdated?.(cluster.id);
    }
    showEditHandles(clusterId, handles) {
        this._lastEditHandleClusterId = clusterId;
        this.hooks.onShowEditHandles?.(clusterId, handles);
    }
    hideEditHandles(clusterId) {
        this.hooks.onHideEditHandles?.();
        if (this._lastEditHandleClusterId === clusterId) {
            this._lastEditHandleClusterId = null;
        }
    }
    /** Active edit-mode cluster id (for input fallback). */
    getLastEditHandleClusterId() {
        return this._lastEditHandleClusterId;
    }
}
//# sourceMappingURL=galaxy.js.map