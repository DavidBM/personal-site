import { mountBattleFx } from './fx-controls.js';
import { bindText, setText } from '../../ui/dom-bindings.js';
import { ensureMicroStyles } from '../../ui/micro.js';
// @ts-expect-error Native presentation module.
import { defaultBattleTuning, battleTuningProfiles, scheduleBattleTuning, BATTLE_TUNING_FIELDS, BATTLE_TUNING_LIMITS } from '../../lib/ship-runtime/battle-tuning.mjs';
import { mountBattleStrategies } from './strategy-controls.js';
// @ts-expect-error Native presentation module.
import { BATTLE_STRATEGIES } from '../../lib/ship-runtime/battle-strategies.mjs';
const names = ['Interceptor', 'Fighter', 'Bomber', 'Frigate', 'Battleship', 'Colossus'];
const labels = ['Speed', 'Cycle · ticks', 'Ship spread', 'Tracking response', 'Ship noise strength', 'Ship noise · ticks', 'Ship vertical ratio', 'Ship noise enabled', 'Squad noise strength', 'Squad noise · ticks', 'Squad vertical ratio', 'Squad noise enabled', 'Squads per class', 'Ship spread height', 'Cohesion', 'Breakaway width', 'Attack pass width'];
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
    hint.textContent = 'Selected class only. Ship spread gives each ship its own stable offset inside the squad, even with noise off. Spread height adds vertical room. Noise adds movement; at strength 1, ship / squad noise spans ±10% / ±16% of battle radius per axis. Periods use simulation ticks.';
    const inputs = [], texts = [];
    let selected = 0, frame = 0;
    const queued = new Map();
    function flush() { frame = 0; const patches = [...queued.values()]; queued.clear(); scheduleBattleTuning(patches); actions.setBattleTuning?.(patches); }
    function queue(patch) { queued.set(patch.index, { ...queued.get(patch.index), ...patch }); if (!frame)
        frame = requestAnimationFrame(flush); }
    function paint() {
        weaponControls.paint();
        strategyControls.paint(rows[selected]);
        BATTLE_TUNING_FIELDS.forEach((key, i) => {
            const v = rows[selected][key];
            inputs[i].value = String(v);
            inputs[i].checked = v > 0;
            setText(texts[i], String(v));
        });
    }
    const strategyControls = mountBattleStrategies(panel.content, patch => {
        Object.assign(rows[selected], patch);
        queue({ index: selected, ...patch });
        strategyControls.paint(rows[selected]);
    });
    const help = document.createElement('details');
    help.style.cssText = 'flex-shrink:0;margin:6px 0';
    const helpTitle = document.createElement('summary');
    helpTitle.textContent = 'Movement and noise · help';
    help.append(helpTitle, hint);
    panel.content.append(help);
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
        input.oninput = () => { const v = toggle ? Number(input.checked) : Number(input.value); rows[selected][key] = v; setText(texts[i], String(v)); queue({ index: selected, [key]: v }); if (key === 'squads')
            strategyControls.paint(rows[selected]); };
    });
    const weaponControls = mountBattleFx(panel.content, actions, () => selected);
    select.onchange = () => { selected = Number(select.value); paint(); };
    function reset(index) { weaponControls.reset(index); rows[index] = { ...defaults[index], strategies: [...defaults[index].strategies] }; queue({ index, ...rows[index] }); }
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
    const disposeCopy = mountSettingsCopy(panel.content, rows, weaponControls.rows);
    const destroy = panel.destroy;
    panel.destroy = () => { weaponControls.dispose(); disposeCopy(); if (frame)
        cancelAnimationFrame(frame); queued.clear(); destroy(); };
    paint();
    return { panel };
}
function mountSettingsCopy(parent, rows, weapons) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'micro-btn';
    button.textContent = 'Copy all settings';
    button.style.cssText = 'margin-top:6px;flex-shrink:0';
    const status = document.createElement('div');
    status.setAttribute('role', 'status');
    const text = bindText(status, { width: '100%', height: '32px', wrap: true });
    const fallback = document.createElement('textarea');
    fallback.readOnly = true;
    fallback.hidden = true;
    fallback.rows = 6;
    fallback.setAttribute('aria-label', 'All battle settings');
    fallback.style.cssText = 'box-sizing:border-box;width:100%;min-height:96px;flex-shrink:0;font:inherit';
    parent.append(button, status, fallback);
    let disposed = false;
    button.onclick = async () => {
        // Read panel rows on click, including edits queued for the next render frame.
        const value = JSON.stringify({ kind: 'galaxy-battle-tuning', version: 5, strategyNames: BATTLE_STRATEGIES,
            classes: Object.fromEntries(names.map((name, i) => [name, { ...rows[i], weapons: weapons[i] }])) }, null, 2);
        button.disabled = true;
        fallback.hidden = true;
        setText(text, 'Copying…');
        try {
            await navigator.clipboard.writeText(value);
            if (!disposed)
                setText(text, 'Copied settings for all 6 classes.');
        }
        catch {
            if (disposed)
                return;
            fallback.value = value;
            fallback.hidden = false;
            fallback.focus();
            fallback.select();
            setText(text, 'Copy blocked. Select and copy the text below.');
        }
        finally {
            if (!disposed)
                button.disabled = false;
        }
    };
    return () => { disposed = true; button.onclick = null; };
}
//# sourceMappingURL=tuning-panel.js.map