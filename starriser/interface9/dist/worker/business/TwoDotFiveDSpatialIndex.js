// 2dot5DSpatialIndex - Fast mutable 2.5D spatial index (Generic QuadTree on XZ, bounded Y range)
//
// Features:
// - Generic: Works with any item that provides id, x, z, yMin, yMax (accessors configurable via constructor)
// - Efficient: insert, remove, and radius query in O(log n) for spatially balanced data
// - Overlapping area search for boundary/corner so items near quad splits are searched in all that apply
// - Handles 2.5D queries for objects "floating" at heights as well as ground objects
// - API: insert(item), remove(id), query(x, z, [radius, y?]), build(items), clear(), size()
// - No cluster or domain logic, pure spatial index
//
// Usage example:
//   const index = new TwoDotFiveDSpatialIndex();
//   index.insert({id, x, z, yMin, yMax});
//   index.remove(id);
//   index.query(x, z, radius, y); // y optional for 2D, required for full 2.5D
//   index.build(arrayOfItems); // (optional bulk load)
export class TwoDotFiveDSpatialIndex {
    constructor(opts = {}) {
        this._getX =
            opts.getX ??
                ((item) => item.x);
        this._getZ =
            opts.getZ ??
                ((item) => item.z);
        this._getYMin =
            opts.getYMin ??
                ((item) => {
                    const data = item;
                    return data.yMin !== undefined ? data.yMin : data.y ?? 0;
                });
        this._getYMax =
            opts.getYMax ??
                ((item) => {
                    const data = item;
                    return data.yMax !== undefined ? data.yMax : data.y ?? 0;
                });
        this._getId =
            opts.getId ??
                ((item) => item.id);
        this._maxDepth = typeof opts.maxDepth === "number" ? opts.maxDepth : 8;
        this._maxItems =
            typeof opts.maxItemsPerNode === "number" ? opts.maxItemsPerNode : 100;
        this._root = null;
        this._idMap = new Map();
        this._size = 0;
        this._bounds = null;
    }
    clear() {
        this._root = null;
        this._idMap = new Map();
        this._size = 0;
        this._bounds = null;
    }
    size() {
        return this._size;
    }
    /**
     * Build from bulk array (overwrites index!)
     */
    build(items) {
        this.clear();
        if (!Array.isArray(items) || items.length === 0)
            return;
        // Compute bulk bounds for XZ
        let minX = Infinity;
        let minZ = Infinity;
        let maxX = -Infinity;
        let maxZ = -Infinity;
        for (const item of items) {
            const x = this._getX(item);
            const z = this._getZ(item);
            minX = Math.min(minX, x);
            minZ = Math.min(minZ, z);
            maxX = Math.max(maxX, x);
            maxZ = Math.max(maxZ, z);
        }
        // Add small margin
        const pad = 1;
        this._bounds = {
            minX: minX - pad,
            minZ: minZ - pad,
            maxX: maxX + pad,
            maxZ: maxZ + pad,
        };
        this._root = this._createNode(this._bounds, 0);
        for (const item of items) {
            this._insertInternal(item, this._root, 0);
        }
    }
    /**
     * Insert a new item (item must provide id, x, z, yMin, yMax)
     * Duplicates on ID are ignored (remove first if necessary)
     */
    insert(item) {
        if (item == null)
            return false;
        const id = this._getId(item);
        if (this._idMap.has(id))
            return false;
        if (!this._root) {
            // Auto-bounds from first item
            const x = this._getX(item);
            const z = this._getZ(item);
            this._bounds = { minX: x - 1, minZ: z - 1, maxX: x + 1, maxZ: z + 1 };
            this._root = this._createNode(this._bounds, 0);
        }
        if (this._bounds && !this._withinBounds(item, this._bounds)) {
            this._expandRoot(item);
        }
        if (!this._root)
            return false;
        this._insertInternal(item, this._root, 0);
        return true;
    }
    /**
     * Remove item by ID
     * Returns true if removed, false if missing
     */
    remove(id) {
        const entry = this._idMap.get(id);
        if (!entry)
            return false;
        const { node } = entry;
        const idx = node.items.findIndex((item) => this._getId(item) === id);
        if (idx >= 0) {
            node.items.splice(idx, 1);
            this._idMap.delete(id);
            this._size--;
            return true;
        }
        return false;
    }
    /**
     * Find the closest item within radius (optional Y).
     * If y is provided, also checks Y range of items.
     */
    query(x, z, radius = Infinity, y) {
        if (!this._root) {
            return { item: null, dist: Infinity, distXZ: Infinity, distY: Infinity };
        }
        let best = null;
        let bestDistXZ = Infinity;
        let bestDistY = Infinity;
        const sq = (n) => n * n;
        // Accept overlap within some epsilon to handle boundary/corner properly
        const epsilon = 1e-4;
        const boxOverlaps = (bounds) => {
            if (x < bounds.minX - epsilon ||
                x > bounds.maxX + epsilon ||
                z < bounds.minZ - epsilon ||
                z > bounds.maxZ + epsilon) {
                return false;
            }
            return true;
        };
        const search = (node) => {
            if (!boxOverlaps(node.bounds))
                return;
            if (node.children) {
                for (const child of node.children)
                    search(child);
            }
            for (const item of node.items) {
                const ix = node.getX(item);
                const iz = node.getZ(item);
                const iyMin = node.getYMin(item);
                const iyMax = node.getYMax(item);
                const dx = x - ix;
                const dz = z - iz;
                const d2xz = sq(dx) + sq(dz);
                if (d2xz > radius * radius)
                    continue;
                let dY = 0;
                if (y !== undefined) {
                    if (y < iyMin - epsilon || y > iyMax + epsilon)
                        continue;
                    dY = Math.abs((iyMax + iyMin) / 2 - y);
                }
                if (d2xz < bestDistXZ || (d2xz === bestDistXZ && dY < bestDistY)) {
                    bestDistXZ = d2xz;
                    bestDistY = dY;
                    best = item;
                }
            }
        };
        search(this._root);
        return {
            item: best,
            dist: Math.sqrt(bestDistXZ + bestDistY * bestDistY),
            distXZ: Math.sqrt(bestDistXZ),
            distY: bestDistY,
        };
    }
    /* ---------- Internal Implementation ---------- */
    _createNode(bounds, depth) {
        return {
            bounds,
            depth,
            items: [],
            children: null,
            getX: this._getX,
            getZ: this._getZ,
            getId: this._getId,
            getYMin: this._getYMin,
            getYMax: this._getYMax,
        };
    }
    _insertInternal(item, node, depth) {
        if (!node.children && (node.items.length < this._maxItems || depth >= this._maxDepth)) {
            node.items.push(item);
            this._idMap.set(this._getId(item), { item, node });
            this._size++;
            return;
        }
        if (!node.children)
            this._split(node);
        const children = node.children;
        if (!children)
            return;
        const idx = this._quadrantIdx(item, node.bounds);
        this._insertInternal(item, children[idx], depth + 1);
    }
    _split(node) {
        const { minX, minZ, maxX, maxZ } = node.bounds;
        const mx = (minX + maxX) / 2;
        const mz = (minZ + maxZ) / 2;
        const boundsArr = [
            { minX, minZ, maxX: mx, maxZ: mz },
            { minX: mx, minZ, maxX, maxZ: mz },
            { minX, minZ: mz, maxX: mx, maxZ },
            { minX: mx, minZ: mz, maxX, maxZ },
        ];
        node.children = boundsArr.map((b) => this._createNode(b, node.depth + 1));
        for (const item of node.items) {
            const qIdx = this._quadrantIdx(item, node.bounds);
            const child = node.children[qIdx];
            child.items.push(item);
            const entry = this._idMap.get(this._getId(item));
            if (entry) {
                entry.node = child;
            }
        }
        node.items.length = 0;
    }
    _quadrantIdx(item, bounds) {
        const x = this._getX(item);
        const z = this._getZ(item);
        const mx = (bounds.minX + bounds.maxX) / 2;
        const mz = (bounds.minZ + bounds.maxZ) / 2;
        let idx = 0;
        if (x >= mx)
            idx += 1;
        if (z >= mz)
            idx += 2;
        return idx;
    }
    _withinBounds(item, bounds) {
        const x = this._getX(item);
        const z = this._getZ(item);
        return (x >= bounds.minX &&
            x <= bounds.maxX &&
            z >= bounds.minZ &&
            z <= bounds.maxZ);
    }
    _expandRoot(item) {
        if (!this._bounds || !this._root)
            return;
        let { minX, minZ, maxX, maxZ } = this._bounds;
        const x = this._getX(item);
        const z = this._getZ(item);
        minX = Math.min(minX, x - 1);
        minZ = Math.min(minZ, z - 1);
        maxX = Math.max(maxX, x + 1);
        maxZ = Math.max(maxZ, z + 1);
        const allItems = [];
        this._collectItems(this._root, allItems);
        allItems.push(item);
        this._bounds = { minX, minZ, maxX, maxZ };
        this._root = this._createNode(this._bounds, 0);
        this._idMap.clear();
        this._size = 0;
        for (const it of allItems) {
            this._insertInternal(it, this._root, 0);
        }
    }
    _collectItems(node, outArr) {
        if (!node)
            return;
        for (const item of node.items)
            outArr.push(item);
        if (node.children) {
            for (const ch of node.children)
                this._collectItems(ch, outArr);
        }
    }
}
//# sourceMappingURL=TwoDotFiveDSpatialIndex.js.map