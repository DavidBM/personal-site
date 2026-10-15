/** Async worker picking, fenced against newer input. Never sends a camera command. */
export function createClusterRibbonInput(client, open) {
    let generation = 0, hoverGeneration = 0, hoverAt = 0, hoverBusy = false;
    let hovered = null;
    function reset() {
        generation++;
        hoverGeneration++;
        hovered = null;
        client()?.canvas.classList.remove('cluster-ribbon-hover');
    }
    async function pick(x, y) {
        const renderer = client(), snapshot = renderer?.snapshot();
        // The worker owns opacity and the moving dock's hit regions, including scene exit.
        if (!renderer || !snapshot)
            return null;
        const rect = renderer.canvas.getBoundingClientRect();
        return await renderer.query({ type: 'pickClusterRibbon', x: x - rect.left, y: y - rect.top });
    }
    function route(payload, fallback) {
        if (payload.type === 'down')
            generation++;
        if (payload.type !== 'tap' || payload.eventSource === 'context')
            return false;
        const { x, y } = payload.screen_position;
        select(x, y, fallback);
        return true;
    }
    function select(x, y, fallback) {
        const current = ++generation;
        void pick(x, y).then(hit => {
            if (current !== generation)
                return;
            if (hit) {
                hovered = { x, y };
                open(hit);
            }
            else
                fallback();
        }).catch(() => { if (current === generation)
            fallback(); });
    }
    function hover(x, y) {
        if (x < 0 || y < 0) {
            reset();
            return;
        }
        if (hoverBusy || performance.now() - hoverAt < 80)
            return;
        hoverAt = performance.now();
        hoverBusy = true;
        const current = ++hoverGeneration;
        void pick(x, y).then(hit => {
            if (current !== hoverGeneration)
                return;
            hovered = hit ? { x, y } : null;
            client()?.canvas.classList.toggle('cluster-ribbon-hover', hit !== null);
        }).catch(() => { }).finally(() => { hoverBusy = false; });
    }
    // Camera's existing double-click dive must not fire on a sidebar affordance.
    function doubleClick(event) {
        if (!hovered || Math.hypot(event.clientX - hovered.x, event.clientY - hovered.y) > 6)
            return;
        event.preventDefault();
        event.stopImmediatePropagation();
    }
    return { route, select, hover, reset, doubleClick };
}
//# sourceMappingURL=cluster-ribbon-input.js.map