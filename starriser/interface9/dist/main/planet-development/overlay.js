const colors = ['', '#6de1ac', '#f4b86a', '#93b5ff', '#bba4ed'];
/** Bounded by the 32-row page, in the raster worker. No tile ownership grid. */
export function drawDevelopment(ctx, view, value) {
    ctx.save();
    function site(x, y, kind, selected) {
        const px = (x / view.scale - view.x + view.level) % view.level, py = y / view.scale - view.y;
        const r = 14 / view.scale;
        if (px + r < 0 || px - r > view.width || py + r < 0 || py - r > view.height)
            return;
        ctx.strokeStyle = colors[kind] ?? '#fff';
        ctx.fillStyle = colors[kind] ?? '#fff';
        ctx.lineWidth = selected ? 1 : .5;
        // The rings are area planning aids; they do not claim simulated effects.
        ctx.globalAlpha = .14;
        ctx.beginPath();
        ctx.arc(px, py, Math.max(2, r), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = .8;
        ctx.stroke();
        ctx.globalAlpha = 1;
        const s = 1 / view.scale;
        for (const [dx, dy] of (kind === 1 ? [[0, 0], [1, 0], [0, 1]] : [[0, 0], [1, 0], [0, 1], [1, 1]]))
            ctx.fillRect(px + dx * s, py + dy * s, Math.max(.7, s), Math.max(.7, s));
        if (selected) {
            ctx.strokeStyle = '#fff';
            ctx.strokeRect(px - 2, py - 2, Math.max(4, 2 * s + 4), Math.max(4, 2 * s + 4));
        }
    }
    for (const b of value.buildings)
        site(b.x, b.y, b.kind, b.id === value.selected);
    if (value.anchor)
        site(value.anchor.x, value.anchor.y, value.anchor.kind, true);
    ctx.restore();
}
//# sourceMappingURL=overlay.js.map