/** One breakpoint for layout, safe menu placement and touch-sized controls. */
export const MOBILE_QUERY = '(max-width: 760px), (pointer: coarse) and (max-width: 1100px)';
export function isMobileLayout() { return matchMedia(MOBILE_QUERY).matches; }
export function menuBottomInset() {
    if (!isMobileLayout())
        return 4;
    const rail = document.getElementById('galaxy-dock-debug');
    return rail ? window.innerHeight - rail.getBoundingClientRect().top + 8 : 96;
}
export function showDockPanel(id) {
    window.dispatchEvent(new CustomEvent('galaxy:show-panel', { detail: id }));
}
//# sourceMappingURL=mobile-layout.js.map