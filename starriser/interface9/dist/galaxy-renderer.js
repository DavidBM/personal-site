import * as THREE from "./vendor/three.js";
import { CSS2DRenderer } from "./vendor/CSS2DRenderer.js";
import { StarField } from "./star-field.js";
import GalaxyConnectionLines from "./gfx-utils/galaxy-connection-lines.js";
/**
 * Centralized renderer and scene orchestrator for the galaxy and live ops.
 */
export class GalaxyRenderer {
    constructor(container) {
        // ==== Scene bootstrapping ====
        this.container = container;
        this.scene = new THREE.Scene();
        this.statsPanels = [];
        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 10, 10000000000);
        this.camera.position.set(0, 2000, 2000);
        this.camera.lookAt(0, 0, 0);
        this.controls = null; // can be added if you want orbit/pan/zoom support
        this.cameraController = null;
        this.renderer = new THREE.WebGLRenderer({ antialias: true, debug: false });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setClearColor(0x000015);
        this.container.appendChild(this.renderer.domElement);
        // Label renderer
        this.labelRenderer = new CSS2DRenderer();
        this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
        this.labelRenderer.domElement.style.position = "absolute";
        this.labelRenderer.domElement.style.top = "0";
        this.labelRenderer.domElement.style.pointerEvents = "none";
        this.container.appendChild(this.labelRenderer.domElement);
        // Reference
        this.starField = new StarField(this.scene, this.camera, 3000);
        // Root groups for visual organization and LOD
        this.galaxyClusterGroup = new THREE.Group();
        this.scene.add(this.galaxyClusterGroup);
        // --- Connections (cluster-cluster) management ---
        const connMaterial = new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.7,
            linewidth: 1,
        });
        this.galaxyConnectionLines = new GalaxyConnectionLines(connMaterial, 1000);
        this.scene.add(this.galaxyConnectionLines.getGroup());
        // --- Connections (solar system to solar system within a cluster) ---
        const ssConnMaterial = new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.7,
            linewidth: 1,
        });
        this.solarSystemConnectionLines = new GalaxyConnectionLines(ssConnMaterial, 2000);
        this.scene.add(this.solarSystemConnectionLines.getGroup());
        // Overlay for edit mode: just a thick highlight circle
        this.editHandleOverlayGroup = new THREE.Group();
        this.editHandleOverlayGroup.name = "EditEditCircle";
        this.scene.add(this.editHandleOverlayGroup);
        this.editHandlesByCluster = new Map();
        this._editHandleCircle = null;
        this.fpsCallback = null;
        this.frameCount = 0;
        this.lastTime = performance.now();
        this.stats = null;
        this._handlesActiveCluster = null;
        this._handleBeingDragged = null;
        this._editOverlayRadius = 400;
        this._connectionOverlayGroup = null;
        this._overlayConnectionColors = null;
        this._selectedConnectionKeys = null;
        this._circleTemplates = null;
        this._overlayCircles = null;
        this.overlayGroup = null;
        this._flat2DActive = null;
        this._originalSolarSystemYPositions = null;
        this._originalConnectionYPositions = null;
        this.solarSystemsGeometry = new THREE.BufferGeometry();
        this.solarSystemsPositions = new Float32Array(0);
        this.solarSystemsColors = new Float32Array(0);
        this.solarSystemsVisibility = new Uint8Array(0);
        this.solarSystemsPoints = new THREE.Points(this.solarSystemsGeometry, new THREE.PointsMaterial({ color: 0xffffff, size: 1 }));
        this.solarSystemIdToIndex = new Map();
        this.maxSolarSystems = 0;
        this.currentSolarSystemCount = 0;
        this.connectionsPositions = null;
        this.connectionsColors = null;
        this.connectionsGeometry = new THREE.BufferGeometry();
        this.connectionCount = 0;
        this.connectionIdToBufferIndex = new Map();
        this.clusters = [];
        this.connections = [];
        // Generate global top view entities
        this.initializeSolarSystemBuffer(0);
        this.init();
        window.addEventListener("resize", () => this.onWindowResize());
        this.animate(0);
    }
    hasEditHandles() {
        return this.editHandleOverlayGroup.children.length > 0;
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
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
        const intersects = raycaster.intersectObjects(this.editHandleOverlayGroup.children, true);
        if (!intersects.length)
            return null;
        let handleMesh = null;
        for (const hit of intersects) {
            const obj = hit.object;
            const rawHandleId = obj.userData.__editHandleId;
            if (typeof rawHandleId === "string" || typeof rawHandleId === "number") {
                handleMesh = obj;
                break;
            }
            const parent = obj.parent;
            if (parent &&
                (typeof parent.userData.__editHandleId === "string" ||
                    typeof parent.userData.__editHandleId === "number")) {
                handleMesh = parent;
                break;
            }
            if (typeof obj.userData.__editClusterId === "number") {
                handleMesh = obj;
                break;
            }
        }
        if (!handleMesh) {
            handleMesh = intersects[0].object;
        }
        const rawHandleId = handleMesh.userData.__editHandleId;
        const handleId = typeof rawHandleId === "string" || typeof rawHandleId === "number"
            ? rawHandleId
            : null;
        const handleKind = typeof handleMesh.userData.__editHandleKind === "string"
            ? handleMesh.userData.__editHandleKind
            : undefined;
        const rawClusterId = handleMesh.userData.__editClusterId;
        const clusterId = typeof rawClusterId === "number" ? rawClusterId : undefined;
        return { handleId, handleKind, clusterId };
    }
    /**
     * Show edit overlay (thick circle) for a cluster in edit mode.
     * This overlay is interactive for edit (pan/alt-drag).
     */
    showEditHandles(clusterId, handles) {
        this.hideEditHandles();
        // Find cluster position (from handles[0] or from selection)
        let x = 0, y = 0, z = 0;
        if (Array.isArray(handles) && handles.length > 0) {
            x = handles[0].x || 0;
            y = ((handles[0].yMin || 0) + (handles[0].yMax || 0)) / 2;
            z = handles[0].z || 0;
        }
        // Render a thick circle overlay
        const circleObj = this._renderOverlayCircleRaw({ x, y, z }, "edit", 1.8);
        if (circleObj) {
            circleObj.userData.interactive = true;
            circleObj.userData.__editHandleId = `edit_circle_${clusterId}`;
            circleObj.userData.__editHandleKind = "planeXZ";
            circleObj.userData.__editClusterId = clusterId;
            this.editHandleOverlayGroup.add(circleObj);
            this._editHandleCircle = circleObj;
        }
        const pickRadius = this._editOverlayRadius || 400;
        const pickGeometry = new THREE.PlaneGeometry(pickRadius * 2, pickRadius * 2);
        const pickMaterial = new THREE.MeshBasicMaterial({
            color: 0x000000,
            transparent: true,
            opacity: 0,
            depthWrite: false,
        });
        const pickPlane = new THREE.Mesh(pickGeometry, pickMaterial);
        pickPlane.rotation.x = -Math.PI / 2;
        pickPlane.position.set(x, y, z);
        pickPlane.userData.__editHandleId = `edit_pick_${clusterId}`;
        pickPlane.userData.__editHandleKind = "planeXZ";
        pickPlane.userData.__editClusterId = clusterId;
        this.editHandleOverlayGroup.add(pickPlane);
        this._handlesActiveCluster = clusterId;
    }
    /**
     * Remove edit controls/handles from overlay group.
     */
    hideEditHandles() {
        while (this.editHandleOverlayGroup.children.length) {
            const ch = this.editHandleOverlayGroup.children.pop();
            if (!ch)
                break;
            const renderable = ch;
            if (renderable.geometry)
                renderable.geometry.dispose();
            if (renderable.material)
                renderable.material.dispose();
        }
        this.editHandlesByCluster.clear();
        this._handlesActiveCluster = null;
        this._handleBeingDragged = null;
        this._editHandleCircle = null;
    }
    /**
     * Overlay rendering for a thick circle (edit or select/hover).
     * Used for edit mode overlays as well.
     * @param {Object} pos - {x, y, z}
     * @param {string} type - 'hover', 'select', or 'edit'
     * @param {number} [scale] - thickness multiplier
     */
    _renderOverlayCircleRaw(pos, type, scale = 1.0) {
        // Render a 2D circle in XZ as overlay in Three.js
        const radius = this._editOverlayRadius || 400;
        const segments = 128;
        const pts = [];
        for (let i = 0; i < segments; ++i) {
            const theta = (i / segments) * 2 * Math.PI;
            pts.push(new THREE.Vector3(Math.cos(theta) * radius, 0, Math.sin(theta) * radius));
        }
        const circleGeometry = new THREE.BufferGeometry().setFromPoints(pts);
        let color, linewidth;
        if (type === "hover") {
            color = 0xffe81f;
            linewidth = 2 * scale;
        }
        else if (type === "select") {
            color = 0xff3c3c;
            linewidth = 4 * scale;
        }
        else if (type === "edit") {
            color = 0x21c441;
            linewidth = 9 * scale;
        }
        else {
            color = 0xffffff;
            linewidth = 2 * scale;
        }
        let circle;
        // Prefer using THREE.Line2 for thick, visually robust lines if available
        if (typeof THREE.Line2 !== "undefined" &&
            typeof THREE.LineGeometry !== "undefined" &&
            typeof THREE.LineMaterial !== "undefined") {
            // Remove Y offset for 2D display
            const flatPts = pts.map((pt) => [pt.x, pt.y, pt.z]).flat();
            const geo2 = new THREE.LineGeometry();
            geo2.setPositions(flatPts);
            const mat2 = new THREE.LineMaterial({
                color: color,
                linewidth: linewidth, // in world units
                transparent: true,
                opacity: 0.72,
                depthTest: false,
            });
            mat2.resolution = new THREE.Vector2(window.innerWidth, window.innerHeight); // will be updated on resize
            circle = new THREE.Line2(geo2, mat2);
        }
        else {
            const circleMat = new THREE.LineBasicMaterial({
                color,
                linewidth,
                transparent: true,
                opacity: 0.72,
                depthTest: false,
            });
            circle = new THREE.LineLoop(circleGeometry, circleMat);
        }
        circle.position.set(pos.x, pos.y, pos.z);
        circle.renderOrder = 5000;
        circle.name = "editOverlayCircle";
        circle.userData.overlayType = type;
        return circle;
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
        this._renderOverlayCircle(cluster, "hover");
    }
    /**
     * Highlight/outline the selected cluster visually (draws a different thick circle/loop).
     * @param {Cluster|null} cluster
     */
    setSelectedCluster(cluster) {
        this._renderOverlayCircle(cluster, "select");
    }
    /**
     * Provide a mapping from connection key (as used by this._makeConnectionKey)
     * to a color ([r,g,b] or number), and update connection buffer accordingly.
     * @param {Object} connectionColors - key: connKey, value: [r,g,b] or hex
     */
    setConnectionColors(connectionColors) {
        if (!this.connectionsColors)
            return;
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
        if (!this.connectionsPositions)
            return;
        // Overlay color map
        const overlayColors = this._overlayConnectionColors || {};
        if (typeof THREE.Line2 === "undefined" ||
            typeof THREE.LineMaterial === "undefined" ||
            typeof THREE.LineGeometry === "undefined") {
            throw new Error("THREE.Line2/LineMaterial/LineGeometry are required for overlays but not found. Please ensure three/examples/jsm/lines/ modules are loaded.");
        }
        for (const key of this._selectedConnectionKeys) {
            const slot = this.connectionIdToBufferIndex.get(key);
            if (typeof slot !== "number") {
                continue;
            }
            const i = slot * 2 * 3;
            const p1 = new THREE.Vector3(this.connectionsPositions[i + 0], this.connectionsPositions[i + 1], this.connectionsPositions[i + 2]);
            const p2 = new THREE.Vector3(this.connectionsPositions[i + 3], this.connectionsPositions[i + 4], this.connectionsPositions[i + 5]);
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
    _initOverlayCircleTemplates() {
        if (this._circleTemplates)
            return;
        let templates;
        // Create unit circle geometry centered at origin with radius 1
        const segments = 96;
        const pts = [];
        for (let i = 0; i < segments; ++i) {
            const theta = (i / segments) * Math.PI * 2;
            pts.push(new THREE.Vector3(Math.cos(theta), 0, Math.sin(theta)));
        }
        // closed line
        pts.push(pts[0].clone());
        // Try to use THREE's fat lines (Line2/LineMaterial/LineGeometry)
        if (typeof THREE.Line2 !== "undefined" &&
            typeof THREE.LineMaterial !== "undefined" &&
            typeof THREE.LineGeometry !== "undefined") {
            // Convert the points array to flat array [x0,y0,z0, x1,y1,z1, ...]
            const posArr = [];
            for (const v of pts) {
                posArr.push(v.x, v.y, v.z);
            }
            // Create shared geometry
            const geometry = new THREE.LineGeometry();
            geometry.setPositions(posArr);
            // Create materials for hover and select
            const hoverMat = new THREE.LineMaterial({
                color: 0xffe81f,
                linewidth: 10,
                transparent: true,
                opacity: 1,
                depthWrite: false,
                depthTest: false,
            });
            hoverMat.resolution.set(window.innerWidth, window.innerHeight);
            const selectMat = new THREE.LineMaterial({
                color: 0xff3c3c,
                linewidth: 10,
                transparent: true,
                opacity: 1,
                depthWrite: false,
                depthTest: false,
            });
            selectMat.resolution.set(window.innerWidth, window.innerHeight);
            templates = {
                geometry,
                hoverMaterial: hoverMat,
                selectMaterial: selectMat,
                useLine2: true,
            };
        }
        else {
            // fallback to basic (1px) wire
            const circleGeometry = new THREE.BufferGeometry().setFromPoints(pts);
            const hoverMat = new THREE.LineBasicMaterial({
                color: new THREE.Color(0xffe81f),
                linewidth: 1,
                transparent: true,
                opacity: 1,
                depthWrite: false,
                depthTest: false,
            });
            const selectMat = new THREE.LineBasicMaterial({
                color: new THREE.Color(0xff3c3c),
                linewidth: 1,
                transparent: true,
                opacity: 1,
                depthWrite: false,
                depthTest: false,
            });
            templates = {
                geometry: circleGeometry,
                hoverMaterial: hoverMat,
                selectMaterial: selectMat,
                useLine2: false,
            };
        }
        this._circleTemplates = templates;
    }
    _renderOverlayCircle(cluster, type) {
        if (!this.overlayGroup) {
            this.overlayGroup = new THREE.Group();
            this.overlayGroup.renderOrder = 999;
            this.scene.add(this.overlayGroup);
            this._overlayCircles = {};
        }
        const overlayGroup = this.overlayGroup;
        if (!this._overlayCircles)
            this._overlayCircles = {};
        // Initialize templates if needed
        this._initOverlayCircleTemplates();
        const templates = this._circleTemplates;
        if (!templates)
            return;
        // Hide previous overlay of this type if any
        if (this._overlayCircles[type]) {
            this._overlayCircles[type].visible = false;
        }
        if (!cluster || !cluster.position)
            return;
        const radius = cluster.radius || 300;
        // Create circle if it doesn't exist for this type
        if (!this._overlayCircles[type]) {
            let circle;
            if (templates.useLine2) {
                const material = type === "hover" ? templates.hoverMaterial : templates.selectMaterial;
                circle = new THREE.Line2(templates.geometry, material);
                circle.computeLineDistances();
            }
            else {
                const material = type === "hover" ? templates.hoverMaterial : templates.selectMaterial;
                circle = new THREE.Line(templates.geometry, material);
            }
            circle.renderOrder = 999;
            overlayGroup.add(circle);
            this._overlayCircles[type] = circle;
        }
        // Update position and scale of existing circle
        const circle = this._overlayCircles[type];
        circle.position.set(cluster.position.x, cluster.position.y, cluster.position.z);
        circle.scale.setScalar(radius);
        circle.visible = true;
    }
    /**
     * Clean up overlay circle resources
     */
    disposeOverlayCircles() {
        if (this._circleTemplates) {
            if (this._circleTemplates.geometry) {
                this._circleTemplates.geometry.dispose();
            }
            if (this._circleTemplates.hoverMaterial) {
                this._circleTemplates.hoverMaterial.dispose();
            }
            if (this._circleTemplates.selectMaterial) {
                this._circleTemplates.selectMaterial.dispose();
            }
            this._circleTemplates = null;
        }
        if (this._overlayCircles) {
            Object.values(this._overlayCircles).forEach((circle) => {
                if (circle && circle.parent) {
                    circle.parent.remove(circle);
                }
            });
            this._overlayCircles = {};
        }
    }
    /**
     * Converts screen (clientX/clientY) to galaxy world coordinates, 2D (XZ plane).
     * Recommended for pointer picking/picking logic.
     * @param {number} clientX
     * @param {number} clientY
     * @returns {{x: number, y: number}}
     */
    screenToWorld(clientX, clientY) {
        // Compute normalized device coordinates (-1..1)
        const rect = this.renderer.domElement.getBoundingClientRect();
        const x = ((clientX - rect.left) / rect.width) * 2 - 1;
        const y = -((clientY - rect.top) / rect.height) * 2 + 1;
        const vector = new THREE.Vector3(x, y, 0.5);
        vector.unproject(this.camera);
        // Return world coords: we use X, Z as galaxy plane
        return { x: vector.x, y: vector.z };
    }
    /**
     * Initialize or reset the solar system batched buffer Points object for fast rendering.
     * Also sets up the main connection buffer for cluster links.
     * @param {number} maxSolarSystems
     */
    initializeSolarSystemBuffer(maxSolarSystems) {
        // Remove old points object if present
        if (this.solarSystemsPoints && this.solarSystemsPoints.parent) {
            this.solarSystemsPoints.parent.remove(this.solarSystemsPoints);
        }
        this.solarSystemIdToIndex = new Map();
        this.solarSystemsGeometry = new THREE.BufferGeometry();
        this.solarSystemsPositions = new Float32Array(maxSolarSystems * 3);
        this.solarSystemsColors = new Float32Array(maxSolarSystems * 3);
        this.solarSystemsVisibility = new Uint8Array(maxSolarSystems);
        this.solarSystemsGeometry.setAttribute("position", new THREE.BufferAttribute(this.solarSystemsPositions, 3));
        this.solarSystemsGeometry.setAttribute("color", new THREE.BufferAttribute(this.solarSystemsColors, 3));
        const material = new THREE.PointsMaterial({
            color: 0xffffff,
            size: 10.5,
            vertexColors: true,
            sizeAttenuation: true,
            transparent: true,
            opacity: 0.76,
        });
        this.solarSystemsPoints = new THREE.Points(this.solarSystemsGeometry, material);
        this.solarSystemsPoints.frustumCulled = false;
        this.scene.add(this.solarSystemsPoints);
        this.maxSolarSystems = maxSolarSystems;
        this.currentSolarSystemCount = 0;
        // --- Connection lines for cluster-cluster (handled by GalaxyConnectionLines, already in scene) ---
        // No-op here: handled by this.galaxyConnectionLines
    }
    init() {
        // Reference plane for navigation
        this.addReferencePlane();
        // Add lighting/ambience as needed here...
    }
    addReferencePlane() {
        const planeGeometry = new THREE.PlaneGeometry(100000, 100000, 10, 10);
        const planeMaterial = new THREE.MeshBasicMaterial({
            color: 0x334455,
            transparent: true,
            opacity: 0.08,
            wireframe: true,
            side: THREE.DoubleSide,
        });
        const plane = new THREE.Mesh(planeGeometry, planeMaterial);
        plane.rotation.x = Math.PI / 2;
        this.scene.add(plane);
    }
    setCameraController(controller) {
        this.cameraController = controller;
    }
    setFPSCallback(callback) {
        this.fpsCallback = callback;
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
        // Grow solar systems buffer if needed
        if (this.currentSolarSystemCount >= this.maxSolarSystems) {
            // Increase by 20%
            const newMax = Math.ceil(this.maxSolarSystems * 2) || this.maxSolarSystems + 1000;
            // Create new buffers with increased size
            const newPositions = new Float32Array(newMax * 3);
            const newColors = new Float32Array(newMax * 3);
            const newVisibility = new Uint8Array(newMax);
            // Copy old data
            newPositions.set(this.solarSystemsPositions);
            newColors.set(this.solarSystemsColors);
            newVisibility.set(this.solarSystemsVisibility);
            // Replace old
            this.solarSystemsPositions = newPositions;
            this.solarSystemsColors = newColors;
            this.solarSystemsVisibility = newVisibility;
            // Update geometry attributes
            this.solarSystemsGeometry.setAttribute("position", new THREE.BufferAttribute(this.solarSystemsPositions, 3));
            this.solarSystemsGeometry.setAttribute("color", new THREE.BufferAttribute(this.solarSystemsColors, 3));
            this.maxSolarSystems = newMax;
            console.warn("Resized solar systems buffer: now", this.maxSolarSystems);
        }
        const idx = this.currentSolarSystemCount++;
        this.solarSystemIdToIndex.set(solarSystem.id, idx);
        // Write position to buffer
        this.solarSystemsPositions[idx * 3] = solarSystem.position.x;
        this.solarSystemsPositions[idx * 3 + 1] = solarSystem.position.y;
        this.solarSystemsPositions[idx * 3 + 2] = solarSystem.position.z;
        // Write color to buffer (cluster color or jumpgate color)
        let color = new THREE.Color(solarSystem.isJumpGate ? 0x00ffff : cluster.color || 0xffffff);
        this.solarSystemsColors[idx * 3] = color.r;
        this.solarSystemsColors[idx * 3 + 1] = color.g;
        this.solarSystemsColors[idx * 3 + 2] = color.b;
        // Optionally mark this one as visible
        this.solarSystemsVisibility[idx] = 1;
        // Mark buffers as dirty so Three.js re-uploads to GPU
        this.solarSystemsGeometry.attributes.position.needsUpdate = true;
        this.solarSystemsGeometry.attributes.color.needsUpdate = true;
        // Optionally, save the buffer index on the solarSystem entity (for direct access)
        solarSystem._bufferIndex = idx;
    }
    updateSolarSystemPositions(solarSystems) {
        if (!Array.isArray(solarSystems) || solarSystems.length === 0)
            return;
        for (const solarSystem of solarSystems) {
            const idx = solarSystem._bufferIndex;
            if (typeof idx !== "number")
                continue;
            this.solarSystemsPositions[idx * 3] = solarSystem.position.x;
            this.solarSystemsPositions[idx * 3 + 1] = solarSystem.position.y;
            this.solarSystemsPositions[idx * 3 + 2] = solarSystem.position.z;
        }
        this.solarSystemsGeometry.attributes.position.needsUpdate = true;
    }
    removeSolarSystem(cluster, solarSystem) {
        // Remove the solar system from the batched Points buffer by marking its slot as invisible.
        // Set its color alpha to zero and position far away.
        const idx = solarSystem._bufferIndex;
        if (typeof idx !== "number")
            return;
        // Move it far away so it's outside the camera frustum
        this.solarSystemsPositions[idx * 3] = 1e9;
        this.solarSystemsPositions[idx * 3 + 1] = 1e9;
        this.solarSystemsPositions[idx * 3 + 2] = 1e9;
        // Optionally set its color to transparent
        this.solarSystemsColors[idx * 3] = 0;
        this.solarSystemsColors[idx * 3 + 1] = 0;
        this.solarSystemsColors[idx * 3 + 2] = 0;
        // Optionally, mark visibility as 0 (if used in custom shader)
        this.solarSystemsVisibility[idx] = 0;
        this.solarSystemsGeometry.attributes.position.needsUpdate = true;
        this.solarSystemsGeometry.attributes.color.needsUpdate = true;
    }
    /**
     * Generate a unique connection key for buffer index/slot mapping.
     * Uses cluster1Id, cluster2Id, jumpGate1Id, jumpGate2Id.
     * Always orders cluster IDs lowest first for consistent mapping.
     */
    _makeConnectionKey(cluster1, cluster2, jumpGate1, jumpGate2) {
        // IDs are always numbers.
        // To ensure symmetric connections (A-B == B-A), sort cluster IDs.
        let arr = [cluster1.id, cluster2.id, jumpGate1.id, jumpGate2.id];
        // Sort by clusterId then by jumpGateId to make the direction unique.
        if (cluster1.id > cluster2.id ||
            (cluster1.id === cluster2.id && jumpGate1.id > jumpGate2.id)) {
            arr = [cluster2.id, cluster1.id, jumpGate2.id, jumpGate1.id];
        }
        return arr.join("_");
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
        if (!solarSystemA || !solarSystemB)
            return;
        // Symmetric key for edge inside this cluster
        // You can alternatively just: `${solarSystemA.id}_${solarSystemB.id}_${cluster.id}`
        const key = GalaxyConnectionLines.makeKey(solarSystemA.id, solarSystemB.id) +
            `_${cluster.id}`;
        const p1 = solarSystemA.position;
        const p2 = solarSystemB.position;
        // Color fallback: 0xffc700 (gold) for solar system links; or allow override
        const color = options.color || 0xffc700;
        this.solarSystemConnectionLines.addConnection(p1, p2, color, key);
    }
    removeSolarSystemConnection(cluster, solarSystemA, solarSystemB) {
        const key = GalaxyConnectionLines.makeKey(solarSystemA.id, solarSystemB.id) +
            `_${cluster.id}`;
        return this.solarSystemConnectionLines.removeConnection(key);
    }
    updateSolarSystemConnections(cluster) {
        const idToSystem = new Map();
        for (const sys of cluster.solarSystems) {
            idToSystem.set(sys.id, sys);
        }
        for (const sys of cluster.solarSystems) {
            if (!Array.isArray(sys.connections))
                continue;
            for (const connectedId of sys.connections) {
                if (connectedId <= sys.id)
                    continue;
                const other = idToSystem.get(connectedId);
                if (!other)
                    continue;
                const key = GalaxyConnectionLines.makeKey(sys.id, other.id) + `_${cluster.id}`;
                this.solarSystemConnectionLines.updateConnection(key, sys.position, other.position);
            }
        }
    }
    updateEditOverlayPosition(clusterId, position) {
        if (this._handlesActiveCluster !== clusterId)
            return;
        if (!this._editHandleCircle)
            return;
        this._editHandleCircle.position.set(position.x, position.y, position.z);
    }
    /**
     * Toggles between 3D and flattened (XZ plane) rendering for solar systems/connections.
     * Directly mutates underlying GPU position buffers.
     */
    toggleDimensionality() {
        if (typeof this._flat2DActive !== "boolean") {
            this._flat2DActive = false;
        }
        // On first activation, back up all original Y coordinates for restoration.
        if (!this._originalSolarSystemYPositions) {
            this._originalSolarSystemYPositions = new Float32Array(this.solarSystemsPositions.length / 3);
            for (let i = 0, len = this.solarSystemsPositions.length / 3; i < len; ++i) {
                this._originalSolarSystemYPositions[i] =
                    this.solarSystemsPositions[i * 3 + 1];
            }
        }
        if (!this._originalConnectionYPositions && this.connectionsPositions) {
            this._originalConnectionYPositions = new Float32Array(this.connectionsPositions.length / 3);
            for (let i = 0, len = this.connectionsPositions.length / 3; i < len; ++i) {
                this._originalConnectionYPositions[i] =
                    this.connectionsPositions[i * 3 + 1];
            }
        }
        this._flat2DActive = !this._flat2DActive;
        // Flip solar system points
        for (let i = 0, len = this.solarSystemsPositions.length / 3; i < len; ++i) {
            if (this._flat2DActive) {
                this.solarSystemsPositions[i * 3 + 1] = 0;
            }
            else {
                this.solarSystemsPositions[i * 3 + 1] =
                    this._originalSolarSystemYPositions[i];
            }
        }
        if (this.solarSystemsGeometry &&
            this.solarSystemsGeometry.attributes &&
            this.solarSystemsGeometry.attributes.position) {
            this.solarSystemsGeometry.attributes.position.needsUpdate = true;
        }
        // Flip connection lines (Y)
        if (this.connectionsPositions && this._originalConnectionYPositions) {
            for (let i = 0, len = this.connectionsPositions.length / 3; i < len; ++i) {
                if (this._flat2DActive) {
                    this.connectionsPositions[i * 3 + 1] = 0;
                }
                else {
                    this.connectionsPositions[i * 3 + 1] =
                        this._originalConnectionYPositions[i];
                }
            }
            if (this.connectionsGeometry &&
                this.connectionsGeometry.attributes &&
                this.connectionsGeometry.attributes.position) {
                this.connectionsGeometry.attributes.position.needsUpdate = true;
            }
        }
    }
    connectClusters(cluster1, cluster2, jumpGate1, jumpGate2) {
        if (!jumpGate1 || !jumpGate2)
            return;
        const key = this._makeConnectionKey(cluster1, cluster2, jumpGate1, jumpGate2);
        // Add with default color, key; points from jumpGate1 -> jumpGate2
        this.galaxyConnectionLines.addConnection(jumpGate1.position, jumpGate2.position, 0x00ffff, key);
        this.connections.push({ cluster1, cluster2, jumpGate1, jumpGate2 });
        // Optionally link buffer keys to cluster objects (not buffer index)
        if (!cluster1.connectedConnectionKeys)
            cluster1.connectedConnectionKeys = [];
        if (!cluster2.connectedConnectionKeys)
            cluster2.connectedConnectionKeys = [];
        cluster1.connectedConnectionKeys.push(key);
        cluster2.connectedConnectionKeys.push(key);
    }
    updateClusterConnections(clusterId) {
        if (!Array.isArray(this.connections))
            return;
        for (const conn of this.connections) {
            if (conn.cluster1.id !== clusterId && conn.cluster2.id !== clusterId)
                continue;
            const key = this._makeConnectionKey(conn.cluster1, conn.cluster2, conn.jumpGate1, conn.jumpGate2);
            this.galaxyConnectionLines.updateConnection(key, conn.jumpGate1.position, conn.jumpGate2.position);
            const slot = this.connectionIdToBufferIndex.get(key);
            if (this.connectionsPositions && typeof slot === "number") {
                const i = slot * 2 * 3;
                this.connectionsPositions[i + 0] = conn.jumpGate1.position.x;
                this.connectionsPositions[i + 1] = conn.jumpGate1.position.y;
                this.connectionsPositions[i + 2] = conn.jumpGate1.position.z;
                this.connectionsPositions[i + 3] = conn.jumpGate2.position.x;
                this.connectionsPositions[i + 4] = conn.jumpGate2.position.y;
                this.connectionsPositions[i + 5] = conn.jumpGate2.position.z;
            }
        }
        if (this.connectionsGeometry.attributes &&
            this.connectionsGeometry.attributes.position) {
            this.connectionsGeometry.attributes.position.needsUpdate = true;
        }
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
        return this.galaxyConnectionLines.removeConnection(key);
    }
    /**
     * Remove a cluster connection using its entities (cluster, jumpgates).
     * @param {object} cluster1
     * @param {object} cluster2
     * @param {object} jumpGate1
     * @param {object} jumpGate2
     */
    removeClusterConnection(cluster1, cluster2, jumpGate1, jumpGate2) {
        const key = this._makeConnectionKey(cluster1, cluster2, jumpGate1, jumpGate2);
        this.connections = this.connections.filter((conn) => conn.cluster1.id !== cluster1.id ||
            conn.cluster2.id !== cluster2.id ||
            conn.jumpGate1.id !== jumpGate1.id ||
            conn.jumpGate2.id !== jumpGate2.id);
        return this.removeClusterConnectionByKey(key);
    }
    /**
     * Finalize GPU buffers after bulk generation or major topology edits.
     * Rebuilds tightly packed solar-system + connection buffers, refreshes index maps,
     * and updates per-system buffer indices so incremental updates hit the right slots.
     * This is necessary because incremental add/remove ops leave holes in fixed-size
     * buffers; compacting avoids stale draws and keeps draw ranges accurate.
     */
    finalizeBuffers(galaxy) {
        // 1. Solar systems:
        // Count total number of solar systems
        let numSolarSystems = 0;
        for (const c of galaxy.clusters)
            numSolarSystems += c.solarSystems.length;
        // Create new, perfectly-sized buffers
        const ssPositions = new Float32Array(numSolarSystems * 3);
        const ssColors = new Float32Array(numSolarSystems * 3);
        const ssVisibility = new Uint8Array(numSolarSystems);
        // Fill with current data
        let idx = 0;
        for (const c of galaxy.clusters) {
            for (const s of c.solarSystems) {
                ssPositions[idx * 3 + 0] = s.position.x;
                ssPositions[idx * 3 + 1] = s.position.y;
                ssPositions[idx * 3 + 2] = s.position.z;
                const color = new THREE.Color(s.isJumpGate ? 0x00ffff : c.color || 0xffffff);
                ssColors[idx * 3 + 0] = color.r;
                ssColors[idx * 3 + 1] = color.g;
                ssColors[idx * 3 + 2] = color.b;
                ssVisibility[idx] = 1;
                // Also, let the solarSystem know its buffer index
                s._bufferIndex = idx;
                idx++;
            }
        }
        // Replace attributes on Points geometry
        this.solarSystemsPositions = ssPositions;
        this.solarSystemsColors = ssColors;
        this.solarSystemsVisibility = ssVisibility;
        this.maxSolarSystems = numSolarSystems;
        this.currentSolarSystemCount = numSolarSystems;
        this.solarSystemsGeometry.setAttribute("position", new THREE.BufferAttribute(ssPositions, 3));
        this.solarSystemsGeometry.setAttribute("color", new THREE.BufferAttribute(ssColors, 3));
        this.solarSystemsGeometry.attributes.position.needsUpdate = true;
        this.solarSystemsGeometry.attributes.color.needsUpdate = true;
        // 2. Connections:
        // Compact all cluster-to-cluster jumpgate connections
        // Remove any holes, rebuild buffer and index map from scratch
        // Only keep connections that are visually valid (i.e., don't have any nulls etc)
        const validConnections = [];
        for (const conn of galaxy.connections) {
            // Sanity: skip if any part missing
            if (!conn.cluster1 ||
                !conn.cluster2 ||
                !conn.jumpGate1 ||
                !conn.jumpGate2)
                continue;
            // Optionally skip if either jumpgate is missing position
            if (!conn.jumpGate1.position || !conn.jumpGate2.position)
                continue;
            validConnections.push(conn);
        }
        const numConnections = validConnections.length;
        const conPositions = new Float32Array(numConnections * 2 * 3);
        const conColors = new Float32Array(numConnections * 2 * 3);
        // === Compact connectionIdToBufferIndex to match new buffer order ===
        this.connectionIdToBufferIndex = new Map();
        let cidx = 0;
        for (const conn of validConnections) {
            const s1 = conn.jumpGate1.position, s2 = conn.jumpGate2.position;
            conPositions[cidx * 6 + 0] = s1.x;
            conPositions[cidx * 6 + 1] = s1.y;
            conPositions[cidx * 6 + 2] = s1.z;
            conPositions[cidx * 6 + 3] = s2.x;
            conPositions[cidx * 6 + 4] = s2.y;
            conPositions[cidx * 6 + 5] = s2.z;
            const color = new THREE.Color(0x00ffff); // fixed for jumpgate
            conColors[cidx * 6 + 0] = color.r;
            conColors[cidx * 6 + 1] = color.g;
            conColors[cidx * 6 + 2] = color.b;
            conColors[cidx * 6 + 3] = color.r;
            conColors[cidx * 6 + 4] = color.g;
            conColors[cidx * 6 + 5] = color.b;
            // Regenerate the key for this connection for the new buffer slot
            const key = this._makeConnectionKey(conn.cluster1, conn.cluster2, conn.jumpGate1, conn.jumpGate2);
            this.connectionIdToBufferIndex.set(key, cidx);
            cidx++;
        }
        this.connectionsPositions = conPositions;
        this.connectionsColors = conColors;
        this.connectionCount = numConnections;
        this.connectionsGeometry.setAttribute("position", new THREE.BufferAttribute(conPositions, 3));
        this.connectionsGeometry.setAttribute("color", new THREE.BufferAttribute(conColors, 3));
        this.connectionsGeometry.setDrawRange(0, numConnections * 2);
        this.connectionsGeometry.attributes.position.needsUpdate = true;
        this.connectionsGeometry.attributes.color.needsUpdate = true;
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
        this.renderer.render(this.scene, this.camera);
        for (const panel of this.statsPanels) {
            panel.end();
        }
        //this.labelRenderer.render(this.scene, this.camera);
    }
    updateFPS() {
        this.frameCount++;
        const currentTime = performance.now();
        const elapsed = currentTime - this.lastTime;
        if (elapsed >= 1000) {
            const fps = Math.round((this.frameCount * 1000) / elapsed);
            if (this.fpsCallback)
                this.fpsCallback(fps);
            this.frameCount = 0;
            this.lastTime = currentTime;
        }
    }
    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
        // Update Line2 material resolution for overlay circles
        if (this._circleTemplates && this._circleTemplates.useLine2) {
            const width = window.innerWidth;
            const height = window.innerHeight;
            const hoverMat = this._circleTemplates
                .hoverMaterial;
            const selectMat = this._circleTemplates
                .selectMaterial;
            hoverMat.resolution.set(width, height);
            selectMat.resolution.set(width, height);
        }
    }
    clear() {
        // Clear all children from root groups
        while (this.galaxyClusterGroup.children.length > 0) {
            const c = this.galaxyClusterGroup.children[0];
            this.galaxyClusterGroup.remove(c);
            // Dispose geometry/material if you want here...
        }
        this.galaxyConnectionLines.clear();
        this.solarSystemConnectionLines.clear();
        this.connectionIdToBufferIndex = new Map();
        this.connectionsPositions = null;
        this.connectionsColors = null;
        this.connectionCount = 0;
        this.connections = [];
        this.clusters = [];
        // Clean up overlay circles
        this.disposeOverlayCircles();
    }
    getStatistics() {
        let numClusters = this.clusters.length;
        let numSystems = 0;
        let numJumpGates = 0;
        let numConnections = this.connections ? this.connections.length : 0;
        let numInternalLinks = 0;
        for (const cluster of this.clusters) {
            if (!cluster.solarSystems)
                continue;
            numSystems += cluster.solarSystems.length;
            for (const sys of cluster.solarSystems) {
                if (sys.isJumpGate)
                    numJumpGates++;
                // Internal connections: count once per system (undirected)
                if (Array.isArray(sys.connections))
                    numInternalLinks += sys.connections.length;
            }
        }
        // Internal links counted for each system; halve for total undirected links
        numInternalLinks = Math.floor(numInternalLinks / 2);
        return {
            clusters: numClusters,
            solarSystems: numSystems,
            jumpGates: numJumpGates,
            connections: numConnections,
            internalConnections: numInternalLinks,
        };
    }
}
//# sourceMappingURL=galaxy-renderer.js.map