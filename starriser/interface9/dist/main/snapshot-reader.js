import { projectFleetMarker } from '../gpu/map/fleets/fleet-marker.js';
import { SNAPSHOT_HEADER_WORDS, SNAPSHOT_ROW_WORDS } from '../render/snapshot-packet.js';
/** The consumer owns UI assembly and projection. Returned snapshots contain no views
 * into the transferred buffer: it can immediately go back to the render worker. */
export function createSnapshotReader() {
    const catalog = [];
    const center = { x: 0, y: 0, z: 0 };
    return (packet) => {
        for (const { row, value } of packet.changed)
            catalog[row] = value;
        catalog.length = packet.count;
        const words = new Float64Array(packet.data), header = packet.header;
        const sceneFleets = [];
        for (let row = 0; row < packet.count; row++) {
            const meta = catalog[row];
            if (!meta)
                throw new Error(`Missing fleet observation metadata at ${row}`);
            const offset = SNAPSHOT_HEADER_WORDS + row * SNAPSHOT_ROW_WORDS;
            center.x = words[offset + 4];
            center.y = words[offset + 5];
            center.z = words[offset + 6];
            const marker = projectFleetMarker(words, center, meta.types?.length ?? 0, header.camera.viewportW, header.camera.viewportH);
            const remaining = words[offset + 7], sampledAt = words[offset + 8];
            sceneFleets.push({ ...meta, shipIndex: words[offset], x: words[offset + 1], y: words[offset + 2], z: words[offset + 3],
                remainingSec: Number.isNaN(remaining) ? null : remaining,
                sampledAt: Number.isNaN(sampledAt) ? undefined : sampledAt, marker: marker ?? undefined });
        }
        return { ...header, sceneFleets };
    };
}
//# sourceMappingURL=snapshot-reader.js.map