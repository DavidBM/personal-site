import * as THREE from "../vendor/three.js";
export default class GalaxyConnectionLines {
    /**
     * @param {THREE.Material} lineMaterial - Material for LineSegments (must support vertexColors)
     * @param {number} [initialCapacity=1000] - Initial number of connections to allocate for
     */
    constructor(lineMaterial, initialCapacity = 1000) {
        this.capacity = initialCapacity;
        this.count = 0;
        // Buffer data
        this.positions = new Float32Array(this.capacity * 2 * 3); // 2 ends, 3 coords each
        this.colors = new Float32Array(this.capacity * 2 * 3);
        this.geometry = new THREE.BufferGeometry();
        this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
        this.geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
        this.geometry.setDrawRange(0, 0);
        this.lineMaterial = lineMaterial;
        this.lines = new THREE.LineSegments(this.geometry, this.lineMaterial);
        this.lines.frustumCulled = false;
        this.group = new THREE.Group();
        this.group.add(this.lines);
        // key: string (user's context; usually `${i1}-${i2}`), value: buffer slot
        this.keyToIndex = new Map();
        // Reverse mapping, for buffer compaction (rarely needed):
        this.indexToKey = new Map();
    }
    /**
     * Utility: generate a symmetric key for two indices.
     * E.g. [3,7] and [7,3] both become '3-7'.
     */
    static makeKey(i1, i2) {
        return i1 < i2 ? `${i1}-${i2}` : `${i2}-${i1}`;
    }
    /**
     * Add a connection line between two points (accepts THREE.Vector3 or array [x,y,z]).
     * The only requirement for the key is that it is unique in this context.
     * If the key already exists, does nothing.
     */
    addConnection(p1, p2, color = 0x00ffff, key) {
        if (!key)
            throw new Error("addConnection requires a unique key");
        if (this.keyToIndex.has(key))
            return key;
        // Expand buffer if needed
        if (this.count >= this.capacity) {
            this._resize(Math.ceil(this.capacity * 1.3) || this.capacity + 256);
        }
        // Write into buffer
        const slot = this.count;
        let i = slot * 2 * 3;
        // Set positions
        for (let j = 0; j < 3; ++j) {
            this.positions[i + j] = Array.isArray(p1) ? p1[j] : p1.getComponent(j);
            this.positions[i + 3 + j] = Array.isArray(p2)
                ? p2[j]
                : p2.getComponent(j);
        }
        // Color (r,g,b 0..1)
        let colorArr;
        if (color instanceof THREE.Color)
            colorArr = [color.r, color.g, color.b];
        else if (Array.isArray(color))
            colorArr = color;
        else if (typeof color === "number")
            colorArr = [
                ((color >> 16) & 0xff) / 255,
                ((color >> 8) & 0xff) / 255,
                (color & 0xff) / 255,
            ];
        else
            throw new Error("Color format not recognized");
        for (let j = 0; j < 3; ++j) {
            this.colors[i + j] = colorArr[j] ?? 0;
            this.colors[i + 3 + j] = colorArr[j] ?? 0;
        }
        // Set/mark ranges
        this.keyToIndex.set(key, slot);
        this.indexToKey.set(slot, key);
        this.count += 1;
        this.geometry.setDrawRange(0, this.count * 2);
        // Inform Three.js of buffer changes
        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.attributes.color.needsUpdate = true;
        return key;
    }
    /**
     * Remove a connection by key (does not compact buffer, just 'hides' line segment).
     * Call finalizeBuffers() to compact after many changes, if needed.
     */
    removeConnection(key) {
        if (!this.keyToIndex.has(key))
            return false;
        const slot = this.keyToIndex.get(key);
        if (typeof slot !== "number")
            return false;
        let i = slot * 2 * 3;
        for (let k = 0; k < 6; ++k) {
            this.positions[i + k] = 1e9; // Move far away
            this.colors[i + k] = 0; // Transparent/black
        }
        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.attributes.color.needsUpdate = true;
        this.keyToIndex.delete(key);
        this.indexToKey.delete(slot);
        return true;
    }
    /**
     * Compact buffers to remove "holes" from removals.
     * Call occasionally if many adds/removes were done for maximal perf.
     * This will reassign buffer slots and keys, so stored slot indices become invalid.
     */
    finalizeBuffers() {
        const newPositions = new Float32Array(this.capacity * 2 * 3);
        const newColors = new Float32Array(this.capacity * 2 * 3);
        const newKeyToIndex = new Map();
        const newIndexToKey = new Map();
        let newCount = 0;
        for (let slot = 0; slot < this.count; ++slot) {
            const key = this.indexToKey.get(slot);
            if (!key)
                continue; // removed
            let iOld = slot * 2 * 3;
            let iNew = newCount * 2 * 3;
            for (let k = 0; k < 6; ++k) {
                newPositions[iNew + k] = this.positions[iOld + k];
                newColors[iNew + k] = this.colors[iOld + k];
            }
            newKeyToIndex.set(key, newCount);
            newIndexToKey.set(newCount, key);
            newCount++;
        }
        this.positions = newPositions;
        this.colors = newColors;
        this.keyToIndex = newKeyToIndex;
        this.indexToKey = newIndexToKey;
        this.count = newCount;
        this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
        this.geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
        this.geometry.setDrawRange(0, this.count * 2);
        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.attributes.color.needsUpdate = true;
    }
    /**
     * Utility function to resize all internal buffers when needed (expands)
     * @private
     */
    _resize(newCapacity) {
        if (newCapacity <= this.capacity)
            return;
        const newPositions = new Float32Array(newCapacity * 2 * 3);
        newPositions.set(this.positions);
        const newColors = new Float32Array(newCapacity * 2 * 3);
        newColors.set(this.colors);
        this.positions = newPositions;
        this.colors = newColors;
        this.capacity = newCapacity;
        this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
        this.geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.attributes.color.needsUpdate = true;
    }
    /**
     * Updates color for a connection.
     */
    setConnectionColor(key, color) {
        const slot = this.keyToIndex.get(key);
        if (typeof slot !== "number")
            return false;
        let i = slot * 2 * 3;
        let colorArr;
        if (color instanceof THREE.Color)
            colorArr = [color.r, color.g, color.b];
        else if (Array.isArray(color))
            colorArr = color;
        else if (typeof color === "number")
            colorArr = [
                ((color >> 16) & 0xff) / 255,
                ((color >> 8) & 0xff) / 255,
                (color & 0xff) / 255,
            ];
        else
            throw new Error("Color format not recognized");
        for (let j = 0; j < 3; ++j) {
            this.colors[i + j] = colorArr[j] ?? 0;
            this.colors[i + 3 + j] = colorArr[j] ?? 0;
        }
        this.geometry.attributes.color.needsUpdate = true;
        return true;
    }
    /**
     * Update endpoints for an existing connection.
     */
    updateConnection(key, p1, p2) {
        const slot = this.keyToIndex.get(key);
        if (typeof slot !== "number")
            return false;
        let i = slot * 2 * 3;
        for (let j = 0; j < 3; ++j) {
            this.positions[i + j] = Array.isArray(p1) ? p1[j] : p1.getComponent(j);
            this.positions[i + 3 + j] = Array.isArray(p2)
                ? p2[j]
                : p2.getComponent(j);
        }
        this.geometry.attributes.position.needsUpdate = true;
        return true;
    }
    /**
     * Return the group containing the line segments ready for scene.add().
     */
    getGroup() {
        return this.group;
    }
    /**
     * Clear all connections.
     */
    clear() {
        this.keyToIndex.clear();
        this.indexToKey.clear();
        this.count = 0;
        this.geometry.setDrawRange(0, 0);
        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.attributes.color.needsUpdate = true;
    }
}
//# sourceMappingURL=galaxy-connection-lines.js.map