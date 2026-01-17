/**
 * SelectionService - Manages hovered and selected cluster state with observable pattern.
 *
 * Standalone, pure logic. Use:
 *   SelectionService.setHovered(clusterId)
 *   SelectionService.setSelected(clusterId)
 *   SelectionService.subscribe(fn) // fn({ hoveredId, selectedId })
 *   SelectionService.unsubscribe(fn)
 *   SelectionService.getState() // { hoveredId, selectedId }
 *
 * Observers receive notification on any change.
 */
export const SelectionService = (() => {
    let hoveredId = null;
    let selectedId = null;
    const observers = new Set();
    function notify() {
        const state = { hoveredId, selectedId };
        for (const fn of observers)
            fn(state);
    }
    return {
        setHovered(id) {
            if (id === hoveredId)
                return;
            hoveredId = id;
            notify();
        },
        setSelected(id) {
            if (id === selectedId)
                return;
            selectedId = id;
            notify();
        },
        getState() {
            return { hoveredId, selectedId };
        },
        subscribe(fn) {
            observers.add(fn);
            // Optionally flush current state immediately:
            fn({ hoveredId, selectedId });
        },
        unsubscribe(fn) {
            observers.delete(fn);
        },
        clear() {
            hoveredId = null;
            selectedId = null;
            notify();
        },
    };
})();
//# sourceMappingURL=SelectionService.js.map