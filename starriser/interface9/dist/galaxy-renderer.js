import * as THREE from "./vendor/three.js";
import { Fleets } from "./fleets.js";
import { ClusterSelectionOverlay } from "./render/cluster-selection-overlay.js";
import { EditHandleOverlay, } from "./render/edit-handle-overlay.js";
import { GalaxyConnectionLayer } from "./render/galaxy-connection-layer.js";
import { createSceneBootstrap, resizeSceneBootstrap, } from "./render/scene-bootstrap.js";
import { SolarSystemPointLayer } from "./render/solar-system-point-layer.js";
import { SolarSystemConnectionLayer } from "./render/solar-system-connection-layer.js";
export class GalaxyRenderer {
    constructor(container) {
        this.container = container;
        this.statsPanels = [];
        const bootstrap = createSceneBootstrap(container);
        this.sceneBootstrap = bootstrap;
        this.scene = bootstrap.scene;
        this.camera = bootstrap.camera;
        this.renderer = bootstrap.renderer;
        this.labelRenderer = bootstrap.labelRenderer;
        this.uiOverlayLayer = bootstrap.uiOverlayLayer;
        this.screenOverlayRegistry = bootstrap.screenOverlayRegistry;
        this.selectionOverlay = bootstrap.selectionOverlay;
        this.pathOverlay = bootstrap.pathOverlay;
        this.textOverlay = bootstrap.textOverlay;
        this.starField = bootstrap.starField;
        this.galaxyClusterGroup = bootstrap.galaxyClusterGroup;
        this.controls = null; // can be added if you want orbit/pan/zoom support
        this.cameraController = null;
        this.galaxyConnectionLayer = new GalaxyConnectionLayer(this.scene);
        this.solarSystemConnectionLayer = new SolarSystemConnectionLayer(this.scene);
        this.editHandleOverlay = new EditHandleOverlay(this.scene);
        this.fleets = new Fleets(this.scene);
        this.stats = null;
        this._connectionOverlayGroup = null;
        this._overlayConnectionColors = null;
        this._selectedConnectionKeys = null;
        this.clusterSelectionOverlay = new ClusterSelectionOverlay(this.scene, this.selectionOverlay);
        this.solarSystemPointLayer = new SolarSystemPointLayer(this.scene);
        this.clusters = [];
        window.addEventListener("resize", () => this.onWindowResize());
        this.animate(0);
    }
    hasEditHandles() {
        return this.editHandleOverlay.hasHandles();
    }
    setFleetPositionProvider(provider) {
        this.fleets.setPositionProvider(provider);
    }
    addFleet(id, counts, state) {
        this.fleets.addFleet(id, counts, state);
    }
    updateFleetState(id, state) {
        this.fleets.updateFleetState(id, state);
    }
    removeFleet(id) {
        this.fleets.removeFleet(id);
    }
    clearFleets() {
        this.fleets.clear();
    }
    setFleetUpdateConfig(options) {
        this.fleets.setUpdateConfig(options);
    }
    getPointerRayFromEvent(event) {
        let x, y;
        if ("touches" in event && event.touches.length > 0) {
            x = event.touches[0].clientX;
            y = event.touches[0].clientY;
        }
        else {
            const mouseEvent = event;
            x = mouseEvent.clientX;
            y = mouseEvent.clientY;
        }
        const rect = this.renderer.domElement.getBoundingClientRect();
        const ndcX = ((x - rect.left) / rect.width) * 2 - 1;
        const ndcY = -((y - rect.top) / rect.height) * 2 + 1;
        return { ndcX, ndcY, screenX: x, screenY: y };
    }
    getEditHandleHit(ndcX, ndcY) {
        return this.editHandleOverlay.getHit(this.camera, ndcX, ndcY);
    }
    /**
     * Show edit overlay (thick circle) for a cluster in edit mode.
     * This overlay is interactive for edit (pan/alt-drag).
     */
    showEditHandles(clusterId, handles) {
        this.editHandleOverlay.show(clusterId, handles);
    }
    /**
     * Remove edit controls/handles from overlay group.
     */
    hideEditHandles() {
        this.editHandleOverlay.hide();
    }
    setStatsPanels(statsArr) {
        this.statsPanels = statsArr || [];
    }
    setStats(stats) {
        this.stats = stats;
    }
    // === Overlay rendering API ===
    /**
     * Highlight/outline the hovered cluster visually (draws a thick circle/loop).
     * @param {Cluster|null} cluster
     */
    setHoveredCluster(cluster) {
        this.clusterSelectionOverlay.setHoveredCluster(cluster);
    }
    /**
     * Highlight/outline the selected cluster visually (draws a different thick circle/loop).
     * @param {Cluster|null} cluster
     */
    setSelectedCluster(cluster) {
        this.clusterSelectionOverlay.setSelectedCluster(cluster);
    }
    setSelectionBoxes(selections) {
        this.clusterSelectionOverlay.setSelectionBoxes(selections);
    }
    setPathOverlay(points, color) {
        this.pathOverlay.setPath(points.map((point) => ({ x: point.x, y: 0, z: point.z })), color);
    }
    clearPathOverlay() {
        this.pathOverlay.clear();
    }
    setTextLabels(labels) {
        this.textOverlay.setLabels(labels);
    }
    /**
     * Provide a mapping from connection key (as used by this._makeConnectionKey)
     * to a color ([r,g,b] or number), and update the selected-connection overlay.
     * @param {Object} connectionColors - key: connKey, value: [r,g,b] or hex
     */
    setConnectionColors(connectionColors) {
        // Overlay-only highlight: only update overlays, NOT the base color buffer
        this._selectedConnectionKeys = [];
        this._overlayConnectionColors = {};
        if (connectionColors) {
            for (const key of Object.keys(connectionColors)) {
                this._selectedConnectionKeys.push(key);
                this._overlayConnectionColors[key] = connectionColors[key];
            }
        }
        this._refreshSelectedConnectionsOverlay();
    }
    /**
     * Draws/removes overlay lines (thick, using Line2 if available, or fallback Line) for currently selected connections
     */
    _refreshSelectedConnectionsOverlay() {
        // Remove existing overlay group if exists
        if (!this._connectionOverlayGroup) {
            this._connectionOverlayGroup = new THREE.Group();
            this.scene.add(this._connectionOverlayGroup);
        }
        const overlayGroup = this._connectionOverlayGroup;
        // Always ensure attached to scene
        if (overlayGroup.parent !== this.scene) {
            this.scene.add(overlayGroup);
        }
        while (overlayGroup.children.length > 0) {
            const obj = overlayGroup.children.pop();
            if (!obj)
                break;
            const renderable = obj;
            if (renderable.geometry)
                renderable.geometry.dispose();
            if (renderable.material)
                renderable.material.dispose();
        }
        if (!Array.isArray(this._selectedConnectionKeys) ||
            this._selectedConnectionKeys.length === 0) {
            return;
        }
        const connectionPositions = this.galaxyConnectionLayer.positions;
        // Overlay color map
        const overlayColors = this._overlayConnectionColors || {};
        if (typeof THREE.Line2 === "undefined" ||
            typeof THREE.LineMaterial === "undefined" ||
            typeof THREE.LineGeometry === "undefined") {
            throw new Error("THREE.Line2/LineMaterial/LineGeometry are required for overlays but not found. Please ensure three/examples/jsm/lines/ modules are loaded.");
        }
        for (const key of this._selectedConnectionKeys) {
            const slot = this.galaxyConnectionLayer.getConnectionSlot(key);
            if (typeof slot !== "number")
                continue;
            const i = slot * 2 * 3;
            const p1 = new THREE.Vector3(connectionPositions[i + 0], connectionPositions[i + 1], connectionPositions[i + 2]);
            const p2 = new THREE.Vector3(connectionPositions[i + 3], connectionPositions[i + 4], connectionPositions[i + 5]);
            if (p1.equals(p2) ||
                isNaN(p1.x) ||
                isNaN(p2.x) ||
                isNaN(p1.y) ||
                isNaN(p2.y) ||
                isNaN(p1.z) ||
                isNaN(p2.z)) {
                continue;
            }
            // Overlay color is bright fallback
            let colorArr = [1, 0, 0.2];
            let overlayHex = 0xff0a3c;
            let c = overlayColors[key];
            if (typeof c === "number") {
                overlayHex = c;
                const r = ((c >> 16) & 0xff) / 255;
                const g = ((c >> 8) & 0xff) / 255;
                const b = (c & 0xff) / 255;
                colorArr = [r, g, b];
            }
            else if (Array.isArray(c)) {
                colorArr = c;
                overlayHex = ((c[0] * 255) << 16) | ((c[1] * 255) << 8) | (c[2] * 255);
            }
            const geometry = new THREE.LineGeometry();
            geometry.setPositions([p1.x, p1.y, p1.z, p2.x, p2.y, p2.z]);
            const mat = new THREE.LineMaterial({
                color: new THREE.Color(...colorArr),
                linewidth: 3, // Clearly visible
                transparent: true,
                opacity: 1.0,
                depthWrite: false,
                depthTest: false,
            });
            mat.resolution.set(window.innerWidth, window.innerHeight);
            const lineObj = new THREE.Line2(geometry, mat);
            lineObj.computeLineDistances();
            overlayGroup.add(lineObj);
        }
    }
    /**
     * Initialize or reset the solar system batched buffer Points object for fast rendering.
     * @param {number} maxSolarSystems
     */
    initializeSolarSystemBuffer(maxSolarSystems) {
        this.solarSystemPointLayer.initialize(maxSolarSystems);
    }
    setCameraController(controller) {
        this.cameraController = controller;
    }
    // ==== LIVE OPS RENDERING API ====
    addCluster(cluster) {
        this.clusters.push(cluster);
        //this.galaxyClusterGroup.add(cluster.group);
        // Optional: add label
        // if (!cluster.label && cluster.name) {
        //   const labelDiv = document.createElement("div");
        //   labelDiv.className = "cluster-label";
        //   labelDiv.textContent = cluster.name;
        //   labelDiv.style.color = "#fff";
        //   labelDiv.style.fontSize = "13px";
        //   labelDiv.style.background = "rgba(0,0,0,0.45)";
        //   labelDiv.style.borderRadius = "3px";
        //   labelDiv.style.padding = "2px";
        //   labelDiv.style.fontWeight = "bold";
        //   labelDiv.style.pointerEvents = "none";
        //   const label = new CSS2DObject(labelDiv);
        //   label.position.set(
        //     cluster.position.x,
        //     cluster.position.y + 60,
        //     cluster.position.z,
        //   );
        //   this.scene.add(label);
        //   cluster.label = label;
        // }
        // Attach label for possible removal later
    }
    removeCluster(cluster) {
        const idx = this.clusters.indexOf(cluster);
        if (idx !== -1) {
            this.clusters.splice(idx, 1);
        }
        // Remove/cleanup all Three.js objects for the cluster
        if (cluster.label) {
            this.scene.remove(cluster.label);
            cluster.label = null;
        }
        if (cluster.centerObj) {
            cluster.centerObj.geometry.dispose();
            cluster.centerObj.material.dispose();
        }
        if (cluster.group) {
            // Remove all solar systems
            if (cluster.solarSystems) {
                for (const s of cluster.solarSystems) {
                    this.removeSolarSystem(cluster, s);
                }
            }
            this.galaxyClusterGroup.remove(cluster.group);
        }
    }
    addSolarSystem(cluster, solarSystem) {
        this.solarSystemPointLayer.add(cluster, solarSystem);
    }
    updateSolarSystemPositions(solarSystems) {
        this.solarSystemPointLayer.updatePositions(solarSystems);
    }
    removeSolarSystem(cluster, solarSystem) {
        this.solarSystemPointLayer.remove(solarSystem);
    }
    /**
     * Generate a unique connection key for buffer index/slot mapping.
     * Uses cluster1Id, cluster2Id, jumpGate1Id, jumpGate2Id.
     * Always orders cluster IDs lowest first for consistent mapping.
     */
    _makeConnectionKey(cluster1, cluster2, jumpGate1, jumpGate2) {
        return this.galaxyConnectionLayer.makeConnectionKey(cluster1, cluster2, jumpGate1, jumpGate2);
    }
    /**
     * Render a connection ("edge"/"link") between two solar systems inside a cluster.
     * Used for in-cluster (intra-cluster) solar system connections.
     * @param {object} cluster - The cluster object (context for ID, not always needed)
     * @param {object} solarSystemA - First solar system object (must have id and position)
     * @param {object} solarSystemB - Second solar system object (must have id and position)
     * @param {object} [options] - Optional: color/attributes to override
     */
    addSolarSystemConnection(cluster, solarSystemA, solarSystemB, options = {}) {
        this.solarSystemConnectionLayer.addConnection(cluster, solarSystemA, solarSystemB, options);
    }
    removeSolarSystemConnection(cluster, solarSystemA, solarSystemB) {
        return this.solarSystemConnectionLayer.removeConnection(cluster, solarSystemA, solarSystemB);
    }
    updateSolarSystemConnections(cluster) {
        this.solarSystemConnectionLayer.updateClusterConnections(cluster);
    }
    updateEditOverlayPosition(clusterId, position) {
        this.editHandleOverlay.updatePosition(clusterId, position);
    }
    connectClusters(cluster1, cluster2, jumpGate1, jumpGate2) {
        this.galaxyConnectionLayer.connectClusters(cluster1, cluster2, jumpGate1, jumpGate2);
    }
    updateClusterConnections(clusterId) {
        this.galaxyConnectionLayer.updateClusterConnections(clusterId);
    }
    refreshConnectionOverlays() {
        this._refreshSelectedConnectionsOverlay();
    }
    /**
     * Remove a cluster connection from the buffer, using its unique key.
     * This function forgets about the connection visually by moving it far away (does not compact buffer!).
     * Compacting is handled by finalizeBuffers().
     * @param {string} key - The unique connection key from _makeConnectionKey.
     */
    removeClusterConnectionByKey(key) {
        return this.galaxyConnectionLayer.removeConnectionByKey(key);
    }
    /**
     * Remove a cluster connection using its entities (cluster, jumpgates).
     * @param {object} cluster1
     * @param {object} cluster2
     * @param {object} jumpGate1
     * @param {object} jumpGate2
     */
    removeClusterConnection(cluster1, cluster2, jumpGate1, jumpGate2) {
        return this.galaxyConnectionLayer.removeClusterConnection(cluster1, cluster2, jumpGate1, jumpGate2);
    }
    /**
     * Finalize GPU buffers after bulk generation or major topology edits.
     * Rebuilds tightly packed solar-system + connection buffers, refreshes index maps,
     * and updates per-system buffer indices so incremental updates hit the right slots.
     * This is necessary because incremental add/remove ops leave holes in fixed-size
     * buffers; compacting avoids stale draws and keeps draw ranges accurate.
     */
    finalizeBuffers(galaxy) {
        this.solarSystemPointLayer.finalize(galaxy);
        // Actual connection rendering is owned by GalaxyConnectionLines. Compact those
        // layers after bulk generation or removals instead of maintaining a second,
        // unused connection buffer in GalaxyRenderer.
        this.galaxyConnectionLayer.finalize();
        this.solarSystemConnectionLayer.finalize();
        this.refreshConnectionOverlays();
    }
    // ==== MAIN ANIMATION LOOP ====
    animate(timestamp) {
        requestAnimationFrame((t) => this.animate(t));
        // Call .begin on all stats panels (to measure proper timings per type)
        for (const panel of this.statsPanels) {
            panel.begin();
        }
        if (this.cameraController)
            this.cameraController.update();
        if (this.starField)
            this.starField.update(16);
        this.clusterSelectionOverlay.update();
        this.textOverlay.update(this.camera, this.renderer.domElement);
        this.screenOverlayRegistry.update(this.camera, this.renderer.domElement);
        this.fleets.update(Date.now(), this.camera.position.y);
        this.renderer.render(this.scene, this.camera);
        for (const panel of this.statsPanels) {
            panel.end();
        }
        //this.labelRenderer.render(this.scene, this.camera);
    }
    onWindowResize() {
        resizeSceneBootstrap(this.sceneBootstrap, window.innerWidth, window.innerHeight);
        this.clusterSelectionOverlay.onWindowResize(window.innerWidth, window.innerHeight);
    }
    clear() {
        // Clear all children from root groups
        while (this.galaxyClusterGroup.children.length > 0) {
            const c = this.galaxyClusterGroup.children[0];
            this.galaxyClusterGroup.remove(c);
            // Dispose geometry/material if you want here...
        }
        this.clearFleets();
        this.solarSystemPointLayer.clear();
        this.galaxyConnectionLayer.clear();
        this.solarSystemConnectionLayer.clear();
        this.clusters = [];
        this.clusterSelectionOverlay.clear();
        this.pathOverlay.clear();
        this.textOverlay.setLabels([]);
        this.screenOverlayRegistry.clear();
    }
}
//# sourceMappingURL=galaxy-renderer.js.map