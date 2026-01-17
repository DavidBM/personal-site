import * as THREE from "./vendor/three.js";
import { GalaxyMetrics } from "./galaxy-metrics.js";
/**
 * Data/model and orchestrator of galaxy. Knows about renderer.
 */
export class Galaxy {
    constructor(renderer, metrics, clusterEditPointerHandler) {
        this._lastEditHandleClusterId = null;
        this._lastSelectedId = null;
        this._editPointerDownHandle = null;
        this.renderer = renderer;
        this.metrics = metrics ?? new GalaxyMetrics();
        this.clusters = [];
        this.idToCluster = new Map();
        this.idToSolarSystem = new Map(); // key: `${clusterId}:${solarSystemId}`
        this.connectionIdMap = new Map();
        this.connections = [];
        this.connectionGroup = new THREE.Group();
        this.renderer.scene.add(this.connectionGroup);
        this._clusterEditPointerHandler = clusterEditPointerHandler;
    }
    addCluster(cluster) {
        this.clusters.push(cluster);
        this.idToCluster.set(cluster.id, cluster);
        this.renderer.addCluster(cluster);
        this.metrics.incrementClusters();
        return cluster;
    }
    /**
     * Look up a cluster by its id.
     */
    getClusterById(clusterId) {
        return this.idToCluster.get(clusterId) ?? null;
    }
    /**
     * Look up a solar system by both cluster and solarSystemId.
     */
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
            this.renderer.removeCluster(cluster);
            this.metrics.decrementClusters();
        }
    }
    /**
     * Add a solar system to a cluster, updating all relevant Galaxy structures.
     * Maintains single responsibility: cluster handles its own array, Galaxy handles lookup map & renderer.
     */
    addSolarSystem(cluster, solarSystem) {
        // Delegate to cluster to update the local state/array
        cluster.addSolarSystem(solarSystem);
        // Maintain global fast lookup
        this.idToSolarSystem.set(`${cluster.id}:${solarSystem.id}`, solarSystem);
        // Let renderer know
        this.renderer.addSolarSystem(cluster, solarSystem);
        // Update metrics
        this.metrics.incrementSolarSystems();
        if (solarSystem.isJumpGate) {
            this.metrics.incrementJumpGates();
        }
        return solarSystem;
    }
    removeSolarSystem(cluster, solarSystem) {
        const idx = cluster.solarSystems.indexOf(solarSystem);
        if (idx !== -1) {
            cluster.solarSystems.splice(idx, 1);
            solarSystem.dispose();
            this.idToSolarSystem.delete(`${cluster.id}:${solarSystem.id}`);
            this.renderer.removeSolarSystem(cluster, solarSystem);
            // Update metrics
            this.metrics.decrementSolarSystems();
            if (solarSystem.isJumpGate) {
                this.metrics.decrementJumpGates();
            }
        }
    }
    removeClusterConnection(cluster1, cluster2, jumpGate1, jumpGate2) {
        const key = `${cluster1.id}:${cluster2.id}:${jumpGate1.id}:${jumpGate2.id}`;
        const index = this.connections.findIndex((conn) => conn.cluster1.id === cluster1.id &&
            conn.cluster2.id === cluster2.id &&
            conn.jumpGate1.id === jumpGate1.id &&
            conn.jumpGate2.id === jumpGate2.id);
        if (index !== -1) {
            this.connections.splice(index, 1);
            this.connectionIdMap.delete(key);
            this.renderer.removeClusterConnection(cluster1, cluster2, jumpGate1, jumpGate2);
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
        const key = `${cluster1.id}:${cluster2.id}:${jumpGate1.id}:${jumpGate2.id}`;
        this.connectionIdMap.set(key, connection);
        this.renderer.connectClusters(cluster1, cluster2, jumpGate1, jumpGate2);
        this.metrics.incrementClusterConnections();
    }
    /**
     * Render a connection between two solar systems inside a cluster.
     * For in-cluster (intra-cluster) connections.
     */
    addSolarSystemConnection(cluster, solarSystemA, solarSystemB, options = {}) {
        if (!solarSystemA.connections.includes(solarSystemB.id)) {
            solarSystemA.connections.push(solarSystemB.id);
        }
        if (!solarSystemB.connections.includes(solarSystemA.id)) {
            solarSystemB.connections.push(solarSystemA.id);
        }
        this.renderer.addSolarSystemConnection(cluster, solarSystemA, solarSystemB, options);
        this.metrics.incrementSolarSystemConnections();
    }
    /**
     * Remove a connection between two solar systems inside a cluster.
     */
    removeSolarSystemConnection(cluster, solarSystemA, solarSystemB) {
        solarSystemA.connections = solarSystemA.connections.filter((id) => id !== solarSystemB.id);
        solarSystemB.connections = solarSystemB.connections.filter((id) => id !== solarSystemA.id);
        this.renderer.removeSolarSystemConnection(cluster, solarSystemA, solarSystemB);
        this.metrics.decrementSolarSystemConnections();
    }
    clear() {
        for (const c of this.clusters)
            c.dispose();
        this.renderer.scene.remove(this.connectionGroup);
        this.clusters = [];
        this.connections = [];
        this.idToCluster.clear();
        this.idToSolarSystem.clear();
        this.connectionIdMap.clear();
        this.connectionGroup = new THREE.Group();
        this.renderer.scene.add(this.connectionGroup);
        this.metrics.reset();
    }
    /**
     * Return galaxy stats for UI using cached metrics.
     */
    getStatistics() {
        return this.metrics.getStatistics();
    }
    /**
     * Overlay API: set hovered cluster. Abstracts renderer.
     */
    setHoveredCluster(cluster) {
        this.renderer.setHoveredCluster(cluster);
    }
    /**
     * Overlay API: set selected cluster. Abstracts renderer.
     */
    setSelectedCluster(cluster) {
        this._lastSelectedId = cluster ? cluster.id : null;
        this.renderer.setSelectedCluster(cluster);
    }
    previewMoveCluster(cluster, position) {
        const deltaX = position.x - cluster.position.x;
        const deltaY = position.y - cluster.position.y;
        const deltaZ = position.z - cluster.position.z;
        if (deltaX === 0 && deltaY === 0 && deltaZ === 0)
            return;
        cluster.position.set(position.x, position.y, position.z);
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
            this.renderer.updateSolarSystemPositions(movedJumpGates);
            this.renderer.updateClusterConnections(cluster.id);
        }
    }
    commitMoveCluster(cluster, startPosition, endPosition) {
        const deltaX = endPosition.x - startPosition.x;
        const deltaY = endPosition.y - startPosition.y;
        const deltaZ = endPosition.z - startPosition.z;
        if (deltaX === 0 && deltaY === 0 && deltaZ === 0) {
            cluster.position.set(endPosition.x, endPosition.y, endPosition.z);
            return;
        }
        cluster.position.set(endPosition.x, endPosition.y, endPosition.z);
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
            this.renderer.updateSolarSystemPositions(movedSystems);
        }
        this.renderer.updateSolarSystemConnections(cluster);
        this.renderer.updateClusterConnections(cluster.id);
    }
    handleEditPointerDown(event) {
        if (!this.renderer.hasEditHandles())
            return false;
        const { ndcX, ndcY, screenX, screenY } = this.renderer.getPointerRayFromEvent(event);
        const hit = this.renderer.getEditHandleHit(ndcX, ndcY);
        if (!hit)
            return false;
        this._editPointerDownHandle =
            hit.handleId ?? `edit_cluster_${hit.clusterId ?? "unknown"}`;
        this.onEditHandlePointerEvent({
            type: "down",
            handleId: hit.handleId ?? undefined,
            handleKind: hit.handleKind,
            clusterId: hit.clusterId,
            screenX,
            screenY,
            ndcX,
            ndcY,
            originalEvent: event,
        });
        return true;
    }
    dispatchClusterEditPointer(evt) {
        this._clusterEditPointerHandler(evt);
    }
    handleEditPointerMove(event) {
        if (!this._editPointerDownHandle)
            return false;
        const { ndcX, ndcY, screenX, screenY } = this.renderer.getPointerRayFromEvent(event);
        this.onEditHandlePointerEvent({
            type: "move",
            handleId: this._editPointerDownHandle ?? undefined,
            screenX,
            screenY,
            ndcX,
            ndcY,
            originalEvent: event,
        });
        return true;
    }
    handleEditPointerUp(event) {
        if (!this._editPointerDownHandle)
            return false;
        const { ndcX, ndcY, screenX, screenY } = this.renderer.getPointerRayFromEvent(event);
        this.onEditHandlePointerEvent({
            type: "up",
            handleId: this._editPointerDownHandle ?? undefined,
            screenX,
            screenY,
            ndcX,
            ndcY,
            originalEvent: event,
        });
        this._editPointerDownHandle = null;
        return true;
    }
    /**
     * Called by Galaxy's edit-handle pointer handlers after renderer hit-testing.
     * Forwards to the correct cluster (by handle.clusterId), which can handle or call back to app.
     */
    onEditHandlePointerEvent(evt) {
        let clusterId = evt.clusterId ?? this._lastEditHandleClusterId ?? null;
        if (!clusterId && this._lastSelectedId)
            clusterId = this._lastSelectedId;
        if (!clusterId && this.clusters.length > 0)
            clusterId = this.clusters[0].id;
        const cluster = clusterId ? this.getClusterById(clusterId) : null;
        if (cluster) {
            cluster.editHandlePointerEvent(evt);
        }
    }
    /**
     * Show edit handles for a cluster.
     */
    showEditHandles(clusterId, handles) {
        this._lastEditHandleClusterId = clusterId;
        const cluster = this.getClusterById(clusterId);
        if (cluster) {
            cluster.showEditHandles(handles);
        }
    }
    /**
     * Hide/clear edit handles for a cluster.
     */
    hideEditHandles(clusterId) {
        const cluster = this.getClusterById(clusterId);
        if (cluster) {
            cluster.hideEditHandles();
        }
        if (this._lastEditHandleClusterId === clusterId) {
            this._lastEditHandleClusterId = null;
        }
    }
}
//# sourceMappingURL=galaxy.js.map