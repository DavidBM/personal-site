import * as THREE from "../vendor/three.js";
export class ScreenOverlayRegistry {
    constructor(container) {
        this.container = container;
        this.overlays = new Map();
        this._scratch = new THREE.Vector3();
    }
    register(options) {
        const existing = this.overlays.get(options.id);
        if (existing) {
            existing.element.remove();
            this.overlays.delete(options.id);
        }
        const entry = {
            id: options.id,
            element: options.element,
            getWorldPosition: options.getWorldPosition,
            getScreenPosition: options.getScreenPosition,
            offset: options.offset ?? { x: 0, y: 0 },
            draggable: options.draggable ?? false,
        };
        entry.element.style.position = "absolute";
        entry.element.style.left = "0";
        entry.element.style.top = "0";
        entry.element.style.pointerEvents = entry.draggable ? "auto" : "none";
        entry.element.style.transform = "translate(-9999px, -9999px)";
        if (entry.draggable) {
            this.attachDragHandlers(entry);
        }
        this.container.appendChild(entry.element);
        this.overlays.set(entry.id, entry);
        return {
            id: entry.id,
            remove: () => {
                entry.element.remove();
                this.overlays.delete(entry.id);
            },
            setOffset: (x, y) => {
                entry.offset.x = x;
                entry.offset.y = y;
            },
        };
    }
    clear() {
        for (const entry of this.overlays.values()) {
            entry.element.remove();
        }
        this.overlays.clear();
    }
    update(camera, viewport) {
        const width = viewport.clientWidth || window.innerWidth;
        const height = viewport.clientHeight || window.innerHeight;
        for (const entry of this.overlays.values()) {
            let x = 0;
            let y = 0;
            if (entry.getScreenPosition) {
                const pos = entry.getScreenPosition(camera, viewport);
                x = pos.x;
                y = pos.y;
            }
            else {
                const position = entry.getWorldPosition();
                this._scratch.set(position.x, position.y, position.z);
                this._scratch.project(camera);
                x = (this._scratch.x * 0.5 + 0.5) * width;
                y = (-this._scratch.y * 0.5 + 0.5) * height;
            }
            const nextX = Math.round(x + entry.offset.x);
            const nextY = Math.round(y + entry.offset.y);
            entry.element.style.transform = `translate(${nextX}px, ${nextY}px)`;
        }
    }
    attachDragHandlers(entry) {
        let dragging = false;
        let startX = 0;
        let startY = 0;
        let originX = 0;
        let originY = 0;
        const onPointerMove = (event) => {
            if (!dragging)
                return;
            const dx = event.clientX - startX;
            const dy = event.clientY - startY;
            entry.offset.x = originX + dx;
            entry.offset.y = originY + dy;
        };
        const onPointerUp = () => {
            if (!dragging)
                return;
            dragging = false;
            document.removeEventListener("pointermove", onPointerMove);
            document.removeEventListener("pointerup", onPointerUp);
        };
        entry.element.addEventListener("pointerdown", (event) => {
            if (event.button !== 0)
                return;
            dragging = true;
            startX = event.clientX;
            startY = event.clientY;
            originX = entry.offset.x;
            originY = entry.offset.y;
            document.addEventListener("pointermove", onPointerMove);
            document.addEventListener("pointerup", onPointerUp);
            event.preventDefault();
            event.stopPropagation();
        });
    }
}
export class SelectionOverlay {
    constructor(scene, overlayRegistry) {
        this.geometry = new THREE.BufferGeometry();
        this.material = new THREE.LineBasicMaterial({
            color: 0xff3c3c,
            transparent: true,
            opacity: 0.7,
            depthTest: false,
        });
        this._positions = new Float32Array(0);
        this.geometry.setAttribute("position", new THREE.BufferAttribute(this._positions, 3));
        this.line = new THREE.LineSegments(this.geometry, this.material);
        this.line.frustumCulled = false;
        this.line.renderOrder = 4500;
        this.line.visible = false;
        scene.add(this.line);
        this._items = [];
        this._overlayRegistry = overlayRegistry;
        this._overlayHandles = new Map();
    }
    setSelections(items) {
        this._items = items.slice();
        this.syncOverlayElements();
        this.ensureBuffer(items.length);
        this.update();
    }
    clear() {
        this._items = [];
        this.line.visible = false;
        this.geometry.setDrawRange(0, 0);
        this._overlayRegistry.clear();
        this._overlayHandles.clear();
    }
    update() {
        if (!this._items.length) {
            this.line.visible = false;
            this.geometry.setDrawRange(0, 0);
            return;
        }
        this.line.visible = true;
        let offset = 0;
        for (const item of this._items) {
            const pos = item.getPosition();
            const halfX = item.size.x * 0.5;
            const halfY = item.size.y * 0.5;
            const halfZ = item.size.z * 0.5;
            const x0 = pos.x - halfX;
            const x1 = pos.x + halfX;
            const y0 = pos.y - halfY;
            const y1 = pos.y + halfY;
            const z0 = pos.z - halfZ;
            const z1 = pos.z + halfZ;
            const corners = [
                [x0, y0, z0],
                [x1, y0, z0],
                [x1, y0, z1],
                [x0, y0, z1],
                [x0, y1, z0],
                [x1, y1, z0],
                [x1, y1, z1],
                [x0, y1, z1],
            ];
            const edges = [
                [0, 1],
                [1, 2],
                [2, 3],
                [3, 0],
                [4, 5],
                [5, 6],
                [6, 7],
                [7, 4],
                [0, 4],
                [1, 5],
                [2, 6],
                [3, 7],
            ];
            for (const [a, b] of edges) {
                const ca = corners[a];
                const cb = corners[b];
                this._positions[offset++] = ca[0];
                this._positions[offset++] = ca[1];
                this._positions[offset++] = ca[2];
                this._positions[offset++] = cb[0];
                this._positions[offset++] = cb[1];
                this._positions[offset++] = cb[2];
            }
        }
        this.geometry.setDrawRange(0, offset / 3);
        this.geometry.attributes.position.needsUpdate = true;
    }
    ensureBuffer(itemCount) {
        const needed = itemCount * 72;
        if (this._positions.length === needed)
            return;
        this._positions = new Float32Array(needed);
        this.geometry.setAttribute("position", new THREE.BufferAttribute(this._positions, 3));
    }
    syncOverlayElements() {
        const activeIds = new Set(this._items.map((item) => item.id));
        for (const [id, handle] of this._overlayHandles) {
            if (!activeIds.has(id)) {
                handle.remove();
                this._overlayHandles.delete(id);
            }
        }
        for (const item of this._items) {
            if (!item.html)
                continue;
            if (this._overlayHandles.has(item.id))
                continue;
            let getScreenPosition;
            if (item.htmlAnchor === "box-right") {
                const scratch = new THREE.Vector3();
                getScreenPosition = (camera, viewport) => {
                    const pos = item.getPosition();
                    const halfX = item.size.x * 0.5;
                    const halfY = item.size.y * 0.5;
                    const halfZ = item.size.z * 0.5;
                    const x0 = pos.x - halfX;
                    const x1 = pos.x + halfX;
                    const y0 = pos.y - halfY;
                    const y1 = pos.y + halfY;
                    const z0 = pos.z - halfZ;
                    const z1 = pos.z + halfZ;
                    const width = viewport.clientWidth || window.innerWidth;
                    const height = viewport.clientHeight || window.innerHeight;
                    let maxX = -Infinity;
                    const corners = [
                        [x0, y0, z0],
                        [x1, y0, z0],
                        [x1, y0, z1],
                        [x0, y0, z1],
                        [x0, y1, z0],
                        [x1, y1, z0],
                        [x1, y1, z1],
                        [x0, y1, z1],
                    ];
                    for (const corner of corners) {
                        scratch.set(corner[0], corner[1], corner[2]);
                        scratch.project(camera);
                        const sx = (scratch.x * 0.5 + 0.5) * width;
                        if (sx > maxX)
                            maxX = sx;
                    }
                    scratch.set(pos.x, pos.y, pos.z);
                    scratch.project(camera);
                    const centerY = (-scratch.y * 0.5 + 0.5) * height;
                    return { x: maxX, y: centerY };
                };
            }
            const handle = this._overlayRegistry.register({
                id: item.id,
                element: item.html,
                getWorldPosition: item.htmlGetPosition ?? item.getPosition,
                getScreenPosition,
                offset: item.htmlOffset,
                draggable: item.htmlDraggable,
            });
            this._overlayHandles.set(item.id, handle);
        }
    }
}
export class GraphPathOverlay {
    constructor(scene) {
        this.geometry = new THREE.BufferGeometry();
        this.material = new THREE.LineBasicMaterial({
            color: 0x3c5cff,
            transparent: true,
            opacity: 0.85,
            depthTest: false,
        });
        this._positions = new Float32Array(0);
        this.geometry.setAttribute("position", new THREE.BufferAttribute(this._positions, 3));
        this.line = new THREE.Line(this.geometry, this.material);
        this.line.renderOrder = 4200;
        this.line.visible = false;
        scene.add(this.line);
    }
    setPath(points, color) {
        if (points.length < 2) {
            this.clear();
            return;
        }
        if (color !== undefined) {
            this.material.color = new THREE.Color(color);
        }
        const needed = points.length * 3;
        if (this._positions.length !== needed) {
            this._positions = new Float32Array(needed);
            this.geometry.setAttribute("position", new THREE.BufferAttribute(this._positions, 3));
        }
        let offset = 0;
        for (const point of points) {
            this._positions[offset++] = point.x;
            this._positions[offset++] = point.y;
            this._positions[offset++] = point.z;
        }
        this.geometry.setDrawRange(0, points.length);
        this.geometry.attributes.position.needsUpdate = true;
        this.line.visible = true;
    }
    clear() {
        this.geometry.setDrawRange(0, 0);
        this.line.visible = false;
    }
}
export class TextBillboardManager {
    constructor(scene) {
        this.group = new THREE.Group();
        scene.add(this.group);
        this._labels = new Map();
    }
    setLabels(labels) {
        const active = new Set(labels.map((label) => label.id));
        for (const [id, entry] of this._labels) {
            if (!active.has(id)) {
                this.group.remove(entry.sprite);
                entry.sprite.material.dispose();
                const map = entry.sprite.material.map;
                map?.dispose();
                this._labels.delete(id);
            }
        }
        for (const label of labels) {
            const existing = this._labels.get(label.id);
            if (existing && existing.text === label.text) {
                existing.sprite.position.set(label.position.x, label.position.y, label.position.z);
                continue;
            }
            if (existing) {
                this.group.remove(existing.sprite);
                existing.sprite.material.dispose();
                const map = existing.sprite.material.map;
                map?.dispose();
                this._labels.delete(label.id);
            }
            const { texture, width, height } = createTextTexture(label);
            const material = new THREE.SpriteMaterial({
                map: texture,
                transparent: true,
                depthTest: false,
            });
            const sprite = new THREE.Sprite(material);
            sprite.position.set(label.position.x, label.position.y, label.position.z);
            sprite.renderOrder = 4300;
            this.group.add(sprite);
            this._labels.set(label.id, { sprite, width, height, text: label.text });
        }
    }
    update(camera, viewport) {
        const height = viewport.clientHeight || window.innerHeight;
        const fov = THREE.MathUtils.degToRad(camera.fov);
        for (const entry of this._labels.values()) {
            const distance = camera.position.distanceTo(entry.sprite.position);
            const worldScreenHeight = 2 * Math.tan(fov * 0.5) * distance;
            const worldPerPixel = worldScreenHeight / height;
            entry.sprite.scale.set(entry.width * worldPerPixel, entry.height * worldPerPixel, 1);
        }
    }
}
function createTextTexture(label) {
    const font = "12px Fira Mono, Menlo, Monaco, Consolas, monospace";
    const padding = 6;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
        throw new Error("Unable to create canvas 2D context");
    }
    ctx.font = font;
    const metrics = ctx.measureText(label.text);
    const textWidth = Math.ceil(metrics.width);
    const textHeight = 16;
    canvas.width = textWidth + padding * 2;
    canvas.height = textHeight + padding * 2;
    ctx.font = font;
    ctx.textBaseline = "top";
    if (label.background) {
        ctx.fillStyle = label.background;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    else {
        ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.fillStyle = label.color ?? "#ffffff";
    ctx.fillText(label.text, padding, padding);
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return { texture, width: canvas.width, height: canvas.height };
}
export class AxisGizmo {
    constructor(parent, axisLength = 600) {
        this.group = new THREE.Group();
        this.group.name = "AxisGizmo";
        parent.add(this.group);
        this._axisLength = axisLength;
        this._clusterId = null;
    }
    show(clusterId, position, axisLength) {
        this._clusterId = clusterId;
        if (axisLength)
            this._axisLength = axisLength;
        this.clear();
        this.group.position.set(position.x, position.y, position.z);
        const axes = [
            { kind: "axisX", color: 0xff4d4d, dir: new THREE.Vector3(1, 0, 0) },
            { kind: "axisY", color: 0x59ff7a, dir: new THREE.Vector3(0, 1, 0) },
            { kind: "axisZ", color: 0x4da6ff, dir: new THREE.Vector3(0, 0, 1) },
        ];
        for (const axis of axes) {
            const lineGeometry = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(0, 0, 0),
                axis.dir.clone().multiplyScalar(this._axisLength),
            ]);
            const lineMaterial = new THREE.LineBasicMaterial({
                color: axis.color,
                transparent: true,
                opacity: 0.85,
                depthTest: false,
            });
            const line = new THREE.Line(lineGeometry, lineMaterial);
            line.userData.__editHandleId = `${axis.kind}_${clusterId}`;
            line.userData.__editHandleKind = axis.kind;
            line.userData.__editClusterId = clusterId;
            this.group.add(line);
            const pickLength = this._axisLength * 0.9;
            const pickRadius = 20;
            const pickGeometry = new THREE.CylinderGeometry(pickRadius, pickRadius, pickLength, 6);
            const pickMaterial = new THREE.MeshBasicMaterial({
                color: 0x000000,
                transparent: true,
                opacity: 0,
                depthWrite: false,
            });
            const pickMesh = new THREE.Mesh(pickGeometry, pickMaterial);
            if (axis.kind === "axisX") {
                pickMesh.rotation.z = Math.PI / 2;
                pickMesh.position.set(pickLength * 0.5, 0, 0);
            }
            else if (axis.kind === "axisY") {
                pickMesh.position.set(0, pickLength * 0.5, 0);
            }
            else {
                pickMesh.rotation.x = Math.PI / 2;
                pickMesh.position.set(0, 0, pickLength * 0.5);
            }
            pickMesh.userData.__editHandleId = `${axis.kind}_pick_${clusterId}`;
            pickMesh.userData.__editHandleKind = axis.kind;
            pickMesh.userData.__editClusterId = clusterId;
            this.group.add(pickMesh);
        }
    }
    updatePosition(position) {
        this.group.position.set(position.x, position.y, position.z);
    }
    hide() {
        this._clusterId = null;
        this.clear();
    }
    clear() {
        while (this.group.children.length) {
            const child = this.group.children.pop();
            if (!child)
                break;
            const obj = child;
            if (obj.geometry)
                obj.geometry.dispose();
            if (obj.material)
                obj.material.dispose();
        }
    }
}
//# sourceMappingURL=ui-overlays.js.map