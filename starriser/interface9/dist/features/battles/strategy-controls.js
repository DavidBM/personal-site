// @ts-expect-error Native presentation module.
import { BATTLE_STRATEGIES } from '../../lib/ship-runtime/battle-strategies.mjs';
const classes = ['Automatic', 'Interceptor', 'Fighter', 'Bomber', 'Frigate', 'Battleship', 'Colossus'];
const descriptions = [
    'Mixed guards, bomber escorts and strike runs; capitals cruise slowly.',
    'Slow cruise around your side of the encounter.',
    'Protect a friendly squad, intercept nearby enemies, then return.',
    'Protect bombers during their runs. Falls back to heavier squads if absent.',
    'Leave the friendly anchor, pass the enemy and curl back.',
    'Follow a moving enemy squad.', 'Pull away from the assigned enemy squad.',
    'Circle the assigned enemy squad in a tilted orbit.', 'Fly through the enemy and curl around.',
    'Split opposing wings, cross and pull out repeatedly.', 'Circle a regroup point on your side.',
    'Orbit a friendly squad continuously, without interception.',
];
/** Retained controls; changing class or squad count only patches properties. */
export function mountBattleStrategies(parent, edit) {
    const section = document.createElement('section');
    section.style.cssText = 'margin:8px 0;flex-shrink:0';
    parent.append(section);
    let profile;
    const all = selectRow(section, 'All squads', BATTLE_STRATEGIES, 'battle-strategy-all');
    const mixed = document.createElement('option');
    mixed.value = 'mixed';
    mixed.textContent = 'Mixed strategies';
    mixed.disabled = true;
    all.prepend(mixed);
    const hint = document.createElement('p');
    hint.style.cssText = 'min-height:42px;margin:4px 0;line-height:1.4;color:#9fb4c9';
    section.append(hint);
    const anchor = selectRow(section, 'Friendly class', classes, 'battle-anchor-class');
    const target = selectRow(section, 'Enemy class', classes, 'battle-target-class');
    anchor.title = 'Friendly orbit, guards and strike returns use this class. Applies to all squads of the selected class.';
    target.title = 'Attacks use this enemy class. Applies to all squads of the selected class.';
    const fallback = document.createElement('p');
    fallback.textContent = 'Missing classes fall back automatically.';
    fallback.style.cssText = 'margin:4px 0;color:#9fb4c9;line-height:1.4';
    section.append(fallback);
    const details = document.createElement('details');
    const title = document.createElement('summary');
    title.textContent = 'Individual squad strategies';
    details.append(title);
    section.append(details);
    const squads = Array.from({ length: 16 }, (_, i) => {
        const control = selectRow(details, `Squad ${i + 1}`, BATTLE_STRATEGIES, `battle-strategy-${i}`);
        control.onchange = () => { const values = [...profile.strategies]; values[i] = Number(control.value); edit({ strategies: values }); };
        return control;
    });
    all.onchange = () => edit({ strategies: Array(16).fill(Number(all.value)) });
    anchor.onchange = () => edit({ anchorClass: Number(anchor.value) });
    target.onchange = () => edit({ targetClass: Number(target.value) });
    return { paint(row) {
            profile = row;
            const first = row.strategies[0];
            const uniform = row.strategies.slice(0, row.squads).every(v => v === first);
            all.value = uniform ? String(first) : 'mixed';
            hint.textContent = uniform ? descriptions[first] : 'Each active squad uses its selected strategy. Open individual squads to edit the mix.';
            anchor.value = String(row.anchorClass);
            target.value = String(row.targetClass);
            squads.forEach((control, i) => { control.value = String(row.strategies[i]); control.disabled = i >= row.squads; control.parentElement.style.opacity = i >= row.squads ? '.4' : '1'; });
        } };
}
function selectRow(parent, label, options, name) {
    const row = document.createElement('label');
    row.style.cssText = 'display:grid;grid-template-columns:94px minmax(0,1fr);gap:4px;align-items:center;min-height:30px';
    row.append(document.createTextNode(label));
    const control = document.createElement('select');
    control.className = 'ui-select';
    control.name = name;
    control.setAttribute('aria-label', label);
    control.style.cssText = 'min-width:0;width:100%;font:inherit';
    options.forEach((text, i) => { const option = document.createElement('option'); option.value = String(i); option.textContent = text; control.append(option); });
    row.append(control);
    parent.append(row);
    return control;
}
//# sourceMappingURL=strategy-controls.js.map