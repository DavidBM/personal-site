import { BATTLE_PHASE_MS, BATTLE_PHASES, battleTactics } from '../../features/battles/script.js';
/** Bounded cosmetic ownership of accepted participant allocations. Counts and
 * status are authoritative; choreography and a public cosmetic seed are local:
 * the offline phase cycle (BATTLE_PHASES, a new phase and tactics every
 * BATTLE_PHASE_MS from the first bind, on a local timer between server turns),
 * so fire and manoeuvres stay continuous while turns arrive every tickMs.
 * `clock` reads the same wall clock as the `now` passed to sync. */
export function createBattleVisuals(existing, release, finished = () => { }, clock = () => Date.now()) {
    let page, center, axis = { x: 1, y: 0, z: 0 }, radius = .018;
    let started, lastNode, phaseTimer;
    const leased = new Map(), bound = new Map(), initial = new Map();
    let timer, appliedPlans = [0, 0, 0, 0, 0, 0];
    const visual = (id) => existing(id) ?? leased.get(id);
    function clear() {
        clearTimeout(timer);
        timer = undefined;
        clearTimeout(phaseTimer);
        phaseTimer = undefined;
        started = undefined;
        lastNode = undefined;
        for (const v of bound.values())
            if (v.state.state === 'awaiting' && v.state.battle?.authoritative)
                v.state = { state: 'awaiting', node: v.state.node };
        for (const v of leased.values())
            release(v);
        page = undefined;
        center = undefined;
        leased.clear();
        bound.clear();
        initial.clear();
        appliedPlans = [0, 0, 0, 0, 0, 0];
    }
    function set(value) {
        if (!value) {
            clear();
            return;
        }
        if (page && page.battleId !== value.battleId)
            clear();
        if (page && value.revision < page.revision)
            return;
        if (page && value.nextTurn > page.nextTurn)
            appliedPlans = page.strategies;
        page = value;
    }
    function geometry() {
        if (center || !page?.visuals)
            return;
        const points = page.visuals.map(([id]) => visual(id)?.remote).filter((v) => !!v);
        if (points.length < 2)
            return;
        center = { x: 0, y: 0, z: 0 };
        for (const p of points) {
            center.x += p.x / points.length;
            center.y += p.y / points.length;
            center.z += p.z / points.length;
        }
        const a = points[0], b = points[1], d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) || 1;
        axis = { x: (b.x - a.x) / d, y: (b.y - a.y) / d, z: (b.z - a.z) / d };
        radius = Math.max(.018, ...points.map(p => Math.hypot(p.x - center.x, p.y - center.y, p.z - center.z) + .018));
    }
    function order(slot, v, node, now) {
        if (!page?.visuals || !center)
            return;
        const row = page.fleets[slot], other = opposing(row[1]);
        const counts = page.visuals[slot][1], base = initial.get(page.visuals[slot][0]), { sequence, phase, start } = localPhase(now);
        return { id: cosmeticId(page.battleId), revision: orderRevision(page.revision, sequence), attacker: v.id, defender: other?.id ?? '', node,
            stage: 'engaged', phase, tactics: battleTactics(phase), at: start, phaseAt: start + sequence * BATTLE_PHASE_MS, phaseDuration: BATTLE_PHASE_MS, center, axis, radius,
            side: row[1], opponent: other?.id ?? '', authoritative: { fractions: counts.map((n, k) => base[k] ? Math.min(1, n / base[k]) : 0),
                strategies: slot === page.selectedSlot ? appliedPlans : [0, 0, 0, 0, 0, 0], retreat: row[2] === 1 || row[2] === 2 } };
    }
    function opposing(side) {
        const opponent = page?.fleets.find(r => r[1] !== side && r[2] <= 1);
        return opponent && page?.visuals ? visual(page.visuals[opponent[0]][0]) : undefined;
    }
    function phaseSequence(now) { return Math.max(0, Math.floor((now - (started ?? now)) / BATTLE_PHASE_MS)); }
    function localPhase(now) { const sequence = phaseSequence(now); return { sequence, phase: BATTLE_PHASES[sequence % BATTLE_PHASES.length], start: started ?? now }; }
    function unchanged(id, v, revision) {
        const old = v.state.state === 'awaiting' ? v.state.battle : undefined;
        return bound.get(id) === v && !!old?.authoritative && old.revision === revision;
    }
    function bind(slot, id, counts, node, now) {
        const v = visual(id);
        if (!v || !page)
            return;
        if (!initial.has(id))
            initial.set(id, v.counts.classes ?? counts);
        if (unchanged(id, v, orderRevision(page.revision, phaseSequence(now))))
            return;
        const b = order(slot, v, node, now);
        if (!b)
            return;
        bound.set(id, v);
        v.pendingMove = undefined;
        v.state = { state: 'awaiting', node, battle: b, localMove: { revision: 1, orderId: -b.id * 2 - 1, destination: b.center } };
    }
    function sync(node, now) {
        if (!page?.visuals)
            return;
        geometry();
        lastNode = node;
        if (center && started === undefined)
            started = now;
        for (const [slot, [id, counts]] of page.visuals.entries())
            bind(slot, id, counts, node, now);
        if (page.finished && !timer)
            timer = setTimeout(() => { const ids = page?.visuals?.map(r => r[0]) ?? []; clear(); finished(ids); }, 1500);
        clearTimeout(phaseTimer);
        phaseTimer = undefined;
        if (!page.finished && started !== undefined) {
            const next = started + (phaseSequence(now) + 1) * BATTLE_PHASE_MS;
            phaseTimer = setTimeout(() => { phaseTimer = undefined; if (lastNode)
                sync(lastNode, clock()); }, Math.max(50, next - now));
        }
    }
    function path(fleet, p) {
        const counts = page?.visuals?.find(row => row[0] === fleet.id)?.[1];
        if (!counts)
            return p;
        const total = counts.reduce((a, b) => a + b, 0);
        if (!total)
            return p;
        return { ...p, appearance: { totalShips: total, hullCounts: counts, placeholder: false } };
    }
    return { set, sync, path, clear, ids: () => page?.visuals?.map(r => r[0]) ?? [], visual: (id) => leased.get(id),
        // Participants keep the allocation the player already sees from the moment
        // the page names them: losses apply to it, it is never rebuilt for the battle.
        protects: (id) => bound.has(id) || !!page?.visuals?.some(row => row[0] === id),
        handoff(id, v) { if (!bound.has(id) || leased.has(id))
            return false; leased.set(id, v); return true; },
        restore(id) { const v = leased.get(id); if (v) {
            leased.delete(id);
            bound.delete(id);
        } return v; },
        entries: () => leased.entries() };
}
/** Page revision and local phase together: either one changing rewrites the order. */
function orderRevision(revision, sequence) { return Number((revision * 1000000n + BigInt(sequence)) % 4294967295n); }
function cosmeticId(id) { let n = 2166136261; for (let i = 0; i < id.length; i++)
    n = Math.imul(n ^ id.charCodeAt(i), 16777619); return (n >>> 0) % 16777214 + 1; }
//# sourceMappingURL=battle-visuals.js.map