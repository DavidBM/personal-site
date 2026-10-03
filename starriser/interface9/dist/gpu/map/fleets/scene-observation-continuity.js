const sameOwner = (previous, next) => previous?.id === next.id && previous.generation === next.generation && previous.systemId === next.systemId;
/** Membership tables may move storage without changing a fleet's coordinate frame. */
export class SceneObservationContinuity {
    constructor() {
        this.owners = new Map();
    }
    reconcile(fleets) {
        const next = new Map(), retained = new Set();
        for (const fleet of fleets) {
            if (!fleet.id || fleet.shipCount <= 0)
                continue;
            const slot = fleet.slot ?? 0;
            const owner = { id: fleet.id, generation: fleet.generation ?? 0, systemId: fleet.ownerSystemId ?? fleet.systemId ?? null };
            const previous = this.owners.get(slot);
            if (sameOwner(previous, owner))
                retained.add(slot);
            next.set(slot, owner);
        }
        this.owners = next;
        return retained;
    }
    clear() { this.owners.clear(); }
}
//# sourceMappingURL=scene-observation-continuity.js.map