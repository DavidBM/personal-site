import * as THREE from "./vendor/three.js";
import { buildFleetGeometry, buildFleetVisualGeometry, scaleFleetCounts, } from "./render/fleets/fleet-geometry.js";
const LOD_HEIGHT = 180000;
const LOD_MAX_SHIPS = 800;
const COOLDOWN_SEGMENTS = 40;
const COOLDOWN_RADIUS = 34;
const COOLDOWN_Y_OFFSET = 0;
const HIDDEN_COORDINATE = 1e9;
const RENDER_PLANE_Y = 0;
const FLEET_TRIANGLE_VERTICES = new Float32Array([
    1,
    0,
    0,
    -0.5,
    0,
    0.8660254,
    -0.5,
    0,
    -0.8660254,
]);
const FLEET_VERTEX_SHADER = `
attribute vec3 instanceBase;
attribute vec3 instanceCenter;
attribute float instanceRotation;
attribute float instanceSize;
attribute vec3 instanceColor;
varying vec3 vColor;

void main() {
  float s = sin(instanceRotation);
  float c = cos(instanceRotation);
  vec2 rotated = vec2(
    position.x * c - position.z * s,
    position.x * s + position.z * c
  ) * instanceSize;
  vec3 localPosition = instanceCenter + vec3(
    rotated.x,
    position.y * instanceSize,
    rotated.y
  );
  vColor = instanceColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(
    instanceBase + localPosition,
    1.0
  );
}
`;
const FLEET_FRAGMENT_SHADER = `
uniform float opacity;
varying vec3 vColor;

void main() {
  gl_FragColor = vec4(vColor, opacity);
}
`;
function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}
function getForcedFleetRendererMode() {
    if (typeof window === "undefined")
        return null;
    const mode = new URLSearchParams(window.location.search).get("fleetRenderer");
    return mode === "batched" || mode === "instanced" ? mode : null;
}
function hasInstancedFleetRenderer() {
    return (typeof THREE.InstancedBufferGeometry === "function" &&
        typeof THREE.InstancedBufferAttribute === "function" &&
        typeof THREE.ShaderMaterial === "function");
}
function chooseFleetRendererMode() {
    const forcedMode = getForcedFleetRendererMode();
    if (forcedMode)
        return forcedMode;
    return hasInstancedFleetRenderer() ? "instanced" : "batched";
}
function setInstancedDrawCount(geometry, instanceCount) {
    geometry.instanceCount = instanceCount;
    // Three caches this from the first bound instanced attribute. If the mesh
    // renders once while empty, the cache is 0 and later buffers still draw 0.
    geometry._maxInstanceCount = instanceCount;
}
export class Fleets {
    constructor(scene) {
        this.scene = scene;
        this.group = new THREE.Group();
        this.rendererMode = chooseFleetRendererMode();
        this.instancedGeometry = new THREE.InstancedBufferGeometry();
        this.instancedMaterial = new THREE.ShaderMaterial({
            uniforms: {
                opacity: { value: 0.9 },
            },
            vertexShader: FLEET_VERTEX_SHADER,
            fragmentShader: FLEET_FRAGMENT_SHADER,
            transparent: true,
            depthWrite: false,
            depthTest: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
        });
        this.instanceBases = new Float32Array(0);
        this.instanceCenters = new Float32Array(0);
        this.instanceRotations = new Float32Array(0);
        this.instanceSizes = new Float32Array(0);
        this.instanceColors = new Float32Array(0);
        this.instancedGeometry.setAttribute("position", new THREE.BufferAttribute(FLEET_TRIANGLE_VERTICES, 3));
        this.instancedGeometry.setAttribute("instanceBase", new THREE.InstancedBufferAttribute(this.instanceBases, 3));
        this.instancedGeometry.setAttribute("instanceCenter", new THREE.InstancedBufferAttribute(this.instanceCenters, 3));
        this.instancedGeometry.setAttribute("instanceRotation", new THREE.InstancedBufferAttribute(this.instanceRotations, 1));
        this.instancedGeometry.setAttribute("instanceSize", new THREE.InstancedBufferAttribute(this.instanceSizes, 1));
        this.instancedGeometry.setAttribute("instanceColor", new THREE.InstancedBufferAttribute(this.instanceColors, 3));
        setInstancedDrawCount(this.instancedGeometry, 0);
        this.instancedGeometry.setDrawRange(0, 3);
        this.instancedMesh = new THREE.Mesh(this.instancedGeometry, this.instancedMaterial);
        this.instancedMesh.frustumCulled = false;
        this.instancedMesh.renderOrder = 3200;
        this.geometry = new THREE.BufferGeometry();
        this.material = new THREE.MeshBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.9,
            depthWrite: false,
            depthTest: false,
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
            depthTest: false,
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
            depthTest: false,
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
        this.instancedMesh.visible = this.rendererMode === "instanced";
        this.mesh.visible = this.rendererMode === "batched";
        this.group.add(this.instancedMesh);
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
        const geometry = buildFleetVisualGeometry(counts);
        const visual = {
            id,
            counts,
            offsets: geometry.offsets,
            vertexColors: geometry.vertexColors,
            vertexStart: 0,
            vertexCount: geometry.vertexCount,
            centers: geometry.centers,
            rotations: geometry.rotations,
            sizes: geometry.sizes,
            instanceColors: geometry.instanceColors,
            instanceStart: 0,
            instanceCount: geometry.instanceCount,
            hasBasePosition: false,
            baseX: 0,
            baseY: 0,
            baseZ: 0,
            state,
        };
        this.fleets.set(id, visual);
        this.rebuildBuffers();
        this.listDirty = true;
        this.cooldownDirty = true;
        if (this.updateFleetPosition(visual, Date.now())) {
            this.markPositionsDirty();
        }
    }
    updateFleetState(id, state) {
        const visual = this.fleets.get(id);
        if (!visual)
            return;
        visual.state = state;
        this.listDirty = true;
        this.cooldownDirty = true;
        if (this.updateFleetPosition(visual, Date.now())) {
            this.markPositionsDirty();
        }
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
            this.setMainFleetVisible(false);
            this.cooldownLines.visible = false;
            this.lodMesh.visible = true;
            this.updateLod(now);
            return;
        }
        this.setMainFleetVisible(true);
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
        if (this.rendererMode === "instanced") {
            this.rebuildInstancedBuffers();
        }
        else {
            this.rebuildBatchedBuffers();
        }
        this.resetLodSignature();
        this.listDirty = true;
        this.cooldownDirty = true;
    }
    rebuildInstancedBuffers() {
        let totalInstances = 0;
        for (const id of this.fleetOrder) {
            const fleet = this.fleets.get(id);
            if (!fleet)
                continue;
            fleet.instanceStart = totalInstances;
            totalInstances += fleet.instanceCount;
        }
        this.instanceBases = new Float32Array(totalInstances * 3);
        this.instanceCenters = new Float32Array(totalInstances * 3);
        this.instanceRotations = new Float32Array(totalInstances);
        this.instanceSizes = new Float32Array(totalInstances);
        this.instanceColors = new Float32Array(totalInstances * 3);
        let vectorCursor = 0;
        let scalarCursor = 0;
        for (const id of this.fleetOrder) {
            const fleet = this.fleets.get(id);
            if (!fleet)
                continue;
            this.instanceCenters.set(fleet.centers, vectorCursor);
            this.instanceColors.set(fleet.instanceColors, vectorCursor);
            this.instanceRotations.set(fleet.rotations, scalarCursor);
            this.instanceSizes.set(fleet.sizes, scalarCursor);
            if (fleet.hasBasePosition) {
                this.writeFleetBasePosition(fleet, fleet.baseX, fleet.baseY, fleet.baseZ, true);
            }
            vectorCursor += fleet.centers.length;
            scalarCursor += fleet.instanceCount;
        }
        this.instancedGeometry.setAttribute("position", new THREE.BufferAttribute(FLEET_TRIANGLE_VERTICES, 3));
        this.instancedGeometry.setAttribute("instanceBase", new THREE.InstancedBufferAttribute(this.instanceBases, 3));
        this.instancedGeometry.setAttribute("instanceCenter", new THREE.InstancedBufferAttribute(this.instanceCenters, 3));
        this.instancedGeometry.setAttribute("instanceRotation", new THREE.InstancedBufferAttribute(this.instanceRotations, 1));
        this.instancedGeometry.setAttribute("instanceSize", new THREE.InstancedBufferAttribute(this.instanceSizes, 1));
        this.instancedGeometry.setAttribute("instanceColor", new THREE.InstancedBufferAttribute(this.instanceColors, 3));
        setInstancedDrawCount(this.instancedGeometry, totalInstances);
        this.instancedGeometry.setDrawRange(0, 3);
        this.instancedGeometry.attributes.position.needsUpdate = true;
        this.instancedGeometry.attributes.instanceBase.needsUpdate = true;
        this.instancedGeometry.attributes.instanceCenter.needsUpdate = true;
        this.instancedGeometry.attributes.instanceRotation.needsUpdate = true;
        this.instancedGeometry.attributes.instanceSize.needsUpdate = true;
        this.instancedGeometry.attributes.instanceColor.needsUpdate = true;
    }
    rebuildBatchedBuffers() {
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
            this.colors.set(fleet.vertexColors, cursor);
            if (fleet.hasBasePosition) {
                this.writeFleetVertexPosition(fleet, fleet.baseX, fleet.baseY, fleet.baseZ, true);
            }
            cursor += fleet.vertexColors.length;
        }
        this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
        this.geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
        this.geometry.setDrawRange(0, totalVertices);
        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.attributes.color.needsUpdate = true;
    }
    resetLodSignature() {
        this.lodSignature = null;
    }
    setMainFleetVisible(visible) {
        this.instancedMesh.visible =
            visible && this.rendererMode === "instanced";
        this.mesh.visible = visible && this.rendererMode === "batched";
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
        let changed = false;
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
                changed = this.hideFleetVertices(fleet) || changed;
                continue;
            }
            const t = clamp01((now - state.startTime) / state.durationMs);
            const baseX = start.x + (end.x - start.x) * t;
            const baseY = RENDER_PLANE_Y;
            const baseZ = start.z + (end.z - start.z) * t;
            changed =
                this.writeFleetPosition(fleet, baseX, baseY, baseZ) || changed;
        }
        if (changed) {
            this.markPositionsDirty();
        }
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
        let changed = false;
        for (let i = 0; i < count; i++) {
            const id = this.scheduledFleetIds[this.scheduleCursor++];
            const fleet = this.fleets.get(id);
            if (!fleet)
                continue;
            changed = this.updateFleetPosition(fleet, now) || changed;
        }
        if (changed) {
            this.markPositionsDirty();
        }
    }
    updateFleetPosition(fleet, now) {
        const position = this.resolveFleetPosition(fleet.state, now);
        if (!position) {
            return this.hideFleetVertices(fleet);
        }
        return this.writeFleetPosition(fleet, position.x, RENDER_PLANE_Y, position.z);
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
            sumY += RENDER_PLANE_Y;
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
                y: RENDER_PLANE_Y,
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
    markPositionsDirty() {
        if (this.rendererMode === "instanced") {
            this.instancedGeometry.attributes.instanceBase.needsUpdate = true;
        }
        else {
            this.geometry.attributes.position.needsUpdate = true;
        }
    }
    hideFleetVertices(fleet) {
        return this.writeFleetPosition(fleet, HIDDEN_COORDINATE, HIDDEN_COORDINATE, HIDDEN_COORDINATE);
    }
    writeFleetPosition(fleet, x, y, z, force = false) {
        if (this.rendererMode === "instanced") {
            return this.writeFleetBasePosition(fleet, x, y, z, force);
        }
        return this.writeFleetVertexPosition(fleet, x, y, z, force);
    }
    writeFleetBasePosition(fleet, x, y, z, force = false) {
        if (!force &&
            fleet.hasBasePosition &&
            fleet.baseX === x &&
            fleet.baseY === y &&
            fleet.baseZ === z) {
            return false;
        }
        let index = fleet.instanceStart * 3;
        const end = index + fleet.instanceCount * 3;
        for (; index < end; index += 3) {
            this.instanceBases[index] = x;
            this.instanceBases[index + 1] = y;
            this.instanceBases[index + 2] = z;
        }
        fleet.hasBasePosition = true;
        fleet.baseX = x;
        fleet.baseY = y;
        fleet.baseZ = z;
        return true;
    }
    writeFleetVertexPosition(fleet, x, y, z, force = false) {
        if (!force &&
            fleet.hasBasePosition &&
            fleet.baseX === x &&
            fleet.baseY === y &&
            fleet.baseZ === z) {
            return false;
        }
        const offsets = fleet.offsets;
        const targetStart = fleet.vertexStart * 3;
        for (let i = 0; i < offsets.length; i += 3) {
            const target = targetStart + i;
            this.positions[target] = offsets[i] + x;
            this.positions[target + 1] = offsets[i + 1] + y;
            this.positions[target + 2] = offsets[i + 2] + z;
        }
        fleet.hasBasePosition = true;
        fleet.baseX = x;
        fleet.baseY = y;
        fleet.baseZ = z;
        return true;
    }
}
//# sourceMappingURL=fleets.js.map