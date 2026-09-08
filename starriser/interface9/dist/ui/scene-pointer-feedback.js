/** Lightweight DOM reticle: hit testing stays data-driven and GPU-free. */
export function createScenePointerFeedback(parent) {
    const reticle = document.createElement("div");
    reticle.id = "scene-hover-reticle";
    reticle.setAttribute("aria-hidden", "true");
    Object.assign(reticle.style, {
        position: "fixed", width: "28px", height: "28px", borderRadius: "50%",
        pointerEvents: "none", display: "none", zIndex: "900",
        transform: "translate(-50%, -50%) rotate(45deg)",
        transition: "border-color 90ms, box-shadow 90ms, opacity 90ms",
    });
    parent.appendChild(reticle);
    function update(kind, x = 0, y = 0) {
        if (kind == null) {
            reticle.style.display = "none";
            return;
        }
        const color = kind === "fleet" ? "96,226,255" : "255,196,92";
        reticle.dataset.kind = kind;
        reticle.style.display = "block";
        reticle.style.left = `${x}px`;
        reticle.style.top = `${y}px`;
        reticle.style.border = `1px solid rgba(${color},.9)`;
        reticle.style.boxShadow = `0 0 5px rgba(${color},.85), inset 0 0 8px rgba(${color},.28)`;
    }
    return { update, dispose: () => reticle.remove() };
}
//# sourceMappingURL=scene-pointer-feedback.js.map