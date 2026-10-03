/** Event-only ring. No per-tick allocation or routine UI/worker publication. */
export class FollowEvents {
    constructor() {
        this.rows = new Array(64);
        this.sequence = 0;
    }
    record(atMs, reason, ship, fleet, system) {
        const sequence = ++this.sequence;
        this.rows[(sequence - 1) % this.rows.length] = { sequence, atMs, reason, ship, fleet, system };
    }
    snapshot() {
        const out = [];
        for (let i = Math.max(0, this.sequence - this.rows.length); i < this.sequence; i++)
            out.push({ ...this.rows[i % this.rows.length] });
        return out;
    }
}
//# sourceMappingURL=follow-events.js.map