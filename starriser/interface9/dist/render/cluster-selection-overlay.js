import * as THREE from "../vendor/three.js";
export class ClusterSelectionOverlay {
    constructor(scene, selectionOverlay) {
        this.scene = scene;
        this.selectionOverlay = selectionOverlay;
        this.circleTemplates = null;
        this.overlayCircles = null;
        this.overlayGroup = null;
    }
    setHoveredCluster(cluster) {
        this.renderOverlayCircle(cluster, "hover");
    }
    setSelectedCluster(cluster) {
        this.renderOverlayCircle(cluster, "select");
        if (!cluster) {
            this.selectionOverlay.setSelections([]);
            return;
        }
        const selectionPanel = this.createSelectionPanel(cluster);
        const size = {
            x: cluster.radius * 2,
            y: Math.max(120, cluster.radius * 0.5),
            z: cluster.radius * 2,
        };
        const selection = {
            id: `cluster_${cluster.id}`,
            getPosition: () => ({
                x: cluster.position.x,
                y: 0,
                z: cluster.position.z,
            }),
            size,
            html: selectionPanel,
            htmlOffset: { x: 8, y: -12 },
            htmlAnchor: "box-right",
            htmlDraggable: false,
        };
        this.selectionOverlay.setSelections([selection]);
    }
    setSelectionBoxes(selections) {
        this.selectionOverlay.setSelections(selections);
    }
    update() {
        this.selectionOverlay.update();
    }
    onWindowResize(width, height) {
        if (!this.circleTemplates || !this.circleTemplates.useLine2)
            return;
        this.circleTemplates.hoverMaterial.resolution.set(width, height);
        this.circleTemplates.selectMaterial.resolution.set(width, height);
    }
    clear() {
        this.disposeOverlayCircles();
        this.selectionOverlay.clear();
    }
    createSelectionPanel(cluster) {
        const panel = document.createElement("div");
        panel.className = "ui-panel webgl-selection-panel";
        panel.style.padding = "8px 10px";
        panel.style.pointerEvents = "none";
        const title = document.createElement("div");
        title.className = "ui-panel-title";
        title.textContent = `Cluster ${cluster.id}`;
        panel.appendChild(title);
        const radius = document.createElement("div");
        radius.className = "ui-muted";
        radius.textContent = `Radius: ${Math.round(cluster.radius)}`;
        panel.appendChild(radius);
        return panel;
    }
    initOverlayCircleTemplates() {
        if (this.circleTemplates)
            return;
        let templates;
        const segments = 96;
        const pts = [];
        for (let i = 0; i < segments; ++i) {
            const theta = (i / segments) * Math.PI * 2;
            pts.push(new THREE.Vector3(Math.cos(theta), 0, Math.sin(theta)));
        }
        pts.push(pts[0].clone());
        if (typeof THREE.Line2 !== "undefined" &&
            typeof THREE.LineMaterial !== "undefined" &&
            typeof THREE.LineGeometry !== "undefined") {
            const posArr = [];
            for (const v of pts) {
                posArr.push(v.x, v.y, v.z);
            }
            const geometry = new THREE.LineGeometry();
            geometry.setPositions(posArr);
            const hoverMaterial = new THREE.LineMaterial({
                color: 0xffe81f,
                linewidth: 10,
                transparent: true,
                opacity: 1,
                depthWrite: false,
                depthTest: false,
            });
            hoverMaterial.resolution.set(window.innerWidth, window.innerHeight);
            const selectMaterial = new THREE.LineMaterial({
                color: 0xff3c3c,
                linewidth: 10,
                transparent: true,
                opacity: 1,
                depthWrite: false,
                depthTest: false,
            });
            selectMaterial.resolution.set(window.innerWidth, window.innerHeight);
            templates = {
                geometry,
                hoverMaterial,
                selectMaterial,
                useLine2: true,
            };
        }
        else {
            const geometry = new THREE.BufferGeometry().setFromPoints(pts);
            const hoverMaterial = new THREE.LineBasicMaterial({
                color: new THREE.Color(0xffe81f),
                linewidth: 1,
                transparent: true,
                opacity: 1,
                depthWrite: false,
                depthTest: false,
            });
            const selectMaterial = new THREE.LineBasicMaterial({
                color: new THREE.Color(0xff3c3c),
                linewidth: 1,
                transparent: true,
                opacity: 1,
                depthWrite: false,
                depthTest: false,
            });
            templates = {
                geometry,
                hoverMaterial,
                selectMaterial,
                useLine2: false,
            };
        }
        this.circleTemplates = templates;
    }
    renderOverlayCircle(cluster, type) {
        if (!this.overlayGroup) {
            this.overlayGroup = new THREE.Group();
            this.overlayGroup.renderOrder = 999;
            this.scene.add(this.overlayGroup);
            this.overlayCircles = {};
        }
        const overlayGroup = this.overlayGroup;
        if (!this.overlayCircles)
            this.overlayCircles = {};
        this.initOverlayCircleTemplates();
        const templates = this.circleTemplates;
        if (!templates)
            return;
        if (this.overlayCircles[type]) {
            this.overlayCircles[type].visible = false;
        }
        if (!cluster || !cluster.position)
            return;
        const radius = cluster.radius || 300;
        if (!this.overlayCircles[type]) {
            let circle;
            if (templates.useLine2) {
                const material = type === "hover" ? templates.hoverMaterial : templates.selectMaterial;
                const line = new THREE.Line2(templates.geometry, material);
                line.computeLineDistances();
                circle = line;
            }
            else {
                const material = type === "hover" ? templates.hoverMaterial : templates.selectMaterial;
                circle = new THREE.Line(templates.geometry, material);
            }
            circle.renderOrder = 999;
            overlayGroup.add(circle);
            this.overlayCircles[type] = circle;
        }
        const circle = this.overlayCircles[type];
        circle.position.set(cluster.position.x, 0, cluster.position.z);
        circle.scale.setScalar(radius);
        circle.visible = true;
    }
    disposeOverlayCircles() {
        if (this.circleTemplates) {
            this.circleTemplates.geometry.dispose();
            this.circleTemplates.hoverMaterial.dispose();
            this.circleTemplates.selectMaterial.dispose();
            this.circleTemplates = null;
        }
        if (this.overlayCircles) {
            Object.values(this.overlayCircles).forEach((circle) => {
                if (circle && circle.parent) {
                    circle.parent.remove(circle);
                }
            });
            this.overlayCircles = {};
        }
    }
}
//# sourceMappingURL=cluster-selection-overlay.js.map