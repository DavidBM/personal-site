/** Drag a fixed-position panel by its header (buttons in the header still click). */
export function dragByHeader(root, header) {
    header.addEventListener("pointerdown", (e) => {
        if (e.target.closest("button, input, select"))
            return;
        const r = root.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
        header.setPointerCapture(e.pointerId);
        const move = (m) => {
            const left = Math.min(Math.max(m.clientX - dx, 0), innerWidth - 80), top = Math.min(Math.max(m.clientY - dy, 0), innerHeight - 40);
            Object.assign(root.style, { left: `${left}px`, top: `${top}px`, right: "auto" });
        };
        const up = () => { header.removeEventListener("pointermove", move); header.removeEventListener("pointerup", up); };
        header.addEventListener("pointermove", move);
        header.addEventListener("pointerup", up);
    });
}
//# sourceMappingURL=floating-panel.js.map