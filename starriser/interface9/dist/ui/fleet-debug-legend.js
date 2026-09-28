/** View-only explanation for the selected-fleet sampled diagnostics. */
export function createFleetDebugLegend(parent) {
    const element = document.createElement('div');
    Object.assign(element.style, { position: 'fixed', left: '50%', top: '92px', transform: 'translateX(-50%)',
        color: '#b2c7d8', background: 'rgba(4,12,23,.86)', border: '1px solid #25455a', padding: '5px 7px',
        font: '9px/1.4 monospace', pointerEvents: 'none', zIndex: '6', maxWidth: '430px' });
    element.hidden = true;
    element.textContent = 'Selected fleet · ≤12 samples · 5 Hz · hidden after 1s stale\nWhite: latest mean · magenta: sampled route frame · gray: frame distance\nYellow: navigation heading × reach · green: measured velocity ×2s\nBlue: post-formation intent ×2s / repulsion radius · red: body avoidance ×1s²\nCues exclude neighbor/contact forces. Dashed paths show automatic intent.';
    element.style.whiteSpace = 'pre-line';
    parent.append(element);
    return { show(on) { element.hidden = !on; }, dispose() { element.remove(); } };
}
//# sourceMappingURL=fleet-debug-legend.js.map