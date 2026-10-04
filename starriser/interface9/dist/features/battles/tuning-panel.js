import { bindText, setText } from '../../ui/dom-bindings.js';
import { ensureMicroStyles } from '../../ui/micro.js';
// @ts-expect-error Native presentation module.
import { defaultBattleTuning, battleTuningProfiles, scheduleBattleTuning, BATTLE_TUNING_FIELDS, BATTLE_TUNING_LIMITS } from '../../lib/ship-runtime/battle-tuning.mjs';
const names = ['Interceptor', 'Fighter', 'Bomber', 'Frigate', 'Battleship', 'Colossus'];
const labels = ['Speed', 'Cycle · ticks', 'Stream spread', 'Tracking response', 'Ship noise strength', 'Ship noise · ticks', 'Ship vertical ratio', 'Ship noise enabled', 'Squad noise strength', 'Squad noise · ticks', 'Squad vertical ratio', 'Squad noise enabled', 'Squads per class', 'Stream height ratio', 'Cohesion', 'Breakaway width', 'Attack pass width'];
export function buildBattleTuningPanel(ctx, actions) {
    ensureMicroStyles();
    const panel = ctx.panel({ id: 'battle-tuning-panel', title: 'Battle', width: 290, className: 'micro' });
    panel.element.style.background = '#050c17f7';
    panel.content.style.fontSize = '11px';
    const rows = battleTuningProfiles(), defaults = defaultBattleTuning();
    const select = document.createElement('select');
    select.className = 'ui-select';
    select.setAttribute('aria-label', 'Battle ship class');
    select.style.cssText = 'width:100%;font:inherit';
    names.forEach((name, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = name; select.append(o); });
    panel.content.append(select);
    const hint = document.createElement('p');
    hint.style.cssText = 'margin:6px 0;color:#9fb4c9;font:inherit;line-height:1.4';
    hint.textContent = 'Selected class only. At strength 1, ship / squad noise spans ±10% / ±16% of battle radius per axis. Periods use simulation ticks.';
    panel.content.append(hint);
    const inputs = [], texts = [];
    let selected = 0, frame = 0;
    const queued = new Map();
    function flush() { frame = 0; const patches = [...queued.values()]; queued.clear(); scheduleBattleTuning(patches); actions.setBattleTuning?.(patches); }
    function queue(patch) { queued.set(patch.index, { ...queued.get(patch.index), ...patch }); if (!frame)
        frame = requestAnimationFrame(flush); }
    function paint() {
        BATTLE_TUNING_FIELDS.forEach((key, i) => {
            const v = rows[selected][key];
            inputs[i].value = String(v);
            inputs[i].checked = v > 0;
            setText(texts[i], String(v));
        });
    }
    BATTLE_TUNING_FIELDS.forEach((key, i) => {
        const label = document.createElement('label');
        label.style.cssText = 'display:grid;grid-template-columns:138px minmax(0,1fr) 42px;gap:4px;align-items:center;min-height:28px;flex-shrink:0';
        label.append(document.createTextNode(labels[i]));
        const input = document.createElement('input');
        const toggle = key.endsWith('Enabled');
        input.type = toggle ? 'checkbox' : 'range';
        input.min = String(BATTLE_TUNING_LIMITS[i][0]);
        input.max = String(BATTLE_TUNING_LIMITS[i][1]);
        input.step = key === 'squads' || key.endsWith('Ticks') || key.endsWith('Period') ? '1' : '.05';
        input.style.cssText = `width:${toggle ? '14px' : '100%'};min-width:0;margin:0;accent-color:#86cfff`;
        input.name = key;
        const value = document.createElement('span');
        texts.push(bindText(value, { width: '42px', height: '20px' }));
        inputs.push(input);
        label.append(input, value);
        panel.content.append(label);
        input.oninput = () => { const v = toggle ? Number(input.checked) : Number(input.value); rows[selected][key] = v; setText(texts[i], String(v)); queue({ index: selected, [key]: v }); };
    });
    select.onchange = () => { selected = Number(select.value); paint(); };
    function reset(index) { rows[index] = { ...defaults[index] }; queue({ index, ...rows[index] }); }
    const buttons = document.createElement('div');
    buttons.className = 'micro-actions';
    panel.content.append(buttons);
    for (const [label, all] of [['Reset class', false], ['Reset all', true]]) {
        const b = document.createElement('button');
        b.className = 'micro-btn';
        b.textContent = label;
        b.onclick = () => { if (all)
            for (let i = 0; i < 6; i++)
                reset(i);
        else
            reset(selected); paint(); };
        buttons.append(b);
    }
    const destroy = panel.destroy;
    panel.destroy = () => { if (frame)
        cancelAnimationFrame(frame); queued.clear(); destroy(); };
    paint();
    return { panel };
}
//# sourceMappingURL=tuning-panel.js.map