import * as THREE from "./vendor/three.js";
const BASE_SHIP_SIZE = 2.4;
const SHIP_SPREAD = 26;
const RED_SCALE = 20;
const BLUE_SCALE = 3;
const GREEN_SCALE = 1;
const LOD_HEIGHT = 180000;
const LOD_MAX_SHIPS = 800;
const COOLDOWN_SEGMENTS = 40;
const COOLDOWN_RADIUS = 34;
const COOLDOWN_Y_OFFSET = 6;
function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}
function pickTriangle(size, centerOffset, rotation) {
    const a = rotation;
    const b = rotation + (Math.PI * 2) / 3;
    const c = rotation + (Math.PI * 4) / 3;
    const scale = size * (0.6 + Math.random() * 0.4);
    const ax = Math.cos(a) * scale + centerOffset.x;
    const az = Math.sin(a) * scale + centerOffset.z;
    const bx = Math.cos(b) * scale + centerOffset.x;
    const bz = Math.sin(b) * scale + centerOffset.z;
    const cx = Math.cos(c) * scale + centerOffset.x;
    const cz = Math.sin(c) * scale + centerOffset.z;
    const y = centerOffset.y;
    return [ax, y, az, bx, y, bz, cx, y, cz];
}
function buildFleetGeometry(counts) {
    const totalShips = counts.red + counts.blue + counts.green;
    const vertexCount = totalShips * 3;
    const offsets = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);
    let cursor = 0;
    const writeShip = (scale, color) => {
        const centerOffset = {
            x: (Math.random() - 0.5) * SHIP_SPREAD * scale,
            y: (Math.random() - 0.5) * 6,
            z: (Math.random() - 0.5) * SHIP_SPREAD * scale,
        };
        const rotation = Math.random() * Math.PI * 2;
        const tri = pickTriangle(BASE_SHIP_SIZE * scale, centerOffset, rotation);
        for (let i = 0; i < 9; i += 3) {
            offsets[cursor] = tri[i];
            offsets[cursor + 1] = tri[i + 1];
            offsets[cursor + 2] = tri[i + 2];
            colors[cursor] = color[0];
            colors[cursor + 1] = color[1];
            colors[cursor + 2] = color[2];
            cursor += 3;
        }
    };
    for (let i = 0; i < counts.red; i++) {
        writeShip(RED_SCALE, [1.0, 0.2, 0.2]);
    }
    for (let i = 0; i < counts.blue; i++) {
        writeShip(BLUE_SCALE, [0.2, 0.6, 1.0]);
    }
    for (let i = 0; i < counts.green; i++) {
        writeShip(GREEN_SCALE, [0.2, 1.0, 0.4]);
    }
    return { offsets, colors, vertexCount };
}
function scaleFleetCounts(counts, scale) {
    return {
        red: Math.max(0, Math.floor(counts.red * scale)),
        blue: Math.max(0, Math.floor(counts.blue * scale)),
        green: Math.max(0, Math.floor(counts.green * scale)),
    };
}
export class Fleets {
    constructor(scene) {
        this.scene = scene;
        this.group = new THREE.Group();
        this.geometry = new THREE.BufferGeometry();
        this.material = new THREE.MeshBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.9,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
        });
        this.positions = new Float32Array(0);
        this.colors = new Float32Array(0);
        this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
        this.geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 3200;
        this.lodGeometry = new THREE.BufferGeometry();
        this.lodMaterial = new THREE.MeshBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.85,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
        });
        this.lodPositions = new Float32Array(0);
        this.lodColors = new Float32Array(0);
        this.lodGeometry.setAttribute("position", new THREE.BufferAttribute(this.lodPositions, 3));
        this.lodGeometry.setAttribute("color", new THREE.BufferAttribute(this.lodColors, 3));
        this.lodMesh = new THREE.Mesh(this.lodGeometry, this.lodMaterial);
        this.lodMesh.frustumCulled = false;
        this.lodMesh.renderOrder = 3200;
        this.lodMesh.visible = false;
        this.lodSignature = null;
        this.lodOffsets = null;
        this.cooldownGeometry = new THREE.BufferGeometry();
        this.cooldownMaterial = new THREE.LineBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.8,
            depthWrite: false,
        });
        this.cooldownPositions = new Float32Array(0);
        this.cooldownGeometry.setAttribute("position", new THREE.BufferAttribute(this.cooldownPositions, 3));
        this.cooldownLines = new THREE.LineSegments(this.cooldownGeometry, this.cooldownMaterial);
        this.cooldownLines.frustumCulled = false;
        this.cooldownLines.renderOrder = 3300;
        this.cooldownCapacity = 0;
        this.fleets = new Map();
        this.fleetOrder = [];
        this.positionProvider = null;
        this.updateChunkMs = 200;
        this.perFrameFraction = 0.25;
        this.jumpingFleetIds = [];
        this.nonJumpingFleetIds = [];
        this.cooldownFleetIds = [];
        this.scheduledFleetIds = [];
        this.scheduleCursor = 0;
        this.nextChunkTime = 0;
        this.listDirty = true;
        this.cooldownDirty = true;
        this.cooldownSlots = [];
        this.group.add(this.mesh);
        this.group.add(this.lodMesh);
        this.group.add(this.cooldownLines);
        this.scene.add(this.group);
    }
    setPositionProvider(provider) {
        this.positionProvider = provider;
    }
    setUpdateConfig(options) {
        if (typeof options.updateChunkMs === "number") {
            this.updateChunkMs = Math.max(20, options.updateChunkMs);
        }
        if (typeof options.perFrameFraction === "number") {
            this.perFrameFraction = Math.max(0.05, Math.min(1, options.perFrameFraction));
        }
    }
    addFleet(id, counts, state) {
        if (this.fleets.has(id)) {
            this.updateFleetState(id, state);
            return;
        }
        const geometry = buildFleetGeometry(counts);
        const visual = {
            id,
            counts,
            offsets: geometry.offsets,
            colors: geometry.colors,
            vertexStart: 0,
            vertexCount: geometry.vertexCount,
            state,
        };
        this.fleets.set(id, visual);
        this.rebuildBuffers();
        this.listDirty = true;
        this.cooldownDirty = true;
        this.updateFleetPosition(visual, Date.now());
    }
    updateFleetState(id, state) {
        const visual = this.fleets.get(id);
        if (!visual)
            return;
        visual.state = state;
        this.listDirty = true;
        this.cooldownDirty = true;
        this.updateFleetPosition(visual, Date.now());
    }
    removeFleet(id) {
        if (!this.fleets.has(id))
            return;
        this.fleets.delete(id);
        this.rebuildBuffers();
        this.listDirty = true;
        this.cooldownDirty = true;
    }
    clear() {
        this.fleets.clear();
        this.rebuildBuffers();
        this.listDirty = true;
        this.cooldownDirty = true;
    }
    update(now, cameraHeight) {
        if (!this.positionProvider)
            return;
        const lodActive = cameraHeight >= LOD_HEIGHT;
        if (lodActive) {
            this.mesh.visible = false;
            this.cooldownLines.visible = false;
            this.lodMesh.visible = true;
            this.updateLod(now);
            return;
        }
        this.mesh.visible = true;
        this.cooldownLines.visible = true;
        this.lodMesh.visible = false;
        if (this.listDirty) {
            this.rebuildStateLists();
        }
        this.updateJumpingPositions(now);
        if (now >= this.nextChunkTime) {
            this.scheduleNextChunk(now);
        }
        this.updateNonJumpingPositions(now);
        if (this.cooldownDirty) {
            this.updateCooldownRings(now);
            this.cooldownDirty = false;
        }
    }
    rebuildBuffers() {
        this.fleetOrder = Array.from(this.fleets.keys());
        let totalVertices = 0;
        for (const id of this.fleetOrder) {
            const fleet = this.fleets.get(id);
            if (!fleet)
                continue;
            fleet.vertexStart = totalVertices;
            totalVertices += fleet.vertexCount;
        }
        this.positions = new Float32Array(totalVertices * 3);
        this.colors = new Float32Array(totalVertices * 3);
        let cursor = 0;
        for (const id of this.fleetOrder) {
            const fleet = this.fleets.get(id);
            if (!fleet)
                continue;
            this.colors.set(fleet.colors, cursor);
            cursor += fleet.colors.length;
        }
        this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
        this.geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
        this.geometry.setDrawRange(0, totalVertices);
        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.attributes.color.needsUpdate = true;
        this.resetLodSignature();
        this.listDirty = true;
        this.cooldownDirty = true;
    }
    resetLodSignature() {
        this.lodSignature = null;
    }
    rebuildStateLists() {
        this.jumpingFleetIds = [];
        this.nonJumpingFleetIds = [];
        this.cooldownFleetIds = [];
        for (const [id, fleet] of this.fleets.entries()) {
            if (fleet.state.state === "jumping") {
                this.jumpingFleetIds.push(id);
            }
            else {
                this.nonJumpingFleetIds.push(id);
                if (fleet.state.state === "cooldown") {
                    this.cooldownFleetIds.push(id);
                }
            }
        }
        this.listDirty = false;
    }
    updateJumpingPositions(now) {
        const ids = this.jumpingFleetIds;
        const total = ids.length;
        if (total === 0)
            return;
        const positions = this.positions;
        for (let i = 0; i < total; i++) {
            const id = ids[i];
            const fleet = this.fleets.get(id);
            if (!fleet)
                continue;
            const state = fleet.state;
            if (state.state !== "jumping")
                continue;
            const start = this.positionProvider?.(state.startNode);
            const end = this.positionProvider?.(state.endNode);
            if (!start || !end) {
                this.hideFleetVertices(fleet, positions);
                continue;
            }
            const t = clamp01((now - state.startTime) / state.durationMs);
            const baseX = start.x + (end.x - start.x) * t;
            const baseY = start.y + (end.y - start.y) * t;
            const baseZ = start.z + (end.z - start.z) * t;
            const offsets = fleet.offsets;
            let target = fleet.vertexStart * 3;
            for (let j = 0; j < offsets.length; j += 3) {
                positions[target + j] = offsets[j] + baseX;
                positions[target + j + 1] = offsets[j + 1] + baseY;
                positions[target + j + 2] = offsets[j + 2] + baseZ;
            }
        }
        this.geometry.attributes.position.needsUpdate = true;
    }
    scheduleNextChunk(now) {
        this.scheduledFleetIds = this.nonJumpingFleetIds.slice();
        this.scheduleCursor = 0;
        this.nextChunkTime = now + this.updateChunkMs;
        this.cooldownDirty = true;
    }
    updateNonJumpingPositions(now) {
        if (this.scheduledFleetIds.length === 0)
            return;
        const remaining = this.scheduledFleetIds.length - this.scheduleCursor;
        if (remaining <= 0)
            return;
        const targetCount = Math.max(1, Math.ceil(this.scheduledFleetIds.length * this.perFrameFraction));
        const count = Math.min(remaining, targetCount);
        for (let i = 0; i < count; i++) {
            const id = this.scheduledFleetIds[this.scheduleCursor++];
            const fleet = this.fleets.get(id);
            if (!fleet)
                continue;
            this.updateFleetPosition(fleet, now);
        }
        this.geometry.attributes.position.needsUpdate = true;
    }
    updateFleetPosition(fleet, now) {
        const position = this.resolveFleetPosition(fleet.state, now);
        if (!position) {
            this.hideFleetVertices(fleet, this.positions);
            return;
        }
        const offsets = fleet.offsets;
        let target = fleet.vertexStart * 3;
        for (let i = 0; i < offsets.length; i += 3) {
            this.positions[target + i] = offsets[i] + position.x;
            this.positions[target + i + 1] = offsets[i + 1] + position.y;
            this.positions[target + i + 2] = offsets[i + 2] + position.z;
        }
    }
    updateLod(now) {
        const summary = this.computeLodSummary(now);
        if (!summary) {
            this.lodMesh.visible = false;
            return;
        }
        const signature = `${summary.counts.red}:${summary.counts.blue}:${summary.counts.green}`;
        if (this.lodSignature !== signature || !this.lodOffsets) {
            const geometry = buildFleetGeometry(summary.counts);
            this.lodOffsets = geometry.offsets;
            this.lodPositions = new Float32Array(geometry.vertexCount * 3);
            this.lodColors = geometry.colors;
            this.lodGeometry.setAttribute("position", new THREE.BufferAttribute(this.lodPositions, 3));
            this.lodGeometry.setAttribute("color", new THREE.BufferAttribute(this.lodColors, 3));
            this.lodGeometry.setDrawRange(0, geometry.vertexCount);
            this.lodGeometry.attributes.position.needsUpdate = true;
            this.lodGeometry.attributes.color.needsUpdate = true;
            this.lodSignature = signature;
        }
        const position = summary.position;
        if (!position || !this.lodOffsets)
            return;
        for (let i = 0; i < this.lodOffsets.length; i += 3) {
            this.lodPositions[i] = this.lodOffsets[i] + position.x;
            this.lodPositions[i + 1] = this.lodOffsets[i + 1] + position.y;
            this.lodPositions[i + 2] = this.lodOffsets[i + 2] + position.z;
        }
        this.lodGeometry.attributes.position.needsUpdate = true;
    }
    computeLodSummary(now) {
        if (this.fleets.size === 0)
            return null;
        let sumX = 0;
        let sumY = 0;
        let sumZ = 0;
        let count = 0;
        let totalRed = 0;
        let totalBlue = 0;
        let totalGreen = 0;
        for (const fleet of this.fleets.values()) {
            const pos = this.resolveFleetPosition(fleet.state, now);
            if (!pos)
                continue;
            sumX += pos.x;
            sumY += pos.y;
            sumZ += pos.z;
            count += 1;
            totalRed += fleet.counts.red;
            totalBlue += fleet.counts.blue;
            totalGreen += fleet.counts.green;
        }
        if (count === 0)
            return null;
        const totalShips = totalRed + totalBlue + totalGreen;
        const scale = totalShips > LOD_MAX_SHIPS ? LOD_MAX_SHIPS / totalShips : 1;
        const counts = scaleFleetCounts({ red: totalRed, blue: totalBlue, green: totalGreen }, scale);
        if (counts.red + counts.blue + counts.green === 0) {
            counts.green = 1;
        }
        return {
            counts,
            position: {
                x: sumX / count,
                y: sumY / count,
                z: sumZ / count,
            },
        };
    }
    updateCooldownRings(now) {
        this.cooldownSlots = [];
        for (let i = 0; i < this.cooldownFleetIds.length; i++) {
            const id = this.cooldownFleetIds[i];
            const fleet = this.fleets.get(id);
            if (!fleet || fleet.state.state !== "cooldown")
                continue;
            const position = this.resolveFleetPosition(fleet.state, now);
            if (!position)
                continue;
            const elapsed = now - fleet.state.startTime;
            const remaining = clamp01(1 - elapsed / fleet.state.durationMs);
            this.cooldownSlots.push({
                position: { x: position.x, y: position.y, z: position.z },
                remainingFraction: remaining,
            });
        }
        const neededSegments = this.cooldownSlots.length * COOLDOWN_SEGMENTS;
        if (neededSegments !== this.cooldownCapacity) {
            this.cooldownCapacity = neededSegments;
            this.cooldownPositions = new Float32Array(Math.max(1, neededSegments * 2 * 3));
            this.cooldownGeometry.setAttribute("position", new THREE.BufferAttribute(this.cooldownPositions, 3));
        }
        this.cooldownGeometry.setDrawRange(0, neededSegments * 2);
        let cursor = 0;
        for (let i = 0; i < this.cooldownSlots.length; i++) {
            const slot = this.cooldownSlots[i];
            const angleMax = Math.PI * 2 * slot.remainingFraction;
            const segmentsToShow = Math.floor(COOLDOWN_SEGMENTS * slot.remainingFraction);
            for (let seg = 0; seg < COOLDOWN_SEGMENTS; seg++) {
                const enabled = seg < segmentsToShow;
                const startAngle = (seg / COOLDOWN_SEGMENTS) * angleMax;
                const endAngle = ((seg + 1) / COOLDOWN_SEGMENTS) * angleMax;
                if (!enabled || angleMax <= 0) {
                    this.cooldownPositions[cursor] = 1e9;
                    this.cooldownPositions[cursor + 1] = 1e9;
                    this.cooldownPositions[cursor + 2] = 1e9;
                    this.cooldownPositions[cursor + 3] = 1e9;
                    this.cooldownPositions[cursor + 4] = 1e9;
                    this.cooldownPositions[cursor + 5] = 1e9;
                    cursor += 6;
                    continue;
                }
                const sx = Math.cos(startAngle) * COOLDOWN_RADIUS + slot.position.x;
                const sz = Math.sin(startAngle) * COOLDOWN_RADIUS + slot.position.z;
                const ex = Math.cos(endAngle) * COOLDOWN_RADIUS + slot.position.x;
                const ez = Math.sin(endAngle) * COOLDOWN_RADIUS + slot.position.z;
                const y = slot.position.y + COOLDOWN_Y_OFFSET;
                this.cooldownPositions[cursor] = sx;
                this.cooldownPositions[cursor + 1] = y;
                this.cooldownPositions[cursor + 2] = sz;
                this.cooldownPositions[cursor + 3] = ex;
                this.cooldownPositions[cursor + 4] = y;
                this.cooldownPositions[cursor + 5] = ez;
                cursor += 6;
            }
        }
        this.cooldownGeometry.attributes.position.needsUpdate = true;
    }
    resolveFleetPosition(state, now) {
        if (!this.positionProvider)
            return null;
        if (state.state === "jumping") {
            const start = this.positionProvider(state.startNode);
            const end = this.positionProvider(state.endNode);
            if (!start || !end)
                return null;
            const t = clamp01((now - state.startTime) / state.durationMs);
            return {
                x: start.x + (end.x - start.x) * t,
                y: start.y + (end.y - start.y) * t,
                z: start.z + (end.z - start.z) * t,
            };
        }
        if (state.state === "cooldown") {
            return this.positionProvider(state.node);
        }
        return this.positionProvider(state.node);
    }
    hideFleetVertices(fleet, target) {
        let index = fleet.vertexStart * 3;
        const end = index + fleet.vertexCount * 3;
        for (; index < end; index += 3) {
            target[index] = 1e9;
            target[index + 1] = 1e9;
            target[index + 2] = 1e9;
        }
    }
}
//# sourceMappingURL=fleets.js.map