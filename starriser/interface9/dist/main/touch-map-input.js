/** Deltas describe one gesture; no camera or selection state lives on the main thread. */
export function touchPairDelta(a, b, nextA, nextB) {
    const distance = Math.max(8, Math.hypot(b.x - a.x, b.y - a.y));
    const nextDistance = Math.max(8, Math.hypot(nextB.x - nextA.x, nextB.y - nextA.y));
    const angle = Math.atan2(nextB.y - nextA.y, nextB.x - nextA.x) - Math.atan2(b.y - a.y, b.x - a.x);
    return { zoom: distance / nextDistance, yaw: Math.atan2(Math.sin(angle), Math.cos(angle)),
        pitch: ((nextA.y + nextB.y) - (a.y + b.y)) * 0.0025 };
}
export function installTouchMapInput(canvas, actions) {
    const points = new Map();
    let start = null, moved = false, multi = false, startedAt = 0;
    const point = (e) => ({ x: e.clientX, y: e.clientY });
    const down = (e) => {
        if (e.pointerType !== 'touch')
            return;
        e.preventDefault();
        canvas.setPointerCapture(e.pointerId);
        if (!points.size) {
            start = point(e);
            moved = false;
            multi = false;
            startedAt = performance.now();
            actions.begin();
        }
        points.set(e.pointerId, point(e));
        if (points.size > 1)
            multi = true;
    };
    const move = (e) => {
        if (!points.has(e.pointerId))
            return;
        e.preventDefault();
        const entries = [...points.entries()], old = points.get(e.pointerId);
        const next = point(e);
        points.set(e.pointerId, next);
        if (points.size > 2)
            return;
        const rect = canvas.getBoundingClientRect();
        if (points.size === 2) {
            const [idA, a] = entries[0], [idB, b] = entries[1];
            const na = points.get(idA), nb = points.get(idB);
            actions.gesture({ type: 'touchGesture', x: (na.x + nb.x) / 2 - rect.left, y: (na.y + nb.y) / 2 - rect.top,
                dx: 0, dy: 0, ...touchPairDelta(a, b, na, nb) });
            moved = true;
            return;
        }
        if (!moved && start && Math.hypot(next.x - start.x, next.y - start.y) < 6)
            return;
        moved = true;
        actions.gesture({ type: 'touchGesture', x: next.x - rect.left, y: next.y - rect.top,
            dx: next.x - old.x, dy: next.y - old.y, zoom: 1, yaw: 0, pitch: 0 });
    };
    const up = (e) => {
        if (!points.delete(e.pointerId))
            return;
        e.preventDefault();
        if (e.type === 'pointerup' && !points.size && !moved && !multi && performance.now() - startedAt < 500)
            actions.tap(e.clientX, e.clientY);
        if (e.type !== 'pointerup')
            moved = true;
        if (canvas.hasPointerCapture(e.pointerId))
            canvas.releasePointerCapture(e.pointerId);
    };
    const cancel = () => { points.clear(); start = null; moved = true; };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('lostpointercapture', up);
    // Prevent compatibility mouse events and the old touch selection path.
    const suppress = (e) => e.preventDefault();
    canvas.addEventListener('touchstart', suppress, { passive: false });
    canvas.addEventListener('touchmove', suppress, { passive: false });
    window.addEventListener('blur', cancel);
    return () => {
        cancel();
        canvas.removeEventListener('pointerdown', down);
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', up);
        canvas.removeEventListener('pointercancel', up);
        canvas.removeEventListener('lostpointercapture', up);
        canvas.removeEventListener('touchstart', suppress);
        canvas.removeEventListener('touchmove', suppress);
        window.removeEventListener('blur', cancel);
    };
}
//# sourceMappingURL=touch-map-input.js.map