import { fleetRelationship } from '../contracts/fleet-relationship.js';
import { bindText, setText } from './dom-bindings.js';
export function fleetCardText(fleet) {
    const countdown = fleet.remainingSec == null ? '' : ` · ${fleet.remainingSec}s`;
    const destination = fleet.planetName ? ` → ${fleet.planetName}` : '';
    const action = fleet.action ?? strategicAction(fleet.state);
    const counts = fleet.visualCount == null ? `${fleet.shipCount} ships` : `${fleet.visualCount} drawn / ${fleet.shipCount} ships`;
    const composition = fleet.types?.map(row => `${row.name} ${row.count}`).join(' · ') ?? '';
    return { title: `${fleet.id} · ${fleetRelationship(fleet.relationship).toUpperCase()}`, action: `${action}${destination}`, micro: fleet.micro ?? 'Visual state unavailable',
        state: `${fleet.state}${countdown}`, ships: composition ? `${counts} · ${composition}` : counts };
}
/** Card-owned borrowed text cache. Snapshot inputs may be fresh OR mutated in
 * place. Copy the few displayed scalars, never retain the input as the baseline. */
export function createFleetCardTextCache() {
    const previous = {};
    const values = { title: '', action: '', micro: '', state: '', ships: '' };
    const names = [], counts = [];
    let first = true, composition = '';
    function title(fleet) {
        if (first || fleet.id !== previous.id || fleet.relationship !== previous.relationship) {
            values.title = `${fleet.id} · ${fleetRelationship(fleet.relationship).toUpperCase()}`;
            previous.id = fleet.id;
            previous.relationship = fleet.relationship;
        }
    }
    function action(fleet) {
        const action = fleet.action ?? strategicAction(fleet.state);
        if (first || action !== previous.action || fleet.planetName !== previous.planetName) {
            values.action = action + (fleet.planetName ? ` → ${fleet.planetName}` : '');
            previous.action = action;
            previous.planetName = fleet.planetName;
        }
    }
    function state(fleet) {
        if (first || fleet.state !== previous.state || fleet.remainingSec !== previous.remainingSec) {
            values.state = fleet.state + (fleet.remainingSec == null ? '' : ` · ${fleet.remainingSec}s`);
            previous.state = fleet.state;
            previous.remainingSec = fleet.remainingSec;
        }
    }
    function compositionChanged(types) {
        const length = types?.length ?? 0;
        let changed = length !== names.length;
        for (let i = 0; i < length; i++) {
            const row = types[i];
            if (names[i] !== row.name || counts[i] !== row.count)
                changed = true;
            names[i] = row.name;
            counts[i] = row.count;
        }
        names.length = length;
        counts.length = length;
        return changed;
    }
    function ships(fleet) {
        const changed = compositionChanged(fleet.types);
        if (changed)
            composition = names.map((name, i) => `${name} ${counts[i]}`).join(' · ');
        if (first || changed || fleet.shipCount !== previous.shipCount || fleet.visualCount !== previous.visualCount) {
            const total = fleet.visualCount == null ? `${fleet.shipCount} ships` : `${fleet.visualCount} drawn / ${fleet.shipCount} ships`;
            values.ships = composition ? `${total} · ${composition}` : total;
            previous.shipCount = fleet.shipCount;
            previous.visualCount = fleet.visualCount;
        }
    }
    return { update(fleet) {
            title(fleet);
            action(fleet);
            state(fleet);
            ships(fleet);
            values.micro = fleet.micro ?? 'Visual state unavailable';
            first = false;
            return values;
        } };
}
export function createFleetCard(element) {
    const fields = ['title', 'action', 'micro', 'state', 'ships'];
    const texts = fields.map(key => {
        const row = document.createElement('span');
        row.dataset.fleetCard = key;
        element.append(row);
        return bindText(row, { height: '12px', lineHeight: '12px' });
    });
    const cache = createFleetCardTextCache();
    let tooltipId, tooltipAction = '', tooltipMicro = '', tooltipShips = '';
    return { element, update(fleet) {
            const values = cache.update(fleet);
            for (let i = 0; i < fields.length; i++)
                setText(texts[i], values[fields[i]]);
            if (tooltipId !== fleet.id || tooltipAction !== values.action || tooltipMicro !== values.micro || tooltipShips !== values.ships) {
                element.title = `Select ${fleet.id}. ${values.action}. ${values.micro}. ${values.ships}. Type counts are admitted visual ships.`;
                tooltipId = fleet.id;
                tooltipAction = values.action;
                tooltipMicro = values.micro;
                tooltipShips = values.ships;
            }
        } };
}
export const FLEET_CARD_CSS = `
.ui-button.ui-fleet-row,.fleet-card {display:grid;grid-template-columns:minmax(0,1fr) 45%;grid-template-rows:repeat(4,12px);gap:2px 5px;
 box-sizing:border-box;height:66px;min-height:66px;flex-shrink:0;contain:layout paint;
 content-visibility:auto;contain-intrinsic-size:auto 66px;
 padding:5px 6px;border:1px solid rgba(105,151,192,.22);border-radius:2px;font:9px/1.25 monospace;
 letter-spacing:0;background:rgba(14,27,43,.45);white-space:normal;text-transform:none;}
[data-fleet-card]{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
[data-fleet-card=title]{color:#b2c7df;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
[data-fleet-card=state]{grid-column:2;grid-row:1;color:#708ca9;font-size:8px;}
[data-fleet-card=action],[data-fleet-card=micro],[data-fleet-card=ships]{grid-column:1 / -1;}
[data-fleet-card=action]{color:#a0b7ca;}
[data-fleet-card=micro]{color:#79a9bf;font-size:8px;}
[data-fleet-card=ships]{color:#70889d;font-size:8px;}
`;
function strategicAction(state) { return state === 'jumping' ? 'System transfer' : state === 'cooldown' ? 'Wait for next jump' : 'Awaiting orders'; }
/** Missing rows mean unavailable observations, not zero visual population. */
export function fleetCardObservation(fleet) {
    return { visualCount: fleet?.visualCount, types: fleet?.types ?? [], action: fleet?.action,
        micro: fleet?.micro ?? 'Visual observation unavailable', sampledAt: fleet?.sampledAt };
}
//# sourceMappingURL=fleet-card.js.map