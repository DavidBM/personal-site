import { create } from '@bufbuild/protobuf';
import { FleetCompositionSchema } from './generated/galaxy/v1/galaxy_pb.js';
import { opaqueIdAt } from '../contracts/opaque-id.js';
const u32 = (n) => Number.isInteger(n) && n >= 0 && n <= 0xffffffff;
const identity = (id) => id?.length === 16 && id.some(n => n !== 0);
function designValid(d) {
    if (!d || !identity(d.designId) || !u32(d.version) || d.version < 1 || !Number.isInteger(d.role) || d.role < 1 || d.role > 6)
        return false;
    return hullValid(d) && [d.hullPoints, d.shieldPoints, d.attackPoints, d.cargoUnits].every(u32) && d.hullPoints > 0;
}
function hullValid(d) {
    const h = d.hull;
    return !!h && identity(h.hullId) && u32(h.version) && h.version > 0
        && /^[a-z][a-z0-9/_-]{0,63}$/.test(h.assetKey) && h.assetKey.split('/').every(Boolean);
}
function damageValid(damage, design) {
    return typeof damage === 'bigint' && damage >= 0n && damage < BigInt(design.hullPoints) + BigInt(design.shieldPoints);
}
export function validateFleetComposition(value) {
    if (!value.groups.length || value.groups.length > 16)
        throw new Error('Invalid fleet groups');
    const seen = new Set();
    let total = 0;
    for (const group of value.groups) {
        if (!designValid(group.design) || !u32(group.count) || group.count < 1)
            throw new Error('Invalid fleet design/count');
        if (!damageValid(group.damagePoints, group.design))
            throw new Error('Invalid fleet damage');
        const key = `${opaqueIdAt(group.design.designId)}:${group.design.version}`;
        if (seen.has(key))
            throw new Error('Duplicate fleet design');
        seen.add(key);
        total += group.count;
    }
    if (total > 1000000)
        throw new Error('Fleet member budget exceeded');
}
/** Known fields only; never retain unknown protobuf fields or aliased byte spans. */
export function copyFleetComposition(value) {
    if (!value)
        return undefined;
    validateFleetComposition(value);
    return create(FleetCompositionSchema, { groups: value.groups.map(group => {
            const d = group.design, h = d.hull;
            return { count: group.count, damagePoints: group.damagePoints, design: { designId: new Uint8Array(d.designId), version: d.version, role: d.role,
                    hull: { hullId: new Uint8Array(h.hullId), version: h.version, assetKey: h.assetKey },
                    hullPoints: d.hullPoints, shieldPoints: d.shieldPoints, attackPoints: d.attackPoints, cargoUnits: d.cargoUnits } };
        }) });
}
export function summarizeComposition(value) {
    if (!value)
        return undefined;
    validateFleetComposition(value);
    return value.groups.map(({ count, damagePoints, design: d }) => ({ count, ...(damagePoints ? { damagePoints: Number(damagePoints) } : {}), design: { id: opaqueIdAt(d.designId), version: d.version, role: d.role,
            hull: { id: opaqueIdAt(d.hull.hullId), version: d.hull.version, assetKey: d.hull.assetKey },
            hullPoints: d.hullPoints, shieldPoints: d.shieldPoints, attackPoints: d.attackPoints, cargoUnits: d.cargoUnits } }));
}
export function copyCompositionSummary(value) {
    return value?.map(group => ({ count: group.count, ...(group.damagePoints ? { damagePoints: group.damagePoints } : {}), design: { ...group.design, hull: { ...group.design.hull } } }));
}
//# sourceMappingURL=fleet-composition.js.map