/**
 * Pure free-list allocator for fleet GPU rows + ship instance slots.
 *
 * Reuse policy (tombstones first, grow last):
 * - Fleet slots: among free indices, take the **highest** slot (watermark-first).
 * - Ship ranges: among free holes that fit, take the hole whose end is highest,
 *   and carve from the **high end** of that hole.
 * High-water only grows when no free tombstone/hole fits. High-water never shrinks.
 * - No GPU / DOM.
 */
export function createFleetSlotAllocator(opts) {
    const maxFleets = Math.max(0, opts.maxFleets | 0);
    const maxShips = Math.max(0, opts.maxShips | 0);
    /** Free fleet indices (unsorted; alloc picks max). */
    const fleetFree = [];
    /** 1 = currently allocated (within high-water). */
    const fleetLive = new Uint8Array(maxFleets);
    /** Sorted, non-overlapping free ship ranges (coalesced). */
    let shipFree = [];
    const alloc = {
        fleetHighWater: 0,
        shipHighWater: 0,
        allocFleetSlot() {
            // Prefer highest free tombstone so we refill high indices before growing.
            if (fleetFree.length > 0) {
                let bestI = 0;
                let bestSlot = fleetFree[0];
                for (let i = 1; i < fleetFree.length; i++) {
                    const s = fleetFree[i];
                    if (s > bestSlot) {
                        bestSlot = s;
                        bestI = i;
                    }
                }
                fleetFree.splice(bestI, 1);
                fleetLive[bestSlot] = 1;
                return bestSlot;
            }
            if (alloc.fleetHighWater >= maxFleets)
                return null;
            const slot = alloc.fleetHighWater;
            alloc.fleetHighWater = slot + 1;
            fleetLive[slot] = 1;
            return slot;
        },
        freeFleetSlot(slot) {
            const s = slot | 0;
            if (s < 0 || s >= alloc.fleetHighWater)
                return;
            if (!fleetLive[s])
                return;
            fleetLive[s] = 0;
            fleetFree.push(s);
        },
        allocShipRange(n) {
            const count = n | 0;
            if (count < 0)
                return null;
            // Zero-size: report tip of high-water; do not grow.
            if (count === 0) {
                return { start: alloc.shipHighWater, count: 0 };
            }
            // Among free holes that fit, pick the one with the highest end
            // (closest to watermark), then carve from that end.
            let bestI = -1;
            let bestEnd = -1;
            for (let i = 0; i < shipFree.length; i++) {
                const r = shipFree[i];
                if (r.count < count)
                    continue;
                const end = r.start + r.count;
                if (end > bestEnd) {
                    bestEnd = end;
                    bestI = i;
                }
            }
            if (bestI >= 0) {
                const r = shipFree[bestI];
                // Take high end of the hole: [start+count' - n, start+count').
                const start = r.start + r.count - count;
                if (r.count === count) {
                    shipFree.splice(bestI, 1);
                }
                else {
                    r.count -= count; // free prefix remains at r.start
                }
                return { start, count };
            }
            // No free hole fits — grow high-water.
            if (alloc.shipHighWater + count > maxShips)
                return null;
            const start = alloc.shipHighWater;
            alloc.shipHighWater = start + count;
            return { start, count };
        },
        freeShipRange(start, count) {
            const s = start | 0;
            const c = count | 0;
            if (c <= 0)
                return;
            if (s < 0 || s + c > alloc.shipHighWater)
                return;
            // Ignore double-free / overlap with existing free ranges.
            for (let i = 0; i < shipFree.length; i++) {
                const r = shipFree[i];
                if (s < r.start + r.count && s + c > r.start)
                    return;
            }
            // Insert sorted by start.
            let i = 0;
            while (i < shipFree.length && shipFree[i].start < s)
                i++;
            shipFree.splice(i, 0, { start: s, count: c });
            // Coalesce with previous (adjacent).
            if (i > 0) {
                const prev = shipFree[i - 1];
                const cur = shipFree[i];
                if (prev.start + prev.count === cur.start) {
                    prev.count += cur.count;
                    shipFree.splice(i, 1);
                    i -= 1;
                }
            }
            // Coalesce with next (adjacent).
            if (i + 1 < shipFree.length) {
                const cur = shipFree[i];
                const next = shipFree[i + 1];
                if (cur.start + cur.count === next.start) {
                    cur.count += next.count;
                    shipFree.splice(i + 1, 1);
                }
            }
        },
        reset() {
            alloc.fleetHighWater = 0;
            alloc.shipHighWater = 0;
            fleetFree.length = 0;
            fleetLive.fill(0);
            shipFree = [];
        },
    };
    return alloc;
}
/**
 * Tiny pure self-test. Throws on failure. Called from check-invariants.
 */
export function selfTestFleetSlotAllocator() {
    const fail = (msg) => {
        throw new Error(`fleet-slot-allocator: ${msg}`);
    };
    const eq = (a, b, msg) => {
        if (a !== b)
            fail(`${msg}: expected ${String(b)}, got ${String(a)}`);
    };
    const a = createFleetSlotAllocator({ maxFleets: 4, maxShips: 16 });
    // Fleet: grow high-water
    eq(a.allocFleetSlot(), 0, "fleet alloc 0");
    eq(a.allocFleetSlot(), 1, "fleet alloc 1");
    eq(a.fleetHighWater, 2, "fleet high-water after 2");
    // Fleet: free low then high — alloc prefers highest free tombstone
    a.freeFleetSlot(0);
    a.freeFleetSlot(1);
    eq(a.allocFleetSlot(), 1, "fleet prefers highest free (1 over 0)");
    eq(a.allocFleetSlot(), 0, "fleet then reuses 0");
    eq(a.fleetHighWater, 2, "fleet high-water does not shrink");
    // Fleet: ignore invalid / double free
    a.freeFleetSlot(-1);
    a.freeFleetSlot(99);
    a.freeFleetSlot(1);
    a.freeFleetSlot(1); // double-free
    eq(a.allocFleetSlot(), 1, "fleet after free 1");
    eq(a.fleetHighWater, 2, "fleet high-water still 2");
    // Fleet: exhaust
    eq(a.allocFleetSlot(), 2, "fleet alloc 2");
    eq(a.allocFleetSlot(), 3, "fleet alloc 3");
    eq(a.allocFleetSlot(), null, "fleet full → null");
    eq(a.fleetHighWater, 4, "fleet high-water at max");
    // Ship: grow
    const r0 = a.allocShipRange(4);
    eq(r0?.start, 0, "ship range start 0");
    eq(r0?.count, 4, "ship range count 4");
    eq(a.shipHighWater, 4, "ship high-water 4");
    const r1 = a.allocShipRange(4);
    eq(r1?.start, 4, "ship range start 4");
    eq(a.shipHighWater, 8, "ship high-water 8");
    // Ship: free low hole [0,4) and high hole later — prefer high end of free space
    a.freeShipRange(0, 4);
    a.freeShipRange(4, 4); // coalesced [0,8)
    // Carve from high end of [0,8): need 2 → [6,8)
    const r2 = a.allocShipRange(2);
    eq(r2?.start, 6, "ship alloc carves high end of free hole");
    eq(r2?.count, 2, "ship high-end count");
    eq(a.shipHighWater, 8, "ship high-water still 8 after reuse");
    // remaining free [0,6); need 3 → [3,6)
    const r3 = a.allocShipRange(3);
    eq(r3?.start, 3, "ship continues carving high end");
    eq(a.shipHighWater, 8, "ship high-water still 8");
    // Coalesce and re-alloc full 8
    a.freeShipRange(3, 3);
    a.freeShipRange(6, 2);
    // free [3,8) + still [0,3)? only free 3.. if [0,3) was left
    // after r3, free was [0,3). free 3,3 and 6,2 → coalesce [0,8)
    a.freeShipRange(0, 3);
    const r4 = a.allocShipRange(8);
    eq(r4?.start, 0, "coalesced free allows 8 from high carve of full hole");
    eq(a.shipHighWater, 8, "ship high-water still 8");
    // Ship: zero-size does not grow
    const z = a.allocShipRange(0);
    eq(z?.start, a.shipHighWater, "zero-range start = high-water");
    eq(z?.count, 0, "zero-range count 0");
    eq(a.shipHighWater, 8, "zero-range does not grow");
    // Ship: free invalid / zero is no-op
    a.freeShipRange(0, 0);
    a.freeShipRange(-1, 4);
    a.freeShipRange(100, 1);
    a.freeShipRange(0, 4);
    a.freeShipRange(0, 4); // double-free
    eq(a.shipHighWater, 8, "invalid free leaves high-water");
    // Ship: exceed max
    a.reset();
    eq(a.fleetHighWater, 0, "reset fleet high-water");
    eq(a.shipHighWater, 0, "reset ship high-water");
    const big = a.allocShipRange(16);
    eq(big?.count, 16, "alloc full maxShips");
    eq(a.allocShipRange(1), null, "exceed maxShips → null");
    eq(a.shipHighWater, 16, "ship high-water at max");
    // Ship: small free hole at low end, need larger → grow high-water
    a.reset();
    a.allocShipRange(4); // [0,4)
    a.allocShipRange(4); // [4,8)
    a.freeShipRange(0, 2); // free [0,2) — too small for 3
    const r5 = a.allocShipRange(3);
    eq(r5?.start, 8, "skips small low hole → grow");
    eq(a.shipHighWater, 11, "high-water grew past small hole");
    // Ship: two free holes — prefer the higher one
    a.reset();
    a.allocShipRange(10); // [0,10)
    a.freeShipRange(0, 3); // free [0,3)
    a.freeShipRange(7, 3); // free [7,10)
    const r6 = a.allocShipRange(2);
    eq(r6?.start, 8, "prefers higher free hole [7,10) carved high → [8,10)");
    eq(a.shipHighWater, 10, "no grow when higher hole fits");
}
//# sourceMappingURL=fleet-slot-allocator.js.map