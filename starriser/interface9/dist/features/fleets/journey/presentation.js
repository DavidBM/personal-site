export function presentJourney(view, nowMs) {
    validate(view, nowMs);
    const canCancel = !view.cancelRequested;
    switch (view.phase.phase) {
        case 'ready': {
            if (view.completedLegs === view.totalLegs)
                return { label: 'Preparing final destination approach', canCancel };
            const remainingMs = view.phase.readyMs > nowMs ? view.phase.readyMs - nowMs : 0n;
            return { label: remainingMs > 0n ? 'Jump drive cooling down' : 'Ready for next jump', remainingMs, canCancel };
        }
        case 'arriving': return { label: view.cancelRequested ? 'Finishing destination approach' : 'Approaching final destination', canCancel };
        case 'approaching': return { label: view.cancelRequested ? 'Finishing gate approach' : 'Approaching departure gate', canCancel };
        case 'dispatching':
            return { label: view.cancelRequested ? 'Finishing current jump order' : 'Preparing jump', canCancel };
        case 'transit':
            return transit(view.phase, nowMs, view.cancelRequested);
        case 'completed': return { label: 'Journey completed', canCancel: false };
        case 'cancelled': return { label: 'Journey cancelled', canCancel: false };
        case 'failed': return { label: 'Route stopped', canCancel: false };
    }
}
function transit(phase, now, cancelled) {
    const remainingMs = phase.arrivalMs > now ? phase.arrivalMs - now : 0n;
    const elapsed = now > phase.departureMs ? now - phase.departureMs : 0n;
    const duration = phase.arrivalMs - phase.departureMs;
    const progress = Number(elapsed > duration ? duration : elapsed) / Number(duration);
    const flying = cancelled ? 'Finishing current jump' : 'Jumping';
    return { label: remainingMs > 0n ? flying : 'Awaiting arrival confirmation', progress, remainingMs, canCancel: !cancelled };
}
function validate(view, now) {
    if (now < 0n || !Number.isInteger(view.totalLegs) || view.totalLegs < 1 || view.totalLegs > 1024)
        throw new Error('Invalid journey view');
    if (!Number.isInteger(view.completedLegs) || view.completedLegs < 0 || view.completedLegs > view.totalLegs)
        throw new Error('Invalid journey progress');
    validatePhase(view.phase);
}
function validatePhase(phase) {
    if (phase.phase === 'transit' && (phase.departureMs < 0n || phase.arrivalMs <= phase.departureMs))
        throw new Error('Invalid accepted jump');
    if (phase.phase === 'ready' && phase.readyMs < 0n)
        throw new Error('Invalid jump readiness');
}
//# sourceMappingURL=presentation.js.map