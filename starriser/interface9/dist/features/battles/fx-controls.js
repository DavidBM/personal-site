import { FX_FIELDS, FX_LIMITS, defaultFxProfiles, fxProfiles, scheduleFxTuning, fxTuningState, setFxEnabled } from './fx-tuning.js';
import { FX_GROUPS, FX_HELP } from './fx-control-fields.js';
import { bindText } from '../../ui/dom-bindings.js';
/** Mount once. Input events alone patch text and send small coalesced profiles. */
export function mountBattleFx(parent, actions, selected, updates) {
    const rows = fxProfiles();
    const section = document.createElement('details');
    section.style.cssText = 'flex-shrink:0;margin:8px 0';
    const title = document.createElement('summary');
    title.textContent = 'Weapons and impacts';
    section.append(title);
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.title = 'Enable cosmetic weapons and impacts. Off skips all battle FX GPU work; ships and battles continue.';
    toggle.checked = fxTuningState().enabled;
    const label = document.createElement('label');
    label.style.display = 'block';
    label.append(toggle, document.createTextNode(' Battle FX'));
    section.append(label);
    const hint = document.createElement('p');
    hint.textContent = 'Cosmetic fire. High FX uses 10× the Normal effect limits and admits 50K ships. Counts are per ship; zero disables a weapon. Shared FX budgets may thin dense battles. Widths shrink with distance. Times use simulation seconds. Hover any label, slider or value for its explanation.';
    hint.style.cssText = 'font:inherit;color:#9fb4c9;line-height:1.4';
    section.append(hint);
    let frame = 0;
    const queued = new Map();
    function flush() { frame = 0; const patches = [...queued.values()]; queued.clear(); scheduleFxTuning(patches); actions.setBattleFx?.(patches); }
    function queue(patch) { queued.set(patch.index, { ...queued.get(patch.index), ...patch }); if (!frame)
        frame = requestAnimationFrame(flush); }
    toggle.onchange = () => { setFxEnabled(toggle.checked); actions.setBattleFx?.([], toggle.checked); };
    const inputs = [], values = [];
    for (const group of FX_GROUPS) {
        const body = document.createElement('details');
        body.style.cssText = 'margin:6px 0';
        body.dataset.weaponGroup = group.name;
        const summary = document.createElement('summary');
        summary.textContent = group.name;
        body.append(summary);
        const note = document.createElement('p');
        note.textContent = group.note;
        note.style.cssText = 'font:inherit;color:#9fb4c9;line-height:1.4';
        body.append(note);
        group.fields.forEach(key => {
            const i = FX_FIELDS.indexOf(key), [label, help] = FX_HELP[key];
            const row = document.createElement('label');
            row.style.cssText = 'display:grid;grid-template-columns:138px minmax(0,1fr) 38px;gap:4px;align-items:center;min-height:28px';
            row.title = help;
            row.append(document.createTextNode(label));
            const input = document.createElement('input');
            input.type = 'range';
            input.name = 'fx-' + key;
            input.setAttribute('aria-label', label);
            input.setAttribute('aria-description', help);
            input.title = help;
            input.style.cssText = 'width:100%;min-width:0';
            const [min, max, step] = FX_LIMITS[i];
            input.min = String(min);
            input.max = String(max);
            input.step = String(step);
            const value = document.createElement('span');
            value.title = help;
            const text = bindText(value, { width: '38px', height: '20px' });
            const binding = updates.number(text, { decimals: 3, format: String });
            values[i] = binding;
            inputs[i] = input;
            input.oninput = () => { const index = selected(), n = Number(input.value); rows[index][key] = n; binding.queue(n); queue({ index, [key]: n }); };
            row.append(input, value);
            body.append(row);
        });
        section.append(body);
    }
    parent.append(section);
    function paint() { FX_FIELDS.forEach((key, i) => { const n = rows[selected()][key]; inputs[i].value = String(n); values[i].queue(n); }); }
    return { rows, paint, reset(index) { rows[index] = defaultFxProfiles()[index]; queue({ index, ...rows[index] }); },
        dispose() { for (const binding of values)
            binding.dispose(); if (frame)
            cancelAnimationFrame(frame); queued.clear(); } };
}
//# sourceMappingURL=fx-controls.js.map