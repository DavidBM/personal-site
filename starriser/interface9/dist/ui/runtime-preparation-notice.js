import { bindText, setText, setHidden } from './dom-bindings.js';
export function preparationActive(status) {
    return status.phase === 'preparing' || status.phase === 'checking' || status.phase === 'compiling';
}
/** Wall time may advance while the rendering worker is busy; progress never does. */
export function preparationNoticeText(status, sinceSnapshotMs = 0) {
    const active = preparationActive(status);
    const age = Math.max(0, sinceSnapshotMs);
    const seconds = ((status.elapsedMs + (active ? age : 0)) / 1000).toFixed(1);
    const headings = { preparing: 'Preparing ships', checking: 'Checking GPU shaders', compiling: 'Compiling GPU pipelines',
        ready: 'Ship GPU setup ready', failed: 'Ship preparation failed', cancelled: 'Ship preparation cancelled' };
    const count = status.total == null ? '' : ` · ${status.completed}/${status.total} complete in this stage`;
    const waiting = active && age >= 5000 ? ` · Last runtime update ${(age / 1000).toFixed(0)}s ago` : '';
    const running = active && status.active?.length ? `Pending: ${status.active.map(job => `${job.label} (${((job.elapsedMs + age) / 1000).toFixed(1)}s)`).join(', ')}` : status.label;
    const queued = status.queued ? ` · ${status.queued} queued` : '';
    const detail = status.phase === 'cancelled' ? 'Outstanding GPU work may finish in the background.' : status.error?.split('\n')[0] ?? '';
    return { heading: `${headings[status.phase]} · ${seconds}s elapsed`, detail: `${running}${count}${queued}${waiting}`,
        error: detail, active };
}
/** A preparation observation only: no controls, motion decisions, or busy idle timer. */
export function createRuntimePreparationNotice(parent) {
    const element = document.createElement('div');
    element.id = 'runtime-preparation-notice';
    element.role = 'status';
    element.setAttribute('aria-live', 'polite');
    element.hidden = true;
    element.style.cssText = 'position:fixed;left:50%;bottom:64px;transform:translateX(-50%);z-index:1100;padding:8px 11px;background:#09131fee;border:1px solid #506e89;border-radius:4px;color:#c0d7ec;font:11px/1.4 monospace;width:min(540px,80vw);pointer-events:none';
    const heading = document.createElement('div'), detail = document.createElement('div'), error = document.createElement('div');
    detail.style.cssText = 'font-size:10px;color:#9bb1c6';
    error.style.cssText = 'font-size:10px;color:#edb2a6;overflow-wrap:anywhere';
    detail.style.pointerEvents = 'auto';
    error.style.pointerEvents = 'auto';
    element.append(heading, detail, error);
    parent.append(element);
    const headingText = bindText(heading), detailText = bindText(detail, { height: '4.2em', wrap: true }), errorText = bindText(error, { height: '4.2em', wrap: true });
    let value = null, receivedAt = 0, settledAt = 0, disposed = false;
    let timer;
    function stop() { clearInterval(timer); timer = undefined; }
    function paint() {
        if (!value || disposed)
            return;
        const now = performance.now(), text = preparationNoticeText(value, now - receivedAt);
        const transient = value.phase === 'ready' || value.phase === 'cancelled';
        setHidden(element, transient && now - settledAt >= 3000);
        setText(headingText, text.heading);
        setText(detailText, text.detail);
        setText(errorText, text.error);
        setHidden(error, !text.error);
        if (element.dataset.phase !== value.phase) {
            element.dataset.phase = value.phase;
            element.setAttribute('aria-busy', String(text.active));
        }
        if (element.hidden || value.phase === 'failed')
            stop();
    }
    function settledAndHidden(status) {
        if (!element.hidden || value?.id !== status.id || value.phase !== status.phase)
            return false;
        return status.phase === 'ready' || status.phase === 'cancelled';
    }
    function startTimer() {
        if (!element.hidden && value?.phase !== 'failed' && timer == null)
            timer = setInterval(paint, 250);
    }
    return {
        element,
        update(status) {
            if (disposed)
                return;
            if (!status) {
                value = null;
                setHidden(element, true);
                stop();
                return;
            }
            // Completed notices stay asleep until a new preparation or phase arrives.
            if (settledAndHidden(status))
                return;
            const now = performance.now();
            if (value?.id !== status.id || value?.phase !== status.phase)
                settledAt = now;
            value = status;
            receivedAt = now;
            paint();
            startTimer();
        },
        dispose() { disposed = true; value = null; stop(); element.remove(); },
    };
}
//# sourceMappingURL=runtime-preparation-notice.js.map