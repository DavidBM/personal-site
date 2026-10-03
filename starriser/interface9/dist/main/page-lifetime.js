/** Workers must stop before pagehide returns; async cleanup can be suspended. */
export function bindPageLifetime(page, stop, reload) {
    const detach = () => page.removeEventListener('pagehide', hide);
    const hide = (event) => {
        detach();
        // A cached document no longer owns a live renderer/canvas. Restore via a
        // fresh boot rather than displaying its terminated OffscreenCanvas.
        if (event.persisted)
            page.addEventListener('pageshow', () => reload(), { once: true });
        stop();
    };
    page.addEventListener('pagehide', hide);
    return detach;
}
//# sourceMappingURL=page-lifetime.js.map