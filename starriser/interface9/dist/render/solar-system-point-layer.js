import * as THREE from "../vendor/three.js";
const RENDER_PLANE_Y = 0;
export class SolarSystemPointLayer {
    constructor(scene) {
        this.scene = scene;
        this.geometry = new THREE.BufferGeometry();
        this.positions = new Float32Array(0);
        this.colors = new Float32Array(0);
        this.visibility = new Uint8Array(0);
        this.points = new THREE.Points(this.geometry, new THREE.PointsMaterial({ color: 0xffffff, size: 1 }));
        this.maxCount = 0;
        this.currentCount = 0;
        this.initialize(0);
    }
    initialize(maxSolarSystems) {
        if (this.points && this.points.parent) {
            this.points.parent.remove(this.points);
        }
        this.geometry.dispose();
        this.points.material.dispose();
        this.geometry = new THREE.BufferGeometry();
        this.positions = new Float32Array(maxSolarSystems * 3);
        this.colors = new Float32Array(maxSolarSystems * 3);
        this.visibility = new Uint8Array(maxSolarSystems);
        this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
        this.geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
        const material = new THREE.PointsMaterial({
            color: 0xffffff,
            size: 10.5,
            vertexColors: true,
            sizeAttenuation: true,
            transparent: true,
            opacity: 0.76,
        });
        this.points = new THREE.Points(this.geometry, material);
        this.points.frustumCulled = false;
        this.scene.add(this.points);
        this.maxCount = maxSolarSystems;
        this.currentCount = 0;
    }
    clear() {
        this.initialize(0);
    }
    add(cluster, solarSystem) {
        if (this.currentCount >= this.maxCount) {
            const newMax = Math.ceil(this.maxCount * 2) || this.maxCount + 1000;
            const newPositions = new Float32Array(newMax * 3);
            const newColors = new Float32Array(newMax * 3);
            const newVisibility = new Uint8Array(newMax);
            newPositions.set(this.positions);
            newColors.set(this.colors);
            newVisibility.set(this.visibility);
            this.positions = newPositions;
            this.colors = newColors;
            this.visibility = newVisibility;
            this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
            this.geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
            this.maxCount = newMax;
            console.warn("Resized solar systems buffer: now", this.maxCount);
        }
        const idx = this.currentCount++;
        this.positions[idx * 3] = solarSystem.position.x;
        this.positions[idx * 3 + 1] = RENDER_PLANE_Y;
        this.positions[idx * 3 + 2] = solarSystem.position.z;
        const color = new THREE.Color(solarSystem.isJumpGate ? 0x00ffff : cluster.color || 0xffffff);
        this.colors[idx * 3] = color.r;
        this.colors[idx * 3 + 1] = color.g;
        this.colors[idx * 3 + 2] = color.b;
        this.visibility[idx] = 1;
        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.attributes.color.needsUpdate = true;
        solarSystem._bufferIndex = idx;
    }
    updatePositions(solarSystems) {
        if (!Array.isArray(solarSystems) || solarSystems.length === 0)
            return;
        for (const solarSystem of solarSystems) {
            const idx = solarSystem._bufferIndex;
            if (typeof idx !== "number")
                continue;
            this.positions[idx * 3] = solarSystem.position.x;
            this.positions[idx * 3 + 1] = RENDER_PLANE_Y;
            this.positions[idx * 3 + 2] = solarSystem.position.z;
        }
        this.geometry.attributes.position.needsUpdate = true;
    }
    remove(solarSystem) {
        const idx = solarSystem._bufferIndex;
        if (typeof idx !== "number")
            return;
        this.positions[idx * 3] = 1e9;
        this.positions[idx * 3 + 1] = 1e9;
        this.positions[idx * 3 + 2] = 1e9;
        this.colors[idx * 3] = 0;
        this.colors[idx * 3 + 1] = 0;
        this.colors[idx * 3 + 2] = 0;
        this.visibility[idx] = 0;
        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.attributes.color.needsUpdate = true;
    }
    finalize(galaxy) {
        let numSolarSystems = 0;
        for (const cluster of galaxy.clusters) {
            numSolarSystems += cluster.solarSystems.length;
        }
        const positions = new Float32Array(numSolarSystems * 3);
        const colors = new Float32Array(numSolarSystems * 3);
        const visibility = new Uint8Array(numSolarSystems);
        let idx = 0;
        for (const cluster of galaxy.clusters) {
            for (const solarSystem of cluster.solarSystems) {
                positions[idx * 3] = solarSystem.position.x;
                positions[idx * 3 + 1] = RENDER_PLANE_Y;
                positions[idx * 3 + 2] = solarSystem.position.z;
                const color = new THREE.Color(solarSystem.isJumpGate ? 0x00ffff : cluster.color || 0xffffff);
                colors[idx * 3] = color.r;
                colors[idx * 3 + 1] = color.g;
                colors[idx * 3 + 2] = color.b;
                visibility[idx] = 1;
                solarSystem._bufferIndex = idx;
                idx++;
            }
        }
        this.positions = positions;
        this.colors = colors;
        this.visibility = visibility;
        this.maxCount = numSolarSystems;
        this.currentCount = numSolarSystems;
        this.geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        this.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.attributes.color.needsUpdate = true;
    }
}
//# sourceMappingURL=solar-system-point-layer.js.map