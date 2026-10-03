/** One retained presentation lease. World doubles stop here; ship buffers always
 * use the current local frame. This owns no ship poses or secondary runtime. */
export class FollowJourney {
    constructor(id, generation, systemId, count, origin, ownerSystemId = systemId) {
        this.jump = null;
        this.queuedJump = null;
        this.start = null;
        this.end = null;
        this.departureSystemId = null;
        this.departureOrigin = null;
        this.endMs = 0;
        this.beginMs = 0;
        this.lateMs = 0;
        this.completedJump = -1;
        this.fleetId = id;
        this.generation = generation;
        this.ownerSystemId = ownerSystemId;
        this.count = count;
        this.systemId = systemId;
        this.origin = { ...origin };
    }
    observe(state) {
        if (state.state === 'jumping') {
            // Selecting an inbound ship must keep its already-running local warp.
            // Starting a new journey here would first reload the source system.
            if (!this.jump && this.systemId === state.endNode.solarSystemId) {
                this.completedJump = state.startTime;
                this.queuedJump = null;
                return;
            }
            if (state.startTime !== this.completedJump && state.startTime !== this.jump?.startTime)
                this.queuedJump = state;
        }
        else if (this.queuedJump && !(state.state === 'cooldown' && state.node.solarSystemId === this.queuedJump.endNode.solarSystemId)) {
            // A logical arrival may overtake a late physical departure. A replacement
            // local order, however, must not resurrect that cancelled jump later.
            this.queuedJump = null;
        }
    }
    begin(jump, source, destination, position, radius, now) {
        if (this.jump?.startTime === jump.startTime)
            return;
        this.jump = jump;
        this.start = { ...position };
        this.beginMs = now;
        this.departureSystemId = this.systemId;
        this.departureOrigin = { ...this.origin };
        const dx = source.x - destination.x, dz = source.z - destination.z, length = Math.hypot(dx, dz) || 1;
        // Ports cannot overlap on short edges. Arrival still occurs outside the
        // compact system; the ordinary route planner owns the planet approach.
        const extent = Math.min(radius, length * .15);
        this.end = { x: destination.x + dx / length * extent, y: 0, z: destination.z + dz / length * extent };
        this.endMs = Math.max(jump.startTime + jump.durationMs, now + 1000);
        this.lateMs = Math.max(0, this.endMs - jump.startTime - jump.durationMs);
    }
    frame(now, source, destination) {
        if (!this.jump || !this.start || !this.end)
            return { systemId: this.systemId, origin: this.origin };
        const u = Math.max(0, Math.min(1, (now - this.beginMs) / (this.endMs - this.beginMs)));
        // Residency windows must also bound coordinates on long galaxy edges.
        const length = Math.hypot(this.end.x - this.start.x, this.end.z - this.start.z);
        const residencyFraction = Math.min(.16, 128 / Math.max(length, 1));
        // Residency follows the physical departure, which can lag the backend by
        // a hop. Never load the newer logical source underneath the retained ship.
        const leaving = u < residencyFraction;
        const systemId = leaving ? this.departureSystemId : u > 1 - residencyFraction ? this.jump.endNode.solarSystemId : null;
        if (systemId != null)
            return { systemId, origin: leaving ? this.departureOrigin ?? source : destination };
        const point = { x: this.start.x + (this.end.x - this.start.x) * u, z: this.start.z + (this.end.z - this.start.z) * u };
        if (this.systemId == null && Math.hypot(point.x - this.origin.x, point.z - this.origin.z) < 128)
            return { systemId, origin: this.origin };
        return { systemId, origin: { x: Math.round(point.x * 560) / 560, z: Math.round(point.z * 560) / 560 } };
    }
}
//# sourceMappingURL=follow-journey.js.map