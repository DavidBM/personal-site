import { GPU_BUDGETS, gpuBudgetMode } from '../contracts/gpu-budget.js';
/** Configure once before resource creation in this render worker. */
let mode = 'standard';
export function configureRenderBudget(value) { mode = gpuBudgetMode(value); }
export function renderBudget() { return GPU_BUDGETS[mode]; }
export function compactRenderBudget() { return mode === 'compact'; }
//# sourceMappingURL=render-budget.js.map