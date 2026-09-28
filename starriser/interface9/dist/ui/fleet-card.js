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
export function createFleetCard(element) {
    const fields = ['title', 'action', 'micro', 'state', 'ships'];
    const texts = fields.map(key => {
        const row = document.createElement('span');
        row.dataset.fleetCard = key;
        element.append(row);
        return bindText(row, { height: '12px', lineHeight: '12px' });
    });
    return { element, update(fleet) {
            const values = fleetCardText(fleet);
            fields.forEach((key, index) => setText(texts[index], values[key]));
            const title = `Select ${fleet.id}. ${values.action}. ${values.micro}. ${values.ships}. Type counts are admitted visual ships.`;
            if (element.title !== title)
                element.title = title;
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