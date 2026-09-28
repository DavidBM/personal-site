import { SIMULATION_RATES, DEFAULT_SIMULATION_RATE } from '../contracts/simulation-rate.js';
import { bindOptions, bindText, setText } from './dom-bindings.js';
/** Mount once; the native select and its option text nodes retain identity. */
export function simulationRateControl(actions) {
    const row = document.createElement('label');
    Object.assign(row.style, { display: 'grid', gridTemplateColumns: '62px 110px', alignItems: 'center', height: '22px', contain: 'layout style paint' });
    const label = document.createElement('span');
    setText(bindText(label, { width: '62px', height: '18px', lineHeight: '18px' }), 'Sim Hz');
    const select = document.createElement('select');
    select.id = 'simulation-rate';
    select.setAttribute('aria-label', 'Ship simulation rate');
    Object.assign(select.style, { width: '110px', height: '20px', font: '10px monospace', color: '#b2c7d8', background: '#09131e', border: '1px solid #294051', overflow: 'hidden', contain: 'strict' });
    bindOptions(select).update(SIMULATION_RATES, String, hz => hz === 0 ? 'Every frame' : `${hz} Hz`);
    select.value = String(actions.getSimulationRate?.() ?? DEFAULT_SIMULATION_RATE);
    select.title = 'GPU ship movement update rate. Every frame uses elapsed frame time. Rendering stays independent; fixed rates are limited by rendered frames.';
    select.addEventListener('change', () => actions.setSimulationRate?.(Number(select.value)));
    row.append(label, select);
    return row;
}
//# sourceMappingURL=simulation-rate-control.js.map