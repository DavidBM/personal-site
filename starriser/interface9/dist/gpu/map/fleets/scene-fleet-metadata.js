// @ts-expect-error CPU packing shares the runtime's authoritative formation layout.
import { writeFleetFormation } from '../../../lib/ship-runtime/formation.mjs';
import { sceneFleetTypes } from './fleet-marker.js';
/** Admission changes one fleet's prefix. Preserve every other record/row identity. */
export function patchSceneFleetMetadata(tables, fleet, ranges) {
    const slot = fleet.slot ?? 0;
    writeFleetFormation(tables.formation, fleet, slot, ranges);
    const runs = sceneFleetTypes(fleet.id ?? '', fleet.seedShipCount, fleet.type, fleet.seedPlan)
        .map(row => ({ ...row, count: Math.min(row.count, Math.max(0, fleet.shipCount - row.ordinal)) }))
        .filter(row => row.count > 0);
    const rows = [];
    for (const run of runs) {
        const previous = rows.find(row => row.kind === run.kind);
        if (previous) {
            previous.count += run.count;
            previous.lastOrdinal = run.ordinal + run.count - 1;
        }
        else
            rows.push(run);
    }
    rows.sort((a, b) => a.kind - b.kind);
    tables.rows.set(fleet.id ?? '', rows);
    const at = slot * 8;
    tables.types.fill(0, at, at + 8);
    for (const row of rows)
        tables.types[at + row.kind] += row.count;
    tables.types[at + 6] = rows.length;
}
//# sourceMappingURL=scene-fleet-metadata.js.map