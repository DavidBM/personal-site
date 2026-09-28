import { createFleetMovePreview, sceneHeightScale } from './fleet-move-preview.js';
/** A stationary primary hold reserves height editing; ordinary early drags still pan. */
export function createFleetMoveGesture(options) {
    let session = null;
    let timer = null, frame = 0, cancelled = false;
    let preview = null;
    function clear() {
        if (timer != null)
            clearTimeout(timer);
        timer = null;
        if (frame)
            cancelAnimationFrame(frame);
        frame = 0;
        preview?.destroy();
        preview = null;
    }
    function paint() {
        const snapshot = options.snapshot(), current = session;
        if (!snapshot || !current || snapshot.systemId !== current.target.snapshot.systemId) {
            cancel();
            return;
        }
        preview?.draw(snapshot, options.rect(), current.point, current.scale, false);
        frame = requestAnimationFrame(paint);
    }
    function cancel() {
        const active = session != null;
        clear();
        session = null;
        cancelled || (cancelled = active);
        return active;
    }
    return {
        begin(event) {
            cancel();
            cancelled = false;
            const target = options.capture(event);
            if (!target)
                return false;
            session = { target, x: event.clientX, y: event.clientY, height: false, point: { ...target.destination }, scale: sceneHeightScale(target.snapshot, target.destination) };
            timer = setTimeout(() => {
                if (!session)
                    return;
                session.height = true;
                preview = createFleetMovePreview(options.parent);
                paint();
            }, 350);
            return true;
        },
        move(event) {
            if (cancelled)
                return true;
            const current = session;
            if (!current)
                return false;
            if (current.height) {
                current.point.y = Math.max(-100, Math.min(100, (current.y - event.clientY) * current.scale));
                return true;
            }
            if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > 6) {
                clear();
                session = null;
                return false;
            }
            return true;
        },
        end(event) {
            if (cancelled) {
                cancelled = false;
                return true;
            }
            const current = session;
            clear();
            session = null;
            if (!current || (!current.height && !current.target.clickCommit))
                return false;
            // Picking is evaluated at the original ground click, not the dragged height endpoint.
            current.target.commit(current.point, current.x, current.y);
            return true;
        },
        cancel,
    };
}
//# sourceMappingURL=fleet-move-gesture.js.map