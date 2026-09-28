/** Player-relative presentation metadata, independent of ship class/color counts. */
export const FLEET_RELATIONSHIPS = ['enemy', 'neutral', 'ally', 'own'];
export const RELATIONSHIP_COLORS = [[1, .22, .25], [1, 1, 1], [.25, .9, .45], [.25, .6, 1]];
export function fleetRelationship(value) {
    return FLEET_RELATIONSHIPS.includes(value) ? value : 'neutral';
}
/** Demo only. Stable across motion/respawn, without consuming the simulation RNG. */
export function demoFleetRelationship(id) {
    let hash = 2166136261;
    for (let i = 0; i < id.length; i++)
        hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
    return FLEET_RELATIONSHIPS[(hash >>> 0) % 4];
}
//# sourceMappingURL=fleet-relationship.js.map