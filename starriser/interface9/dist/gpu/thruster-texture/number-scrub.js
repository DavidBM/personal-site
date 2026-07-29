/**
 * Vertical mouse-scrub for numeric fields (creative-tool style).
 * Drag up (negative screen Δy) increases; drag down decreases.
 * Pure — UI wires pointer events; tests call this directly.
 */
/** Infer decimal places from step so 0.05 stays on the step grid. */
export function decimalsFromStep(step) {
    if (!(step > 0) || !Number.isFinite(step))
        return 0;
    const s = step.toString().toLowerCase();
    if (s.includes("e-")) {
        const exp = Number(s.split("e-")[1]);
        return Number.isFinite(exp) ? exp : 0;
    }
    const i = s.indexOf(".");
    return i < 0 ? 0 : s.length - i - 1;
}
/**
 * @param startValue value at pointerdown
 * @param deltaY clientY − startY (up is negative)
 * @param bounds min/max/step from the input
 * @param pixelsPerStep screen px per one `step` (smaller = faster scrub)
 * @param sensitivity multiplies effective step (e.g. Shift → 0.1, Alt → 10)
 */
export function applyVerticalScrub(startValue, deltaY, bounds, pixelsPerStep = 4, sensitivity = 1) {
    const step = bounds.step > 0 && Number.isFinite(bounds.step) ? bounds.step : 1;
    const pps = pixelsPerStep > 0 ? pixelsPerStep : 4;
    const sens = Number.isFinite(sensitivity) && sensitivity !== 0 ? sensitivity : 1;
    // Drag up → negative deltaY → positive delta value
    const steps = -deltaY / pps;
    let v = startValue + steps * step * sens;
    const dec = decimalsFromStep(step * (sens < 1 ? sens : 1));
    // Snap to the base step grid (not sensitivity-scaled) for stable typing later
    const grid = step;
    const inv = 1 / grid;
    v = Math.round(v * inv) / inv;
    // Extra decimal clamp for float noise when sens is fractional
    const d = Math.max(decimalsFromStep(step), dec);
    const f = 10 ** d;
    v = Math.round(v * f) / f;
    if (Number.isFinite(bounds.min))
        v = Math.max(bounds.min, v);
    if (Number.isFinite(bounds.max))
        v = Math.min(bounds.max, v);
    return v;
}
export function parseInputBounds(el) {
    const stepAttr = el.step;
    let step = 1;
    if (stepAttr && stepAttr !== "any") {
        const s = Number(stepAttr);
        if (Number.isFinite(s) && s > 0)
            step = s;
    }
    const min = el.min !== "" ? Number(el.min) : -Infinity;
    const max = el.max !== "" ? Number(el.max) : Infinity;
    return {
        min: Number.isFinite(min) ? min : -Infinity,
        max: Number.isFinite(max) ? max : Infinity,
        step,
    };
}
//# sourceMappingURL=number-scrub.js.map