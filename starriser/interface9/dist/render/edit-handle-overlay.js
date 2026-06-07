import * as THREE from "../vendor/three.js";
import { AxisGizmo } from "../gfx-utils/ui-overlays.js";
export class EditHandleOverlay {
    constructor(scene) {
        this.group = new THREE.Group();
        this.group.name = "EditEditCircle";
        scene.add(this.group);
        this.handlesByCluster = new Map();
        this.axisGizmo = new AxisGizmo(this.group);
        this.editHandleCircle = null;
        this.activeCluster = null;
        this.handleBeingDragged = null;
        this.radius = 400;
    }
    hasHandles() {
        return this.group.children.length > 0;
    }
    getHit(camera, ndcX, ndcY) {
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
        const intersects = raycaster.intersectObjects(this.group.children, true);
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
    show(clusterId, handles) {
        this.hide();
        if (this.axisGizmo.group.parent !== this.group) {
            this.group.add(this.axisGizmo.group);
        }
        let x = 0;
        let z = 0;
        if (Array.isArray(handles) && handles.length > 0) {
            x = handles[0].x || 0;
            z = handles[0].z || 0;
        }
        const y = 0;
        const circleObj = this.renderOverlayCircle({ x, y, z }, 1.8);
        circleObj.userData.interactive = true;
        circleObj.userData.__editHandleId = `edit_circle_${clusterId}`;
        circleObj.userData.__editHandleKind = "planeXZ";
        circleObj.userData.__editClusterId = clusterId;
        this.group.add(circleObj);
        this.editHandleCircle = circleObj;
        const pickGeometry = new THREE.PlaneGeometry(this.radius * 2, this.radius * 2);
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
        this.group.add(pickPlane);
        this.activeCluster = clusterId;
        this.axisGizmo.show(clusterId, { x, y, z }, this.radius * 1.4);
    }
    hide() {
        for (const child of [...this.group.children]) {
            if (child === this.axisGizmo.group)
                continue;
            this.group.remove(child);
            const renderable = child;
            if (renderable.geometry)
                renderable.geometry.dispose();
            if (renderable.material)
                renderable.material.dispose();
        }
        this.handlesByCluster.clear();
        this.activeCluster = null;
        this.handleBeingDragged = null;
        this.editHandleCircle = null;
        this.axisGizmo.hide();
    }
    updatePosition(clusterId, position) {
        if (this.activeCluster !== clusterId)
            return;
        if (!this.editHandleCircle)
            return;
        this.editHandleCircle.position.set(position.x, 0, position.z);
        this.axisGizmo.updatePosition({ x: position.x, y: 0, z: position.z });
    }
    renderOverlayCircle(pos, scale) {
        const segments = 128;
        const pts = [];
        for (let i = 0; i < segments; ++i) {
            const theta = (i / segments) * 2 * Math.PI;
            pts.push(new THREE.Vector3(Math.cos(theta) * this.radius, 0, Math.sin(theta) * this.radius));
        }
        const circleGeometry = new THREE.BufferGeometry().setFromPoints(pts);
        const color = 0x21c441;
        const linewidth = 9 * scale;
        let circle;
        if (typeof THREE.Line2 !== "undefined" &&
            typeof THREE.LineGeometry !== "undefined" &&
            typeof THREE.LineMaterial !== "undefined") {
            const flatPts = pts.map((pt) => [pt.x, pt.y, pt.z]).flat();
            const geometry = new THREE.LineGeometry();
            geometry.setPositions(flatPts);
            const material = new THREE.LineMaterial({
                color,
                linewidth,
                transparent: true,
                opacity: 0.72,
                depthTest: false,
            });
            material.resolution = new THREE.Vector2(window.innerWidth, window.innerHeight);
            circle = new THREE.Line2(geometry, material);
        }
        else {
            const material = new THREE.LineBasicMaterial({
                color,
                linewidth,
                transparent: true,
                opacity: 0.72,
                depthTest: false,
            });
            circle = new THREE.LineLoop(circleGeometry, material);
        }
        circle.position.set(pos.x, pos.y, pos.z);
        circle.renderOrder = 5000;
        circle.name = "editOverlayCircle";
        circle.userData.overlayType = "edit";
        return circle;
    }
}
//# sourceMappingURL=edit-handle-overlay.js.map