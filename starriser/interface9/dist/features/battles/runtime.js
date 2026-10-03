import { battleTactics } from './script.js';
import { battleOrder, MAX_BATTLES } from './contracts.js';
const PHASES = ['pincer', 'pass', 'pursue', 'evade', 'orbit', 'regroup'];
const PHASE_MS = 12000;
function sameNode(a, b) {
    return a.clusterId === b.clusterId && a.solarSystemId === b.solarSystemId;
}
function validProbe(p) {
    return !!p?.node && [p.attacker, p.defender, p.center].every(v => v &&
        [v.x, v.y, v.z].every(n => Number.isFinite(n) && Math.abs(n) <= 100)) && p.radius >= .005 && p.radius <= .1;
}
function eligible(m, p, battle = 0) {
    return !!m && !m.jumping && sameNode(m.node, p.node) && (m.battle == null || m.battle === battle);
}
function targetSpeed(p) {
    const v = p.defenderVelocity;
    return v && [v.x, v.y, v.z].every(Number.isFinite) ? Math.min(.5, Math.hypot(v.x, v.y, v.z)) : 0;
}
function intercept(p) {
    const v = p.defenderVelocity, speed = targetSpeed(p);
    if (!v || speed === 0)
        return { ...p.defender };
    const k = .75 * speed / Math.hypot(v.x, v.y, v.z);
    return { x: p.defender.x + v.x * k, y: p.defender.y + v.y * k, z: p.defender.z + v.z * k };
}
function axis(p) {
    const x = p.defender.x - p.attacker.x, z = p.defender.z - p.attacker.z, n = Math.hypot(x, z);
    return n > 1e-8 ? { x: x / n, y: 0, z: z / n } : { x: 1, y: 0, z: 0 };
}
/** Offline battle authority. No rendering or ship state. An actual backend can
 * replace this script by publishing the same accepted event timeline. */
export function createBattleRuntime(ports) {
    const rows = new Map();
    let nextId = 1;
    function publish(row) {
        const e = row.event;
        ports.fleets.order(e.attacker, battleOrder(e, 0));
        if (e.stage === 'engaged')
            ports.fleets.order(e.defender, battleOrder(e, 1));
        ports.changed(e);
    }
    function end(id, reason = 'Battle ended') {
        const row = rows.get(id);
        if (!row)
            return;
        rows.delete(id);
        const e = { ...row.event, revision: row.event.revision + 1, stage: 'ended', reason };
        ports.fleets.release(e.attacker, id);
        ports.fleets.release(e.defender, id);
        ports.changed(e);
    }
    function fight(request) {
        const p = request?.probe;
        if (!validProbe(p) || request.attacker === request.defender) {
            ports.rejected('Choose two available fleets in one system');
            return;
        }
        if (rows.size >= MAX_BATTLES) {
            ports.rejected('Battle limit reached');
            return;
        }
        if (!eligible(ports.fleets.member(request.attacker), p) || !eligible(ports.fleets.member(request.defender), p)) {
            ports.rejected('Fleet is warping, already engaged, or outside this system');
            return;
        }
        const now = ports.now();
        const event = { id: nextId++, revision: 1, attacker: request.attacker,
            defender: request.defender, node: { ...p.node }, stage: 'pursuit', phase: 'pincer', tactics: battleTactics('pincer'), pursuitSpeed: targetSpeed(p), at: now, phaseAt: now,
            phaseDuration: PHASE_MS, center: intercept(p), axis: axis(p), radius: p.radius };
        const row = { event, started: now, observed: now, sequence: 0 };
        rows.set(event.id, row);
        publish(row);
        observe({ id: event.id, revision: event.revision, probe: p });
    }
    function observe(observation) {
        const row = rows.get(observation?.id), p = observation?.probe;
        if (!currentObservation(row, observation))
            return;
        const e = row.event, now = ports.now();
        if (!readyForCapture(e, p)) {
            end(e.id, 'Participant unavailable');
            return;
        }
        const distance = Math.hypot(p.attacker.x - p.defender.x, p.attacker.y - p.defender.y, p.attacker.z - p.defender.z);
        const radius = Math.max(e.radius, p.radius);
        if (distance <= radius) {
            row.started = now;
            row.event = { ...e, revision: e.revision + 1, stage: 'engaged', at: now, phaseAt: now,
                center: { ...p.center }, axis: axis(p), radius: p.radius };
            publish(row);
        }
        else if (now - row.observed >= 1000) {
            row.observed = now;
            const goal = intercept(p);
            if (Math.hypot(goal.x - e.center.x, goal.y - e.center.y, goal.z - e.center.z) < .001 && radius - e.radius < .001)
                return;
            row.event = { ...e, revision: e.revision + 1, center: goal, radius, pursuitSpeed: targetSpeed(p) };
            publish(row);
        }
    }
    function currentObservation(row, o) {
        return !!row && row.event.stage === 'pursuit' && row.event.revision === o.revision && validProbe(o.probe);
    }
    function readyForCapture(e, p) {
        return sameNode(e.node, p.node) && eligible(ports.fleets.member(e.attacker), p, e.id) && eligible(ports.fleets.member(e.defender), p);
    }
    function participantGone(e) {
        const a = ports.fleets.member(e.attacker), b = ports.fleets.member(e.defender);
        return !a || !b || a.jumping || b.jumping || !sameNode(a.node, e.node) || !sameNode(b.node, e.node);
    }
    function tick() {
        const now = ports.now();
        // At most eight records, no scan of the galaxy or catch-up event replay.
        for (const row of rows.values()) {
            const e = row.event;
            if (participantGone(e)) {
                end(e.id, 'Participant left');
                continue;
            }
            if (e.stage === 'pursuit') {
                if (ports.fleets.member(e.defender).battle != null)
                    end(e.id, 'Target entered another battle');
                continue;
            }
            const sequence = Math.floor((now - row.started) / PHASE_MS);
            if (sequence === row.sequence)
                continue;
            row.sequence = sequence;
            const phase = PHASES[sequence % PHASES.length];
            row.event = { ...e, revision: e.revision + 1, phase, tactics: battleTactics(phase), phaseAt: row.started + sequence * PHASE_MS };
            publish(row);
        }
    }
    return { fight, observe, tick, end: (p) => end(p.id),
        clear() { for (const id of rows.keys())
            end(id, 'World cleared'); },
        snapshot: () => [...rows.values()].map(row => row.event) };
}
//# sourceMappingURL=runtime.js.map