/** Browser preference boundary; renderer receives a boolean. */
export function readBrowserFrameDebug() {
    const value = new URLSearchParams(window.location.search).get("frameDebug");
    if (value === "1" || value === "true" || value === "yes")
        return true;
    if (value === "0" || value === "false")
        return false;
    try {
        const saved = window.localStorage.getItem("galaxyFrameDebug");
        return saved === "1" || saved === "true";
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=browser-frame-debug.js.map