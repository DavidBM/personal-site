import { bindText, bindOptions, setText } from './dom-bindings.js';
import { readGpuBudget, saveGpuBudget, gpuBudgetReloadUrl } from '../main/gpu-budget-settings.js';
import { gpuBudgetMode } from '../contracts/gpu-budget.js';
export function gpuBudgetControl() {
    const row = document.createElement('label');
    row.className = 'quality-select-row';
    Object.assign(row.style, { display: 'grid', gridTemplateColumns: '62px 110px', height: '30px', alignItems: 'center', contain: 'layout style paint' });
    const label = document.createElement('span');
    setText(bindText(label, { width: '62px', height: '18px' }), 'GPU budget');
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'GPU memory budget');
    Object.assign(select.style, { width: '110px', height: '28px', font: '10px monospace', color: '#b2c7d8', background: '#09131e' });
    bindOptions(select).update(['standard', 'compact'], String, value => value === 'standard' ? 'Normal · auto' : 'Low · 2K / 32');
    select.value = readGpuBudget();
    select.title = 'Reloads and resets the demo. Normal retries once in Low memory after GPU allocation failure. Low: 2K ships / 32 scene fleets, half resolution, no MSAA/glow, preview planet textures.';
    select.addEventListener('change', () => {
        const mode = gpuBudgetMode(select.value);
        saveGpuBudget(mode);
        location.replace(gpuBudgetReloadUrl(mode, location.href));
    });
    row.append(label, select);
    return row;
}
//# sourceMappingURL=gpu-budget-control.js.map