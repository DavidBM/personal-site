export const HIDDEN_FLEET_POSITION = 1e9;
const BASE_SHIP_SIZE = 2.4;
const SHIP_SPREAD = 26;
const RED_SCALE = 20;
const BLUE_SCALE = 3;
const GREEN_SCALE = 1;
export function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}
export function buildFleetGeometry(counts, random = Math.random) {
    const totalShips = counts.red + counts.blue + counts.green;
    const vertexCount = totalShips * 3;
    const offsets = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);
    let cursor = 0;
    const writeShip = (scale, color) => {
        const centerOffset = {
            x: (random() - 0.5) * SHIP_SPREAD * scale,
            y: (random() - 0.5) * 6,
            z: (random() - 0.5) * SHIP_SPREAD * scale,
        };
        const rotation = random() * Math.PI * 2;
        const tri = pickFleetTriangle(BASE_SHIP_SIZE * scale, centerOffset, rotation, random);
        for (let index = 0; index < 9; index += 3) {
            offsets[cursor] = tri[index];
            offsets[cursor + 1] = tri[index + 1];
            offsets[cursor + 2] = tri[index + 2];
            colors[cursor] = color[0];
            colors[cursor + 1] = color[1];
            colors[cursor + 2] = color[2];
            cursor += 3;
        }
    };
    for (let index = 0; index < counts.red; index++) {
        writeShip(RED_SCALE, [1.0, 0.2, 0.2]);
    }
    for (let index = 0; index < counts.blue; index++) {
        writeShip(BLUE_SCALE, [0.2, 0.6, 1.0]);
    }
    for (let index = 0; index < counts.green; index++) {
        writeShip(GREEN_SCALE, [0.2, 1.0, 0.4]);
    }
    return { offsets, colors, vertexCount };
}
export function rebuildFleetRenderBuffers(fleets) {
    const fleetOrder = Array.from(fleets.keys());
    let totalVertices = 0;
    for (const id of fleetOrder) {
        const fleet = fleets.get(id);
        if (!fleet)
            continue;
        fleet.vertexStart = totalVertices;
        totalVertices += fleet.vertexCount;
    }
    const positions = new Float32Array(totalVertices * 3);
    const colors = new Float32Array(totalVertices * 3);
    let cursor = 0;
    for (const id of fleetOrder) {
        const fleet = fleets.get(id);
        if (!fleet)
            continue;
        colors.set(fleet.colors, cursor);
        cursor += fleet.colors.length;
    }
    return {
        fleetOrder,
        positions,
        colors,
        totalVertices,
    };
}
export function classifyFleetVisualStateIds(fleets) {
    const jumpingFleetIds = [];
    const nonJumpingFleetIds = [];
    const cooldownFleetIds = [];
    for (const [id, fleet] of fleets.entries()) {
        if (fleet.state.state === "jumping") {
            jumpingFleetIds.push(id);
            continue;
        }
        nonJumpingFleetIds.push(id);
        if (fleet.state.state === "cooldown") {
            cooldownFleetIds.push(id);
        }
    }
    return {
        jumpingFleetIds,
        nonJumpingFleetIds,
        cooldownFleetIds,
    };
}
export function resolveFleetRenderPosition(state, now, positionProvider) {
    if (!positionProvider)
        return null;
    if (state.state === "jumping") {
        const start = positionProvider(state.startNode);
        const end = positionProvider(state.endNode);
        if (!start || !end)
            return null;
        const t = clamp01((now - state.startTime) / state.durationMs);
        return {
            x: start.x + (end.x - start.x) * t,
            y: start.y + (end.y - start.y) * t,
            z: start.z + (end.z - start.z) * t,
        };
    }
    return positionProvider(state.node);
}
export function writeFleetVisualPosition(fleet, target, position) {
    const offsets = fleet.offsets;
    let targetIndex = fleet.vertexStart * 3;
    for (let index = 0; index < offsets.length; index += 3) {
        target[targetIndex + index] = offsets[index] + position.x;
        target[targetIndex + index + 1] = offsets[index + 1] + position.y;
        target[targetIndex + index + 2] = offsets[index + 2] + position.z;
    }
}
export function hideFleetVisualVertices(fleet, target, hiddenPosition = HIDDEN_FLEET_POSITION) {
    let index = fleet.vertexStart * 3;
    const end = index + fleet.vertexCount * 3;
    for (; index < end; index += 3) {
        target[index] = hiddenPosition;
        target[index + 1] = hiddenPosition;
        target[index + 2] = hiddenPosition;
    }
}
export function buildFleetLodSummary(fleets, now, positionProvider, maxShips) {
    let sumX = 0;
    let sumY = 0;
    let sumZ = 0;
    let count = 0;
    let totalRed = 0;
    let totalBlue = 0;
    let totalGreen = 0;
    for (const fleet of fleets) {
        const position = resolveFleetRenderPosition(fleet.state, now, positionProvider);
        if (!position)
            continue;
        sumX += position.x;
        sumY += position.y;
        sumZ += position.z;
        count += 1;
        totalRed += fleet.counts.red;
        totalBlue += fleet.counts.blue;
        totalGreen += fleet.counts.green;
    }
    if (count === 0)
        return null;
    const totalShips = totalRed + totalBlue + totalGreen;
    const scale = totalShips > maxShips ? maxShips / totalShips : 1;
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
export function buildFleetLodSignature(counts) {
    return `${counts.red}:${counts.blue}:${counts.green}`;
}
export function shouldRebuildFleetLodGeometry(currentSignature, offsets, nextSignature) {
    return currentSignature !== nextSignature || !offsets;
}
export function buildFleetLodGeometryBuffers(counts, random = Math.random) {
    const geometry = buildFleetGeometry(counts, random);
    return {
        signature: buildFleetLodSignature(counts),
        offsets: geometry.offsets,
        positions: new Float32Array(geometry.vertexCount * 3),
        colors: geometry.colors,
        vertexCount: geometry.vertexCount,
    };
}
export function writeFleetLodPositions(positions, offsets, position) {
    for (let index = 0; index < offsets.length; index += 3) {
        positions[index] = offsets[index] + position.x;
        positions[index + 1] = offsets[index + 1] + position.y;
        positions[index + 2] = offsets[index + 2] + position.z;
    }
}
export function collectFleetCooldownSlots(fleetIds, fleets, now, positionProvider) {
    const slots = [];
    for (let index = 0; index < fleetIds.length; index++) {
        const fleet = fleets.get(fleetIds[index]);
        if (!fleet || fleet.state.state !== "cooldown")
            continue;
        const position = resolveFleetRenderPosition(fleet.state, now, positionProvider);
        if (!position)
            continue;
        const elapsed = now - fleet.state.startTime;
        slots.push({
            position: { x: position.x, y: position.y, z: position.z },
            remainingFraction: clamp01(1 - elapsed / fleet.state.durationMs),
        });
    }
    return slots;
}
export function calculateFleetCooldownSegmentCapacity(slotCount, segmentsPerRing) {
    return slotCount * segmentsPerRing;
}
export function writeFleetCooldownRingPositions(target, slots, { segmentsPerRing, radius, yOffset, hiddenPosition = HIDDEN_FLEET_POSITION, }) {
    let cursor = 0;
    for (let index = 0; index < slots.length; index++) {
        const slot = slots[index];
        const angleMax = Math.PI * 2 * slot.remainingFraction;
        const segmentsToShow = Math.floor(segmentsPerRing * slot.remainingFraction);
        for (let segment = 0; segment < segmentsPerRing; segment++) {
            const enabled = segment < segmentsToShow;
            const startAngle = (segment / segmentsPerRing) * angleMax;
            const endAngle = ((segment + 1) / segmentsPerRing) * angleMax;
            if (!enabled || angleMax <= 0) {
                for (let offset = 0; offset < 6; offset++) {
                    target[cursor + offset] = hiddenPosition;
                }
                cursor += 6;
                continue;
            }
            const sx = Math.cos(startAngle) * radius + slot.position.x;
            const sz = Math.sin(startAngle) * radius + slot.position.z;
            const ex = Math.cos(endAngle) * radius + slot.position.x;
            const ez = Math.sin(endAngle) * radius + slot.position.z;
            const y = slot.position.y + yOffset;
            target[cursor] = sx;
            target[cursor + 1] = y;
            target[cursor + 2] = sz;
            target[cursor + 3] = ex;
            target[cursor + 4] = y;
            target[cursor + 5] = ez;
            cursor += 6;
        }
    }
}
export function scaleFleetCounts(counts, scale) {
    return {
        red: Math.max(0, Math.floor(counts.red * scale)),
        blue: Math.max(0, Math.floor(counts.blue * scale)),
        green: Math.max(0, Math.floor(counts.green * scale)),
    };
}
function pickFleetTriangle(size, centerOffset, rotation, random) {
    const a = rotation;
    const b = rotation + (Math.PI * 2) / 3;
    const c = rotation + (Math.PI * 4) / 3;
    const scale = size * (0.6 + random() * 0.4);
    const ax = Math.cos(a) * scale + centerOffset.x;
    const az = Math.sin(a) * scale + centerOffset.z;
    const bx = Math.cos(b) * scale + centerOffset.x;
    const bz = Math.sin(b) * scale + centerOffset.z;
    const cx = Math.cos(c) * scale + centerOffset.x;
    const cz = Math.sin(c) * scale + centerOffset.z;
    const y = centerOffset.y;
    return [ax, y, az, bx, y, bz, cx, y, cz];
}
//# sourceMappingURL=fleet-visual-buffers.js.map