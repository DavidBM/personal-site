import { gpuBudgetMode } from '../contracts/gpu-budget.js';
const KEY = 'galaxy.gpuBudget';
export function readGpuBudget() {
    const query = typeof location === 'undefined' ? null : new URL(location.href).searchParams.get('gpuBudget');
    if (query === 'standard' || query === 'compact')
        return query;
    try {
        return gpuBudgetMode(globalThis.localStorage?.getItem(KEY));
    }
    catch {
        return 'standard';
    }
}
export function gpuBudgetReloadUrl(mode, href) {
    // URL is authoritative even when browser storage is disabled; no retry loop.
    const url = new URL(href);
    url.searchParams.set('gpuBudget', mode);
    return url.href;
}
export function saveGpuBudget(mode) {
    try {
        globalThis.localStorage?.setItem(KEY, mode);
    }
    catch { /* URL carries the choice. */ }
}
//# sourceMappingURL=gpu-budget-settings.js.map