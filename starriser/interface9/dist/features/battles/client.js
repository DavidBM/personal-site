import { BattleTopics, MAX_BATTLES } from './contracts.js';
import { publishFeatureTopic, subscribeFeatureTopic } from '../../worker/protocol/feature-topics.js';
/** One outstanding fleet-only query, round-robin at four probes/second TOTAL.
 * This timer does no work while idle and never enumerates ships or the galaxy. */
export function createBattleClient(bus, probe, notice) {
    const rows = new Map();
    let timer = null;
    let closed = false, cursor = 0, busy = false;
    function schedule() { if (!closed && timer == null && rows.size)
        timer = setTimeout(() => { timer = null; void sample(); }, 250); }
    async function sample() {
        if (closed || busy)
            return;
        const list = [...rows.values()].filter(e => e.stage === 'pursuit');
        if (!list.length)
            return;
        const e = list[cursor++ % list.length];
        busy = true;
        try {
            const p = await probe(e.attacker, e.defender);
            if (p && !closed && rows.get(e.id) === e)
                publishFeatureTopic(bus, BattleTopics.observe, { id: e.id, revision: e.revision, probe: p });
        }
        catch { /* A scene switch discards this observation, never cancels a battle. */ }
        finally {
            busy = false;
            schedule();
        }
    }
    const off = subscribeFeatureTopic(bus, BattleTopics.changed, e => {
        const old = rows.get(e.id);
        if (old && old.revision >= e.revision)
            return;
        if (e.stage === 'ended')
            rows.delete(e.id);
        else if (rows.has(e.id) || rows.size < MAX_BATTLES)
            rows.set(e.id, e);
        notice(e.stage === 'ended' ? e.reason ?? 'Battle ended' : e.stage === 'pursuit' ? 'Intercepting fleet' : `Battle · ${e.phase}`);
        schedule();
    });
    const reject = subscribeFeatureTopic(bus, BattleTopics.rejected, e => notice(e.reason));
    return {
        async fight(attacker, defender) {
            try {
                const p = await probe(attacker, defender);
                if (closed)
                    return;
                if (p)
                    publishFeatureTopic(bus, BattleTopics.fight, { attacker, defender, probe: p });
                else
                    notice('Both fleets must be present and out of warp');
            }
            catch {
                if (!closed)
                    notice('Fleet observation unavailable · try again');
            }
        },
        end(id) { publishFeatureTopic(bus, BattleTopics.end, { id }); },
        dispose() { closed = true; if (timer != null)
            clearTimeout(timer); off(); reject(); rows.clear(); },
    };
}
//# sourceMappingURL=client.js.map