import { createUpdateQueue } from './dom-update-queue.js';
function displayNumber(value, scale) {
    if (!Number.isFinite(value))
        return NaN;
    const scaled = value * scale;
    // At this magnitude the requested decimal places are already below the ULP.
    const rounded = Number.isFinite(scaled) ? Math.round(scaled) / scale : value;
    return rounded === 0 ? 0 : rounded;
}
function textBinding(queue, node) {
    let target = node, pending = node.data, staged = pending, committed = pending;
    const job = queue.job(() => { staged = pending; }, () => {
        if (!target || staged === committed)
            return;
        target.data = staged;
        committed = staged;
        queue.metrics.writes++;
    });
    return {
        ...job,
        queue(value) { if (value === pending)
            return; pending = value; job.invalidate(); },
        // Explicit escape hatch after an external DOM mutation.
        invalidate() { if (target)
            committed = target.data; job.invalidate(); },
        dispose() { job.dispose(); target = null; },
    };
}
function numberBinding(queue, node, options = {}) {
    const decimals = options.decimals ?? 0;
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 10)
        throw new RangeError('decimals must be 0–10');
    const scale = 10 ** decimals;
    const format = options.format ?? (value => Number.isFinite(value) ? value.toFixed(decimals) : '—');
    let target = node, pending = NaN, staged = NaN, committed = NaN;
    let hasPending = false, valid = false, text = node.data;
    const job = queue.job(() => { staged = pending; }, () => {
        const value = displayNumber(staged, scale);
        if (!target || (valid && Object.is(committed, value)))
            return;
        const next = format(value);
        queue.metrics.formats++;
        if (text !== next) {
            target.data = next;
            text = next;
            queue.metrics.writes++;
        }
        committed = value;
        valid = true;
    });
    return {
        ...job,
        queue(value) { if (hasPending && Object.is(pending, value))
            return; hasPending = true; pending = value; job.invalidate(); },
        invalidate() { valid = false; if (target)
            text = target.data; job.invalidate(); },
        dispose() { job.dispose(); target = null; },
    };
}
export function createDomUpdates(options = {}) {
    const queue = createUpdateQueue(options);
    return {
        ...queue,
        text(node) { return textBinding(queue, node); },
        number(node, format) { return numberBinding(queue, node, format); },
    };
}
//# sourceMappingURL=dom-updates.js.map