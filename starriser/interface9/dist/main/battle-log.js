import { bindText, setHidden, setText } from '../ui/dom-bindings.js';
import { battleRoles, battleStatuses } from './battle-tactical.js';
/** Retained turn log: one row per resolved turn, newest first. A row is
 * written once when its turn arrives and is never rebuilt. */
export function createBattleLog(parent) {
    const section = document.createElement('div'), heading = document.createElement('strong'), note = document.createElement('p');
    const list = document.createElement('ol');
    heading.textContent = 'Turns';
    const noteText = bindText(note, { height: '1.4em' });
    list.setAttribute('aria-label', 'Battle turns');
    list.tabIndex = 0;
    list.style.cssText = 'max-height:16em;overflow:auto;margin:0;padding:0;list-style:none;display:grid;gap:4px;min-width:0';
    section.style.cssText = 'display:grid;gap:4px;max-width:44em;min-width:0';
    section.append(heading, note, list);
    parent.append(section);
    setHidden(section, true);
    const rows = new Map();
    return {
        clear() { for (const row of rows.values())
            row.remove(); rows.clear(); setText(noteText, ''); setHidden(section, true); },
        note(text) { setText(noteText, text); },
        add(turns, fleets) {
            for (const turn of turns) {
                if (rows.has(turn[0]))
                    continue;
                const row = document.createElement('li');
                row.style.cssText = 'content-visibility:auto;contain-intrinsic-size:auto 2.8em;border-top:1px solid #34465a;padding-top:2px';
                setText(bindText(row, { height: '2.8em', wrap: true }), turnText(turn, fleets));
                list.insertBefore(row, list.firstChild);
                rows.set(turn[0], row);
            }
            setHidden(section, rows.size === 0);
        },
        inspect: () => ({ turns: [...rows.keys()] }),
    };
}
/** Fetches only the turns the log has not shown yet, oldest first. */
export function createBattleHistory(log) {
    let battle = '', after = 0, latest = 0, gap = '', owner;
    let fleets = [], request;
    /** False when the server had nothing newer, so the caller does not ask again at once. */
    async function load(controller) {
        while (after < latest && request) {
            const value = await request(battle, after, controller.signal);
            if (owner !== controller)
                return false;
            if (value.from > after)
                gap = `Turns up to ${value.from} are no longer kept.`;
            log.note(gap);
            log.add(value.turns, fleets);
            const last = value.turns[value.turns.length - 1]?.[0] ?? value.from;
            if (last <= after)
                return false;
            after = last;
            latest = Math.max(latest, value.latest);
        }
        return true;
    }
    function start() {
        const controller = owner = new AbortController();
        load(controller).then(progressed => {
            if (owner !== controller)
                return;
            owner = undefined;
            if (progressed && after < latest)
                start();
        }, () => { if (owner === controller) {
            owner = undefined;
            log.note('The turn log is unavailable right now.');
        } });
    }
    function clear() { owner?.abort(); owner = undefined; battle = gap = ''; after = latest = 0; request = undefined; log.clear(); }
    return {
        /** Each accepted page may reveal newer turns; a different battle starts a new log. */
        sync(page, read) {
            if (page.battleId !== battle) {
                clear();
                battle = page.battleId;
            }
            fleets = page.fleets;
            request = read;
            latest = Math.max(latest, Number(page.nextTurn - 1n));
            if (after < latest && !owner)
                start();
        },
        clear,
    };
}
function turnText(turn, fleets) {
    return `Turn ${turn[0]} — ${turn[1].map((row, slot) => fleetText(row, fleets[slot])).join('; ')}`;
}
function fleetText(row, fleet) {
    const name = !fleet ? 'Fleet' : fleet[4] ? `Your fleet ${fleet[0] + 1}` : `Side ${fleet[1] + 1} fleet ${fleet[0] + 1}`;
    const lost = row.slice(3).flatMap((n, role) => n ? [`${n.toLocaleString()} ${battleRoles[role]}`] : []);
    const status = row[0] === 0 ? '' : `, ${battleStatuses[row[0]].toLowerCase()}${row[0] === 1 ? ` (${row[1]} exposed turn${row[1] === 1 ? '' : 's'} left)` : ''}`;
    return `${name} lost ${lost.length ? lost.join(', ') : 'nothing'}, ${row[2].toLocaleString()} left${status}`;
}
//# sourceMappingURL=battle-log.js.map