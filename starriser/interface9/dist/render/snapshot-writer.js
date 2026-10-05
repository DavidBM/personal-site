import { hashFleetId } from '../gpu/fleet-layout.js';
import { sceneParkPlanetName } from '../gpu/solar-system-lod.js';
import { sceneFleetRemainingSec } from './protocol.js';
import { fleetSnapshotPosition, renderSnapshotHeader } from './runtime-state.js';
import { SNAPSHOT_BUFFER_BYTES, SNAPSHOT_FLEET_LIMIT, SNAPSHOT_HEADER_WORDS, SNAPSHOT_ROW_WORDS } from './snapshot-packet.js';
/** One in-flight observation, one buffer returned by its consumer. Never transfer GPU
 * mapped storage or live renderer arrays. Diagnostic snapshots retain their old API. */
export function createSnapshotWriter() {
    let buffer = null;
    const catalog = [];
    const seen = new Set();
    const position = { x: 0, y: 0, z: 0 };
    const emptyTypes = [];
    return {
        recycle(data) { if (data.byteLength === SNAPSHOT_BUFFER_BYTES)
            buffer = data; },
        write(state, remote, remoteTotal) {
            const data = buffer ?? new ArrayBuffer(SNAPSHOT_BUFFER_BYTES);
            buffer = null;
            const words = new Float64Array(data);
            words.set(state.view.sceneMarkerProjection(), 0);
            const header = renderSnapshotHeader(state, remoteTotal);
            const changed = [];
            let count = 0;
            seen.clear();
            const append = (id, visual) => {
                if (!visual || visual.instanceActive <= 0 || count === SNAPSHOT_FLEET_LIMIT)
                    return;
                const slot = state.view.readFleetGpuSlot(visual.id);
                if (!slot)
                    return;
                const row = count++, offset = SNAPSHOT_HEADER_WORDS + row * SNAPSHOT_ROW_WORDS;
                fleetSnapshotPosition(state, id, visual, slot, position);
                const center = header.systemId == null ? null : state.view.sceneMarkerCenter(visual.id);
                const activity = state.view.sceneFleetActivity(visual.id);
                words[offset] = state.view.getSceneShipHandle(visual.id, 0) ?? -1;
                words[offset + 1] = position.x;
                words[offset + 2] = position.y;
                words[offset + 3] = position.z;
                words[offset + 4] = center?.x ?? NaN;
                words[offset + 5] = center?.y ?? NaN;
                words[offset + 6] = center?.z ?? NaN;
                words[offset + 7] = sceneFleetRemainingSec(visual.state, header.wallMs) ?? NaN;
                words[offset + 8] = activity?.sampledAt ?? NaN;
                const liveTypes = state.view.sceneShipTypes(visual.id);
                const types = liveTypes.length ? liveTypes : emptyTypes;
                const shipCount = visual.counts.red + visual.counts.blue + visual.counts.green;
                const planetName = sceneParkPlanetName(hashFleetId(visual.id), state.view.solarBodies, visual.state);
                const old = catalog[row];
                if (!old || old.id !== id || old.types !== types || old.shipCount !== shipCount ||
                    old.state !== visual.state.state || old.action !== activity?.action ||
                    old.micro !== activity?.micro || old.planetName !== planetName) {
                    const value = { id, types, shipCount,
                        visualCount: types.reduce((sum, type) => sum + type.count, 0),
                        state: visual.state.state, action: activity?.action, micro: activity?.micro, planetName };
                    catalog[row] = value;
                    changed.push({ row, value });
                }
                state.sceneFleetRenderIds.set(id, visual.id);
                seen.add(id);
            };
            if (state.selectedFleetId)
                append(state.selectedFleetId, state.view.getFleetVisual(state.selectedFleetId));
            for (const id of state.sceneFleetIds) {
                if (count === SNAPSHOT_FLEET_LIMIT)
                    break;
                if (id !== state.selectedFleetId)
                    append(id, state.view.getFleetVisual(id));
            }
            for (const ref of remote) {
                if (count === SNAPSHOT_FLEET_LIMIT)
                    break;
                if (!seen.has(ref.id))
                    append(ref.id, ref.visual);
            }
            catalog.length = count;
            return { header, data, count, changed };
        },
    };
}
//# sourceMappingURL=snapshot-writer.js.map